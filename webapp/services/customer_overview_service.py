# -*- coding: utf-8 -*-
"""
客户负荷总览服务
提供客户总览页面的KPI、图表、列表数据查询
"""

import logging
from typing import List, Dict, Optional, Any
from datetime import datetime
from calendar import monthrange
from pymongo.database import Database
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.services.load_query_service import LoadQueryService
from webapp.services.contract_service import ContractService
from webapp.schemas.load_structs import TouUsage, MonthlyTotal

logger = logging.getLogger(__name__)


class CustomerOverviewService:
    """客户负荷总览服务"""
    
    def __init__(self, db: Database = None):
        self.db = db if db is not None else DATABASE
        self.load_service = LoadQueryService()
        self.contract_service = ContractService(self.db)
        self.customer_collection = self.db['customer_archives']
        self.contract_collection = self.db['retail_contracts']
        self.load_collection = self.db['unified_load_curve']
    
    def _get_date_range(self, year: int, month: int, view_mode: str) -> tuple:
        """
        根据年月和视图模式获取日期范围
        
        Args:
            year: 年份
            month: 月份
            view_mode: 'monthly' 或 'ytd'
            
        Returns:
            (start_date, end_date) YYYY-MM-DD 格式
        """
        if view_mode == 'ytd':
            start_date = f"{year}-01-01"
        else:
            start_date = f"{year}-{month:02d}-01"
        
        # 月末最后一天
        _, last_day = monthrange(year, month)
        end_date = f"{year}-{month:02d}-{last_day:02d}"
        
        return start_date, end_date
    
    def _get_signed_customers(self, year: int, month: int) -> List[Dict]:
        """
        获取指定年月的签约客户列表
        
        Returns:
            [{"customer_id": str, "customer_name": str, "short_name": str, 
              "signed_quantity": float, "contract_start_month": int, "contract_end_month": int}, ...]
        """
        # 构建查询条件：该年内有合同的客户
        start_of_year = datetime(year, 1, 1)
        end_of_year = datetime(year, 12, 31, 23, 59, 59)
        
        # 聚合管道：按客户合计签约电量
        pipeline = [
            {
                "$match": {
                    "purchase_start_month": {"$lte": end_of_year},
                    "purchase_end_month": {"$gte": start_of_year}
                }
            },
            {
                "$group": {
                    "_id": "$customer_id",
                    "customer_name": {"$first": "$customer_name"},
                    "signed_quantity": {"$sum": "$purchasing_electricity_quantity"},
                    "contract_start_month": {"$min": {"$month": "$purchase_start_month"}},
                    "contract_end_month": {"$max": {"$month": "$purchase_end_month"}}
                }
            }
        ]
        
        contracts = list(self.contract_collection.aggregate(pipeline))
        
        # 获取客户简称
        result = []
        for c in contracts:
            customer_id = c["_id"]
            short_name = c["customer_name"]  # 默认使用全名
            
            # 查询客户简称
            if ObjectId.is_valid(customer_id):
                customer = self.customer_collection.find_one(
                    {"_id": ObjectId(customer_id)},
                    {"short_name": 1}
                )
                if customer and customer.get("short_name"):
                    short_name = customer["short_name"]
            
            result.append({
                "customer_id": customer_id,
                "customer_name": c["customer_name"],
                "short_name": short_name,
                "signed_quantity": c["signed_quantity"] / 1000,  # kWh -> MWh
                "contract_start_month": c["contract_start_month"],
                "contract_end_month": c["contract_end_month"]
            })
        
        return result
    
    def _get_customer_actual_usage(
        self, 
        customer_id: str, 
        start_date: str, 
        end_date: str
    ) -> Dict:
        """
        获取客户在指定日期范围内的实测电量和分时结构
        
        Returns:
            {"total": float, "tou_usage": TouUsage}
        """
        # 使用 LoadQueryService 获取数据，确保与详情页逻辑一致 (支持 MP/Meter 融合策略)
        # 默认策略 MP_PRIORITY (优先使用MP数据，缺失则使用表计)
        try:
            daily_totals = self.load_service.get_daily_totals(customer_id, start_date, end_date)
        except Exception as e:
            logger.error(f"Error calling LoadQueryService for {customer_id}: {e}")
            daily_totals = []
            
        if not daily_totals:
            return {
                "total": 0.0,
                "tou_usage": TouUsage()
            }
        
        # 在应用层汇总
        total_val = 0.0
        tou_agg = TouUsage()
        
        for dt in daily_totals:
            total_val += dt.total
            if dt.tou_usage:
                tou_agg.tip += dt.tou_usage.tip
                tou_agg.peak += dt.tou_usage.peak
                tou_agg.flat += dt.tou_usage.flat
                tou_agg.valley += dt.tou_usage.valley
                tou_agg.deep += dt.tou_usage.deep
        
        return {
            "total": total_val,
            "tou_usage": tou_agg
        }
    
    def _calc_peak_valley_ratio(self, tou: TouUsage) -> float:
        """计算峰谷比"""
        peak_usage = tou.tip + tou.peak
        valley_usage = tou.valley + tou.deep
        if valley_usage == 0:
            return 0.0
        return round(peak_usage / valley_usage, 2)
    
    def _get_last_year_comparison_range(self, year: int, month: int, view_mode: str) -> tuple:
        """
        计算去年同期的日期范围。
        如果是当前月份，则限制去年同期的结束日期为"同月同日"（MTD对比），避免用全月对比半月。
        
        Returns:
            (ly_start_date, ly_end_date)
        """
        last_year = year - 1
        now = datetime.now()
        is_current_month = (year == now.year and month == now.month)
        
        # 1. 确定去年的由始至终 (Full Range)
        if view_mode == 'ytd':
            ly_start = f"{last_year}-01-01"
        else:
            ly_start = f"{last_year}-{month:02d}-01"
            
        _, ly_last_day = monthrange(last_year, month)
        ly_end = f"{last_year}-{month:02d}-{ly_last_day:02d}"
        
        # 2. 如果是当月，进行截断 (Cap to Today)
        if is_current_month:
            # 去年同期的结束日期应该也是今天（的对应日）
            # 注意处理闰年2月29的情况
            try:
                # 尝试构建去年同月同日
                cap_date = datetime(last_year, now.month, now.day)
                # 如果计算出的截断日期比全月最后一天还早，就使用截断日期
                # (逻辑上肯定是早的，或者是同一天)
                ly_end_cap = cap_date.strftime("%Y-%m-%d")
                
                # 双重保险：取 min(ly_end, ly_end_cap)
                if ly_end_cap < ly_end:
                    ly_end = ly_end_cap
            except ValueError:
                # 只有一种情况：今天2月29，去年只有28天 -> 使用2月28
                if now.month == 2 and now.day == 29:
                    # ly_end 已经是2-28了，无需操作
                    pass

        return ly_start, ly_end

    def get_overview_kpi(self, year: int, month: int, view_mode: str) -> Dict:
        """
        获取KPI卡片数据
        
        Returns:
            {
                "signed_customers_count": int,
                "signed_total_quantity": float (MWh),
                "signed_quantity_yoy": float | None,
                "actual_total_usage": float (MWh),
                "actual_usage_yoy": float | None,
                "avg_peak_valley_ratio": float,
                "tou_breakdown": TouUsage
            }
        """
        signed_customers = self._get_signed_customers(year, month)
        start_date, end_date = self._get_date_range(year, month, view_mode)
        
        # 静态指标：签约客户数和签约规模
        signed_customers_count = len(signed_customers)
        signed_total_quantity = sum(c["signed_quantity"] for c in signed_customers)
        
        # 计算签约规模同比（vs 去年同期实测）
        last_year = year - 1
        last_year_actual = 0.0
        for c in signed_customers:
            # 按客户签约期计算去年同期
            ly_start = f"{last_year}-{c['contract_start_month']:02d}-01"
            _, ly_last_day = monthrange(last_year, c['contract_end_month'])
            ly_end = f"{last_year}-{c['contract_end_month']:02d}-{ly_last_day:02d}"
            usage = self._get_customer_actual_usage(c["customer_id"], ly_start, ly_end)
            last_year_actual += usage["total"]
        
        signed_quantity_yoy = None
        if last_year_actual > 0:
            signed_quantity_yoy = round((signed_total_quantity - last_year_actual) / last_year_actual * 100, 1)
        
        # 动态指标：当前总电量
        total_usage = 0.0
        total_tou = TouUsage()
        for c in signed_customers:
            usage = self._get_customer_actual_usage(c["customer_id"], start_date, end_date)
            total_usage += usage["total"]
            total_tou.tip += usage["tou_usage"].tip
            total_tou.peak += usage["tou_usage"].peak
            total_tou.flat += usage["tou_usage"].flat
            total_tou.valley += usage["tou_usage"].valley
            total_tou.deep += usage["tou_usage"].deep
        
        # 计算去年同期实测电量（用于同比）
        # 使用统一的 MTD 逻辑
        ly_start_date, ly_end_date = self._get_last_year_comparison_range(year, month, view_mode)
        
        last_year_total = 0.0
        for c in signed_customers:
            usage = self._get_customer_actual_usage(c["customer_id"], ly_start_date, ly_end_date)
            last_year_total += usage["total"]
        
        actual_usage_yoy = None
        if last_year_total > 0:
            actual_usage_yoy = round((total_usage - last_year_total) / last_year_total * 100, 1)
        
        # 综合峰谷比
        avg_pv_ratio = self._calc_peak_valley_ratio(total_tou)
        
        return {
            "signed_customers_count": signed_customers_count,
            "signed_total_quantity": round(signed_total_quantity, 2),
            "signed_quantity_yoy": signed_quantity_yoy,
            "actual_total_usage": round(total_usage, 2),
            "actual_usage_yoy": actual_usage_yoy,
            "avg_peak_valley_ratio": avg_pv_ratio,
            "tou_breakdown": total_tou.model_dump()
        }
    
    def get_contribution_chart(self, year: int, month: int, view_mode: str) -> Dict:
        """
        获取电量贡献构成图表数据
        
        Returns:
            {
                "top5": [{"customer_id", "short_name", "usage", "percentage"}, ...],
                "others": {"usage", "percentage"},
                "total": float
            }
        """
        signed_customers = self._get_signed_customers(year, month)
        start_date, end_date = self._get_date_range(year, month, view_mode)
        
        # 获取各客户电量
        customer_usage = []
        for c in signed_customers:
            usage = self._get_customer_actual_usage(c["customer_id"], start_date, end_date)
            customer_usage.append({
                "customer_id": c["customer_id"],
                "short_name": c["short_name"],
                "usage": usage["total"]
            })
        
        # 按电量降序排序
        customer_usage.sort(key=lambda x: x["usage"], reverse=True)
        
        total = sum(c["usage"] for c in customer_usage)
        
        # Top 5
        top5 = []
        for c in customer_usage[:5]:
            pct = round(c["usage"] / total * 100, 1) if total > 0 else 0
            top5.append({
                "customer_id": c["customer_id"],
                "short_name": c["short_name"],
                "usage": round(c["usage"], 2),
                "percentage": pct
            })
        
        # 其他
        others_usage = sum(c["usage"] for c in customer_usage[5:])
        others_pct = round(others_usage / total * 100, 1) if total > 0 else 0
        
        return {
            "top5": top5,
            "others": {
                "usage": round(others_usage, 2),
                "percentage": others_pct
            },
            "total": round(total, 2)
        }
    
    def get_growth_ranking(self, year: int, month: int, view_mode: str) -> Dict:
        """
        获取涨跌龙虎榜数据
        
        Returns:
            {
                "growth_top5": [{"customer_id", "short_name", "change", "yoy_pct"}, ...],
                "decline_top5": [{"customer_id", "short_name", "change", "yoy_pct"}, ...]
            }
        """
        signed_customers = self._get_signed_customers(year, month)
        start_date, end_date = self._get_date_range(year, month, view_mode)
        
        # 计算去年同期日期范围
        ly_start, ly_end = self._get_last_year_comparison_range(year, month, view_mode)
        
        # 获取各客户今年和去年电量
        changes = []
        total_current_usage = 0.0
        
        for c in signed_customers:
            current = self._get_customer_actual_usage(c["customer_id"], start_date, end_date)
            last_year_usage = self._get_customer_actual_usage(c["customer_id"], ly_start, ly_end)
            
            total_current_usage += current["total"]
            
            change = current["total"] - last_year_usage["total"]
            yoy_pct = None
            if last_year_usage["total"] > 0:
                yoy_pct = round(change / last_year_usage["total"] * 100, 1)
            
            changes.append({
                "customer_id": c["customer_id"],
                "short_name": c["short_name"],
                "change": round(change, 2),
                "yoy_pct": yoy_pct
            })
        
        # 如果当期总电量为0，视为无数据（如未来月份），直接返回空榜单
        if total_current_usage == 0:
            return {
                "growth_top5": [],
                "decline_top5": []
            }
        
        # 增量Top5（正值最大）
        growth = [c for c in changes if c["change"] > 0]
        growth.sort(key=lambda x: x["change"], reverse=True)
        
        # 减量Top5（负值 绝对值最大）
        decline = [c for c in changes if c["change"] < 0]
        decline.sort(key=lambda x: x["change"])  # 负值，从小到大 = 绝对值最大在前
        
        return {
            "growth_top5": growth[:5],
            "decline_top5": decline[:5]
        }
    
    def get_efficiency_ranking(self, year: int, month: int, view_mode: str) -> Dict:
        """
        获取峰谷比极值榜数据
        
        Returns:
            {
                "high_pv_ratio": [{"customer_id", "short_name", "pv_ratio"}, ...],
                "low_pv_ratio": [{"customer_id", "short_name", "pv_ratio"}, ...]
            }
        """
        signed_customers = self._get_signed_customers(year, month)
        start_date, end_date = self._get_date_range(year, month, view_mode)
        
        # 获取各客户峰谷比
        pv_ratios = []
        for c in signed_customers:
            usage = self._get_customer_actual_usage(c["customer_id"], start_date, end_date)
            pv_ratio = self._calc_peak_valley_ratio(usage["tou_usage"])
            
            # 过滤无数据的客户
            if usage["total"] > 0:
                pv_ratios.append({
                    "customer_id": c["customer_id"],
                    "short_name": c["short_name"],
                    "pv_ratio": pv_ratio
                })
        
        # 峰谷比最高（高成本型）
        pv_ratios.sort(key=lambda x: x["pv_ratio"], reverse=True)
        high_pv = pv_ratios[:5]
        
        # 峰谷比最低（优质平稳型）
        low_pv = sorted(pv_ratios, key=lambda x: x["pv_ratio"])[:5]
        
        return {
            "high_pv_ratio": high_pv,
            "low_pv_ratio": low_pv
        }
    
    def get_customer_list(
        self, 
        year: int, 
        month: int, 
        view_mode: str,
        search: Optional[str] = None,
        sort_field: str = "signed_quantity",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 20
    ) -> Dict:
        """
        获取客户资产明细列表
        """
        signed_customers = self._get_signed_customers(year, month)
        start_date, end_date = self._get_date_range(year, month, view_mode)
        
        # 计算去年同期日期范围
        ly_start, ly_end = self._get_last_year_comparison_range(year, month, view_mode)
        
        # 构建列表数据
        items = []
        for c in signed_customers:
            # 筛选
            if search:
                if search.lower() not in c["customer_name"].lower() and \
                   search.lower() not in c["short_name"].lower():
                    continue
            
            # 当前期实测
            current = self._get_customer_actual_usage(c["customer_id"], start_date, end_date)
            # 去年同期实测
            last_year_usage = self._get_customer_actual_usage(c["customer_id"], ly_start, ly_end)
            
            # 签约涨幅（vs 去年同期实测，按签约期范围）
            # 注意：这里的签约期对比可能跨月，暂不使用 ly_end 的逻辑，而是保持按合同月完整对比
            # 因为签约电量通常是"月度"签约，应与"去年全月"对比才合理？
            # 不，如果当前只走了半个月，拿签约量(全月)去比去年半个月，不合理。
            # 但拿签约量(全月)去比去年全月，也不合理(如果想看进度)。
            # 通常：签约偏离度 = (签约 - 去年同期实际) / 去年同期实际
            # 这里的"去年同期实际"通常指去年那个完整月的实际。
            # 所以这里保持原逻辑，使用 contract_start/end_month 对应的去年完整月。
            
            ly_contract_start = f"{year - 1}-{c['contract_start_month']:02d}-01"
            _, ly_contract_last_day = monthrange(year - 1, c['contract_end_month'])
            ly_contract_end = f"{year - 1}-{c['contract_end_month']:02d}-{ly_contract_last_day:02d}"
            ly_contract_usage = self._get_customer_actual_usage(
                c["customer_id"], ly_contract_start, ly_contract_end
            )
            
            signed_yoy = None
            signed_yoy_warning = False
            if ly_contract_usage["total"] > 0:
                signed_yoy = round(
                    (c["signed_quantity"] - ly_contract_usage["total"]) / ly_contract_usage["total"] * 100, 
                    1
                )
                signed_yoy_warning = abs(signed_yoy) > 50
            
            # 实测同比 (Using adjusted ly_end)
            actual_yoy = None
            if last_year_usage["total"] > 0:
                actual_yoy = round(
                    (current["total"] - last_year_usage["total"]) / last_year_usage["total"] * 100,
                    1
                )
            
            items.append({
                "customer_id": c["customer_id"],
                "customer_name": c["customer_name"],
                "short_name": c["short_name"],
                "signed_quantity": round(c["signed_quantity"], 2),
                "signed_yoy": signed_yoy,
                "signed_yoy_warning": signed_yoy_warning,
                "actual_usage": round(current["total"], 2),
                "actual_yoy": actual_yoy,
                "peak_valley_ratio": self._calc_peak_valley_ratio(current["tou_usage"]),
                "tou_breakdown": current["tou_usage"].model_dump(),
                "contract_start_month": c["contract_start_month"],
                "contract_end_month": c["contract_end_month"]
            })
        
        # 排序
        reverse = sort_order == "desc"
        if sort_field in ["signed_quantity", "actual_usage", "peak_valley_ratio"]:
            items.sort(key=lambda x: x.get(sort_field, 0) or 0, reverse=reverse)
        elif sort_field == "signed_yoy":
            items.sort(key=lambda x: x.get("signed_yoy") or -999, reverse=reverse)
        elif sort_field == "actual_yoy":
            items.sort(key=lambda x: x.get("actual_yoy") or -999, reverse=reverse)
        elif sort_field == "customer_name":
            items.sort(key=lambda x: x.get("customer_name", ""), reverse=reverse)
        
        # 分页
        total = len(items)
        if page_size > 0:
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            paginated_items = items[start_idx:end_idx]
        else:
            # 如果 page_size <= 0，返回全量数据（用于前端分页）
            paginated_items = items
        
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": paginated_items
        }
