# -*- coding: utf-8 -*-
"""
负荷数据校核模块 API
提供负荷数据完整性校核、误差分析、数据聚合等功能
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from bson import ObjectId
from fastapi import APIRouter, Query, HTTPException, Depends, File, UploadFile
from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user, User
from webapp.services.meter_data_import_service import MeterDataImportService
from webapp.services.mp_data_import_service import MpDataImportService
from webapp.services.load_aggregation_service import LoadAggregationService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/load-data", tags=["load-data"])

# 集合定义
CUSTOMER_ARCHIVES = DATABASE['customer_archives']
UNIFIED_LOAD_CURVE = DATABASE['unified_load_curve']
RAW_MP_DATA = DATABASE['raw_mp_data']
RAW_METER_DATA = DATABASE['raw_meter_data']
RETAIL_CONTRACTS = DATABASE['retail_contracts']

from webapp.models.load_enums import FusionStrategy
from webapp.services.load_query_service import LoadQueryService


# ##############################################################################
# 主页面接口
# ##############################################################################

@router.get("/summary", summary="获取数据校核统计概览")
async def get_load_data_summary(
    current_user: User = Depends(get_current_active_user)
):
    """
    获取统计卡片数据 (v3.0)：
    - total_customers: 签约客户数
    - pending_mp_days: 待聚合计量点数据天数
    - pending_meter_days: 待聚合电表数据天数
    - integrity_anomaly_count: 完整率异常 (<90%)
    - reliability_anomaly_count: 可靠率异常 (<90%)
    - accuracy_anomaly_count: 准确率异常 (误差>5%)
    """
    try:
        from datetime import datetime as dt
        today = dt.now().strftime("%Y-%m-%d")
        
        # 1. 签约客户
        today_dt = dt.now()
        signed_contracts = RETAIL_CONTRACTS.find({
            "purchase_start_month": {"$lte": today_dt},
            "purchase_end_month": {"$gte": today_dt}
        })
        signed_customer_ids = list(set(
            c.get("customer_id") for c in signed_contracts if c.get("customer_id")
        ))
        total_customers = len(signed_customer_ids)
        
        # 2. 待聚合数据计算 (新逻辑: 对比原始数据 vs 聚合结果)
        # 2.1 获取所有签约客户的计量点ID和电表ID
        customer_mp_ids = {}  # customer_id -> [mp_id list]
        customer_meter_ids = {}  # customer_id -> [meter_id list]
        
        for cust in CUSTOMER_ARCHIVES.find({"_id": {"$in": [ObjectId(cid) if len(cid) == 24 else cid for cid in signed_customer_ids]}}):
            cid = str(cust.get("_id"))
            mp_list = []
            meter_list = []
            for account in cust.get("accounts", []):
                for mp in account.get("metering_points", []):
                    if mp.get("mp_no"):
                        mp_list.append(mp["mp_no"])
                for meter in account.get("meters", []):
                    if meter.get("meter_id"):
                        meter_list.append(meter["meter_id"])
            customer_mp_ids[cid] = mp_list
            customer_meter_ids[cid] = meter_list
        
        # 2.2 获取原始数据的(customer_id, date)对
        all_mp_ids = [mp for mps in customer_mp_ids.values() for mp in mps]
        all_meter_ids = [m for ms in customer_meter_ids.values() for m in ms]
        
        # MP原始数据日期
        raw_mp_dates_by_mp = {}
        if all_mp_ids:
            for doc in RAW_MP_DATA.find({"mp_id": {"$in": all_mp_ids}}, {"mp_id": 1, "date": 1}):
                mp_id = doc.get("mp_id")
                date = doc.get("date")
                if mp_id and date:
                    raw_mp_dates_by_mp.setdefault(mp_id, set()).add(date)
        
        # Meter原始数据日期
        raw_meter_dates_by_meter = {}
        if all_meter_ids:
            for doc in RAW_METER_DATA.find({"meter_id": {"$in": all_meter_ids}}, {"meter_id": 1, "date": 1}):
                meter_id = doc.get("meter_id")
                date = doc.get("date")
                if meter_id and date:
                    raw_meter_dates_by_meter.setdefault(meter_id, set()).add(date)
        
        # 2.3 获取聚合结果的(customer_id, date)对
        aggregated_mp_dates = {}  # customer_id -> set of dates with mp_load
        aggregated_meter_dates = {}  # customer_id -> set of dates with meter_load
        
        for doc in UNIFIED_LOAD_CURVE.find(
            {"customer_id": {"$in": signed_customer_ids}},
            {"customer_id": 1, "date": 1, "mp_load": 1, "meter_load": 1}
        ):
            cid = doc.get("customer_id")
            date = doc.get("date")
            if doc.get("mp_load"):
                aggregated_mp_dates.setdefault(cid, set()).add(date)
            if doc.get("meter_load"):
                aggregated_meter_dates.setdefault(cid, set()).add(date)
        
        # 2.4 计算待聚合客户数（有多少客户的原始数据天数 > 已聚合天数）
        pending_mp_customers = 0
        pending_meter_customers = 0
        
        for cid in signed_customer_ids:
            # MP: 原始数据日期 - 已聚合日期
            mp_ids = customer_mp_ids.get(cid, [])
            raw_mp_dates = set()
            for mp_id in mp_ids:
                raw_mp_dates.update(raw_mp_dates_by_mp.get(mp_id, set()))
            agg_mp_dates = aggregated_mp_dates.get(cid, set())
            if len(raw_mp_dates) > len(agg_mp_dates):
                pending_mp_customers += 1
            
            # Meter: 原始数据日期 - 已聚合日期
            meter_ids = customer_meter_ids.get(cid, [])
            raw_meter_dates = set()
            for meter_id in meter_ids:
                raw_meter_dates.update(raw_meter_dates_by_meter.get(meter_id, set()))
            agg_meter_dates = aggregated_meter_dates.get(cid, set())
            if len(raw_meter_dates) > len(agg_meter_dates):
                pending_meter_customers += 1
        
        # 3. 统计异常
        integrity_issue_count = 0
        reliability_issue_count = 0
        accuracy_issue_count = 0
        
        # 批量获取最近30天统计
        pipeline = [
             {"$match": {"customer_id": {"$in": signed_customer_ids}}},
             {"$sort": {"date": -1}},
             {"$group": {
                 "_id": "$customer_id",
                 "recent_docs": {"$push": "$$ROOT"}
             }},
             {"$project": {
                 "recent_docs": {"$slice": ["$recent_docs", 30]}
             }}
        ]

        cursor = UNIFIED_LOAD_CURVE.aggregate(pipeline)
        
        for doc in cursor:
            recent_data = doc.get("recent_docs", [])
            if not recent_data:
                integrity_issue_count += 1
                continue
                
            dates = {d.get("date") for d in recent_data}
            total_days = 30 # Check last 30 days window
            
            # --- Integrity (完整率) ---
            integrity_rate = len(dates) / total_days
            if integrity_rate < 0.9:
                integrity_issue_count += 1
                
            # --- Reliability (可靠率异常) ---
            # 定义改为：只要最近30天内有任何一天存在计量点缺失，即计为异常
            has_reliability_issue = any(
                len(d.get("mp_load", {}).get("missing_mps", [])) > 0 
                for d in recent_data if d.get("mp_load")
            )
            if has_reliability_issue:
                reliability_issue_count += 1
                
            # --- Accuracy (准确率) ---
            has_warning = any(
                d.get("deviation", {}).get("is_warning", False)
                for d in recent_data if d.get("deviation")
            )
            if has_warning:
                accuracy_issue_count += 1

        return {
            "total_customers": total_customers,
            "pending_mp_customers": pending_mp_customers,
            "pending_meter_customers": pending_meter_customers,
            "integrity_anomaly_count": integrity_issue_count,
            "reliability_anomaly_count": reliability_issue_count,
            "accuracy_anomaly_count": accuracy_issue_count
        }
    except Exception as e:
        logger.error(f"获取统计概览失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取统计概览失败: {str(e)}")


@router.get("/customers", summary="获取客户校核列表")
async def get_load_data_customers(
    status: Optional[str] = Query(None, description="筛选状态: anomaly/error/pending"),
    search: Optional[str] = Query(None, description="搜索客户名称"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页大小"),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取客户列表 (v3.0)
    返回字段:
    - integrity_rate: 完整率
    - reliability_rate: 可靠率
    - accuracy_rate: 准确率
    - contract_days: 合同天数 (估算)
    - status: 状态 ('normal', 'pending', 'warning', 'critical')
    """
    try:
        from datetime import datetime as dt
        today = dt.now()

        # 1. 签约客户
        signed_contracts = RETAIL_CONTRACTS.find({
            "purchase_start_month": {"$lte": today},
            "purchase_end_month": {"$gte": today}
        })
        
        signed_customers = {} # cid -> {name, start, end}
        for c in signed_contracts:
            cid = c.get("customer_id")
            cname = c.get("customer_name")
            if cid and cname:
                signed_customers[cid] = {
                    "name": cname,
                    "start": c.get("purchase_start_month"),
                    "end": c.get("purchase_end_month")
                }
                
        customer_ids = list(signed_customers.keys())

        # 2. 聚合统计
        pipeline = [
            {"$match": {"customer_id": {"$in": customer_ids}}},
            {"$addFields": {
                "has_missing_mp": {
                    "$gt": [{"$size": {"$ifNull": ["$mp_load.missing_mps", []]}}, 0]
                }
            }},
            {"$group": {
                "_id": "$customer_id",
                "mp_dates": {"$push": {"$cond": [{"$ne": ["$mp_load", None]}, "$date", "$$REMOVE"]}},
                "meter_dates": {"$push": {"$cond": [{"$ne": ["$meter_load", None]}, "$date", "$$REMOVE"]}},
                "all_dates": {"$push": "$date"},
                "missing_mp_days": {"$sum": {"$cond": ["$has_missing_mp", 1, 0]}},
                "deviations": {"$push": "$deviation"}
            }}
        ]
        
        load_stats = {
            doc["_id"]: doc 
            for doc in UNIFIED_LOAD_CURVE.aggregate(pipeline)
        }
        
        result = []
        for cid, info in signed_customers.items():
            if search and search.lower() not in info['name'].lower():
                continue
            
            stats = load_stats.get(cid, {})
            
            # --- Metrics Calculation ---
            
            # 1. Integrity (完整率) & Cycle (周期/天数)
            # User Definition:
            # Cycle: Earliest record date ~ Latest record date
            # Days: Count of records in unified_load_curve
            # Integrity Rate: Record Count / (Yesterday - Earliest Record Date)
            
            unique_dates = sorted(list(set(stats.get("all_dates", []))))
            record_count = len(unique_dates)
            
            cycle_range = "-"
            data_days = 0 
            integrity_rate = 0.0

            if unique_dates:
                # Cycle display
                min_date_str = unique_dates[0]
                max_date_str = unique_dates[-1]
                cycle_range = f"{min_date_str}~{max_date_str}"
                data_days = record_count
                
                # Integrity Calculation
                try:
                    min_date = dt.strptime(min_date_str, "%Y-%m-%d")
                    yesterday = today.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
                    
                    # Denominator: Days from Earliest Record to Yesterday
                    expected_days = (yesterday - min_date).days + 1
                    
                    if expected_days > 0:
                        integrity_rate = record_count / expected_days
                    else:
                        integrity_rate = 1.0 if record_count > 0 else 0.0

                except Exception:
                    integrity_rate = 0.0
            
            integrity_rate = min(1.0, integrity_rate)
            
            # 2. Reliability (可靠率/异常天数)
            missing_mp_days = stats.get("missing_mp_days", 0)
            
            # 3. Accuracy (准确率)
            daily_errors = []
            has_warning = False
            for dev in stats.get("deviations", []):
                if dev and isinstance(dev, dict):
                    if dev.get("daily_error") is not None:
                        daily_errors.append(abs(dev["daily_error"]))
                    if dev.get("is_warning"):
                        has_warning = True
            
            avg_error = sum(daily_errors) / len(daily_errors) if daily_errors else 0.0
            accuracy_rate = 1.0 - avg_error
            accuracy_rate = max(0.0, accuracy_rate)

            # Logic: 
            # Critical: Integrity < 80% OR Accuracy < 95% (Error > 5%)
            # Warning: Reliability issue (missing_mp_days > 0)
            # Pending: Has one side missing? (Simplified check)
            # Normal: Else
            
            mp_count = len(stats.get("mp_dates", []))
            meter_count = len(stats.get("meter_dates", []))
            is_pending = mp_count != meter_count
            
            status_code = 'normal'
            if integrity_rate < 0.8 or accuracy_rate < 0.95:
                status_code = 'critical'
            elif missing_mp_days > 0:
                status_code = 'warning'
            elif is_pending:
                status_code = 'pending'

            # Filter by status if requested
            if status:
                map_status = {
                    'anomaly': ['critical', 'warning'], # Map 'abnormal/limit' to critical/warning
                    'error': ['critical'],
                    'pending': ['pending']
                }
                # Mapping user's query param to our new status
                # If status is 'anomaly' (integrity), check integrity
                # If status is 'error' (accuracy), check accuracy
                # If status is 'pending', check pending
                
                # To be precise with legacy params:
                match = False
                if status == 'anomaly' and (integrity_rate < 0.9 or missing_mp_days > 0): match = True
                if status == 'error' and accuracy_rate < 0.95: match = True
                if status == 'pending' and is_pending: match = True
                if status == 'reliability' and missing_mp_days > 0: match = True
                if status == 'pending_meter' and is_pending: match = True  # Uses same logic as pending for now
                if not match:
                    continue

            result.append({
                "customer_id": cid,
                "customer_name": info['name'],
                "cycle_range": cycle_range,
                "data_days": data_days,
                "integrity_rate": integrity_rate,
                "reliability_issue_days": missing_mp_days,
                "accuracy_rate": accuracy_rate,
                "data_distribution": {
                    "mp": mp_count,
                    "meter": meter_count
                },
                "status": status_code
            })

        # Sorting & Pagination
        # Sort by status priority (Critical > Warning > Pending > Normal)
        status_priority = {'critical': 0, 'warning': 1, 'pending': 2, 'normal': 3}
        result.sort(key=lambda x: status_priority.get(x['status'], 3))
        
        total = len(result)
        start = (page - 1) * page_size
        end = start + page_size
        paged_result = result[start:end]
        
        return {
            "total": total,
            "customers": paged_result
        }
    except Exception as e:
        logger.error(f"获取客户列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取失败: {str(e)}")


