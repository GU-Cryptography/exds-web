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


class BatchOverviewCard(BaseModel):
    listing_batch_count: int = Field(..., description="上架批次")
    off_shelf_batch_count: int = Field(..., description="下架批次")


class SummaryCardsResponse(BaseModel):
    record_overview: RecordOverviewCard
    trade_overview: TradeOverviewCard
    period_overview: PeriodOverviewCard
    batch_overview: BatchOverviewCard


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


class BatchTimelineItem(BaseModel):
    batch_id: str = Field(..., description="批次ID")
    batch_action_type: str = Field(..., description="listing / off_shelf")
    batch_start_time: str = Field(..., description="批次开始时间")
    batch_end_time: str = Field(..., description="批次结束时间")
    record_count: int = Field(..., description="批次记录数")
    covered_period_count: int = Field(..., description="覆盖时段数")
    buy_record_count: int = Field(..., description="买入记录数")
    sell_record_count: int = Field(..., description="卖出记录数")
    batch_listing_mwh: float = Field(..., description="批次总申报电量")


class BatchChartRow(BaseModel):
    period: int = Field(..., ge=1, le=48, description="时段")
    trade_direction: str = Field(..., description="buy / sell / unknown")
    listing_mwh: float = Field(0.0, description="挂牌电量")
    traded_mwh: float = Field(0.0, description="成交电量")
    listing_price: Optional[float] = Field(None, description="挂牌价格")
    market_monthly_price: Optional[float] = Field(None, description="市场月内均价")
    spot_price: Optional[float] = Field(None, description="现货价格")
    actual_or_forecast_load_mwh: Optional[float] = Field(None, description="实际或预测电量")
    load_source: Optional[str] = Field(None, description="actual / forecast")


class BatchRecordItem(BaseModel):
    record_key: str = Field(..., description="记录唯一键")
    period: int = Field(..., ge=1, le=48, description="时段")
    trade_direction: str = Field(..., description="buy / sell / unknown")
    listing_mwh: float = Field(0.0, description="挂牌电量")
    traded_mwh: float = Field(0.0, description="成交电量")
    listing_price: Optional[float] = Field(None, description="挂牌价格")
    listing_time: Optional[str] = Field(None, description="上架时间")
    off_shelf_time: Optional[str] = Field(None, description="下架时间")
    off_shelf_type: Optional[str] = Field(None, description="下架类型")
    is_traded: bool = Field(False, description="是否成交")


class BatchDetailResponse(BaseModel):
    batch_id: str = Field(..., description="批次ID")
    batch_action_type: str = Field(..., description="listing / off_shelf")
    batch_start_time: str = Field(..., description="批次开始时间")
    batch_end_time: str = Field(..., description="批次结束时间")
    batch_chart_rows: List[BatchChartRow] = Field(default_factory=list, description="批次图表数据")
    batch_records: List[BatchRecordItem] = Field(default_factory=list, description="批次明细")


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
    batch_timeline: List[BatchTimelineItem] = Field(default_factory=list, description="批次时间轴")
    default_batch_id: Optional[str] = Field(None, description="默认选中的批次ID")
    default_batch_detail: Optional[BatchDetailResponse] = Field(None, description="默认批次详情")
    review_texts: List[str] = Field(default_factory=list, description="复盘文本")
