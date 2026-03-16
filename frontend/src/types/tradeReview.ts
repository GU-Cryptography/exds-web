export interface TradeDateListResponse {
    latest_trade_date: string | null;
    trade_dates: string[];
}

export interface DeliveryDateSummary {
    delivery_date: string;
    record_count: number;
}

export interface TradeOverviewResponse {
    trade_date: string;
    delivery_summaries: DeliveryDateSummary[];
}

export interface RecordOverviewCard {
    total_records: number;
    traded_records: number;
}

export interface TradeOverviewCard {
    traded_mwh: number;
    buy_traded_mwh: number;
    sell_traded_mwh: number;
}

export interface PeriodOverviewCard {
    traded_period_count: number;
    buy_traded_period_count: number;
    sell_traded_period_count: number;
}

export interface BatchOverviewCard {
    listing_batch_count: number;
    off_shelf_batch_count: number;
}

export interface SummaryCardsResponse {
    record_overview: RecordOverviewCard;
    trade_overview: TradeOverviewCard;
    period_overview: PeriodOverviewCard;
    batch_overview: BatchOverviewCard;
}

export interface ExecutionAnalysisSummary {
    profit_count: number;
    profit_amount: number;
    loss_count: number;
    loss_amount: number;
    total_profit_amount: number;
}

export interface ExecutionChartRow {
    period: number;
    annual_monthly_mwh: number;
    monthly_mwh: number;
    mechanism_mwh: number;
    historical_within_month_net_mwh: number;
    trade_day_net_mwh: number;
    final_position_mwh: number;
    actual_or_forecast_load_mwh: number | null;
    load_source: string | null;
    trade_avg_price: number | null;
    trade_count: number;
    trade_volume_mwh: number;
    market_monthly_price: number | null;
    spot_price: number | null;
    period_profit_amount: number | null;
}

export type ExecutionTableRow = ExecutionChartRow;

export interface BatchTimelineItem {
    batch_id: string;
    batch_action_type: 'listing' | 'off_shelf';
    batch_start_time: string;
    batch_end_time: string;
    record_count: number;
    covered_period_count: number;
    buy_record_count: number;
    sell_record_count: number;
    batch_listing_mwh: number;
}

export interface BatchChartRow {
    period: number;
    trade_direction: string;
    listing_mwh: number;
    traded_mwh: number;
    listing_price: number | null;
    market_monthly_price: number | null;
    spot_price: number | null;
    actual_or_forecast_load_mwh: number | null;
    load_source: string | null;
}

export interface BatchRecordItem {
    record_key: string;
    period: number;
    trade_direction: string;
    listing_mwh: number;
    traded_mwh: number;
    listing_price: number | null;
    listing_time: string | null;
    off_shelf_time: string | null;
    off_shelf_type: string | null;
    is_traded: boolean;
}

export interface BatchDetailResponse {
    batch_id: string;
    batch_action_type: 'listing' | 'off_shelf';
    batch_start_time: string;
    batch_end_time: string;
    batch_chart_rows: BatchChartRow[];
    batch_records: BatchRecordItem[];
}

export interface TradeDetailResponse {
    trade_date: string;
    delivery_date: string;
    summary_cards: SummaryCardsResponse;
    execution_analysis_summary: ExecutionAnalysisSummary | null;
    execution_chart: ExecutionChartRow[];
    execution_table: ExecutionTableRow[];
    batch_timeline: BatchTimelineItem[];
    default_batch_id: string | null;
    default_batch_detail: BatchDetailResponse | null;
    review_texts: string[];
}