def _calculate_continuity(dates: List[str]) -> float:
    """计算日期连续性（无缺天的比例）"""
    if not dates or len(dates) < 2:
        return 1.0 if dates else 0.0
    
    start = datetime.strptime(dates[0], "%Y-%m-%d")
    end = datetime.strptime(dates[-1], "%Y-%m-%d")
    expected_days = (end - start).days + 1
    actual_days = len(set(dates))
    
    return actual_days / expected_days if expected_days > 0 else 0.0


# ##############################################################################
# 客户详情接口
# ##############################################################################

@router.get("/customers/{customer_id}", summary="获取客户详情")
async def get_customer_detail(
    customer_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """
    获取客户详情，包含：
    - 基础统计（户号数/电表数/计量点数）
    - 质量指标（断点天数/缺失天数/准确率）
    - 电表档案
    """
    try:
        from bson import ObjectId
        
        # 获取客户档案
        customer = CUSTOMER_ARCHIVES.find_one({"_id": customer_id})
        if not customer:
            customer = CUSTOMER_ARCHIVES.find_one({"_id": ObjectId(customer_id)})
        
        if not customer:
            raise HTTPException(status_code=404, detail="客户不存在")
        
        # 统计户号数/电表数/计量点数
        account_count = len(customer.get("accounts", []))
        meter_count = 0
        mp_count = 0
        accounts = []
        
        for account in customer.get("accounts", []):
            account_meters = account.get("meters", [])
            account_mps = account.get("metering_points", [])
            meter_count += len(account_meters)
            mp_count += len(account_mps)
            
            accounts.append({
                "account_no": account.get("account_no", ""),
                "meters": [{
                    "meter_id": m.get("meter_id"),
                    "multiplier": m.get("multiplier", 1),
                    "allocation_ratio": m.get("allocation_ratio")
                } for m in account_meters],
                "metering_points": [mp.get("mp_no") for mp in account_mps]
            })
        
        # 获取该客户的所有负荷曲线数据（用于计算质量指标）
        curves = list(UNIFIED_LOAD_CURVE.find(
            {"customer_id": customer_id}
        ).sort("date", -1))
        
        # 计算数据概览
        all_dates = sorted(set(c["date"] for c in curves))
        mp_dates = sorted([c["date"] for c in curves if c.get("mp_load")])
        meter_dates = sorted([c["date"] for c in curves if c.get("meter_load")])
        
        # 计算断点天数（期望天数 - 实际天数）
        if all_dates:
            start = datetime.strptime(all_dates[0], "%Y-%m-%d")
            end = datetime.strptime(all_dates[-1], "%Y-%m-%d")
            expected_days = (end - start).days + 1
            actual_days = len(all_dates)
            gap_days = expected_days - actual_days
        else:
            gap_days = 0
            expected_days = 0
            actual_days = 0
        
        # 计算MP缺失天数（coverage < 100%的天数）
        mp_incomplete_days = 0
        for c in curves:
            if c.get("mp_load"):
                mp = c["mp_load"]
                mp_count = mp.get("mp_count", 0)
                missing = len(mp.get("missing_mps", []))
                # 如果有缺失点，则为不完整
                if missing > 0:
                    mp_incomplete_days += 1
        
        # 计算平均准确率
        daily_errors = []
        for c in curves:
            if c.get("deviation") and c["deviation"].get("daily_error") is not None:
                daily_errors.append(abs(c["deviation"]["daily_error"]))
        
        avg_accuracy = (1 - sum(daily_errors) / len(daily_errors)) * 100 if daily_errors else None
        
        # 获取日期范围
        date_range = f"{all_dates[0]} ~ {all_dates[-1]}" if all_dates else None
        
        return {
            "customer_id": customer_id,
            "customer_name": customer.get("user_name", "未知"),
            "stats": {
                "account_count": account_count,
                "meter_count": meter_count,
                "mp_count": mp_count
            },
            "quality": {
                "gap_days": gap_days,  # 断点天数
                "mp_incomplete_days": mp_incomplete_days,  # MP缺失天数
                "avg_accuracy": round(avg_accuracy, 1) if avg_accuracy else None,  # 平均准确率
                "total_days": actual_days  # 总数据天数
            },
            "date_range": date_range,
            "accounts": accounts
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取客户详情失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取客户详情失败: {str(e)}")


@router.get("/customers/{customer_id}/calendar", summary="获取热力图日历数据")
async def get_customer_calendar(
    customer_id: str,
    month: Optional[str] = Query(None, description="月份, 格式 YYYY-MM"),
    fetch_all: bool = Query(False, alias="all", description="是否获取全部数据（用于时间线视图），忽略 month 参数"),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取热力图日历数据，显示每天的采集完整度
    """
    try:
        # 确定查询日期范围
        if fetch_all:
            # 获取全部数据（不限制日期范围）
            start_date = None
            end_date = None
        elif month:
            year, mon = map(int, month.split("-"))
            start_date = f"{year:04d}-{mon:02d}-01"
            if mon == 12:
                end_date = f"{year+1:04d}-01-01"
            else:
                end_date = f"{year:04d}-{mon+1:02d}-01"
        else:
            # 默认最近30天
            today = datetime.now()
            start_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")
            end_date = (today + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # 查询数据
        query = {"customer_id": customer_id}
        if start_date and end_date:
            query["date"] = {"$gte": start_date, "$lt": end_date}
        
        curves = list(UNIFIED_LOAD_CURVE.find(
            query,
            {"date": 1, "mp_load": 1, "meter_load": 1, "deviation": 1}
        ).sort("date", 1))
        
        # 构建日历数据
        calendar_data = []
        for curve in curves:
            date = curve.get("date")
            mp_load = curve.get("mp_load", {})
            meter_load = curve.get("meter_load", {})
            
            # 动态计算覆盖率
            coverage = 0
            if mp_load:
                mp_cnt = mp_load.get("mp_count", 0)
                missing_cnt = len(mp_load.get("missing_mps", []))
                total_mps = mp_cnt + missing_cnt
                coverage = mp_cnt / total_mps if total_mps > 0 else 0
            has_meter = bool(meter_load)
            
            # 计算计量点实际/期望数量
            missing_mps = mp_load.get("missing_mps", []) if mp_load else []
            # 通过coverage反算: actual/expected = coverage, missing = expected - actual
            # 即: mp_expected = len(missing_mps) / (1 - coverage) if coverage < 1
            # 简化处理：直接返回覆盖率和缺失数
            mp_missing = len(missing_mps)
            
            # 计算当日准确率
            deviation = curve.get("deviation", {})
            daily_error = deviation.get("daily_error") if deviation else None
            daily_accuracy = round((1 - abs(daily_error)) * 100, 1) if daily_error is not None else None
            
            # 电表数据统计
            meter_count = meter_load.get("meter_count", 0) if meter_load else 0
            expected_meters = meter_load.get("data_quality", {}).get("expected_meters", 0) if meter_load else 0
            actual_meters = meter_load.get("data_quality", {}).get("actual_meters", 0) if meter_load else 0
            
            calendar_data.append({
                "date": date,
                "coverage": round(coverage * 100, 1),
                "has_meter_data": has_meter,
                "daily_accuracy": daily_accuracy,
                "mp_missing": mp_missing,  # 缺失计量点数
                "meter_actual": actual_meters,  # 实际有数据的电表数
                "meter_expected": expected_meters,  # 期望电表数
                "missing_mps": missing_mps
            })
        
        # 获取缺失日期列表（仅在指定日期范围时计算）
        missing_dates = []
        if start_date and end_date:
            all_dates = set()
            current = datetime.strptime(start_date, "%Y-%m-%d")
            end = datetime.strptime(end_date, "%Y-%m-%d")
            while current < end:
                all_dates.add(current.strftime("%Y-%m-%d"))
                current += timedelta(days=1)
            
            existing_dates = {c["date"] for c in calendar_data}
            missing_dates = sorted(all_dates - existing_dates)
        
        incomplete_dates = [c["date"] for c in calendar_data if c["coverage"] < 100]
        
        return {
            "customer_id": customer_id,
            "calendar": calendar_data,
            "missing_dates": missing_dates,
            "incomplete_dates": incomplete_dates
        }
    except Exception as e:
        logger.error(f"获取日历数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取日历数据失败: {str(e)}")


@router.get("/customers/{customer_id}/curves", summary="获取曲线对比数据")
async def get_customer_curves(
    customer_id: str,
    start_date: str = Query(..., description="开始日期, 格式 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期, 格式 YYYY-MM-DD"),
    detail_date: Optional[str] = Query(None, description="详情日期（返回48点数据）"),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取曲线对比数据：
    - 如果指定 detail_date，返回该日期的48点曲线对比
    - 否则返回日期范围内的日电量对比
    """
    try:
        if detail_date:
            # 返回48点曲线对比
            logger.info(f"API get_customer_curves: customer_id={customer_id}, detail_date={detail_date}")
            curve = UNIFIED_LOAD_CURVE.find_one({
                "customer_id": customer_id,
                "date": detail_date
            })
            logger.info(f"API get_customer_curves result: {bool(curve)}")
            
            if not curve:
                return {"date": detail_date, "mp_values": [], "meter_values": [], "point_errors": []}
            
            mp_values = curve.get("mp_load", {}).get("values", []) if curve.get("mp_load") else []
            meter_values = curve.get("meter_load", {}).get("values", []) if curve.get("meter_load") else []
            deviation = curve.get("deviation") or {}
            
            return {
                "date": detail_date,
                "mp_values": mp_values,
                "meter_values": meter_values,
                "mp_total": curve.get("mp_load", {}).get("total") if curve.get("mp_load") else None,
                "meter_total": curve.get("meter_load", {}).get("total") if curve.get("meter_load") else None,
                "daily_error": deviation.get("daily_error"),
                "point_errors": deviation.get("point_errors", [])
            }
        else:
            # 返回日电量对比
            curves = list(UNIFIED_LOAD_CURVE.find({
                "customer_id": customer_id,
                "date": {"$gte": start_date, "$lte": end_date}
            }).sort("date", 1))
            
            daily_comparison = []
            warning_dates = []
            
            for curve in curves:
                date = curve.get("date")
                mp_total = curve.get("mp_load", {}).get("total") if curve.get("mp_load") else None
                meter_total = curve.get("meter_load", {}).get("total") if curve.get("meter_load") else None
                deviation = curve.get("deviation", {})
                daily_error = deviation.get("daily_error")
                is_warning = deviation.get("is_warning", False)
                
                daily_comparison.append({
                    "date": date,
                    "mp_total": mp_total,
                    "meter_total": meter_total,
                    "daily_error": daily_error,
                    "is_warning": is_warning
                })
                
                if is_warning:
                    warning_dates.append({
                        "date": date,
                        "error": daily_error
                    })
            
            return {
                "start_date": start_date,
                "end_date": end_date,
                "daily_comparison": daily_comparison,
                "warning_dates": warning_dates
            }
    except Exception as e:
        logger.error(f"获取曲线对比数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取曲线对比数据失败: {str(e)}")


# ##############################################################################
# 聚合与重算接口
# ##############################################################################

@router.post("/reaggregate", summary="触发重新聚合")
async def trigger_reaggregate(
    data_type: str = Query("all", description="数据类型: mp/meter/all"),
    customer_id: Optional[str] = Query(None, description="指定客户ID，为空则处理所有客户"),
    start_date: Optional[str] = Query(None, description="开始日期（可选，默认自动检测）"),
    end_date: Optional[str] = Query(None, description="结束日期（可选，默认自动检测）"),
    mode: str = Query("incremental", description="聚合模式: incremental(增量)/full(全量)"),
    current_user: User = Depends(get_current_active_user)
):
    """
    触发重新聚合计算（真正的增量逻辑）
    
    业务逻辑：
    1. 获取原始数据中所有 (customer_id, date) 对
    2. 与 unified_load_curve 对比，找出尚未聚合的日期
    3. 只处理缺失的日期（真正的增量）
    """
    import time
    start_time = time.time()
    
    try:
        from datetime import datetime as dt
        from bson import ObjectId
        
        # 确定客户列表
        if customer_id:
            customer_ids = [customer_id]
        else:
            # 获取所有签约客户
            today_dt = dt.now()
            signed_contracts = RETAIL_CONTRACTS.find({
                "purchase_start_month": {"$lte": today_dt},
                "purchase_end_month": {"$gte": today_dt}
            })
            customer_ids = list(set(
                c.get("customer_id") for c in signed_contracts if c.get("customer_id")
            ))
        
        if not customer_ids:
            return {
                "status": "completed",
                "message": "没有找到需要处理的客户",
                "processed": 0,
                "updated": 0
            }
        
        # 获取客户档案信息（计量点和电表）
        customer_info = {}  # customer_id -> {name, mp_ids, meter_ids}
        for cust in CUSTOMER_ARCHIVES.find({"_id": {"$in": [ObjectId(cid) if len(cid) == 24 else cid for cid in customer_ids]}}):
            cid = str(cust.get("_id"))
            mp_list = []
            meter_list = []
            for account in cust.get("accounts", []):
                for mp in account.get("metering_points", []):
                    if mp.get("mp_no"):
                        mp_list.append(mp["mp_no"])
                for meter in account.get("meters", []):
                    if meter.get("meter_id"):
                        meter_list.append(meter["meter_id"])
            customer_info[cid] = {
                "name": cust.get("user_name", "未知"),
                "mp_ids": mp_list,
                "meter_ids": meter_list
            }
        
        # 收集所有需要的 mp_ids 和 meter_ids
        all_mp_ids = [mp for info in customer_info.values() for mp in info["mp_ids"]]
        all_meter_ids = [m for info in customer_info.values() for m in info["meter_ids"]]
        
        # 查询原始数据的日期
        raw_mp_dates = {}  # mp_id -> set of dates
        if all_mp_ids:
            for doc in RAW_MP_DATA.find({"mp_id": {"$in": all_mp_ids}}, {"mp_id": 1, "date": 1}):
                mp_id = doc.get("mp_id")
                date = doc.get("date")
                if mp_id and date:
                    raw_mp_dates.setdefault(mp_id, set()).add(date)
        
        raw_meter_dates = {}  # meter_id -> set of dates
        if all_meter_ids:
            for doc in RAW_METER_DATA.find({"meter_id": {"$in": all_meter_ids}}, {"meter_id": 1, "date": 1}):
                meter_id = doc.get("meter_id")
                date = doc.get("date")
                if meter_id and date:
                    raw_meter_dates.setdefault(meter_id, set()).add(date)
        
        # 查询已聚合的日期
        aggregated_dates = {}  # customer_id -> set of dates
        if mode != "full":
            for doc in UNIFIED_LOAD_CURVE.find(
                {"customer_id": {"$in": list(customer_info.keys())}},
                {"customer_id": 1, "date": 1}
            ):
                cid = doc.get("customer_id")
                date = doc.get("date")
                if cid and date:
                    aggregated_dates.setdefault(cid, set()).add(date)
        
        # 确定每个客户需要处理的日期（增量逻辑）
        customer_pending_dates = {}  # customer_id -> set of pending dates
        for cid, info in customer_info.items():
            # 收集该客户所有原始数据的日期
            raw_dates = set()
            for mp_id in info["mp_ids"]:
                raw_dates.update(raw_mp_dates.get(mp_id, set()))
            for meter_id in info["meter_ids"]:
                raw_dates.update(raw_meter_dates.get(meter_id, set()))
            
            # 减去已聚合的日期
            existing_dates = aggregated_dates.get(cid, set())
            pending_dates = raw_dates - existing_dates
            
            # 如果指定了日期范围，则进一步过滤
            if start_date:
                pending_dates = {d for d in pending_dates if d >= start_date}
            if end_date:
                pending_dates = {d for d in pending_dates if d <= end_date}
            
            if pending_dates:
                customer_pending_dates[cid] = sorted(pending_dates)
        
        # 统计要处理的总数
        total_pending = sum(len(dates) for dates in customer_pending_dates.values())
        
        if total_pending == 0:
            elapsed = time.time() - start_time
            return {
                "status": "completed",
                "message": "所有数据已是最新，无需聚合",
                "customer_count": len(customer_ids),
                "processed": 0,
                "updated": 0,
                "elapsed_seconds": round(elapsed, 2)
            }
        
        # 处理统计
        processed = 0
        updated = 0
        errors = []
        
        for cid, pending_dates in customer_pending_dates.items():
            customer_name = customer_info.get(cid, {}).get("name", "未知")
            
            for date in pending_dates:
                try:
                    result = LoadAggregationService.upsert_unified_load_curve(
                        cid, date, customer_name
                    )
                    if result:
                        updated += 1
                    processed += 1
                except Exception as e:
                    errors.append(f"{cid}@{date}: {str(e)}")
        
        elapsed = time.time() - start_time
        
        return {
            "status": "completed",
            "message": f"增量聚合完成",
            "data_type": data_type,
            "customer_count": len(customer_pending_dates),
            "total_pending": total_pending,
            "processed": processed,
            "updated": updated,
            "elapsed_seconds": round(elapsed, 2),
            "errors": errors[:10] if errors else []
        }
    except Exception as e:
        logger.error(f"触发重新聚合失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"触发重新聚合失败: {str(e)}")


@router.post("/reaggregate/mp", summary="触发计量点数据重新聚合")
async def trigger_reaggregate_mp(
    customer_id: Optional[str] = Query(None, description="指定客户ID"),
    start_date: Optional[str] = Query(None, description="开始日期"),
    end_date: Optional[str] = Query(None, description="结束日期"),
    current_user: User = Depends(get_current_active_user)
):
    """
    基于 raw_mp_data 重新计算 mp_load
    """
    return await trigger_reaggregate("mp", customer_id, start_date, end_date, current_user)


@router.post("/reaggregate/meter", summary="触发电表数据重新聚合")
async def trigger_reaggregate_meter(
    customer_id: Optional[str] = Query(None, description="指定客户ID"),
    start_date: Optional[str] = Query(None, description="开始日期"),
    end_date: Optional[str] = Query(None, description="结束日期"),
    current_user: User = Depends(get_current_active_user)
):
    """
    基于 raw_meter_data 重新计算 meter_load
    """
    return await trigger_reaggregate("meter", customer_id, start_date, end_date, current_user)


# ##############################################################################
# 数据导入接口
# ##############################################################################

@router.post("/import/meter", summary="导入电表示度数据")
async def import_meter_data(
    file: UploadFile = File(..., description="Excel 文件"),
    current_user: User = Depends(get_current_active_user)
):
    """
    导入电表示度数据（Excel 文件）
    
    业务逻辑：
    1. 从文件名提取电表号
    2. 解析 Excel 内容（支持96点/1440点格式）
    3. 无条件增量入库（按 meter_id + date 去重）
    """
    try:
        # 读取文件内容
        content = await file.read()
        filename = file.filename
        
        # 调用导入服务
        result = MeterDataImportService.import_excel_file(content, filename)
        
        return result
    except Exception as e:
        logger.error(f"导入电表数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@router.get("/raw-meter-data", summary="查询原始电表数据")
async def get_raw_meter_data(
    meter_id: Optional[str] = Query(None, description="电表ID"),
    date: Optional[str] = Query(None, description="日期"),
    limit: int = Query(100, description="返回数量限制"),
    current_user: User = Depends(get_current_active_user)
):
    """
    查询原始电表数据
    """
    try:
        query = {}
        if meter_id:
            query["meter_id"] = meter_id
        if date:
            query["date"] = date
        
        records = list(RAW_METER_DATA.find(query).sort("date", -1).limit(limit))
        
        # 转换 ObjectId
        for r in records:
            r["_id"] = str(r["_id"])
        
        return {
            "total": RAW_METER_DATA.count_documents(query),
            "records": records
        }
    except Exception as e:
        logger.error(f"查询原始电表数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/mp", summary="导入计量点负荷数据")
async def import_mp_data(
    file: UploadFile = File(..., description="Excel 文件"),
    current_user: User = Depends(get_current_active_user)
):
    """
    导入计量点负荷数据（Excel 文件）
    
    业务逻辑：
    1. 解析 Excel 内容（支持24/48时段格式）
    2. 提取计量点ID、日期、时段电量
    3. 无条件增量入库（按 mp_id + date 去重）
    """
    try:
        content = await file.read()
        filename = file.filename
        
        result = MpDataImportService.import_excel_file(content, filename)
        
        return result
    except Exception as e:
        logger.error(f"导入计量点数据失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@router.get("/raw-mp-data", summary="查询原始计量点数据")
async def get_raw_mp_data(
    mp_id: Optional[str] = Query(None, description="计量点ID"),
    date: Optional[str] = Query(None, description="日期"),
    limit: int = Query(100, description="返回数量限制"),
    current_user: User = Depends(get_current_active_user)
):
    """
    查询原始计量点数据
    """
    try:
        query = {}
        if mp_id:
            query["mp_id"] = mp_id
        if date:
            query["date"] = date
        
        records = list(RAW_MP_DATA.find(query).sort("date", -1).limit(limit))
        
        # 转换 ObjectId
        for r in records:
            r["_id"] = str(r["_id"])
        
        return {
            "total": RAW_MP_DATA.count_documents(query),
            "records": records
        }
    except Exception as e:
        logger.error(f"查询原始计量点数据失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ##############################################################################
# 负荷曲线查询接口
# ##############################################################################

@router.get("/curve", summary="获取单客户融合曲线")
@router.get("/curve/{customer_id}", summary="获取单客户融合曲线")
async def get_customer_curve(
    customer_id: Optional[str] = None,
    customer_name: Optional[str] = Query(None, description="客户名称 (与 ID 二选一)"),
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    strategy: FusionStrategy = Query(FusionStrategy.MP_PRIORITY, description="融合策略"),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取单客户的融合负荷曲线
    支持通过 customer_id 或 customer_name 查询
    """
    try:
        return LoadQueryService.get_customer_curve(
            customer_id=customer_id, 
            customer_name=customer_name, 
            start_date=start_date, 
            end_date=end_date, 
            strategy=strategy
        )
    except Exception as e:
        logger.error(f"获取客户曲线失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/curves/batch", summary="批量获取客户日电量和曲线")
async def get_curves_batch(
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    customer_ids: Optional[str] = Query(None, description="客户ID列表，逗号分隔"),
    month: Optional[str] = Query(None, description="月份 YYYY-MM，用于筛选签约客户"),
    strategy: FusionStrategy = Query(FusionStrategy.MP_PRIORITY, description="融合策略"),
    include_curves: bool = Query(False, description="是否返回48点曲线（数据量较大）"),
    current_user: User = Depends(get_current_active_user)
):
    """
    批量获取客户日电量和曲线
    """
    try:
        target_ids = [id.strip() for id in customer_ids.split(",")] if customer_ids else None
        
        return LoadQueryService.get_batch_customer_curves(
            start_date, end_date, target_ids, month, strategy, include_curves
        )
    except Exception as e:
        logger.error(f"批量获取客户曲线失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/total-load", summary="获取总负荷日电量曲线")
async def get_total_load(
    start_date: str = Query(..., description="开始日期 YYYY-MM-DD"),
    end_date: str = Query(..., description="结束日期 YYYY-MM-DD"),
    month: Optional[str] = Query(None, description="月份 YYYY-MM，用于筛选签约客户"),
    strategy: FusionStrategy = Query(FusionStrategy.MP_PRIORITY, description="融合策略"),
    include_curves: bool = Query(False, description="是否返回48点曲线（数据量较大）"),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取所有签约客户的总负荷日电量曲线
    """
    try:
        return LoadQueryService.get_total_load_curve(
            start_date, end_date, month, strategy, include_curves
        )
    except Exception as e:
        logger.error(f"获取总负荷曲线失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ##############################################################################
# 系数校核接口
# ##############################################################################

@router.post("/calibration/calculate", summary="计算推荐系数 (最小二乘法)")
async def calculate_calibration_coefficients(
    customer_id: str = Query(..., description="客户ID"),
    start_date: str = Query(..., description="开始日期 (YYYY-MM-DD)"),
    end_date: str = Query(..., description="结束日期 (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_active_user)
):
    """
    计算推荐的电表分配系数 (基于约束最小二乘法)
    """
    try:
        from webapp.services.calibration_service import CalibrationService
        return CalibrationService.calculate_recommended_coefficients(customer_id, start_date, end_date)
    except Exception as e:
        logger.error(f"计算推荐系数失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/calibration/apply", summary="应用推荐系数")
async def apply_calibration_coefficients(
    request: dict, # {customer_id, coefficients, update_history, history_range}
    current_user: User = Depends(get_current_active_user)
):
    """
    应用推荐系数，并可选触发历史重算
    request body:
    {
        "customer_id": str,
        "coefficients": [{"meter_id": str, "value": float}, ...],
        "update_history": bool,
        "history_range": [start_date, end_date] (optional)
    }
    """
    try:
        from webapp.services.calibration_service import CalibrationService
        customer_id = request.get("customer_id")
        coefficients = request.get("coefficients", [])
        update_history = request.get("update_history", False)
        history_range = request.get("history_range")
        
        if not customer_id or not coefficients:
            raise HTTPException(status_code=400, detail="Missing required parameters")
            
        return CalibrationService.apply_coefficients(
            customer_id, coefficients, update_history, history_range
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"应用系数失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
