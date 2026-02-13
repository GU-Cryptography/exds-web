# -*- coding: utf-8 -*-
"""
零售侧结算服务
负责计算每个客户每日的零售电费
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, List, Any

from webapp.tools.mongo import DATABASE
from webapp.services.contract_service import ContractService
from webapp.services.load_query_service import LoadQueryService
from webapp.services.tou_service import get_tou_rule_by_date
from webapp.models.load_enums import FusionStrategy
from webapp.models.retail_settlement import (
    RetailSettlementDaily, RetailPeriodDetail, TouSummaryItem,
    ReferencePriceInfo, LinkedConfigInfo
)

logger = logging.getLogger(__name__)

# 463号文标准比例 (尖峰:高峰:平段:低谷:深谷)
STANDARD_RATIOS = {
    "tip": 1.8,
    "peak": 1.6,
    "flat": 1.0,
    "valley": 0.4,
    "deep": 0.3,
}

# 最高限价常量 (元/kWh)
UPPER_LIMIT_PRICE = 414.3 * 1.2 / 1000  # = 0.49716

# 时段类型映射：tou_service 中文名 → 内部标识
TOU_TYPE_MAP = {
    "尖峰": "tip",
    "高峰": "peak",
    "平段": "flat",
    "低谷": "valley",
    "深谷": "deep",
}

# 96→48 优先级：两个15分钟合并为30分钟时，取优先级高的类型
TOU_PRIORITY = {"尖峰": 5, "高峰": 4, "平段": 3, "深谷": 2, "低谷": 1}


class RetailSettlementService:
    """零售侧结算服务"""

    def __init__(self):
        self.db = DATABASE
        self.contract_service = ContractService(self.db)

    # ========== 公共接口 ==========

    async def get_latest_results_date(self) -> Optional[str]:
        """查询零售结算结果的最新日期"""
        latest_doc = self.db.retail_settlement_daily.find_one(
            {}, 
            sort=[("date", -1)]
        )
        return latest_doc.get("date") if latest_doc else None

    def calculate_customer_daily(
        self,
        customer_id: str,
        date_str: str,
        force: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        计算单客户单日零售结算

        Args:
            customer_id: 客户ID
            date_str: 结算日期 YYYY-MM-DD
            force: 是否强制重算

        Returns:
            结算结果字典，失败返回 None
        """
        collection = self.db["retail_settlement_daily"]

        # 检查是否已有结果
        if not force:
            existing = collection.find_one({
                "customer_id": customer_id,
                "date": date_str
            })
            if existing:
                logger.info(f"零售结算已存在: {customer_id} {date_str}")
                return existing

        # 1. 查找客户当日生效的合同
        contract = self._find_active_contract(customer_id, date_str)
        if not contract:
            logger.warning(f"客户 {customer_id} 在 {date_str} 无有效合同")
            return None

        # 从合同中获取套餐信息（优先用快照，否则查套餐表）
        package_info = self._get_package_info(contract)
        if not package_info:
            logger.error(f"无法获取套餐信息: 合同 {contract.get('contract_name')}")
            return None

        model_code = package_info.get("model_code", "")
        pricing_config = package_info.get("pricing_config", {})

        # 2. 计算各时段最终价格
        if model_code.startswith("price_spread"):
            price_result = self._calculate_price_spread(pricing_config, date_str)
        elif model_code.startswith("fixed_linked"):
            price_result = self._calculate_fixed_linked(pricing_config, date_str)
        else:
            logger.error(f"不支持的定价模型: {model_code}")
            return None

        if not price_result:
            return None

        # 3. 获取当日峰谷时段映射 (48点)
        tou_48 = self._get_tou_48(date_str)
        if not tou_48:
            logger.error(f"无法获取峰谷时段: {date_str}")
            return None

        # 4. 获取用户48时段电量
        daily_curve = LoadQueryService.get_daily_curve(
            customer_id, date_str, FusionStrategy.MP_COMPLETE
        )
        if not daily_curve:
            logger.warning(f"客户 {customer_id} 在 {date_str} 无负荷数据")
            return None

        load_values = daily_curve.values  # 48个值 (MWh)

        # 5. 逐时段计算电费
        final_prices = price_result["final_prices"]
        period_details = []
        tou_summary = {k: {"load_mwh": 0.0, "fee": 0.0} for k in STANDARD_RATIOS}

        for i in range(48):
            period_type_cn = tou_48[i]
            period_key = TOU_TYPE_MAP.get(period_type_cn, "flat")
            unit_price = final_prices.get(period_key, 0.0)
            load_mwh = load_values[i] if i < len(load_values) else 0.0
            # 单价 元/kWh × 电量 MWh × 1000 = 元
            fee = unit_price * load_mwh * 1000

            period_details.append(RetailPeriodDetail(
                period=i + 1,
                period_type=period_type_cn,
                load_mwh=round(load_mwh, 6),
                unit_price=round(unit_price, 6),
                fee=round(fee, 2),
            ))

            tou_summary[period_key]["load_mwh"] += load_mwh
            tou_summary[period_key]["fee"] += fee

        # 6. 日汇总
        total_load = sum(d.load_mwh for d in period_details)
        total_fee = sum(d.fee for d in period_details)
        avg_price = (total_fee / (total_load * 1000)) if total_load > 0 else 0.0

        # 四舍五入汇总
        tou_summary_models = {}
        for k, v in tou_summary.items():
            tou_summary_models[k] = TouSummaryItem(
                load_mwh=round(v["load_mwh"], 6),
                fee=round(v["fee"], 2)
            )

        # 7. 组装结算文档
        customer_name = contract.get("customer_name", "")
        settlement = RetailSettlementDaily(
            customer_id=customer_id,
            customer_name=customer_name,
            date=date_str,
            contract_id=str(contract.get("_id", "")),
            package_name=contract.get("package_name", ""),
            model_code=model_code,
            settlement_type="daily",
            reference_price=price_result.get("reference_price"),
            fixed_prices=price_result.get("fixed_prices"),
            linked_config=price_result.get("linked_config"),
            final_prices={k: round(v, 6) for k, v in final_prices.items()},
            price_ratio_adjusted=price_result.get("price_ratio_adjusted", False),
            period_details=period_details,
            total_load_mwh=round(total_load, 6),
            total_fee=round(total_fee, 2),
            avg_price=round(avg_price, 6),
            tou_summary=tou_summary_models,
        )

        # 8. 存入数据库 (upsert)
        doc = settlement.model_dump()
        collection.update_one(
            {
                "customer_id": customer_id, 
                "date": date_str,
                "settlement_type": "daily"
            },
            {"$set": doc},
            upsert=True,
        )
        logger.info(
            f"零售结算完成: {customer_name} {date_str} "
            f"电量={total_load:.3f}MWh 电费={total_fee:.2f}元 均价={avg_price:.4f}元/kWh"
        )
        return doc

    def calculate_all_customers_daily(
        self,
        date_str: str,
        force: bool = False
    ) -> Dict[str, Any]:
        """
        批量计算所有签约客户的日结算

        Returns:
            {"success": int, "failed": int, "skipped": int, "details": [...]}
        """
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        # 月初和月末
        month_start = date_dt.replace(day=1)
        month_end = date_dt.replace(day=1, month=date_dt.month % 12 + 1) - timedelta(days=1) \
            if date_dt.month < 12 else date_dt.replace(month=12, day=31)

        customer_ids = self.contract_service.get_active_customers(month_start, month_end)
        logger.info(f"零售结算: {date_str} 共 {len(customer_ids)} 个签约客户")

        results = {"success": 0, "failed": 0, "skipped": 0, "details": []}
        for cid in customer_ids:
            try:
                result = self.calculate_customer_daily(cid, date_str, force=force)
                if result:
                    results["success"] += 1
                    results["details"].append({
                        "customer_id": cid,
                        "customer_name": result.get("customer_name", ""),
                        "status": "success",
                        "total_fee": result.get("total_fee", 0),
                    })
                else:
                    results["skipped"] += 1
                    results["details"].append({
                        "customer_id": cid,
                        "status": "skipped",
                    })
            except Exception as e:
                logger.error(f"客户 {cid} 结算失败: {e}")
                results["failed"] += 1
                results["details"].append({
                    "customer_id": cid,
                    "status": "failed",
                    "error": str(e),
                })

        logger.info(
            f"零售批量结算完成: {date_str} 成功={results['success']} "
            f"失败={results['failed']} 跳过={results['skipped']}"
        )
        return results

    # ========== 价差分成类计算 ==========

    def _calculate_price_spread(
        self,
        pricing_config: Dict[str, Any],
        date_str: str
    ) -> Optional[Dict[str, Any]]:
        """
        价差分成类定价计算 (price_spread_simple_price_time)

        流程:
        1. 解析参考价基准值
        2. 按 1.8:1.6:1:0.4:0.3 展开分时参考价
        3. 每时段 - 价差×分成 + 浮动价
        4. 463号文比例调节
        """
        # 1. 解析参考价
        ref_type = pricing_config.get("reference_type", "")
        ref_info = self._resolve_reference_price(ref_type, date_str)
        if ref_info is None:
            logger.error(f"无法解析参考价: {ref_type} {date_str}")
            return None

        base_value = ref_info["base_value"]

        # 2. 展开分时参考价
        tou_ref = self._expand_reference_to_tou(base_value)

        # 3. 扣减价差 + 浮动
        spread = float(pricing_config.get("agreed_price_spread", 0) or 0)
        sharing = float(pricing_config.get("sharing_ratio", 100) or 100)
        floating = float(pricing_config.get("floating_price", 0) or 0)

        prices = {}
        for period, ref_val in tou_ref.items():
            prices[period] = ref_val - spread * sharing / 100.0 + floating

        # 4. 比例调节
        adjusted, was_adjusted = self._adjust_price_ratios(prices)

        return {
            "reference_price": ReferencePriceInfo(
                type=ref_type,
                base_value=base_value,
                source=ref_info["source"],
                source_month=ref_info["source_month"],
            ),
            "final_prices": adjusted,
            "price_ratio_adjusted": was_adjusted,
        }

    # ========== 固定联动类计算 ==========

    def _calculate_fixed_linked(
        self,
        pricing_config: Dict[str, Any],
        date_str: str
    ) -> Optional[Dict[str, Any]]:
        """
        固定价+联动类定价计算 (fixed_linked_price_time)

        日常预结算: 联动标的 = 当日对应时段的实时现货价格
        """
        # 1. 获取固定分时价格
        fixed = {
            "tip": float(pricing_config.get("fixed_price_peak", 0) or 0),
            "peak": float(pricing_config.get("fixed_price_high", 0) or 0),
            "flat": float(pricing_config.get("fixed_price_flat", 0) or 0),
            "valley": float(pricing_config.get("fixed_price_valley", 0) or 0),
            "deep": float(pricing_config.get("fixed_price_deep_valley", 0) or 0),
        }

        # 2. 获取联动参数
        linked_ratio = float(pricing_config.get("linked_ratio", 0) or 0) / 100.0
        linked_target = pricing_config.get("linked_target", "real_time_avg")

        # 3. 获取联动标的价格 (日常预结算: 当日实时现货均价)
        target_prices = self._get_linked_target_prices(linked_target, date_str)

        # 4. 混合计算
        prices = {}
        for period in STANDARD_RATIOS:
            fp = fixed.get(period, 0)
            tp = target_prices.get(period, 0)
            prices[period] = fp * (1 - linked_ratio) + tp * linked_ratio

        # 5. 比例调节
        adjusted, was_adjusted = self._adjust_price_ratios(prices)

        return {
            "fixed_prices": fixed,
            "linked_config": LinkedConfigInfo(
                ratio=linked_ratio * 100,
                target=linked_target,
                target_prices=target_prices,
            ),
            "final_prices": adjusted,
            "price_ratio_adjusted": was_adjusted,
        }

    # ========== 参考价解析 ==========

    def _resolve_reference_price(
        self,
        ref_type: str,
        date_str: str
    ) -> Optional[Dict[str, Any]]:
        """
        解析参考价基准值

        Args:
            ref_type: 参考价类型
            date_str: 结算日期 YYYY-MM-DD

        Returns:
            {"base_value": float, "source": str, "source_month": str}
        """
        if ref_type == "upper_limit_price":
            return {
                "base_value": UPPER_LIMIT_PRICE,
                "source": "official",
                "source_month": date_str[:7],
            }

        if ref_type == "market_monthly_avg":
            # 取结算日期对应月份的平均上网电价
            target_month = date_str[:7]  # "2026-02"
            doc = self.db["price_sgcc"].find_one(
                {"_id": target_month},
            )

            if doc and doc.get("avg_on_grid_price"):
                return {
                    "base_value": doc["avg_on_grid_price"],
                    "source": "official",
                    "source_month": target_month,
                }

            # 如果当月数据未发布，取最新可用月份
            doc = self.db["price_sgcc"].find_one(
                sort=[("effective_date", -1)]
            )
            if doc and doc.get("avg_on_grid_price"):
                return {
                    "base_value": doc["avg_on_grid_price"],
                    "source": "simulated",
                    "source_month": doc.get("_id", ""),
                }

            logger.error("找不到任何平均上网电价数据")
            return None

        logger.error(f"不支持的参考价类型: {ref_type}")
        return None

    # ========== 分时展开 ==========

    @staticmethod
    def _expand_reference_to_tou(base_price: float) -> Dict[str, float]:
        """按463号文比例展开为5个时段参考价"""
        return {period: base_price * ratio for period, ratio in STANDARD_RATIOS.items()}

    # ========== 价差扣减 + 浮动 ==========
    # (内联在 _calculate_price_spread 中)

    # ========== 比例调节 ==========

    @staticmethod
    def _adjust_price_ratios(prices: Dict[str, float]) -> tuple:
        """
        463号文价格比例调节

        规则: 以平段价为锚点
        - 尖峰/高峰: 低于要求时上调，已超过则不变
        - 低谷/深谷: 高于要求时下调，已满足则不变

        Returns:
            (adjusted_prices, was_adjusted)
        """
        flat = prices.get("flat", 0)
        if flat <= 0:
            return prices, False

        adjusted = dict(prices)
        was_adjusted = False

        for period, ratio in STANDARD_RATIOS.items():
            if period == "flat":
                continue
            threshold = flat * ratio

            if period in ("tip", "peak"):
                # 上浮时段: 仅在低于要求时上调
                if adjusted[period] < threshold:
                    adjusted[period] = threshold
                    was_adjusted = True
            elif period in ("valley", "deep"):
                # 下浮时段: 仅在高于要求时下调
                if adjusted[period] > threshold:
                    adjusted[period] = threshold
                    was_adjusted = True

        return adjusted, was_adjusted

    # ========== TOU 96→48 映射 ==========

    def _get_tou_48(self, date_str: str) -> Optional[List[str]]:
        """
        获取48时段的峰谷类型列表

        tou_service 返回 96点 (15分钟) Dict[str, str]
        需要合并为 48点 (30分钟) List[str]
        """
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        tou_96_map = get_tou_rule_by_date(date_dt)

        if not tou_96_map:
            return None

        # 排序取出 96 个值
        sorted_keys = sorted(tou_96_map.keys())
        tou_96_list = [tou_96_map[k] for k in sorted_keys]

        if len(tou_96_list) != 96:
            logger.warning(f"TOU 数据点数异常: {len(tou_96_list)}，预期 96")
            return None

        # 96→48: 每两个连续点合并，取优先级高的类型
        tou_48 = []
        for i in range(48):
            a = tou_96_list[2 * i]
            b = tou_96_list[2 * i + 1]
            pa = TOU_PRIORITY.get(a, 0)
            pb = TOU_PRIORITY.get(b, 0)
            tou_48.append(a if pa >= pb else b)

        return tou_48

    # ========== 合同查询 ==========

    def _find_active_contract(
        self,
        customer_id: str,
        date_str: str
    ) -> Optional[Dict[str, Any]]:
        """查找客户在指定日期的有效合同"""
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        contract = self.db["retail_contracts"].find_one({
            "customer_id": customer_id,
            "purchase_start_month": {"$lte": date_dt},
            "purchase_end_month": {"$gte": date_dt},
        })
        return contract

    def _get_package_info(self, contract: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        获取套餐信息: 优先用合同快照，否则查套餐表
        """
        # 优先用快照
        snapshot = contract.get("package_snapshot")
        if snapshot and snapshot.get("model_code"):
            return snapshot

        # 回退查套餐表
        package_id = contract.get("package_id")
        if package_id:
            from bson import ObjectId
            pkg = self.db["retail_packages"].find_one({"_id": ObjectId(package_id)})
            if pkg:
                return pkg

        # 按名称查
        package_name = contract.get("package_name")
        if package_name:
            pkg = self.db["retail_packages"].find_one({"package_name": package_name})
            if pkg:
                return pkg

        return None

    # ========== 联动标的价格 ==========

    def _get_linked_target_prices(
        self,
        target: str,
        date_str: str
    ) -> Dict[str, float]:
        """
        获取联动标的的分时段价格

        日常预结算: 取当日96点实时现货/日前现货价格，聚合为48点，再按TOU分类求均值。
        数据源时间范围: 00:15 ~ 24:00 (共96点)
        """
        tou_48 = self._get_tou_48(date_str)
        if not tou_48:
            logger.warning(f"无法获取TOU映射，联动价格置0")
            return {k: 0.0 for k in STANDARD_RATIOS}

        # 确定集合与价格字段
        if target == "real_time_avg":
            collection_name = "real_time_spot_price"
        elif target == "day_ahead_avg":
            collection_name = "day_ahead_spot_price"
        else:
            # 默认 fallback
            collection_name = "real_time_spot_price"

        # 查询当日 96 点数据
        cursor = self.db[collection_name].find(
            {"date_str": date_str},
            {"avg_clearing_price": 1, "time_str": 1}
        ).sort("time_str", 1)
        
        docs = list(cursor)
        if not docs:
            logger.warning(f"未找到 {target} 价格数据: {date_str} (集合: {collection_name})")
            return {k: 0.0 for k in STANDARD_RATIOS}

        if len(docs) != 96:
            logger.warning(
                f"{target} 数据点数异常: {date_str} Count={len(docs)} (预期96). "
                f"可能影响计算准确性。"
            )

        # 96点 -> 48点 (每2点取均值)
        # 假设 docs 按 time_str 排序正确: 00:15, 00:30, ..., 24:00
        # 第i个48点 (i=0..47) 对应 docs[2*i] 和 docs[2*i+1]
        
        spot_prices_48 = []
        for i in range(48):
            # 简单聚合：如果有96点，直接取；如果点数不够，尝试取值
            idx1 = 2 * i
            idx2 = 2 * i + 1
            
            p1 = docs[idx1]["avg_clearing_price"] if idx1 < len(docs) else None
            p2 = docs[idx2]["avg_clearing_price"] if idx2 < len(docs) else None
            
            vals = [p for p in [p1, p2] if p is not None]
            if vals:
                avg = sum(vals) / len(vals)
            else:
                avg = 0.0
            
            spot_prices_48.append(avg)

        # 按TOU类型分组求均值
        period_sums = {k: 0.0 for k in STANDARD_RATIOS}
        period_counts = {k: 0 for k in STANDARD_RATIOS}

        for i in range(48):
            period_cn = tou_48[i]
            period_key = TOU_TYPE_MAP.get(period_cn, "flat")
            period_sums[period_key] += spot_prices_48[i]
            period_counts[period_key] += 1

        # 均值，单位转换 元/MWh → 元/kWh
        result = {}
        for k in STANDARD_RATIOS:
            if period_counts[k] > 0:
                result[k] = (period_sums[k] / period_counts[k]) / 1000.0
            else:
                result[k] = 0.0

        return result


# 全局服务实例
retail_settlement_service = RetailSettlementService()
