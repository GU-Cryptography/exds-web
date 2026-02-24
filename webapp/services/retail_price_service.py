# -*- coding: utf-8 -*-
"""
零售参考价服务
负责从零售结算价格定义中提取并处理参考价数据
"""

import logging
from datetime import datetime
from typing import Dict, Optional, Any, Union, List, Tuple
from webapp.tools.mongo import DATABASE
from webapp.services.tou_service import get_month_tou_meta
from webapp.services.spot_price_service import get_monthly_avg_spot_prices_48, get_spot_price_curve_48

logger = logging.getLogger(__name__)

# 时段类型映射（中文 -> 内部标识）
TOU_TYPE_MAP = {
    "尖峰": "tip",
    "高峰": "peak",
    "平段": "flat",
    "低谷": "valley",
    "深谷": "deep",
}

class RetailPriceService:
    """零售参考价服务"""

    def __init__(self):
        self.db = DATABASE
        self.collection = self.db["retail_settlement_prices"]

    def get_reference_price_values(
        self,
        price_key: str,
        date_str: str,
        is_time_based: bool = False,
        is_monthly: bool = False
    ) -> Tuple[Union[float, Dict[str, float], List[float], None], str]:
        """
        获取指定日期和类型的参考价（自动处理降级）

        Args:
            price_key: 参考价键名，支持：
                - 'upper_limit_price': 上限价
                - 'market_monthly_avg': 市场月度交易均价
                - 'market_annual_avg': 市场年度交易均价
                - 'market_avg': 市场交易均价
                - 'market_monthly_on_grid': 市场月度平均上网电价
                - 'retailer_monthly_avg': 售电公司月度交易均价
                - 'retailer_annual_avg': 售电公司年度交易均价
                - 'retailer_avg': 售电公司交易均价
                - 'retailer_monthly_settle_weighted': 售电公司月度结算加权价
                - 'retailer_side_settle_weighted': 售电侧月度结算加权价
                - 'real_time_avg': 实时市场加权平均价
                - 'day_ahead_avg': 日前市场加权平均价
                - 'day_ahead_avg_econ': 经济日前均价
                - 'grid_agency_price': 电网代理购电价格
                - 'coal_capacity_discount': 煤电容量电费折价
                - 'genside_annual_bilateral': 发电侧火电年度双边价
                - 'market_longterm_flat_avg': 市场中长期平段合规价
            date_str: 结算日期 YYYY-MM-DD
            is_time_based: 是否需要分时数据

        Returns:
            tuple: (价格数据, 来源标识 "official"|"simulated")
            价格数据: 
                - 常规或单值: float
                - 分时(5段): Dict[str, float]
                - 现货(48点): List[float]
                - 缺失: None
        """
        month_str = date_str[:7]
        
        # 1. 优先尝试从 retail_settlement_prices 获取正式发布数据
        doc = self.collection.find_one({"_id": month_str})
        
        if doc:
            if is_time_based:
                # 获取分时价格 (5 段或 48 点)
                period_prices = doc.get("period_prices", [])
                if period_prices:
                    if len(period_prices) == 48:
                        # 现货 48 点返回列表
                        vals = []
                        for p in period_prices:
                            val = p.get(price_key, 0.0)
                            vals.append(float(val) / 1000.0 if val > 10 else float(val))
                        return vals, "official"
                    else:
                        # 5 段分时返回字典
                        res_dict = {}
                        for p in period_prices:
                            ptype_cn = p.get("period_type", "平段")
                            pkey = TOU_TYPE_MAP.get(ptype_cn, "flat")
                            val = p.get(price_key, 0.0)
                            res_dict[pkey] = float(val) / 1000.0 if val > 10 else float(val)
                        return res_dict, "official"
            else:
                # 获取常规价格单值
                regular_prices = doc.get("regular_prices", [])
                for p in regular_prices:
                    if p.get("price_type_key") == price_key:
                        val = p.get("value")
                        if val is not None:
                            return float(val), "official"

        # 2. 如果无正式数据或查找失败，进入降级处理
        logger.info(f"月份 {month_str} 无正式定价数据 [{price_key}]，采用模拟方案")
        return self._fallback_resolve(price_key, date_str, is_time_based), "simulated"

    def _fallback_resolve(
        self,
        price_key: str,
        date_str: str,
        is_time_based: bool
    ) -> Union[float, Dict[str, float], List[float], None]:
        """降级方案实现（江西 4.0 规则）"""
        
        # 1. 上限价 (基准价 0.4143 * 1.2)
        if price_key == "upper_limit_price":
            base_val = 0.4143 * 1.2
            if not is_time_based:
                return base_val
            # 分时展开 (使用江西默认比例)
            from webapp.services.retail_settlement_service import DEFAULT_RATIOS
            return {k: base_val * r for k, r in DEFAULT_RATIOS.items()}
            
        # 2. 市场/售电/代购电价 (降级替换逻辑)
        substitute_keys = (
            "market_monthly_avg", "market_annual_avg", "market_avg", "market_monthly_on_grid",
            "retailer_monthly_avg", "retailer_annual_avg", "retailer_avg",
            "grid_agency_price"
        )
        if price_key in substitute_keys:
            month_str = date_str[:7]
            doc = self.db["price_sgcc"].find_one({"_id": month_str})
            if not doc:
                return None
            
            # 代购电价 mapping
            if price_key == "grid_agency_price":
                val = doc.get("agency_purchase_price")
            else:
                # 其他所有市场及售电均价，降级时统一由“平均上网电价”代替
                val = doc.get("avg_on_grid_price")
                
            if val is None:
                return None
            val = float(val)
            if not is_time_based:
                return val
            from webapp.services.retail_settlement_service import DEFAULT_RATIOS
            return {k: val * r for k, r in DEFAULT_RATIOS.items()}

        # 3. 现货联动类 (日前/实时/经济日前) -> 调用统一聚合服务获取向量
        if price_key in ("day_ahead_avg", "real_time_avg", "day_ahead_avg_econ"):
            data_type_map = {
                "day_ahead_avg": "day_ahead",
                "real_time_avg": "real_time",
                "day_ahead_avg_econ": "day_ahead_econ"
            }
            data_type = data_type_map.get(price_key, "day_ahead")
            
            if is_monthly:
                # 场景：月度结算 -> 使用 MTD 均值
                month_str = date_str[:7]
                return get_monthly_avg_spot_prices_48(self.db, month_str, date_str, data_type), "simulated"
            else:
                # 场景：日清预结算 -> 使用当天的现货价格 (元/MWh -> 元/kWh)
                collection_mapping = {
                    "day_ahead": ("day_ahead_spot_price", "avg_clearing_price"),
                    "real_time": ("real_time_spot_price", "arithmetic_avg_clearing_price"),
                    "day_ahead_econ": ("day_ahead_econ_price", "clearing_price")
                }
                coll_name, p_field = collection_mapping.get(data_type, collection_mapping["day_ahead"])
                
                mwh_prices = get_spot_price_curve_48(self.db, date_str, coll_name, p_field)
                kwh_prices = [round(p / 1000.0, 6) for p in mwh_prices]
                return kwh_prices, "simulated"

        # 其他未定义
        return None

# 全局单例
retail_price_service = RetailPriceService()
