# -*- coding: utf-8 -*-
"""
负荷数据诊断服务
提供批量客户诊断功能，分析数据完整性和质量
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from bson import ObjectId
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

CUSTOMER_ARCHIVES = DATABASE['customer_archives']
UNIFIED_LOAD_CURVE = DATABASE['unified_load_curve']
RAW_MP_DATA = DATABASE['raw_mp_data']
RAW_METER_DATA = DATABASE['raw_meter_data']
RETAIL_CONTRACTS = DATABASE['retail_contracts']


class DiagnosisService:
    """负荷数据诊断服务"""
    
    @staticmethod
    def get_signed_customers() -> List[Dict]:
        """
        获取所有当前签约客户列表
        
        Returns:
            客户列表 [{"customer_id": str, "customer_name": str}, ...]
        """
        today = datetime.now()
        
        # 查询当前有效的合同
        contracts = list(RETAIL_CONTRACTS.find({
            "purchase_start_month": {"$lte": today},
            "purchase_end_month": {"$gte": today}
        }, {"customer_id": 1, "customer_name": 1}))
        
        # 去重
        customer_map = {}
        for c in contracts:
            cid = str(c.get("customer_id", ""))
            if cid and cid not in customer_map:
                customer_map[cid] = {
                    "customer_id": cid,
                    "customer_name": c.get("customer_name", "未知")
                }
        
        return list(customer_map.values())
    
    @staticmethod
    def diagnose_customer(customer_id: str) -> Dict:
        """
        诊断单个客户的数据质量
        
        Args:
            customer_id: 客户ID
            
        Returns:
            诊断结果
        """
        try:
            # 获取客户档案
            customer = CUSTOMER_ARCHIVES.find_one({"_id": ObjectId(customer_id)})
            if not customer:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": customer_id})
            
            customer_name = customer.get("user_name", "未知") if customer else "未知"
            
            # 统计档案中的总计量点数和总电表数
            total_mp_count = 0
            total_meter_count = 0
            if customer:
                for account in customer.get("accounts", []):
                    total_mp_count += len(account.get("metering_points", []))
                    total_meter_count += len(account.get("meters", []))
            
            # 获取该客户所有聚合曲线
            curves = list(UNIFIED_LOAD_CURVE.find(
                {"customer_id": customer_id},
                {"date": 1, "mp_load": 1, "meter_load": 1, "deviation": 1}
            ).sort("date", 1))
            
            if not curves:
                # 检查是否有未聚合的原始数据
                has_raw_mp = RAW_MP_DATA.find_one({"customer_id": customer_id}) is not None
                has_raw_meter = RAW_METER_DATA.find_one({"customer_id": customer_id}) is not None
                
                return {
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "date_range": {"start": None, "end": None},
                    "total_days": 0,
                    "breakpoint_days": 0,
                    "data_distribution": {"mp_days": 0, "meter_days": 0},
                    "incomplete_days": {"mp_incomplete": 0, "meter_incomplete": 0},
                    "max_error": None,
                    "has_unaggregated": {"mp": has_raw_mp, "meter": has_raw_meter}
                }
            
            # 分析曲线数据
            dates = [c["date"] for c in curves]
            start_date = min(dates)
            end_date = max(dates)
            
            # 计算总天数
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            total_days = (end_dt - start_dt).days + 1
            
            # 生成所有日期集合
            all_dates = set()
            current = start_dt
            while current <= end_dt:
                all_dates.add(current.strftime("%Y-%m-%d"))
                current += timedelta(days=1)
            
            # 已有数据的日期
            existing_dates = set(dates)
            
            # 断点天数
            breakpoint_days = len(all_dates - existing_dates)
            
            # ===== MP缺失天数：基于合同周期计算 =====
            # 获取客户当前合同（当日在合同周期内）
            today = datetime.now()
            contract = RETAIL_CONTRACTS.find_one({
                "customer_id": customer_id,
                "purchase_start_month": {"$lte": today},
                "purchase_end_month": {"$gte": today}
            })
            
            # 如果没有当前合同，则取最新的合同
            if not contract:
                contract = RETAIL_CONTRACTS.find_one(
                    {"customer_id": customer_id},
                    sort=[("purchase_start_month", -1)]
                )
            
            # 确定MP期望日期范围：合同开始日期 → (当日-2)
            mp_expected_end = today - timedelta(days=2)  # MP数据有2天延迟
            
            if contract and contract.get("purchase_start_month"):
                mp_expected_start = contract["purchase_start_month"]
                if isinstance(mp_expected_start, str):
                    mp_expected_start = datetime.strptime(mp_expected_start, "%Y-%m-%d")
            else:
                # 无合同则使用第一条数据日期作为起始
                mp_expected_start = start_dt
            
            # 生成期望的MP日期集合
            expected_mp_dates = set()
            curr = mp_expected_start
            while curr <= mp_expected_end:
                expected_mp_dates.add(curr.strftime("%Y-%m-%d"))
                curr += timedelta(days=1)
            
            # 实际有完整MP数据的日期（actual == expected）
            # 实际有部分MP数据的日期（0 < actual < expected）也算缺失
            complete_mp_dates = set()
            partial_mp_dates = set()
            
            for curve in curves:
                date = curve.get("date")
                if curve.get("mp_load"):
                    mp_actual = curve["mp_load"].get("mp_count", 0)
                    if mp_actual > 0:
                        if mp_actual >= total_mp_count:
                            complete_mp_dates.add(date)
                        else:
                            partial_mp_dates.add(date)  # 部分缺失
            
            # MP缺失天数 = 
            #   1. 期望日期中完全没有MP数据的天数
            #   2. 加上有数据但部分缺失的天数
            missing_mp_dates = expected_mp_dates - complete_mp_dates - partial_mp_dates
            mp_incomplete_days = len(missing_mp_dates) + len(partial_mp_dates)
            
            # ===== 电表和误差统计 =====
            mp_days = len(complete_mp_dates) + len(partial_mp_dates)
            meter_days = 0
            meter_incomplete_days = 0
            max_error = None
            
            for curve in curves:
                meter_load = curve.get("meter_load")
                deviation = curve.get("deviation")
                
                # 电表数据统计
                if meter_load:
                    meter_actual = meter_load.get("meter_count", 0)
                    if meter_actual > 0:
                        meter_days += 1
                    if total_meter_count > 0 and meter_actual < total_meter_count:
                        meter_incomplete_days += 1
                
                # 误差统计
                if deviation:
                    daily_error = deviation.get("daily_error")
                    if daily_error is not None:
                        error_abs = abs(daily_error) * 100  # 转为百分比
                        if max_error is None or error_abs > max_error:
                            max_error = error_abs
            
            # 检查是否有未聚合数据
            # 逻辑改进：
            # 1. 找出 unified_load_curve 中 meter_load 为空或 count=0 的日期 -> invalid_meter_dates
            # 2. 找出 unified_load_curve 中 mp_load 为空或 count=0 的日期 -> invalid_mp_dates
            # 3. 找出 raw_meter_data 的所有日期 -> raw_meter_dates
            # 4. 找出 raw_mp_data 的所有日期 -> raw_mp_dates
            # 5. unaggregated_meter = (raw_meter_dates - existing_dates) | (raw_meter_dates & invalid_meter_dates)
            # 6. unaggregated_mp = (raw_mp_dates - existing_dates) | (raw_mp_dates & invalid_mp_dates)
            
            invalid_meter_dates = set()
            invalid_mp_dates = set()
            
            for curve in curves:
                date = curve.get("date")
                m_load = curve.get("meter_load")
                p_load = curve.get("mp_load")
                
                # Check for empty or zero count
                if not m_load or m_load.get("meter_count", 0) == 0:
                    invalid_meter_dates.add(date)
                    
                if not p_load or p_load.get("mp_count", 0) == 0:
                    invalid_mp_dates.add(date)
            
            # 收集该客户下的所有 meter_id 和 mp_no
            meter_ids = []
            mp_ids = []
            if customer:
                for account in customer.get("accounts", []):
                    for meter in account.get("meters", []):
                        if mid := meter.get("meter_id"):
                            meter_ids.append(mid)
                    for mp in account.get("metering_points", []):
                        if mno := mp.get("mp_no"):
                            mp_ids.append(mno)
            
            # 使用 meter_id 查询 raw_meter_data
            raw_meter_cursor = RAW_METER_DATA.find(
                {"meter_id": {"$in": meter_ids}}, 
                {"date": 1}
            )
            raw_meter_dates = set()
            for d in raw_meter_cursor:
                date_val = d.get("date")
                if isinstance(date_val, str):
                    raw_meter_dates.add(date_val)
                elif hasattr(date_val, 'strftime'):
                     raw_meter_dates.add(date_val.strftime("%Y-%m-%d"))

            # 使用 mp_id 查询 raw_mp_data (注意：raw_mp_data使用mp_id字段，对应档案的mp_no)
            raw_mp_cursor = RAW_MP_DATA.find(
                {"mp_id": {"$in": mp_ids}}, 
                {"date": 1}
            )
            raw_mp_dates = set()
            for d in raw_mp_cursor:
                date_val = d.get("date")
                if isinstance(date_val, str):
                    raw_mp_dates.add(date_val)
                elif hasattr(date_val, 'strftime'):
                     raw_mp_dates.add(date_val.strftime("%Y-%m-%d"))
            
            # Debug logs
            unagg_meter_dates = (raw_meter_dates - existing_dates) | (raw_meter_dates & invalid_meter_dates)
            if has_unaggregated_meter := bool(unagg_meter_dates):
                logger.debug(f"[Diagnosis] Customer {customer_id}: Found {len(unagg_meter_dates)} unaggregated meter dates")
            
            unagg_mp_dates = (raw_mp_dates - existing_dates) | (raw_mp_dates & invalid_mp_dates)
            has_unaggregated_mp = bool(unagg_mp_dates)

            return {
                "customer_id": customer_id,
                "customer_name": customer_name,
                "date_range": {"start": start_date, "end": end_date},
                "total_days": total_days,
                "breakpoint_days": breakpoint_days,
                "data_distribution": {"mp_days": mp_days, "meter_days": meter_days},
                "incomplete_days": {"mp_incomplete": mp_incomplete_days, "meter_incomplete": meter_incomplete_days},
                "max_error": round(max_error, 2) if max_error is not None else None,
                "has_unaggregated": {"mp": has_unaggregated_mp, "meter": has_unaggregated_meter}
            }
            
        except Exception as e:
            logger.error(f"诊断客户 {customer_id} 失败: {e}", exc_info=True)
            return {
                "customer_id": customer_id,
                "customer_name": "错误",
                "date_range": {"start": None, "end": None},
                "total_days": 0,
                "breakpoint_days": 0,
                "data_distribution": {"mp_days": 0, "meter_days": 0},
                "incomplete_days": {"mp_incomplete": 0, "meter_incomplete": 0},
                "max_error": None,
                "has_unaggregated": {"mp": False, "meter": False},
                "error": str(e)
            }
    
    @staticmethod
    def diagnose_all_customers() -> Dict:
        """
        诊断所有签约客户
        
        Returns:
            {
                "summary": {...},
                "customers": [...]
            }
        """
        # 获取签约客户列表
        signed_customers = DiagnosisService.get_signed_customers()
        
        if not signed_customers:
            return {
                "summary": {
                    "total_customers": 0,
                    "unaggregated_customers": 0,
                    "error_anomaly_customers": 0,
                    "mp_missing_customers": 0,
                    "meter_missing_customers": 0,
                    "breakpoint_customers": 0
                },
                "customers": []
            }
        
        # 诊断每个客户
        results = []
        unaggregated_count = 0
        error_anomaly_count = 0
        mp_missing_count = 0
        meter_missing_count = 0
        breakpoint_count = 0
        
        for customer in signed_customers:
            cid = customer["customer_id"]
            diagnosis = DiagnosisService.diagnose_customer(cid)
            results.append(diagnosis)
            
            # 统计
            if diagnosis["has_unaggregated"]["mp"] or diagnosis["has_unaggregated"]["meter"]:
                unaggregated_count += 1
            
            if diagnosis["max_error"] is not None and diagnosis["max_error"] > 2:
                error_anomaly_count += 1
            
            if diagnosis["incomplete_days"]["mp_incomplete"] > 0:
                mp_missing_count += 1
            
            if diagnosis["incomplete_days"]["meter_incomplete"] > 0:
                meter_missing_count += 1
            
            if diagnosis["breakpoint_days"] > 0:
                breakpoint_count += 1
        
        return {
            "summary": {
                "total_customers": len(signed_customers),
                "unaggregated_customers": unaggregated_count,
                "error_anomaly_customers": error_anomaly_count,
                "mp_missing_customers": mp_missing_count,
                "meter_missing_customers": meter_missing_count,
                "breakpoint_customers": breakpoint_count
            },
            "customers": results
        }
