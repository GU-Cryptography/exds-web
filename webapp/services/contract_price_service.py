"""
中长期合同价格分析 - 业务服务
"""
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pymongo.database import Database

from webapp.models.contract_price import (
    DailySummaryResponse,
    DailySummaryKPIs,
    ContractTypeSummary,
    CurvePoint,
    CurveData,
    DailyCurvesResponse
)

logger = logging.getLogger(__name__)


class ContractPriceService:
    """中长期合同价格分析服务"""

    def __init__(self, db: Database):
        self.db = db
        self.contracts_collection = db["contracts_aggregated_daily"]
        self.spot_collection = db["day_ahead_spot_price"]

    def _period_to_time_str(self, period: int) -> str:
        """将时段序号转换为时间字符串"""
        # period 1-48 对应 00:00-23:30，每个时段30分钟
        hour = (period - 1) // 2
        minute = ((period - 1) % 2) * 30
        return f"{hour:02d}:{minute:02d}"

    def _calc_daily_stats(self, doc: dict) -> tuple:
        """
        从periods数组计算日电量和日均价
        返回 (total_quantity, avg_price)
        """
        periods = doc.get("periods", [])
        if not periods:
            return 0, 0

        total_quantity = 0
        weighted_sum = 0

        for p in periods:
            qty = p.get("quantity_mwh", 0) or 0
            price = p.get("price_yuan_per_mwh", 0) or 0
            total_quantity += qty
            weighted_sum += qty * price

        avg_price = weighted_sum / total_quantity if total_quantity > 0 else 0
        return total_quantity, avg_price


    def _get_spot_prices(self, date_str: str) -> List[CurvePoint]:
        """获取日前现货价格"""
        try:
            # 从day_ahead_spot_price集合获取数据
            cursor = self.spot_collection.find(
                {"date_str": date_str},
                {"_id": 0, "time_str": 1, "avg_clearing_price": 1}
            ).sort("time_str", 1)

            results = list(cursor)
            if not results:
                return []

            # 转换为48时段格式（现货是96点，需要聚合为48点）
            period_prices: Dict[int, List[float]] = {}
            for doc in results:
                time_str = doc.get("time_str", "")
                price = doc.get("avg_clearing_price")
                if price is None:
                    continue

                # 解析时间，计算属于哪个30分钟时段
                parts = time_str.split(":")
                if len(parts) >= 2:
                    hour = int(parts[0])
                    minute = int(parts[1])
                    period = hour * 2 + (1 if minute < 30 else 2)
                    if period not in period_prices:
                        period_prices[period] = []
                    period_prices[period].append(price)

            # 计算每个时段的平均价格
            curve_points = []
            for period in range(1, 49):
                if period in period_prices and period_prices[period]:
                    avg_price = sum(period_prices[period]) / len(period_prices[period])
                    curve_points.append(CurvePoint(
                        period=period,
                        time_str=self._period_to_time_str(period),
                        price=round(avg_price, 2)
                    ))

            return curve_points

        except Exception as e:
            logger.error(f"获取现货价格失败: {e}")
            return []

    def get_daily_summary(self, date_str: str, entity: str = "全市场") -> DailySummaryResponse:
        """获取单日汇总数据"""
        logger.info(f"[START] get_daily_summary: date={date_str}, entity={entity}")

        # 查询所有合同数据
        logger.info("[STEP 1] 查询合同数据...")
        cursor = self.contracts_collection.find({
            "date": date_str,
            "entity": entity
        })
        docs = list(cursor)
        logger.info(f"[STEP 1] 完成，找到 {len(docs)} 条记录")

        # 调试日志：打印所有查询到的记录的类型和周期
        for doc in docs:
            ct = doc.get("contract_type", "")
            cp = doc.get("contract_period", "")
            logger.info(f"  - contract_type={ct}, contract_period={cp}")



        if not docs:
            # 返回空数据
            return DailySummaryResponse(
                date=date_str,
                kpis=DailySummaryKPIs(
                    total_quantity=0,
                    overall_avg_price=0,
                    price_range_min=0,
                    price_range_max=0,
                    yearly_ratio=0,
                    monthly_ratio=0,
                    within_month_ratio=0
                ),
                contract_curves=[],
                spot_curves=[],
                type_summary=[]
            )

        # 分离整体数据和明细数据
        # 整体数据用于汇总指标和价格曲线
        # 明细数据用于表格（排除所有type或period为"整体"的记录）
        overall_doc = None
        detail_docs = []
        for doc in docs:
            contract_type = doc.get("contract_type", "")
            contract_period = doc.get("contract_period", "")

            # 整体+整体用于汇总指标
            if contract_type == "整体" and contract_period == "整体":
                overall_doc = doc
            # 排除任何维度为"整体"的记录，只保留具体明细
            elif contract_type != "整体" and contract_period != "整体":
                detail_docs.append(doc)


        # 计算汇总指标（从 periods 数组计算）
        if overall_doc:
            total_quantity, overall_avg_price = self._calc_daily_stats(overall_doc)
        else:
            total_quantity, overall_avg_price = 0, 0

        # 计算价格区间
        all_prices = []
        if overall_doc and overall_doc.get("periods"):
            for p in overall_doc["periods"]:
                if p.get("price_yuan_per_mwh") is not None:
                    all_prices.append(p["price_yuan_per_mwh"])

        price_range_min = min(all_prices) if all_prices else 0
        price_range_max = max(all_prices) if all_prices else 0

        # 计算各周期占比和均价
        period_stats = {"年度": {"quantity": 0, "price": None}, 
                       "月度": {"quantity": 0, "price": None}, 
                       "月内": {"quantity": 0, "price": None}}

        for doc in detail_docs:
            period = doc.get("contract_period")
            if period in period_stats:
                # 从 periods 数组计算日电量和均价
                doc_qty, doc_price = self._calc_daily_stats(doc)
                period_stats[period]["quantity"] += doc_qty
                # 取整体类型的价格
                if doc.get("contract_type") == "整体":
                    period_stats[period]["price"] = doc_price if doc_price > 0 else None

        # 计算占比
        yearly_ratio = (period_stats["年度"]["quantity"] / total_quantity * 100) if total_quantity > 0 else 0
        monthly_ratio = (period_stats["月度"]["quantity"] / total_quantity * 100) if total_quantity > 0 else 0
        within_month_ratio = (period_stats["月内"]["quantity"] / total_quantity * 100) if total_quantity > 0 else 0

        kpis = DailySummaryKPIs(
            total_quantity=round(total_quantity, 2),
            overall_avg_price=round(overall_avg_price, 2),
            price_range_min=round(price_range_min, 2),
            price_range_max=round(price_range_max, 2),
            yearly_ratio=round(yearly_ratio, 1),
            monthly_ratio=round(monthly_ratio, 1),
            within_month_ratio=round(within_month_ratio, 1),
            yearly_avg_price=period_stats["年度"]["price"],
            monthly_avg_price=period_stats["月度"]["price"],
            within_month_avg_price=period_stats["月内"]["price"]
        )

        # 构建整体价格曲线
        contract_curves = []
        if overall_doc and overall_doc.get("periods"):
            for p in overall_doc["periods"]:
                period = p.get("period", 0)
                price = p.get("price_yuan_per_mwh")
                quantity = p.get("quantity_mwh")
                if period and price is not None:
                    contract_curves.append(CurvePoint(
                        period=period,
                        time_str=self._period_to_time_str(period),
                        price=round(price, 2),
                        quantity=round(quantity, 2) if quantity else None
                    ))
        contract_curves.sort(key=lambda x: x.period)
        logger.info(f"[STEP 3] 构建合同曲线完成，共 {len(contract_curves)} 个点")

        # 获取现货价格
        logger.info("[STEP 4] 获取现货价格...")
        spot_curves = self._get_spot_prices(date_str)
        logger.info(f"[STEP 4] 获取现货价格完成，共 {len(spot_curves)} 个点")


        # 构建明细表格
        type_summary = []
        for doc in detail_docs:
            # 计算峰谷差
            prices = []
            if doc.get("periods"):
                for p in doc["periods"]:
                    if p.get("price_yuan_per_mwh") is not None:
                        prices.append(p["price_yuan_per_mwh"])

            max_price = max(prices) if prices else None
            min_price = min(prices) if prices else None
            peak_valley = (max_price - min_price) if (max_price and min_price) else None

            # 从 periods 数组计算日电量和均价
            doc_qty, doc_price = self._calc_daily_stats(doc)

            type_summary.append(ContractTypeSummary(
                contract_type=doc.get("contract_type", ""),
                contract_period=doc.get("contract_period", ""),
                daily_total_quantity=round(doc_qty, 2),
                daily_avg_price=round(doc_price, 2),
                max_price=round(max_price, 2) if max_price else None,
                min_price=round(min_price, 2) if min_price else None,
                peak_valley_spread=round(peak_valley, 2) if peak_valley else None
            ))

        # 按类型和周期排序
        type_order = {"市场化": 0, "绿电": 1, "代理购电": 2, "整体": 3}
        period_order = {"年度": 0, "月度": 1, "月内": 2, "整体": 3}

        type_summary.sort(key=lambda x: (type_order.get(x.contract_type, 99), 
                                         period_order.get(x.contract_period, 99)))

        # 构建按合同类型的曲线数据
        # 查找每个合同类型+整体周期的记录
        curves_by_type = {}
        contract_types_to_find = ["整体", "市场化", "绿电", "代理购电"]
        for target_type in contract_types_to_find:
            for doc in docs:
                if doc.get("contract_type") == target_type and doc.get("contract_period") == "整体":
                    curve_points = []
                    if doc.get("periods"):
                        for p in doc["periods"]:
                            period = p.get("period", 0)
                            price = p.get("price_yuan_per_mwh")
                            if period and price is not None:
                                curve_points.append({
                                    "period": period,
                                    "time_str": self._period_to_time_str(period),
                                    "price": round(price, 2)
                                })
                        curve_points.sort(key=lambda x: x["period"])
                    curves_by_type[target_type] = curve_points
                    break

        logger.info(f"[STEP 5] 构建curves_by_type完成，类型数: {len(curves_by_type)}")

        return DailySummaryResponse(
            date=date_str,
            kpis=kpis,
            contract_curves=contract_curves,
            spot_curves=spot_curves,
            type_summary=type_summary,
            curves_by_type=curves_by_type
        )

