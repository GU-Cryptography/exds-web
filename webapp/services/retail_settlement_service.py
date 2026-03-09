# -*- coding: utf-8 -*-
"""
零售侧结算服务
负责计算每个客户每日的零售电费
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, List, Any, Union

from webapp.services.retail_price_service import retail_price_service
from webapp.services.contract_service import ContractService
from webapp.services.load_query_service import LoadQueryService
from webapp.services.tou_service import get_month_tou_meta, get_tou_timeline_by_date
from webapp.tools.mongo import DATABASE
from webapp.models.load_enums import FusionStrategy
from webapp.models.retail_settlement import (
    RetailSettlementDaily, RetailPeriodDetail, TouSummaryItem,
    ReferencePriceInfo, LinkedConfigInfo
)

logger = logging.getLogger(__name__)

# 最高限价常量 (元/kWh)
UPPER_LIMIT_PRICE = 414.3 * 1.2 / 1000  # = 0.49716

# 463号文标准比例（当前结算口径）：尖峰1.8、高峰1.6、平1、低谷0.4、深谷0.3
DEFAULT_RATIOS = {"tip": 1.8, "peak": 1.6, "flat": 1.0, "valley": 0.4, "deep": 0.3}

# 时段类型映射：tou_service 中文名 → 内部标识
TOU_TYPE_MAP = {
    "尖峰": "tip",
    "高峰": "peak",
    "平段": "flat",
    "低谷": "valley",
    "深谷": "deep",
}

# 反向映射
TOU_TYPE_MAP_REV = {v: k for k, v in TOU_TYPE_MAP.items()}

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
            {"settlement_type": "daily"},
            sort=[("date", -1)]
        )
        return latest_doc.get("date") if latest_doc else None

    async def get_settled_count(self, date_str: str, settlement_type: str = "daily") -> int:
        """统计指定日期已结算的客户数量"""
        return self.db.retail_settlement_daily.count_documents(
            {"date": date_str, "settlement_type": settlement_type}
        )

    def calculate_customer_daily(
        self,
        customer_id: str,
        date_str: str,
        force: bool = False,
        settlement_type: str = "daily"
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

        if not force:
            existing = collection.find_one({
                "customer_id": customer_id,
                "date": date_str,
                "settlement_type": settlement_type
            })
            if existing:
                logger.info(f"零售结算已存在: {customer_id} {date_str}")
                existing["_is_new"] = False
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

        # 2. 获取当日峰谷时段映射 (48点)
        tou_48 = self._get_tou_48(date_str)
        if not tou_48:
            logger.error(f"无法获取峰谷时段: {date_str}")
            return None

        # 3. 获取用户48时段电量
        daily_curve = LoadQueryService.get_daily_curve(
            customer_id, date_str, FusionStrategy.MP_ONLY
        )
        if not daily_curve:
            logger.warning(f"客户 {customer_id} 在 {date_str} 无负荷数据")
            return None

        load_values = daily_curve.values  # 48个值 (MWh)
        total_load = sum(load_values)

        # 4. 计算各时段最终价格
        if model_code.startswith("price_spread"):
            is_time_based_pkg = model_code.endswith("_time") and not model_code.endswith("_non_time")
            price_result = self._calculate_price_spread(
                pricing_config, date_str, 
                is_time_based_package=is_time_based_pkg,
                total_load_mwh=total_load,
                settlement_type=settlement_type
            )
        elif model_code.startswith("fixed_linked"):
            price_result = self._calculate_fixed_linked(
                pricing_config, date_str,
                settlement_type=settlement_type
            )
        elif model_code.startswith("reference_linked"):
            is_time_based_pkg = model_code.endswith("_time") and not model_code.endswith("_non_time")
            price_result = self._calculate_reference_linked(
                pricing_config, date_str,
                is_time_based_package=is_time_based_pkg,
                total_load_mwh=total_load,
                settlement_type=settlement_type
            )
        elif model_code.startswith("single_comprehensive"):
            price_result = self._calculate_single_comprehensive(
                pricing_config, date_str,
                settlement_type=settlement_type
            )
        else:
            logger.error(f"不支持的定价模型: {model_code}")
            return None

        # 5. 初始单价获取与封顶校验
        final_prices = price_result["final_prices"]
        final_prices_48 = price_result.get("final_prices_48") # 48点向量
        
        # 预计算当日名义均价，判断是否触发封顶 (优先使用48点明细价格)
        nominal_total_fee = 0.0
        if final_prices_48 and len(final_prices_48) == 48:
            nominal_total_fee = sum(final_prices_48[i] * load_values[i] * 1000 for i in range(48))
        else:
            nominal_total_fee = sum(
                final_prices.get(TOU_TYPE_MAP.get(tou_48[i], "flat"), 0.0) * load_values[i] * 1000
                for i in range(48)
            )
        
        nominal_avg_price = (nominal_total_fee / (total_load * 1000)) if total_load > 0 else 0.0
        
        # 获取当月封顶价并判定
        cap_info = self._get_monthly_cap_price(date_str)
        cap_price = cap_info["cap_price"]
        is_capped = nominal_avg_price > cap_price + 1e-6
        
        if is_capped:
            k = cap_price / nominal_avg_price if nominal_avg_price > 0 else 1.0
            # 缩放 5 时段均价
            for pk in final_prices:
                final_prices[pk] *= k
            # 缩放 48 点明细向量
            if final_prices_48:
                for i in range(48):
                    final_prices_48[i] *= k
                    
            logger.info(
                f"触发日均价封顶: {customer_id} {date_str} "
                f"名义均价={nominal_avg_price:.4f} > 封顶价={cap_price:.4f} "
                f"修正系数 k={k:.4f}"
            )

        # 6. 执行最终计算循环 (仅跑一次)
        period_details = []
        tou_summary = {k: {"load_mwh": 0.0, "fee": 0.0} for k in DEFAULT_RATIOS}

        for i in range(48):
            period_type_cn = tou_48[i]
            period_key = TOU_TYPE_MAP.get(period_type_cn, "flat")
            
            # 价格优先级: 48点点对点 > 5时段聚合
            if final_prices_48:
                unit_price = final_prices_48[i]
            else:
                unit_price = final_prices.get(period_key, 0.0)
                
            load_mwh = load_values[i] if i < len(load_values) else 0.0
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

        # 最终汇总
        final_total_fee = sum(d.fee for d in period_details)
        final_avg_price = (final_total_fee / (total_load * 1000)) if total_load > 0 else 0.0

        # 四舍五入汇总
        tou_summary_models = {}
        for k, v in tou_summary.items():
            tou_summary_models[k] = TouSummaryItem(
                load_mwh=round(v["load_mwh"], 6),
                fee=round(v["fee"], 2)
            )

        # 7. 采购分摊成本及毛利计算 (Step 7)
        # 获取按照天级别规则选定的一套分时批发成本均价
        try:
             wholesale_prices_48 = self._get_wholesale_period_prices(date_str)
        except Exception as e:
             logger.warning(f"客户 {customer_id} 在 {date_str} 缺少批发侧结算数据或存在异常，跳过计算: {e}")
             return None

        total_allocated_cost = 0.0
        
        for i, detail in enumerate(period_details):
             w_price = wholesale_prices_48[i]
             allocated_cost = detail.load_mwh * w_price
             
             detail.wholesale_price = round(w_price, 6)
             detail.allocated_cost = round(allocated_cost, 2)
             total_allocated_cost += allocated_cost

        # 8. 组装结算文档
        customer_name = contract.get("customer_name", "")
        settlement = RetailSettlementDaily(
            customer_id=customer_id,
            customer_name=customer_name,
            date=date_str,
            contract_id=str(contract.get("_id", "")),
            package_name=contract.get("package_name", ""),
            model_code=model_code,
            settlement_type=settlement_type,
            reference_price=price_result.get("reference_price"),
            fixed_prices=price_result.get("fixed_prices"),
            linked_config=price_result.get("linked_config"),
            final_prices={k: round(v, 6) for k, v in final_prices.items()},
            price_ratio_adjusted=price_result.get("price_ratio_adjusted", False),
            price_ratio_adjusted_base=price_result.get("price_ratio_adjusted_base", False),
            is_capped=is_capped,
            nominal_avg_price=round(nominal_avg_price, 6),
            cap_price=round(cap_price, 6),
            period_details=period_details,
            total_load_mwh=round(total_load, 6),
            total_fee=round(final_total_fee, 2),
            avg_price=round(final_avg_price, 6),
            tou_summary=tou_summary_models,
            total_allocated_cost=round(total_allocated_cost, 2),
            gross_profit=round(final_total_fee - total_allocated_cost, 2)
        )

        # 9. 存入数据库 (upsert)
        doc = settlement.model_dump()
        collection.update_one(
            {
                "customer_id": customer_id, 
                "date": date_str,
                "settlement_type": settlement_type
            },
            {"$set": doc},
            upsert=True,
        )
        logger.info(
            f"零售结算完成: {customer_name} {date_str} "
            f"电量={total_load:.3f}MWh 电费={final_total_fee:.2f}元 毛利={doc['gross_profit']:.2f}元 均价={final_avg_price:.4f}元/kWh "
            f"(封顶: {'是' if is_capped else '否'})"
        )
        doc["_is_new"] = True
        return doc

    def _get_wholesale_period_prices(self, date_str: str) -> List[float]:
         """
         获取指定日期全系统批发侧的分时段成本单价 (元/MWh)
         逻辑: 比较天级别的标准值总费用(total_standard_value_cost)和电能量总费用(total_energy_fee)，二者取大。
         如果选定了标准值，时段单价=本时段的标准值/本时段电量；若选定电能量费，时段单价=本时段的电量总费/本时段电量。
         """
         ws_doc = self.db.settlement_daily.find_one({
             "operating_date": date_str,
             "version": "PLATFORM_DAILY"
         })
         if not ws_doc:
              ws_doc = self.db.settlement_daily.find_one({
                  "operating_date": date_str,
                  "version": "PRELIMINARY"
              })
              
         if not ws_doc:
              raise ValueError(f"无法获取日期 {date_str} 的批发侧结算数据(需至少完成一版批发结算)")
              
         total_energy_fee = ws_doc.get("total_energy_fee", 0.0)
         total_standard_cost = ws_doc.get("total_standard_value_cost", 0.0)
         period_details = ws_doc.get("period_details", [])
         
         if len(period_details) < 48:
              raise ValueError(f"日期 {date_str} 批发侧分时明细不足48点")
              
         # 判断取大机制选定的哪套费用体系
         use_standard_value = total_standard_cost > total_energy_fee
         
         wholesale_prices = []
         for p in period_details:
             real_time_vol = 0.0
             if "real_time" in p and isinstance(p["real_time"], dict):
                 real_time_vol = p["real_time"].get("volume", 0.0)
             else:
                 # 可能模型对象访问
                 try:
                     real_time_vol = getattr(p.real_time, "volume", 0.0)
                 except Exception:
                     pass
                     
             if real_time_vol < 1e-4:
                 wholesale_prices.append(0.0)
                 continue
                 
             if use_standard_value:
                 cost = p.get("standard_value_cost", 0.0) if isinstance(p, dict) else getattr(p, "standard_value_cost", 0.0)
             else:
                 cost = p.get("total_energy_fee", 0.0) if isinstance(p, dict) else getattr(p, "total_energy_fee", 0.0)
                 
             wholesale_prices.append(cost / real_time_vol)
             
         return wholesale_prices

    def calculate_all_customers_daily(
        self,
        date_str: str,
        force: bool = False,
        settlement_type: str = "daily"
    ) -> Dict[str, Any]:
        """
        批量计算所有签约客户的日结算

        Returns:
            {"success": int, "new_processed": int, "failed": int, "skipped": int, "details": [...]}
        """
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        # 月初和月末
        month_start = date_dt.replace(day=1)
        month_end = date_dt.replace(day=1, month=date_dt.month % 12 + 1) - timedelta(days=1) \
            if date_dt.month < 12 else date_dt.replace(month=12, day=31)

        customer_ids = self.contract_service.get_active_customers(month_start, month_end)
        logger.info(f"零售结算: {date_str} 共 {len(customer_ids)} 个签约客户")

        results = {"success": 0, "new_processed": 0, "failed": 0, "skipped": 0, "details": []}
        for cid in customer_ids:
            try:
                result = self.calculate_customer_daily(cid, date_str, force=force, settlement_type=settlement_type)
                if result:
                    results["success"] += 1
                    if result.get("_is_new"):
                        results["new_processed"] += 1
                    
                    results["details"].append({
                        "customer_id": cid,
                        "customer_name": result.get("customer_name", ""),
                        "status": "success",
                        "is_new": result.get("_is_new", False),
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
            f"零售批量结算完成: {date_str} 成功={results['success']} (新增={results['new_processed']}) "
            f"失败={results['failed']} 跳过={results['skipped']}"
        )
        return results

    # ========== 价差分成类计算 ==========

    def _calculate_price_spread(
        self,
        pricing_config: Dict[str, Any],
        date_str: str,
        is_time_based_package: bool = True,
        total_load_mwh: float = 0.0,
        settlement_type: str = "daily"
    ) -> Optional[Dict[str, Any]]:
        """
        价差分成类定价计算
        支持常规价格(比例展开)和分时价格(48->5点聚合)
        """
        ref_type = pricing_config.get("reference_type", "")
        # 调用新服务获取参考价数据与来源标识
        is_monthly = (settlement_type == "monthly")
        ref_values, ref_source = retail_price_service.get_reference_price_values(
            ref_type, date_str, 
            is_time_based=is_time_based_package,
            is_monthly=is_monthly
        )

        # 处理参考价基础值记录
        base_value = 0.0
        tou_ref = {}
        ref_values_48 = None
        
        if isinstance(ref_values, list):
            # 48点向量
            ref_values_48 = ref_values
            base_value = sum(ref_values) / len(ref_values) if ref_values else 0.0
            # 为了后续聚合展示，先按48点时段聚合为5段
            tou_48 = self._get_tou_48(date_str)
            for pkey in DEFAULT_RATIOS:
                indices = [idx for idx, t in enumerate(tou_48) if TOU_TYPE_MAP.get(t) == pkey]
                if indices:
                    tou_ref[pkey] = sum(ref_values[idx] for idx in indices) / len(indices)
                else:
                    tou_ref[pkey] = 0.0
        elif isinstance(ref_values, dict):
            base_value = ref_values.get("flat", 0.0)
            tou_ref = ref_values
        else:
            base_value = float(ref_values or 0)
            # 如果是单值但套餐是分时的，按比例展开
            ratios = self._get_tou_ratios(date_str)
            tou_ref = self._expand_reference_to_tou(base_value, ratios=ratios)

        # 计算分成与浮动
        spread = float(pricing_config.get("agreed_price_spread", 0) or 0)
        sharing = float(pricing_config.get("sharing_ratio", 100) or 100)
        floating = float(pricing_config.get("floating_price", 0) or 0)

        # 计算摊分到每kWh的浮动费用
        floating_fee_per_kwh = 0.0
        floating_fee = float(pricing_config.get("floating_fee", 0) or 0)
        if floating_fee > 0 and total_load_mwh > 0:
            floating_fee_per_kwh = floating_fee / (total_load_mwh * 1000.0)

        final_prices_48 = None
        if ref_values_48:
            final_prices_48 = []
            for i in range(48):
                final_prices_48.append(ref_values_48[i] - spread * sharing / 100.0 + floating + floating_fee_per_kwh)
            
            # 聚合为 5 时段用于返回 (final_prices)
            prices = {}
            tou_48 = self._get_tou_48(date_str)
            for pkey in DEFAULT_RATIOS:
                indices = [idx for idx, t in enumerate(tou_48) if TOU_TYPE_MAP.get(t) == pkey]
                if indices:
                    prices[pkey] = sum(final_prices_48[idx] for idx in indices) / len(indices)
                else:
                    prices[pkey] = 0.0
        else:
            prices = {}
            for period, ref_val in tou_ref.items():
                # 最终单价 = 参考价 - 价差 * 分成 + 浮动价 + 摊分后的浮动费
                prices[period] = ref_val - spread * sharing / 100.0 + floating + floating_fee_per_kwh

        # 463号文比例调节（以5时段均价校核）
        adjusted, was_adjusted = self._adjust_price_ratios(prices, date_str)

        # 若使用48点参考价，需将校核结果同步映射回48点结算价，
        # 否则会出现“price_ratio_adjusted=true 但计费仍走未校核48点价”的不一致。
        if final_prices_48 and len(final_prices_48) == 48:
            tou_48 = self._get_tou_48(date_str)
            if tou_48 and len(tou_48) == 48:
                period_delta: Dict[str, float] = {}
                for pkey in DEFAULT_RATIOS:
                    period_delta[pkey] = float(adjusted.get(pkey, 0.0)) - float(prices.get(pkey, 0.0))
                for i in range(48):
                    pkey = TOU_TYPE_MAP.get(tou_48[i], "flat")
                    final_prices_48[i] = float(final_prices_48[i]) + float(period_delta.get(pkey, 0.0))

        return {
            "reference_price": ReferencePriceInfo(
                type=ref_type,
                base_value=base_value,
                source=ref_source,
                source_month=date_str[:7],
            ),
            "final_prices": adjusted,
            "final_prices_48": final_prices_48, # Add 48-point prices to result
            "price_ratio_adjusted": was_adjusted,
        }

    # ========== 固定联动类计算 ==========

    def _calculate_fixed_linked(
        self,
        pricing_config: Dict[str, Any],
        date_str: str,
        settlement_type: str = "daily"
    ) -> Optional[Dict[str, Any]]:
        """
        固定价+联动类定价计算 (fixed_linked_*)
        两步走逻辑: 1. 先校核固定价 2. 再叠加现货
        """
        # 1. 获取固定价 (5时段字典)
        fixed = {
            "tip": float(pricing_config.get("fixed_price_peak", 0) or 0),
            "peak": float(pricing_config.get("fixed_price_high", 0) or 0),
            "flat": float(pricing_config.get("fixed_price_flat", 0) or 0),
            "valley": float(pricing_config.get("fixed_price_valley", 0) or 0),
            "deep": float(pricing_config.get("fixed_price_deep_valley", 0) or 0),
        }

        # 第一阶段：固定价校核 (满足 463 号文)
        adjusted_fixed, was_adjusted_base = self._adjust_price_ratios(fixed, date_str)

        # 2. 获取联动标的价格 (List[float] 或 Dict[str, float])
        linked_ratio = float(pricing_config.get("linked_ratio", 0) or 0) / 100.0
        linked_target = pricing_config.get("linked_target", "real_time_avg")
        target_data = self._get_linked_target_prices(linked_target, date_str, settlement_type=settlement_type)

        # 第二阶段：现货联动叠加 (支持 48 点向量)
        tou_48 = self._get_tou_48(date_str)
        final_prices_48 = [0.0] * 48
        
        for i in range(48):
            ptype_cn = tou_48[i]
            pkey = TOU_TYPE_MAP.get(ptype_cn, "flat")
            
            fp = adjusted_fixed.get(pkey, 0.0)
            # 获取第 i 点标的价格
            if isinstance(target_data, list) and len(target_data) == 48:
                tp = target_data[i]
            else:
                tp = target_data.get(pkey, 0.0)
                
            final_prices_48[i] = fp * (1 - linked_ratio) + tp * linked_ratio

        # 聚合 5 时段展示价 (算术均值，仅用于显示)
        prices_5 = {}
        for pkey in DEFAULT_RATIOS:
            indices = [idx for idx, t in enumerate(tou_48) if TOU_TYPE_MAP.get(t) == pkey]
            if indices:
                prices_5[pkey] = sum(final_prices_48[idx] for idx in indices) / len(indices)
            else:
                prices_5[pkey] = 0.0

        return {
            "fixed_prices": fixed,
            "linked_config": LinkedConfigInfo(
                ratio=linked_ratio * 100,
                target=linked_target,
                target_prices=target_data if isinstance(target_data, dict) else {},
                target_prices_48=target_data if isinstance(target_data, list) else None,
            ),
            "final_prices": prices_5,
            "final_prices_48": final_prices_48,
            "price_ratio_adjusted": False, # 现货联动整体不参与比例调节检查
            "price_ratio_adjusted_base": was_adjusted_base,
        }

    # ========== 参考价联动类计算 ==========

    def _calculate_reference_linked(
        self,
        pricing_config: Dict[str, Any],
        date_str: str,
        is_time_based_package: bool = True,
        total_load_mwh: float = 0.0,
        settlement_type: str = "daily"
    ) -> Optional[Dict[str, Any]]:
        """
        参考价+联动类定价计算 (reference_linked_*)
        两步走逻辑: 1. 先校核基准价 2. 再叠加现货
        """
        # 1. 获取基准参考价
        ref_type = pricing_config.get("reference_type", "")
        is_monthly = (settlement_type == "monthly")
        ref_values, ref_source = retail_price_service.get_reference_price_values(
            ref_type, date_str, 
            is_time_based=is_time_based_package,
            is_monthly=is_monthly
        )
        
        base_value = 0.0
        if isinstance(ref_values, dict):
            base_value = ref_values.get("flat", 0.0)
            tou_base = ref_values
        else:
            base_value = float(ref_values or 0)
            ratios = self._get_tou_ratios(date_str)
            tou_base = self._expand_reference_to_tou(base_value, ratios=ratios)

        # 第一阶段：基准价校核 (463号文)
        adjusted_base, was_adjusted_base = self._adjust_price_ratios(tou_base, date_str)

        # 2. 获取联动标的价格
        linked_ratio = float(pricing_config.get("linked_ratio", 0) or 0) / 100.0
        linked_target = pricing_config.get("linked_target", "real_time_avg")
        target_data = self._get_linked_target_prices(linked_target, date_str, settlement_type=settlement_type)

        # 3. 混合计算
        floating = float(pricing_config.get("floating_price", 0) or 0)
        floating_fee = float(pricing_config.get("floating_fee", 0) or 0)
        floating_fee_per_kwh = (floating_fee / (total_load_mwh * 1000.0)) if (floating_fee > 0 and total_load_mwh > 0) else 0.0

        tou_48 = self._get_tou_48(date_str)
        final_prices_48 = [0.0] * 48
        prices_5 = {}

        for i in range(48):
            ptype_cn = tou_48[i]
            pkey = TOU_TYPE_MAP.get(ptype_cn, "flat")
            
            b = adjusted_base.get(pkey, 0.0)
            if isinstance(target_data, list) and len(target_data) == 48:
                t = target_data[i]
            else:
                t = target_data.get(pkey, 0.0)
                
            final_prices_48[i] = b * (1 - linked_ratio) + t * linked_ratio + floating + floating_fee_per_kwh

        # 聚合 5 时段展示价
        for pkey in DEFAULT_RATIOS:
            indices = [idx for idx, t in enumerate(tou_48) if TOU_TYPE_MAP.get(t) == pkey]
            if indices:
                prices_5[pkey] = sum(final_prices_48[idx] for idx in indices) / len(indices)
            else:
                prices_5[pkey] = 0.0

        return {
            "reference_price": ReferencePriceInfo(
                type=ref_type,
                base_value=base_value,
                source=ref_source,
                source_month=date_str[:7],
            ),
            "linked_config": LinkedConfigInfo(
                ratio=linked_ratio * 100,
                target=linked_target,
                target_prices=target_data if isinstance(target_data, dict) else {},
                target_prices_48=target_data if isinstance(target_data, list) else None,
            ),
            "final_prices": prices_5,
            "final_prices_48": final_prices_48,
            "price_ratio_adjusted": False,
            "price_ratio_adjusted_base": was_adjusted_base,
        }

    # ========== 单一综合价类计算 ==========

    def _calculate_single_comprehensive(
        self,
        pricing_config: Dict[str, Any],
        date_str: str,
        settlement_type: str = "daily"
    ) -> Optional[Dict[str, Any]]:
        """
        单一综合价(参考价)类计算 (single_comprehensive_reference_time)
        Formula: Flat = Base(flat) * ratio, others derived by standard ratios
        """
        ref_type = pricing_config.get("reference_type", "")
        ref_source = "simulated" # Default if no ref_type
        if ref_type:
            # 参考价模式
            is_monthly = (settlement_type == "monthly")
            ref_values, ref_source = retail_price_service.get_reference_price_values(
                ref_type, date_str, 
                is_time_based=False,
                is_monthly=is_monthly
            )
            base_value = ref_values
            spread_ratio = float(pricing_config.get("spread_ratio", 1.0) or 1.0)
            flat_price = base_value * spread_ratio
        else:
            # 固定价模式 (single_comprehensive_fixed_time)
            flat_price = float(pricing_config.get("flat_price", 0) or 0)
            base_value = flat_price # 此时基准即为平段固定价
        
        # 按标准比例展开为5个时段 (单一综合价特征是不使用动态比例)
        prices = self._expand_reference_to_tou(flat_price, ratios=DEFAULT_RATIOS)

        # 此模型本身即为比例模型，通常不需要再做 adjust_price_ratios
        # 但为保险起见，仍经过一遍以防 DEFAULT_RATIOS 有误
        adjusted, was_adjusted = self._adjust_price_ratios(prices, date_str)

        ref_info = None
        if ref_type:
            ref_info = ReferencePriceInfo(
                type=ref_type,
                base_value=base_value,
                source=ref_source,
                source_month=date_str[:7],
            )

        return {
            "reference_price": ref_info,
            "final_prices": adjusted,
            "price_ratio_adjusted": was_adjusted,
        }

    # ========== 辅助工具 ==========

    def _get_tou_ratios(self, date_str: str) -> Dict[str, float]:
        """
        获取分时比例系数映射（En Key -> Ratio）。
        按当前业务要求，严格执行 463 固定比例，不随月度系数变化。
        """
        _ = date_str
        return dict(DEFAULT_RATIOS)

    # ========== 封顶价获取 ==========

    def _get_monthly_cap_price(self, date_str: str) -> Dict[str, float]:
        """
        获取当月的封顶价格信息
        """
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        month_str = date_str[:7]

        # 1. 判定月份类型 (动态获取)
        tou_meta = get_month_tou_meta(date_dt, self.db["tou_rules"])
        is_tip_month = tou_meta.get("is_tip_month", False)
        
        ratio = 0.15 if is_tip_month else 0.10

        # 2. 获取基准价 (使用 avg_on_grid_price)
        base_price = 0.405745  # 默认兜底值
        
        doc = self.db["price_sgcc"].find_one({"_id": month_str})
        if doc and doc.get("avg_on_grid_price"):
             base_price = float(doc["avg_on_grid_price"])
        
        # 3. 计算封顶价
        cap_price = base_price * (1 + ratio)

        return {
            "cap_price": cap_price,
            "base_price": base_price,
            "ratio": ratio
        }

    # ========== 分时展开 ==========

    @staticmethod
    def _expand_reference_to_tou(base_price: float, ratios: Dict[str, float] = None) -> Dict[str, float]:
        """按比例展开为5个时段参考价"""
        if ratios is None:
            ratios = DEFAULT_RATIOS
        return {period: base_price * ratio for period, ratio in ratios.items()}

    # ========== 比例调节 ==========

    def _adjust_price_ratios(self, prices: Dict[str, float], date_str: str) -> tuple:
        """
        463号文价格比例调节 (使用动态系数)
        """
        flat = prices.get("flat", 0)
        if flat <= 0:
            return prices, False
            
        ratios = self._get_tou_ratios(date_str)
        # 比例比较容差：避免边界值受浮点误差影响被误判触发
        eps = 1e-6

        adjusted = dict(prices)
        was_adjusted = False

        for period, ratio in ratios.items():
            if period == "flat":
                continue
            threshold = flat * ratio

            if period in ("tip", "peak"):
                # 上浮时段: 仅在低于要求时上调
                if adjusted.get(period, 0) < threshold - eps:
                    adjusted[period] = threshold
                    was_adjusted = True
            elif period in ("valley", "deep"):
                # 下浮时段: 仅在高于要求时下调
                if adjusted.get(period, 0) > threshold + eps:
                    adjusted[period] = threshold
                    was_adjusted = True

        return adjusted, was_adjusted

    # ========== TOU 96→48 映射 ==========

    def _get_tou_48(self, date_str: str) -> Optional[List[str]]:
        """
        获取48时段的峰谷类型列表
        """
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        tou_48 = get_tou_timeline_by_date(date_dt, points=48)
        if len(tou_48) != 48:
            logger.warning(f"TOU 数据点数异常: {len(tou_48)}，预期 48")
            return None
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
        date_str: str,
        settlement_type: str = "daily"
    ) -> Union[Dict[str, float], List[float]]:
        """获取联动标的价格 (针对现货联动返回 48 点 List)"""
        
        # 优先从零售价格服务获取 (已在内部实现统一聚合)
        is_monthly = (settlement_type == "monthly")
        ref_values, _ = retail_price_service.get_reference_price_values(
            target, date_str, is_time_based=True, is_monthly=is_monthly
        )
        if ref_values is not None:
            if isinstance(ref_values, list) and len(ref_values) == 48:
                return ref_values
            if isinstance(ref_values, dict) and any(ref_values.values()):
                return ref_values

        # 兜底：如果 Service 无数据，返回空时段字典
        return {k: 0.0 for k in DEFAULT_RATIOS}


# 全局服务实例
retail_settlement_service = RetailSettlementService()
