from typing import List, Optional

from pydantic import BaseModel, Field


class TradeDateListResponse(BaseModel):
    latest_trade_date: Optional[str] = Field(None, description="最近交易日")
    trade_dates: List[str] = Field(default_factory=list, description="交易日期列表")


class DeliveryDateSummary(BaseModel):
    delivery_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    record_count: int = Field(..., description="申报记录数")


class TradeOverviewResponse(BaseModel):
    trade_date: str = Field(..., description="交易日期 YYYY-MM-DD")
    delivery_summaries: List[DeliveryDateSummary] = Field(default_factory=list, description="目标日期摘要")


class RecordOverviewCard(BaseModel):
    total_records: int = Field(..., description="总申报记录数")
    traded_records: int = Field(..., description="成交笔数")


class TradeOverviewCard(BaseModel):
    traded_mwh: float = Field(..., description="成交电量")
    buy_traded_mwh: float = Field(..., description="买入成交电量")
    sell_traded_mwh: float = Field(..., description="卖出成交电量")


class PeriodOverviewCard(BaseModel):
    traded_period_count: int = Field(..., description="成交时段数")
    buy_traded_period_count: int = Field(..., description="买入成交时段数")
    sell_traded_period_count: int = Field(..., description="卖出成交时段数")


class OperationOverviewCard(BaseModel):
    listing_operation_count: int = Field(..., description="挂牌申报次数")
    manual_off_shelf_operation_count: int = Field(..., description="人工下架次数")
    auto_off_shelf_operation_count: int = Field(..., description="自动下架次数")


class SummaryCardsResponse(BaseModel):
    record_overview: RecordOverviewCard
    trade_overview: TradeOverviewCard
    period_overview: PeriodOverviewCard
    operation_overview: OperationOverviewCard


class ExecutionAnalysisSummary(BaseModel):
    profit_count: int = Field(..., description="盈利笔数")
    profit_amount: float = Field(..., description="盈利金额")
    loss_count: int = Field(..., description="亏损笔数")
    loss_amount: float = Field(..., description="亏损金额")
    total_profit_amount: float = Field(..., description="当日交易总收益")


class ExecutionChartRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    annual_monthly_mwh: float = Field(0.0, description="年度分月电量")
    monthly_mwh: float = Field(0.0, description="月度电量")
    mechanism_mwh: float = Field(0.0, description="机制电量")
    historical_within_month_net_mwh: float = Field(0.0, description="历史月内净持仓修正量")
    trade_day_net_mwh: float = Field(0.0, description="当日月内净成交量")
    final_position_mwh: float = Field(0.0, description="最终持仓")
    actual_or_forecast_load_mwh: Optional[float] = Field(None, description="实际或预测电量")
    load_source: Optional[str] = Field(None, description="actual / forecast")
    trade_avg_price: Optional[float] = Field(None, description="成交均价")
    trade_count: int = Field(0, description="成交次数")
    trade_volume_mwh: float = Field(0.0, description="累计成交量")
    market_monthly_price: Optional[float] = Field(None, description="市场月内均价")
    spot_price: Optional[float] = Field(None, description="现货价格")
    period_profit_amount: Optional[float] = Field(None, description="该时段交易收益")


class ExecutionTableRow(ExecutionChartRow):
    pass


class OperationButtonItem(BaseModel):
    operation_id: str = Field(..., description="申报过程ID")
    operation_type: str = Field(..., description="listing / manual_off_shelf / auto_off_shelf")
    operation_time: str = Field(..., description="申报过程时间")
    button_title: str = Field(..., description="按钮主文案")
    button_subtitle: str = Field(..., description="按钮副文案")
    record_count: int = Field(..., description="记录数")
    covered_period_count: int = Field(..., description="覆盖时段数")
    buy_record_count: int = Field(..., description="买入记录数")
    sell_record_count: int = Field(..., description="卖出记录数")


class OperationSummary(BaseModel):
    operation_title: str = Field(..., description="动作标题")
    operation_effect_text: str = Field(..., description="本次动作影响说明")
    post_operation_text: str = Field(..., description="动作后状态说明")


class OrderLevelItem(BaseModel):
    level_index: int = Field(..., description="价格档位序号")
    price: float = Field(..., description="挂单价格")
    volume_mwh: float = Field(..., description="挂单电量")
    color_token: str = Field(..., description="颜色标识")


class OperationChartRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    buy_order_levels: List[OrderLevelItem] = Field(default_factory=list, description="买入挂单档位")
    sell_order_levels: List[OrderLevelItem] = Field(default_factory=list, description="卖出挂单档位")
    spot_price: Optional[float] = Field(None, description="实时价格")
    actual_or_forecast_load_mwh: Optional[float] = Field(None, description="实际或预测电量")
    load_source: Optional[str] = Field(None, description="actual / forecast")


class OperationTableRow(BaseModel):
    record_key: str = Field(..., description="记录唯一键")
    period: int = Field(..., ge=1, le=48, description="时段")
    trade_direction: str = Field(..., description="buy / sell")
    price_level_index: int = Field(..., description="价格档位序号")
    same_direction_level_count: int = Field(..., description="同方向档位数")
    listing_price: Optional[float] = Field(None, description="挂单价格")
    listing_mwh: float = Field(0.0, description="挂单电量")
    spot_price: Optional[float] = Field(None, description="实时价格")
    operation_effect_type: str = Field(..., description="add / remove / auto_remove / keep")
    operation_effect_mwh: float = Field(0.0, description="本次动作影响电量")


class OperationDetailResponse(BaseModel):
    operation_id: str = Field(..., description="申报过程ID")
    operation_type: str = Field(..., description="listing / manual_off_shelf / auto_off_shelf")
    operation_time: str = Field(..., description="申报过程时间")
    operation_summary: OperationSummary
    chart_rows: List[OperationChartRow] = Field(default_factory=list, description="申报后挂单图表数据")
    table_rows: List[OperationTableRow] = Field(default_factory=list, description="申报后挂单明细")


class TradeDetailResponse(BaseModel):
    trade_date: str = Field(..., description="交易日期 YYYY-MM-DD")
    delivery_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    summary_cards: SummaryCardsResponse
    execution_analysis_summary: Optional[ExecutionAnalysisSummary] = Field(
        None,
        description="成交分析结果；现货价格未发布时为空",
    )
    execution_chart: List[ExecutionChartRow] = Field(default_factory=list, description="图形复盘数据")
    execution_table: List[ExecutionTableRow] = Field(default_factory=list, description="数据表格")
    operation_buttons: List[OperationButtonItem] = Field(default_factory=list, description="申报过程按钮带")
    default_operation_id: Optional[str] = Field(None, description="默认选中的申报过程ID")
    default_operation_detail: Optional[OperationDetailResponse] = Field(None, description="默认申报过程详情")
    review_texts: List[str] = Field(default_factory=list, description="复盘文本")
