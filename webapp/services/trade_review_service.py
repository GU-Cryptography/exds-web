import logging
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from pymongo.database import Database

from webapp.models.load_enums import FusionStrategy
from webapp.services.contract_service import ContractService
from webapp.services.load_forecast_service import LoadForecastService
from webapp.services.load_query_service import LoadQueryService
from webapp.models.trade_review import (
    BatchDetailResponse,
    BatchRecordItem,
    BatchTimelineItem,
    BatchChartRow,
    BatchOverviewCard,
    DeliveryDateSummary,
    ExecutionAnalysisSummary,
    ExecutionChartRow,
    ExecutionTableRow,
    PeriodOverviewCard,
    RecordOverviewCard,
    SummaryCardsResponse,
    TradeDateListResponse,
    TradeDetailResponse,
    TradeOverviewCard,
    TradeOverviewResponse,
)
from webapp.services.spot_price_service import get_spot_prices

logger = logging.getLogger(__name__)


class TradeReviewService:
    def __init__(self, db: Database) -> None:
        self.db = db
        self.trade_declare_collection = db["trade_declare"]
        self.contracts_collection = db["contracts_aggregated_daily"]
        self.mechanism_collection = db["mechanism_energy_monthly"]
        self.contract_service = ContractService(db)
        self.load_forecast_service = LoadForecastService(db)
        self.load_query_service = LoadQueryService

    def get_trade_dates(self) -> TradeDateListResponse:
        trade_dates = sorted(
            [item for item in self.trade_declare_collection.distinct("trade_date") if item],
            reverse=True,
        )
        return TradeDateListResponse(
            latest_trade_date=trade_dates[0] if trade_dates else None,
            trade_dates=trade_dates,
        )

    def get_trade_overview(self, trade_date: str) -> TradeOverviewResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_summaries = [
            DeliveryDateSummary(
                delivery_date=str(group.get("delivery_date", "")),
                record_count=len(group.get("records", [])),
            )
            for group in doc.get("delivery_groups", [])
            if group.get("delivery_date")
        ]
        delivery_summaries.sort(key=lambda item: item.delivery_date)
        return TradeOverviewResponse(trade_date=trade_date, delivery_summaries=delivery_summaries)

    def get_trade_detail(self, trade_date: str, delivery_date: str) -> TradeDetailResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_group = self._get_delivery_group(doc, delivery_date)
        records = [self._normalize_record(record) for record in delivery_group.get("records", [])]
        spot_price_map = self._load_spot_prices(delivery_date)

        listing_batches = self._build_batches(records, time_field="listing_time", action_type="listing")
        off_shelf_batches = self._build_batches(records, time_field="off_shelf_time", action_type="off_shelf")
        batch_timeline = sorted(listing_batches + off_shelf_batches, key=lambda item: item["sort_time"])

        execution_chart = self._build_execution_rows(trade_date, delivery_date, records, spot_price_map)
        execution_table = [ExecutionTableRow(**row.model_dump()) for row in execution_chart]
        summary_cards = self._build_summary_cards(records, batch_timeline)
        execution_analysis_summary = self._build_execution_analysis_summary(records, spot_price_map)
        default_batch_id = batch_timeline[0]["batch_id"] if batch_timeline else None
        default_batch_detail = (
            self._build_batch_detail(batch_timeline[0], delivery_date, spot_price_map) if batch_timeline else None
        )

        return TradeDetailResponse(
            trade_date=trade_date,
            delivery_date=delivery_date,
            summary_cards=summary_cards,
            execution_analysis_summary=execution_analysis_summary,
            execution_chart=execution_chart,
            execution_table=execution_table,
            batch_timeline=[self._to_batch_timeline_item(batch) for batch in batch_timeline],
            default_batch_id=default_batch_id,
            default_batch_detail=default_batch_detail,
            review_texts=self._build_review_texts(summary_cards),
        )

    def get_batch_detail(self, trade_date: str, delivery_date: str, batch_id: str) -> BatchDetailResponse:
        doc = self._get_trade_doc(trade_date)
        delivery_group = self._get_delivery_group(doc, delivery_date)
        records = [self._normalize_record(record) for record in delivery_group.get("records", [])]
        spot_price_map = self._load_spot_prices(delivery_date)
        all_batches = self._build_batches(records, "listing_time", "listing") + self._build_batches(
            records, "off_shelf_time", "off_shelf"
        )
        target_batch = next((batch for batch in all_batches if batch["batch_id"] == batch_id), None)
        if target_batch is None:
            raise ValueError(f"未找到批次 {batch_id}")
        return self._build_batch_detail(target_batch, delivery_date, spot_price_map)

    def _get_trade_doc(self, trade_date: str) -> Dict[str, Any]:
        doc = self.trade_declare_collection.find_one({"trade_date": trade_date}, {"_id": 0})
        if doc is None:
            raise ValueError(f"未找到交易日 {trade_date} 的交易申报记录")
        return doc

    def _get_delivery_group(self, doc: Dict[str, Any], delivery_date: str) -> Dict[str, Any]:
        for group in doc.get("delivery_groups", []):
            if group.get("delivery_date") == delivery_date:
                return group
        raise ValueError(f"交易日 {doc.get('trade_date')} 下未找到目标日 {delivery_date} 的记录")

    def _normalize_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        listing_mwh = self._safe_float(record.get("listing_mwh"))
        remaining_mwh = self._safe_float(record.get("remaining_mwh"))
        traded_mwh = max(listing_mwh - remaining_mwh, 0.0)
        normalized = {
            "record_key": str(record.get("record_key") or ""),
            "period": int(record.get("period") or 0),
            "trade_direction": self._map_trade_direction(record.get("listing_side")),
            "listing_mwh": listing_mwh,
            "remaining_mwh": remaining_mwh,
            "traded_mwh": traded_mwh,
            "listing_price": self._safe_float(record.get("listing_price"), allow_none=True),
            "listing_time": record.get("listing_time"),
            "off_shelf_time": record.get("off_shelf_time"),
            "off_shelf_type": record.get("off_shelf_type"),
            "is_traded": traded_mwh > 0,
        }
        normalized["holding_seconds"] = self._calc_holding_seconds(
            normalized.get("listing_time"), normalized.get("off_shelf_time")
        )
        normalized["record_result"] = self._resolve_record_result(normalized)
        return normalized

    def _build_summary_cards(
        self, records: List[Dict[str, Any]], batch_timeline: List[Dict[str, Any]]
    ) -> SummaryCardsResponse:
        traded_records = [record for record in records if record["is_traded"]]
        buy_traded_mwh = sum(
            record["traded_mwh"] for record in traded_records if record["trade_direction"] == "buy"
        )
        sell_traded_mwh = sum(
            record["traded_mwh"] for record in traded_records if record["trade_direction"] == "sell"
        )
        buy_periods = {record["period"] for record in traded_records if record["trade_direction"] == "buy"}
        sell_periods = {record["period"] for record in traded_records if record["trade_direction"] == "sell"}

        return SummaryCardsResponse(
            record_overview=RecordOverviewCard(
                total_records=len(records),
                traded_records=len(traded_records),
            ),
            trade_overview=TradeOverviewCard(
                traded_mwh=round(sum(record["traded_mwh"] for record in traded_records), 3),
                buy_traded_mwh=round(buy_traded_mwh, 3),
                sell_traded_mwh=round(sell_traded_mwh, 3),
            ),
            period_overview=PeriodOverviewCard(
                traded_period_count=len(buy_periods | sell_periods),
                buy_traded_period_count=len(buy_periods),
                sell_traded_period_count=len(sell_periods),
            ),
            batch_overview=BatchOverviewCard(
                listing_batch_count=sum(1 for batch in batch_timeline if batch["batch_action_type"] == "listing"),
                off_shelf_batch_count=sum(1 for batch in batch_timeline if batch["batch_action_type"] == "off_shelf"),
            ),
        )

    def _build_execution_rows(
        self,
        trade_date: str,
        delivery_date: str,
        records: List[Dict[str, Any]],
        spot_price_map: Dict[int, Optional[float]],
    ) -> List[ExecutionChartRow]:
        annual_map = self._load_contract_period_quantities(delivery_date, "年度")
        monthly_map = self._load_contract_period_quantities(delivery_date, "月度")
        mechanism_map = self._load_mechanism_quantities(delivery_date)
        historical_map = self._load_historical_within_month_net(delivery_date, trade_date)
        current_day_map, price_map, count_map, volume_map = self._load_trade_day_aggregates(records)
        period_profit_map = self._build_period_profit_map(records, spot_price_map)
        market_price_map = self._load_contract_period_prices(delivery_date, "月内")
        load_map, load_source = self._load_target_load_curve(delivery_date)

        rows: List[ExecutionChartRow] = []
        for period in range(1, 49):
            annual_monthly_mwh = annual_map.get(period, 0.0)
            monthly_mwh = monthly_map.get(period, 0.0)
            mechanism_mwh = mechanism_map.get(period, 0.0)
            historical_net = historical_map.get(period, 0.0)
            trade_day_net = current_day_map.get(period, 0.0)
            final_position = annual_monthly_mwh + monthly_mwh + mechanism_mwh + historical_net + trade_day_net
            rows.append(
                ExecutionChartRow(
                    period=period,
                    annual_monthly_mwh=round(annual_monthly_mwh, 3),
                    monthly_mwh=round(monthly_mwh, 3),
                    mechanism_mwh=round(mechanism_mwh, 3),
                    historical_within_month_net_mwh=round(historical_net, 3),
                    trade_day_net_mwh=round(trade_day_net, 3),
                    final_position_mwh=round(final_position, 3),
                    actual_or_forecast_load_mwh=load_map.get(period),
                    load_source=load_source,
                    trade_avg_price=price_map.get(period),
                    trade_count=count_map.get(period, 0),
                    trade_volume_mwh=round(volume_map.get(period, 0.0), 3),
                    market_monthly_price=market_price_map.get(period),
                    spot_price=spot_price_map.get(period),
                    period_profit_amount=period_profit_map.get(period),
                )
            )
        return rows

    def _build_period_profit_map(
        self,
        records: List[Dict[str, Any]],
        spot_price_map: Dict[int, Optional[float]],
    ) -> Dict[int, Optional[float]]:
        traded_records = [record for record in records if record["is_traded"] and record["period"] > 0]
        empty_profit_map = {period: None for period in range(1, 49)}
        if not traded_records or not spot_price_map:
            return empty_profit_map

        period_profit_map: Dict[int, float] = defaultdict(float)
        for record in traded_records:
            spot_price = spot_price_map.get(record["period"])
            listing_price = record.get("listing_price")
            if spot_price is None or listing_price is None:
                return empty_profit_map

            traded_mwh = record["traded_mwh"]
            if record["trade_direction"] == "buy":
                pnl = (spot_price - float(listing_price)) * traded_mwh
            elif record["trade_direction"] == "sell":
                pnl = (float(listing_price) - spot_price) * traded_mwh
            else:
                continue

            period_profit_map[record["period"]] += pnl

        return {period: round(period_profit_map.get(period, 0.0), 2) for period in range(1, 49)}

    def _build_execution_analysis_summary(
        self,
        records: List[Dict[str, Any]],
        spot_price_map: Dict[int, Optional[float]],
    ) -> Optional[ExecutionAnalysisSummary]:
        traded_records = [record for record in records if record["is_traded"] and record["period"] > 0]
        if not traded_records or not spot_price_map:
            return None

        profit_count = 0
        loss_count = 0
        profit_amount = 0.0
        loss_amount = 0.0
        total_profit_amount = 0.0

        for record in traded_records:
            spot_price = spot_price_map.get(record["period"])
            listing_price = record.get("listing_price")
            if spot_price is None or listing_price is None:
                return None

            traded_mwh = record["traded_mwh"]
            if record["trade_direction"] == "buy":
                pnl = (spot_price - float(listing_price)) * traded_mwh
            elif record["trade_direction"] == "sell":
                pnl = (float(listing_price) - spot_price) * traded_mwh
            else:
                continue

            total_profit_amount += pnl
            if pnl >= 0:
                profit_count += 1
                profit_amount += pnl
            else:
                loss_count += 1
                loss_amount += abs(pnl)

        return ExecutionAnalysisSummary(
            profit_count=profit_count,
            profit_amount=round(profit_amount, 2),
            loss_count=loss_count,
            loss_amount=round(loss_amount, 2),
            total_profit_amount=round(total_profit_amount, 2),
        )

    def _load_trade_day_aggregates(
        self, records: List[Dict[str, Any]]
    ) -> Tuple[Dict[int, float], Dict[int, Optional[float]], Dict[int, int], Dict[int, float]]:
        net_map: Dict[int, float] = defaultdict(float)
        price_weighted_sum: Dict[int, float] = defaultdict(float)
        volume_map: Dict[int, float] = defaultdict(float)
        count_map: Dict[int, int] = defaultdict(int)

        for record in records:
            period = record["period"]
            traded_mwh = record["traded_mwh"]
            if traded_mwh <= 0 or period <= 0:
                continue
            sign = 1.0 if record["trade_direction"] == "buy" else -1.0 if record["trade_direction"] == "sell" else 0.0
            net_map[period] += traded_mwh * sign
            volume_map[period] += traded_mwh
            count_map[period] += 1
            if record.get("listing_price") is not None:
                price_weighted_sum[period] += traded_mwh * float(record["listing_price"])

        avg_price_map: Dict[int, Optional[float]] = {}
        for period, total_volume in volume_map.items():
            if total_volume > 0:
                avg_price_map[period] = round(price_weighted_sum.get(period, 0.0) / total_volume, 3)
        return net_map, avg_price_map, count_map, volume_map

    def _load_historical_within_month_net(self, delivery_date: str, trade_date: str) -> Dict[int, float]:
        period_map: Dict[int, float] = defaultdict(float)
        cursor = self.trade_declare_collection.find(
            {"trade_date": {"$lt": trade_date}, "delivery_dates": delivery_date},
            {"_id": 0, "delivery_groups": 1},
        )
        for doc in cursor:
            group = next(
                (item for item in doc.get("delivery_groups", []) if item.get("delivery_date") == delivery_date),
                None,
            )
            if group is None:
                continue
            for raw_record in group.get("records", []):
                record = self._normalize_record(raw_record)
                if not record["is_traded"] or record["period"] <= 0:
                    continue
                sign = 1.0 if record["trade_direction"] == "buy" else -1.0 if record["trade_direction"] == "sell" else 0.0
                period_map[record["period"]] += record["traded_mwh"] * sign
        return period_map

    def _load_contract_period_quantities(self, delivery_date: str, contract_period: str) -> Dict[int, float]:
        doc = self.contracts_collection.find_one(
            {
                "date": delivery_date,
                "entity": "售电公司",
                "contract_type": "整体",
                "contract_period": contract_period,
            },
            {"_id": 0, "periods": 1},
        )
        result: Dict[int, float] = {}
        if not doc:
            return result
        for item in doc.get("periods", []):
            period = int(item.get("period") or 0)
            if period > 0:
                result[period] = self._safe_float(item.get("quantity_mwh"))
        return result

    def _load_contract_period_prices(self, delivery_date: str, contract_period: str) -> Dict[int, Optional[float]]:
        doc = self.contracts_collection.find_one(
            {
                "date": delivery_date,
                "entity": "全市场",
                "contract_type": "整体",
                "contract_period": contract_period,
            },
            {"_id": 0, "periods": 1},
        )
        result: Dict[int, Optional[float]] = {}
        if not doc:
            return result
        for item in doc.get("periods", []):
            period = int(item.get("period") or 0)
            price = item.get("price_yuan_per_mwh")
            if period > 0 and price is not None:
                result[period] = round(float(price), 3)
        return result

    def _load_mechanism_quantities(self, delivery_date: str) -> Dict[int, float]:
        month_str = delivery_date[:7]
        doc = self.mechanism_collection.find_one({"month_str": month_str}, {"_id": 0, "period_values": 1})
        if not doc:
            return {}
        try:
            year, month = [int(part) for part in month_str.split("-")]
            days_in_month = monthrange(year, month)[1]
        except (TypeError, ValueError):
            days_in_month = 1
        values = doc.get("period_values", [])
        return {
            index + 1: round(self._safe_float(value) / days_in_month, 3)
            for index, value in enumerate(values[:48])
        }

    def _load_spot_prices(self, delivery_date: str) -> Dict[int, Optional[float]]:
        try:
            spot_curve = get_spot_prices(self.db, delivery_date, data_type="real_time", resolution=48, include_volume=False)
        except Exception as exc:
            logger.warning("加载现货价格失败: %s", exc)
            return {}
        return {
            point.period: round(point.price, 3) if point.price is not None else None
            for point in spot_curve.points
        }

    def _load_target_load_curve(self, delivery_date: str) -> Tuple[Dict[int, float], Optional[str]]:
        actual_map = self._load_aggregate_actual_curve(delivery_date)
        if actual_map:
            return actual_map, "actual"

        forecast_map = self._load_forecast_curve_from_service(delivery_date)
        if forecast_map:
            return forecast_map, "forecast"

        return {}, None

    def _load_aggregate_actual_curve(self, delivery_date: str) -> Dict[int, float]:
        try:
            customer_ids = self.contract_service.get_active_customers(delivery_date, delivery_date)
            if not customer_ids:
                return {}
            curves = self.load_query_service.aggregate_curve_series(
                customer_ids=customer_ids,
                start_date=delivery_date,
                end_date=delivery_date,
                strategy=FusionStrategy.MP_COMPLETE,
            )
            if not curves:
                return {}
            values = curves[0].values or []
            return {
                index + 1: round(self._safe_float(value), 3)
                for index, value in enumerate(values[:48])
            }
        except Exception as exc:
            logger.warning("加载聚合实际电量失败: %s", exc)
            return {}

    def _load_forecast_curve_from_service(self, delivery_date: str) -> Dict[int, float]:
        try:
            versions = self.load_forecast_service.get_versions(delivery_date)
            if not versions:
                return {}
            version = min(
                versions,
                key=lambda item: (
                    int(item.get("gap") or 999999),
                    str(item.get("forecast_date") or ""),
                ),
            )
            forecast_date = version.get("forecast_date")
            if not forecast_date:
                return {}
            forecast_data = self.load_forecast_service.get_forecast_data(
                delivery_date,
                forecast_date,
                customer_id="AGGREGATE",
            )
            if not forecast_data:
                return {}
            values = forecast_data.get("values") or []
            return {
                index + 1: round(self._safe_float(value), 3)
                for index, value in enumerate(values[:48])
            }
        except Exception as exc:
            logger.warning("加载聚合预测电量失败: %s", exc)
            return {}

    def _load_system_load_curve(
        self,
        delivery_date: str,
        collection_name: str,
        field_name: str,
    ) -> Dict[int, float]:
        try:
            query_date = datetime.strptime(delivery_date, "%Y-%m-%d")
        except ValueError:
            return {}

        start_of_day = query_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        docs = list(
            self.db[collection_name]
            .find(
                {"datetime": {"$gt": start_of_day, "$lte": end_of_day}},
                {"_id": 0, "datetime": 1, field_name: 1},
            )
            .sort("datetime", 1)
        )

        period_map: Dict[int, float] = defaultdict(float)
        for doc in docs:
            dt = doc.get("datetime")
            raw_value = doc.get(field_name)
            if not isinstance(dt, datetime) or raw_value is None:
                continue
            try:
                load_mw = float(raw_value)
            except (TypeError, ValueError):
                continue

            period_96 = self._datetime_to_period_96(dt, start_of_day)
            if period_96 is None:
                continue
            period_48 = (period_96 - 1) // 2 + 1
            period_map[period_48] += load_mw * 0.25

        return {period: round(value, 3) for period, value in period_map.items()}

    def _datetime_to_period_96(self, dt: datetime, start_of_day: datetime) -> Optional[int]:
        next_day = start_of_day + timedelta(days=1)
        if dt.hour == 0 and dt.minute == 0 and dt.date() == next_day.date():
            return 96
        if dt.date() != start_of_day.date():
            return None

        minutes = dt.hour * 60 + dt.minute
        if minutes <= 0 or minutes > 24 * 60:
            return None
        period_96 = minutes // 15
        return period_96 if 1 <= period_96 <= 95 else None

    def _build_batches(
        self, records: List[Dict[str, Any]], time_field: str, action_type: str
    ) -> List[Dict[str, Any]]:
        candidates = []
        for record in records:
            dt = self._parse_datetime(record.get(time_field))
            if dt is not None:
                candidates.append((dt, record))
        candidates.sort(key=lambda item: item[0])

        batches: List[Dict[str, Any]] = []
        current_records: List[Dict[str, Any]] = []
        current_start: Optional[datetime] = None
        current_end: Optional[datetime] = None
        seen_periods: set[int] = set()
        index = 1

        def flush_batch() -> None:
            nonlocal index, current_records, current_start, current_end, seen_periods
            if not current_records or current_start is None or current_end is None:
                return
            batches.append(
                {
                    "batch_id": f"{action_type}_{index:03d}",
                    "batch_action_type": action_type,
                    "batch_start_time": current_start.strftime("%Y-%m-%d %H:%M:%S"),
                    "batch_end_time": current_end.strftime("%Y-%m-%d %H:%M:%S"),
                    "record_count": len(current_records),
                    "covered_period_count": len({record["period"] for record in current_records if record["period"] > 0}),
                    "buy_record_count": sum(1 for record in current_records if record["trade_direction"] == "buy"),
                    "sell_record_count": sum(1 for record in current_records if record["trade_direction"] == "sell"),
                    "batch_listing_mwh": round(sum(record["listing_mwh"] for record in current_records), 3),
                    "records": [dict(record) for record in current_records],
                    "sort_time": current_start,
                }
            )
            index += 1
            current_records = []
            current_start = None
            current_end = None
            seen_periods = set()

        for dt, record in candidates:
            should_split = False
            if current_end is not None:
                if (dt - current_end).total_seconds() > 5:
                    should_split = True
                if record["period"] in seen_periods:
                    should_split = True
            if should_split:
                flush_batch()
            if current_start is None:
                current_start = dt
            current_end = dt
            seen_periods.add(record["period"])
            current_records.append(record)
        flush_batch()
        return batches

    def _build_batch_detail(
        self,
        batch: Dict[str, Any],
        delivery_date: str,
        spot_price_map: Dict[int, Optional[float]],
    ) -> BatchDetailResponse:
        market_price_map = self._load_contract_period_prices(delivery_date, "月内")
        load_map, load_source = self._load_target_load_curve(delivery_date)
        chart_map: Dict[Tuple[int, str], Dict[str, Any]] = {}
        record_items: List[BatchRecordItem] = []

        for record in batch["records"]:
            key = (record["period"], record["trade_direction"])
            if key not in chart_map:
                chart_map[key] = {
                    "listing_mwh": 0.0,
                    "traded_mwh": 0.0,
                    "listing_price_sum": 0.0,
                    "listing_price_weight": 0.0,
                }
            chart_map[key]["listing_mwh"] += record["listing_mwh"]
            chart_map[key]["traded_mwh"] += record["traded_mwh"]
            if record.get("listing_price") is not None:
                weight = max(record["listing_mwh"], 1.0)
                chart_map[key]["listing_price_sum"] += float(record["listing_price"]) * weight
                chart_map[key]["listing_price_weight"] += weight

            record_items.append(
                BatchRecordItem(
                    record_key=record["record_key"],
                    period=record["period"],
                    trade_direction=record["trade_direction"],
                    listing_mwh=round(record["listing_mwh"], 3),
                    traded_mwh=round(record["traded_mwh"], 3),
                    listing_price=record.get("listing_price"),
                    listing_time=record.get("listing_time"),
                    off_shelf_time=record.get("off_shelf_time"),
                    off_shelf_type=record.get("off_shelf_type"),
                    is_traded=record["is_traded"],
                )
            )

        chart_rows: List[BatchChartRow] = []
        for period, trade_direction in sorted(chart_map.keys(), key=lambda item: (item[0], item[1])):
            item = chart_map[(period, trade_direction)]
            avg_price = None
            if item["listing_price_weight"] > 0:
                avg_price = round(item["listing_price_sum"] / item["listing_price_weight"], 3)
            chart_rows.append(
                BatchChartRow(
                    period=period,
                    trade_direction=trade_direction,
                    listing_mwh=round(item["listing_mwh"], 3),
                    traded_mwh=round(item["traded_mwh"], 3),
                    listing_price=avg_price,
                    market_monthly_price=market_price_map.get(period),
                    spot_price=spot_price_map.get(period),
                    actual_or_forecast_load_mwh=load_map.get(period),
                    load_source=load_source,
                )
            )

        return BatchDetailResponse(
            batch_id=batch["batch_id"],
            batch_action_type=batch["batch_action_type"],
            batch_start_time=batch["batch_start_time"],
            batch_end_time=batch["batch_end_time"],
            batch_chart_rows=chart_rows,
            batch_records=record_items,
        )

    def _to_batch_timeline_item(self, batch: Dict[str, Any]) -> BatchTimelineItem:
        return BatchTimelineItem(
            batch_id=batch["batch_id"],
            batch_action_type=batch["batch_action_type"],
            batch_start_time=batch["batch_start_time"],
            batch_end_time=batch["batch_end_time"],
            record_count=batch["record_count"],
            covered_period_count=batch["covered_period_count"],
            buy_record_count=batch["buy_record_count"],
            sell_record_count=batch["sell_record_count"],
            batch_listing_mwh=batch["batch_listing_mwh"],
        )

    def _build_review_texts(self, summary_cards: SummaryCardsResponse) -> List[str]:
        return [
            f"本目标日共 {summary_cards.record_overview.total_records} 条申报记录，其中 {summary_cards.record_overview.traded_records} 笔产生了成交。",
            f"累计成交电量 {summary_cards.trade_overview.traded_mwh:.3f} MWh，其中买入 {summary_cards.trade_overview.buy_traded_mwh:.3f} MWh，卖出 {summary_cards.trade_overview.sell_traded_mwh:.3f} MWh。",
            f"共识别上架批次 {summary_cards.batch_overview.listing_batch_count} 个、下架批次 {summary_cards.batch_overview.off_shelf_batch_count} 个。",
        ]

    def _map_trade_direction(self, listing_side: Optional[str]) -> str:
        value = str(listing_side or "")
        if any(keyword in value for keyword in ["增持", "买", "购入", "买入"]):
            return "buy"
        if any(keyword in value for keyword in ["减持", "卖", "售出", "卖出"]):
            return "sell"
        return "unknown"

    def _resolve_record_result(self, record: Dict[str, Any]) -> str:
        if record["is_traded"] and record.get("off_shelf_type") == "自动下架-成交":
            return "成交自动下架"
        if record["is_traded"]:
            return "成交未下架"
        if record.get("off_shelf_type") == "人工下架":
            return "人工下架"
        return "未成交结束"

    def _calc_holding_seconds(self, listing_time: Optional[str], off_shelf_time: Optional[str]) -> Optional[int]:
        listing_dt = self._parse_datetime(listing_time)
        off_shelf_dt = self._parse_datetime(off_shelf_time)
        if listing_dt is None or off_shelf_dt is None:
            return None
        return int((off_shelf_dt - listing_dt).total_seconds())

    def _parse_datetime(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None

    def _safe_float(self, value: Any, allow_none: bool = False) -> Optional[float]:
        if value is None:
            return None if allow_none else 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return None if allow_none else 0.0
