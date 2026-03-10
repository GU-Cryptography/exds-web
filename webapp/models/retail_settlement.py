# -*- coding: utf-8 -*-
"""零售侧日结算数据模型"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime

from webapp.models.settlement import SettlementVersion


class RetailPeriodDetail(BaseModel):
    """零售结算48时段明细"""
    period: int = Field(..., description="时段号 (1-48)")
    period_type: str = Field(..., description="时段类型: 尖峰/高峰/平段/低谷/深谷")
    load_mwh: float = Field(0.0, description="时段电量 (MWh)")
    unit_price: float = Field(0.0, description="时段单价 (元/kWh)")
    fee: float = Field(0.0, description="时段电费 (元)")
    allocated_cost: Optional[float] = Field(None, description="该时段采购分摊成本 (元)")
    wholesale_price: Optional[float] = Field(None, description="该时段计算该成本所依据的最终代理拿货单价 (元/MWh)")


class TouSummaryItem(BaseModel):
    """各时段汇总"""
    load_mwh: float = Field(0.0, description="电量 (MWh)")
    fee: float = Field(0.0, description="电费 (元)")


class ReferencePriceInfo(BaseModel):
    """参考价信息"""
    type: str = Field(..., description="参考价类型: market_monthly_avg / upper_limit_price")
    base_value: float = Field(..., description="参考价基准值 (元/kWh)")
    source: str = Field("official", description="数据来源: official / simulated")
    source_month: str = Field(..., description="参考价所属月份 (YYYY-MM)")


class LinkedConfigInfo(BaseModel):
    """联动配置信息 (仅固定+联动模式)"""
    ratio: float = Field(..., description="联动比例 (%)")
    target: str = Field(..., description="联动标的: real_time_avg / day_ahead_avg")
    target_prices: Dict[str, float] = Field(default_factory=dict, description="联动标的时段价格 (5时段)")
    target_prices_48: Optional[List[float]] = Field(None, description="联动标的48点价格向量")


class RetailSettlementDaily(BaseModel):
    """零售侧日结算单"""

    # 基础信息
    customer_id: str = Field(..., description="客户ID")
    customer_name: str = Field("", description="客户名称")
    date: str = Field(..., description="结算日期 YYYY-MM-DD")
    contract_id: str = Field("", description="关联合同ID")
    package_name: str = Field("", description="套餐名称")
    model_code: str = Field("", description="定价模型代码")
    settlement_type: str = Field("daily", description="结算类型: daily / monthly")
    wholesale_version: Optional[SettlementVersion] = Field(
        None,
        description="零售侧结算依赖的批发侧结算版本",
    )

    # 参考价信息
    reference_price: Optional[ReferencePriceInfo] = Field(None, description="参考价信息 (价差分成类)")

    # 固定+联动信息
    fixed_prices: Optional[Dict[str, float]] = Field(None, description="固定分时价格 (固定联动类)")
    linked_config: Optional[LinkedConfigInfo] = Field(None, description="联动配置 (固定联动类)")

    # 最终价格
    final_prices: Dict[str, float] = Field(default_factory=dict, description="最终时段价格 {tip, peak, flat, valley, deep}")
    price_ratio_adjusted: bool = Field(False, description="是否经过463号文比例调节 (最终价)")
    price_ratio_adjusted_base: bool = Field(False, description="是否经过463号文比例调节 (固定价/基准价部分)")

    # 封顶信息
    is_capped: bool = Field(False, description="是否触发了封顶保护")
    nominal_avg_price: float = Field(0.0, description="封顶前的名义均价 (元/kWh)")
    cap_price: float = Field(0.0, description="计算所依据的封顶价基准 (元/kWh)")

    # 48时段明细
    period_details: List[RetailPeriodDetail] = Field(default_factory=list, description="48点明细")

    # 日汇总
    total_load_mwh: float = Field(0.0, description="日总电量 (MWh)")
    total_fee: float = Field(0.0, description="日总电费 (元)")
    avg_price: float = Field(0.0, description="加权均价 (元/kWh)")
    tou_summary: Dict[str, TouSummaryItem] = Field(default_factory=dict, description="各时段汇总")

    # 成本与利润
    total_allocated_cost: Optional[float] = Field(None, description="日总采购分摊成本 (元)")
    gross_profit: Optional[float] = Field(None, description="日毛利 (元)")

    # 时间信息
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
