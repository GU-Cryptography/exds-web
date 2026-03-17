import logging
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId

from webapp.services.load_aggregation_service import LoadAggregationService
from webapp.services.meter_data_import_service import MeterDataImportService
from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


class IntentCustomerDiagnosisService:
    def __init__(self) -> None:
        self.profile_collection = DATABASE["intent_customer_profiles"]
        self.raw_collection = DATABASE["intent_customer_meter_reads_daily"]
        self.curve_collection = DATABASE["intent_customer_load_curve_daily"]
        self.wholesale_result_collection = DATABASE["intent_customer_monthly_wholesale"]
        self.retail_settlement_service = RetailSettlementService()
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        self.profile_collection.create_index("customer_name", unique=True)
        self.profile_collection.create_index("updated_at")
        self.raw_collection.create_index(
            [("customer_id", 1), ("meter_id", 1), ("date", 1)],
            unique=True,
        )
        self.raw_collection.create_index([("customer_id", 1), ("date", 1)])
        self.curve_collection.create_index([("customer_id", 1), ("date", 1)], unique=True)
        self.wholesale_result_collection.create_index(
            [("customer_id", 1), ("settlement_month", 1)],
            unique=True,
        )
        self.wholesale_result_collection.create_index([("customer_id", 1), ("updated_at", -1)])

    def preview_files(self, files: List[Tuple[str, bytes]]) -> Dict[str, Any]:
        preview_items: List[Dict[str, Any]] = []
        blocking_errors: List[str] = []
        warnings: List[str] = []
        extracted_customer_names: set[str] = set()
        meter_ids: List[str] = []

        for filename, file_content in files:
            records, parse_errors = MeterDataImportService.parse_excel_file(file_content, filename)
            if not records:
                blocking_errors.append(f"文件 {filename} 未解析出有效日数据。")
                preview_items.append(
                    {
                        "filename": filename,
                        "meter_id": "",
                        "account_id": "",
                        "extracted_customer_name": None,
                        "start_date": "",
                        "end_date": "",
                        "record_count": 0,
                        "default_multiplier": 1.0,
                        "parse_errors": parse_errors or ["未解析出有效数据"],
                    }
                )
                continue

            dates = sorted(record["date"] for record in records)
            meter_id = records[0]["meter_id"]
            account_id = self._first_non_empty(
                [record.get("meta", {}).get("account_id") for record in records]
            )
            extracted_customer_name = self._first_non_empty(
                [record.get("meta", {}).get("customer_name") for record in records]
            )

            if extracted_customer_name:
                extracted_customer_names.add(extracted_customer_name)
            if not account_id:
                warnings.append(f"文件 {filename} 未提取到户号。")

            meter_ids.append(meter_id)
            preview_items.append(
                {
                    "filename": filename,
                    "meter_id": meter_id,
                    "account_id": account_id or "",
                    "extracted_customer_name": extracted_customer_name,
                    "start_date": dates[0],
                    "end_date": dates[-1],
                    "record_count": len(records),
                    "default_multiplier": 1.0,
                    "parse_errors": parse_errors,
                }
            )

        duplicate_meter_ids = sorted(
            {meter_id for meter_id in meter_ids if meter_id and meter_ids.count(meter_id) > 1}
        )
        if duplicate_meter_ids:
            blocking_errors.append(f"存在重复电表号: {', '.join(duplicate_meter_ids)}")
        if len(extracted_customer_names) > 1:
            blocking_errors.append("上传文件中提取到多个不同的用户名，请确认是否为同一客户。")

        suggested_customer_name = next(iter(extracted_customer_names)) if len(extracted_customer_names) == 1 else None
        if not suggested_customer_name:
            warnings.append("未能从文件中稳定提取唯一客户名称，本次导入将被阻断。")

        return {
            "suggested_customer_name": suggested_customer_name,
            "files": preview_items,
            "validation": {
                "can_import": len(preview_items) > 0 and len(blocking_errors) == 0,
                "errors": blocking_errors,
                "warnings": warnings,
            },
        }

    def import_customer_data(
        self,
        files: List[Tuple[str, bytes]],
        meter_configs: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not files:
            raise ValueError("请至少上传一个电表文件")

        preview = self.preview_files(files)
        if not preview["validation"]["can_import"]:
            raise ValueError("；".join(preview["validation"]["errors"]) or "文件预校验未通过")
        customer_name = (preview.get("suggested_customer_name") or "").strip()
        if not customer_name:
            raise ValueError("无法从电表数据文件中唯一识别意向客户名称")

        config_by_filename = {item["filename"]: item for item in meter_configs}
        parsed_results: List[Tuple[str, List[Dict[str, Any]], Dict[str, Any]]] = []

        for file_item in preview["files"]:
            filename = file_item["filename"]
            if filename not in config_by_filename:
                raise ValueError(f"文件 {filename} 缺少倍率配置")
        for filename, file_content in files:
            records, parse_errors = MeterDataImportService.parse_excel_file(file_content, filename)
            if not records:
                raise ValueError(f"文件 {filename} 未解析出有效数据")
            if parse_errors:
                logger.warning("文件 %s 存在解析告警: %s", filename, parse_errors)

            config = config_by_filename.get(filename)
            if not config:
                raise ValueError(f"文件 {filename} 缺少配置")

            preview_item = next((item for item in preview["files"] if item["filename"] == filename), None)
            if not preview_item:
                raise ValueError(f"文件 {filename} 未找到预解析结果")

            if preview_item["meter_id"] != config["meter_id"]:
                raise ValueError(f"文件 {filename} 的电表号与预解析结果不一致")
            if not config.get("account_id"):
                raise ValueError(f"文件 {filename} 缺少户号")
            if float(config.get("multiplier", 0)) <= 0:
                raise ValueError(f"文件 {filename} 的倍率必须大于0")

            parsed_results.append((filename, records, config))

        now = datetime.now()
        customer_doc = self.profile_collection.find_one({"customer_name": customer_name})
        customer_id = customer_doc["_id"] if customer_doc else ObjectId()

        self.raw_collection.delete_many({"customer_id": str(customer_id)})
        self.curve_collection.delete_many({"customer_id": str(customer_id)})

        raw_documents: List[Dict[str, Any]] = []
        meter_configs_by_meter: Dict[str, Dict[str, Any]] = {}
        meter_records: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)

        for filename, records, config in parsed_results:
            meter_id = config["meter_id"]
            meter_configs_by_meter[meter_id] = {
                "meter_id": meter_id,
                "account_id": config["account_id"],
                "multiplier": float(config["multiplier"]),
                "extracted_customer_name": self._first_non_empty(
                    [record.get("meta", {}).get("customer_name") for record in records]
                ),
                "source_filename": filename,
            }

            for record in records:
                raw_doc = {
                    "customer_id": str(customer_id),
                    "customer_name": customer_name,
                    "meter_id": meter_id,
                    "account_id": config["account_id"],
                    "date": record["date"],
                    "readings": record["readings"],
                    "source_filename": filename,
                    "multiplier": float(config["multiplier"]),
                    "meta": record.get("meta", {}),
                    "created_at": now,
                    "updated_at": now,
                }
                raw_documents.append(raw_doc)
                meter_records[meter_id][record["date"]] = raw_doc

        if raw_documents:
            self.raw_collection.insert_many(raw_documents, ordered=False)

        aggregated_docs = self._aggregate_customer_curves(
            customer_id=str(customer_id),
            customer_name=customer_name,
            meter_records=meter_records,
            meter_configs_by_meter=meter_configs_by_meter,
            now=now,
        )
        if aggregated_docs:
            self.curve_collection.insert_many(aggregated_docs, ordered=False)

        profile_doc = self._build_profile_document(
            customer_id=customer_id,
            customer_name=customer_name,
            created_at=customer_doc.get("created_at") if customer_doc else now,
            updated_at=now,
            meter_configs_by_meter=meter_configs_by_meter,
            aggregated_docs=aggregated_docs,
        )

        self.profile_collection.replace_one({"_id": customer_id}, profile_doc, upsert=True)
        customer_item = self._to_customer_list_item(profile_doc)

        return {
            "customer": customer_item,
            "imported_days": len(raw_documents),
            "aggregated_days": len(aggregated_docs),
            "files": len(files),
            "message": f"已完成 {len(files)} 个文件的导入与自动聚合",
        }

    def list_customers(self) -> Dict[str, Any]:
        items = [
            self._to_customer_list_item(doc)
            for doc in self.profile_collection.find().sort("updated_at", -1)
        ]
        return {"items": items}

    def get_customer_load_data(self, customer_id: str, month: str, date: str) -> Dict[str, Any]:
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        profile_doc = self.profile_collection.find_one({"_id": ObjectId(customer_id)})
        if not profile_doc:
            raise ValueError("客户不存在")

        month_start = datetime.strptime(f"{month}-01", "%Y-%m-%d")
        next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
        month_end = next_month - timedelta(days=1)

        curve_docs = list(
            self.curve_collection.find(
                {
                    "customer_id": customer_id,
                    "date": {
                        "$gte": month_start.strftime("%Y-%m-%d"),
                        "$lte": month_end.strftime("%Y-%m-%d"),
                    },
                }
            )
        )
        curve_map = {doc["date"]: doc for doc in curve_docs}

        month_data: List[Dict[str, Any]] = []
        cursor = month_start
        while cursor <= month_end:
            date_str = cursor.strftime("%Y-%m-%d")
            curve_doc = curve_map.get(date_str)
            month_data.append(
                {
                    "date": date_str,
                    "label": cursor.strftime("%m-%d"),
                    "totalLoad": round(float(curve_doc.get("total", 0.0)), 3) if curve_doc else 0.0,
                    "isMissing": curve_doc is None,
                }
            )
            cursor += timedelta(days=1)

        selected_curve = self.curve_collection.find_one({"customer_id": customer_id, "date": date})
        intraday_values = selected_curve.get("values", []) if selected_curve else []
        intraday_data = [
            {
                "time": f"{index // 2:02d}:{'00' if index % 2 == 0 else '30'}",
                "load": round(float(intraday_values[index]), 3) if index < len(intraday_values) else 0.0,
            }
            for index in range(48)
        ]

        return {
            "customer": self._to_customer_list_item(profile_doc),
            "month_data": month_data,
            "intraday_data": intraday_data,
            "selected_day_total": round(float(selected_curve.get("total", 0.0)), 3) if selected_curve else 0.0,
        }

    def calculate_wholesale_simulation(self, customer_id: str) -> Dict[str, Any]:
        profile_doc = self._get_profile_doc(customer_id)
        months = self._get_available_wholesale_months(customer_id)

        summary_rows: List[Dict[str, Any]] = []
        month_details: List[Dict[str, Any]] = []
        for month in months:
            result = self._calculate_single_wholesale_month(customer_id, profile_doc, month)
            self._save_wholesale_result(result)
            summary_rows.append(result["summary"])
            month_details.append(
                {
                    "settlement_month": month,
                    "summary": result["summary"],
                    "period_details": result["period_details"],
                    "daily_details": result["daily_details"],
                }
            )

        return {
            "customer": self._to_customer_list_item(profile_doc),
            "summary_rows": summary_rows,
            "month_details": month_details,
        }

    def get_wholesale_simulation(self, customer_id: str) -> Dict[str, Any]:
        profile_doc = self._get_profile_doc(customer_id)
        docs = list(
            self.wholesale_result_collection.find(
                {"customer_id": customer_id},
                {"summary": 1, "period_details": 1, "daily_details": 1, "settlement_month": 1},
            ).sort("settlement_month", 1)
        )

        summary_rows: List[Dict[str, Any]] = []
        month_details: List[Dict[str, Any]] = []
        for doc in docs:
            summary = doc.get("summary", {}) or {}
            summary_rows.append(summary)
            month_details.append(
                {
                    "settlement_month": doc.get("settlement_month", ""),
                    "summary": summary,
                    "period_details": doc.get("period_details", []) or [],
                    "daily_details": doc.get("daily_details", []) or [],
                }
            )

        return {
            "customer": self._to_customer_list_item(profile_doc),
            "summary_rows": summary_rows,
            "month_details": month_details,
        }

    def _get_profile_doc(self, customer_id: str) -> Dict[str, Any]:
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        profile_doc = self.profile_collection.find_one({"_id": ObjectId(customer_id)})
        if not profile_doc:
            raise ValueError("客户不存在")
        return profile_doc

    def _get_available_wholesale_months(self, customer_id: str) -> List[str]:
        curve_months = {
            str(doc.get("date", ""))[:7]
            for doc in self.curve_collection.find({"customer_id": customer_id}, {"date": 1})
            if str(doc.get("date", "")).startswith("20")
        }
        wholesale_months = {
            str(month)
            for month in self.wholesale_result_collection.database["wholesale_settlement_monthly"].distinct("month")
            if isinstance(month, str) and len(month) == 7
        }
        return sorted(curve_months & wholesale_months)

    def _calculate_single_wholesale_month(
        self,
        customer_id: str,
        profile_doc: Dict[str, Any],
        month: str,
    ) -> Dict[str, Any]:
        wholesale_doc = self.wholesale_result_collection.database["wholesale_settlement_monthly"].find_one(
            {"_id": month},
            {"settlement_items": 1},
        )
        if not wholesale_doc:
            raise ValueError(f"{month} 缺少批发月度结算数据")

        settlement_items = wholesale_doc.get("settlement_items", {}) or {}
        surplus_unit_price = self._calculate_surplus_unit_price(settlement_items)
        daily_curves = self._get_month_curve_docs(customer_id, month)
        if not daily_curves:
            raise ValueError(f"{month} 缺少可用负荷曲线数据")

        period_loads = [0.0] * 48
        period_daily_costs = [0.0] * 48
        daily_details: List[Dict[str, Any]] = []
        total_energy_mwh = 0.0
        daily_cost_total = 0.0

        for curve_doc in daily_curves:
            date_str = str(curve_doc.get("date"))
            values = self._normalize_to_48(curve_doc.get("values") or [])
            wholesale_prices = self.retail_settlement_service._get_wholesale_period_prices(date_str)

            day_energy_mwh = 0.0
            day_daily_cost = 0.0
            for index in range(48):
                load_mwh = float(values[index] if index < len(values) else 0.0)
                price_mwh = float(wholesale_prices[index] if index < len(wholesale_prices) else 0.0)
                allocated_cost = load_mwh * price_mwh
                period_loads[index] += load_mwh
                period_daily_costs[index] += allocated_cost
                day_energy_mwh += load_mwh
                day_daily_cost += allocated_cost

            day_surplus_cost = day_energy_mwh * surplus_unit_price
            day_total_cost = day_daily_cost + day_surplus_cost
            day_unit_cost = day_total_cost / day_energy_mwh if day_energy_mwh > 0 else 0.0

            total_energy_mwh += day_energy_mwh
            daily_cost_total += day_daily_cost
            daily_details.append(
                {
                    "date": date_str,
                    "total_energy_mwh": round(day_energy_mwh, 6),
                    "daily_cost_total": round(day_daily_cost, 2),
                    "surplus_cost": round(day_surplus_cost, 2),
                    "total_cost": round(day_total_cost, 2),
                    "unit_cost_yuan_per_mwh": round(day_unit_cost, 6),
                }
            )

        surplus_cost = total_energy_mwh * surplus_unit_price
        total_cost = daily_cost_total + surplus_cost
        unit_cost_yuan_per_mwh = total_cost / total_energy_mwh if total_energy_mwh > 0 else 0.0
        unit_cost_yuan_per_kwh = unit_cost_yuan_per_mwh / 1000 if unit_cost_yuan_per_mwh > 0 else 0.0

        summary = {
            "settlement_month": month,
            "total_energy_mwh": round(total_energy_mwh, 6),
            "daily_cost_total": round(daily_cost_total, 2),
            "surplus_unit_price": round(surplus_unit_price, 6),
            "surplus_cost": round(surplus_cost, 2),
            "total_cost": round(total_cost, 2),
            "unit_cost_yuan_per_mwh": round(unit_cost_yuan_per_mwh, 6),
            "unit_cost_yuan_per_kwh": round(unit_cost_yuan_per_kwh, 6),
            "status": "success",
            "message": "",
        }

        period_details: List[Dict[str, Any]] = []
        for index in range(48):
            load_mwh = period_loads[index]
            period_surplus_cost = load_mwh * surplus_unit_price
            period_total_cost = period_daily_costs[index] + period_surplus_cost
            daily_unit_price = period_daily_costs[index] / load_mwh if load_mwh > 0 else 0.0
            final_unit_price = period_total_cost / load_mwh if load_mwh > 0 else 0.0
            period_details.append(
                {
                    "period": index + 1,
                    "time_label": self._build_period_label(index),
                    "load_mwh": round(load_mwh, 6),
                    "daily_cost_total": round(period_daily_costs[index], 2),
                    "surplus_cost": round(period_surplus_cost, 2),
                    "total_cost": round(period_total_cost, 2),
                    "daily_cost_unit_price": round(daily_unit_price, 6),
                    "final_unit_price": round(final_unit_price, 6),
                }
            )

        now = datetime.now()
        return {
            "_id": f"{customer_id}_{month}_intent_monthly_v1",
            "customer_id": customer_id,
            "customer_name": profile_doc.get("customer_name", ""),
            "settlement_month": month,
            "settlement_version": "intent_monthly_v1",
            "calc_status": "success",
            "calc_message": "",
            "summary": summary,
            "period_details": period_details,
            "daily_details": daily_details,
            "created_at": now,
            "updated_at": now,
        }

    @staticmethod
    def _calculate_surplus_unit_price(settlement_items: Dict[str, Any]) -> float:
        fund_surplus_deficit_total = float(settlement_items.get("fund_surplus_deficit_total") or 0.0)
        deviation_recovery_fee = float(settlement_items.get("deviation_recovery_fee") or 0.0)
        actual_monthly_volume = float(settlement_items.get("actual_monthly_volume") or 0.0)
        if actual_monthly_volume <= 0:
            return 0.0
        return (fund_surplus_deficit_total - deviation_recovery_fee) / actual_monthly_volume

    def _get_month_curve_docs(self, customer_id: str, month: str) -> List[Dict[str, Any]]:
        year = int(month[:4])
        mon = int(month[5:7])
        start_date = f"{month}-01"
        end_date = f"{month}-{monthrange(year, mon)[1]:02d}"
        return list(
            self.curve_collection.find(
                {"customer_id": customer_id, "date": {"$gte": start_date, "$lte": end_date}},
                {"date": 1, "values": 1, "total": 1},
            ).sort("date", 1)
        )

    @staticmethod
    def _normalize_to_48(values: List[Any]) -> List[float]:
        normalized = [float(value or 0.0) for value in values]
        if len(normalized) == 48:
            return normalized
        if len(normalized) == 96:
            return [normalized[index * 2] + normalized[index * 2 + 1] for index in range(48)]
        if len(normalized) > 48:
            return normalized[:48]
        return normalized + [0.0] * (48 - len(normalized))

    @staticmethod
    def _build_period_label(index: int) -> str:
        start_minutes = index * 30
        end_minutes = start_minutes + 30
        start_hour = (start_minutes // 60) % 24
        start_minute = start_minutes % 60
        end_hour = (end_minutes // 60) % 24
        end_minute = end_minutes % 60
        return f"{start_hour:02d}:{start_minute:02d}-{end_hour:02d}:{end_minute:02d}"

    def _save_wholesale_result(self, result: Dict[str, Any]) -> None:
        payload = result.copy()
        created_at = payload.pop("created_at", datetime.now())
        self.wholesale_result_collection.update_one(
            {
                "customer_id": result["customer_id"],
                "settlement_month": result["settlement_month"],
            },
            {"$set": payload, "$setOnInsert": {"created_at": created_at}},
            upsert=True,
        )

    def delete_customer(self, customer_id: str) -> None:
        if not ObjectId.is_valid(customer_id):
            raise ValueError("无效的客户ID")

        profile_object_id = ObjectId(customer_id)
        profile_doc = self.profile_collection.find_one({"_id": profile_object_id})
        if not profile_doc:
            raise ValueError("客户不存在")

        self.profile_collection.delete_one({"_id": profile_object_id})
        self.raw_collection.delete_many({"customer_id": customer_id})
        self.curve_collection.delete_many({"customer_id": customer_id})
        self.wholesale_result_collection.delete_many({"customer_id": customer_id})

    def _aggregate_customer_curves(
        self,
        customer_id: str,
        customer_name: str,
        meter_records: Dict[str, Dict[str, Dict[str, Any]]],
        meter_configs_by_meter: Dict[str, Dict[str, Any]],
        now: datetime,
    ) -> List[Dict[str, Any]]:
        all_dates = sorted(
            {date_str for records_by_date in meter_records.values() for date_str in records_by_date.keys()}
        )
        aggregated_docs: List[Dict[str, Any]] = []

        for date_str in all_dates:
            aggregated_values = [0.0] * 48
            interpolated_points: List[int] = []
            dirty_points: List[int] = []
            missing_meters: List[str] = []
            actual_meter_count = 0

            current_date = datetime.strptime(date_str, "%Y-%m-%d")
            prev_date = (current_date - timedelta(days=1)).strftime("%Y-%m-%d")
            next_date = (current_date + timedelta(days=1)).strftime("%Y-%m-%d")

            for meter_id, config in meter_configs_by_meter.items():
                day_record = meter_records.get(meter_id, {}).get(date_str)
                if not day_record:
                    missing_meters.append(meter_id)
                    continue

                actual_meter_count += 1
                prev_record = meter_records.get(meter_id, {}).get(prev_date)
                next_record = meter_records.get(meter_id, {}).get(next_date)
                calc_result = LoadAggregationService.calculate_meter_48_points(
                    readings=day_record.get("readings", []),
                    multiplier=float(config["multiplier"]),
                    prev_readings=prev_record.get("readings", []) if prev_record else [],
                    next_readings=next_record.get("readings", []) if next_record else [],
                )

                values = calc_result.get("values", [])
                for index in range(min(len(values), 48)):
                    aggregated_values[index] += float(values[index])

                interpolated_points.extend(calc_result.get("interpolated_indices", []))
                dirty_points.extend(calc_result.get("dirty_indices", []))

            if actual_meter_count == 0:
                continue

            aggregated_values = [round(value, 3) for value in aggregated_values]
            aggregated_docs.append(
                {
                    "customer_id": customer_id,
                    "customer_name": customer_name,
                    "date": date_str,
                    "values": aggregated_values,
                    "total": round(sum(aggregated_values), 3),
                    "meter_count": actual_meter_count,
                    "missing_meters": sorted(missing_meters),
                    "data_quality": {
                        "interpolated_points": sorted(set(interpolated_points)),
                        "dirty_points": sorted(set(dirty_points)),
                    },
                    "created_at": now,
                    "updated_at": now,
                }
            )

        return aggregated_docs

    def _build_profile_document(
        self,
        customer_id: ObjectId,
        customer_name: str,
        created_at: datetime,
        updated_at: datetime,
        meter_configs_by_meter: Dict[str, Dict[str, Any]],
        aggregated_docs: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        dates = sorted(doc["date"] for doc in aggregated_docs)
        totals = [float(doc["total"]) for doc in aggregated_docs]
        coverage_start = dates[0] if dates else None
        coverage_end = dates[-1] if dates else None

        if coverage_start and coverage_end:
            start_dt = datetime.strptime(coverage_start, "%Y-%m-%d")
            end_dt = datetime.strptime(coverage_end, "%Y-%m-%d")
            coverage_days = (end_dt - start_dt).days + 1
        else:
            coverage_days = 0

        actual_days = len(dates)
        missing_days = max(coverage_days - actual_days, 0)
        completeness = round((actual_days / coverage_days) * 100, 1) if coverage_days > 0 else 0.0
        avg_daily_load = round(sum(totals) / len(totals), 3) if totals else 0.0
        max_daily_load = round(max(totals), 3) if totals else 0.0
        min_daily_load = round(min(totals), 3) if totals else 0.0
        missing_meter_days = sum(1 for doc in aggregated_docs if doc.get("missing_meters"))
        interpolated_days = sum(
            1
            for doc in aggregated_docs
            if doc.get("data_quality", {}).get("interpolated_points")
        )
        dirty_days = sum(
            1
            for doc in aggregated_docs
            if doc.get("data_quality", {}).get("dirty_points")
        )

        return {
            "_id": customer_id,
            "customer_name": customer_name,
            "created_at": created_at,
            "updated_at": updated_at,
            "last_imported_at": updated_at,
            "last_aggregated_at": updated_at,
            "coverage_start": coverage_start,
            "coverage_end": coverage_end,
            "coverage_days": coverage_days,
            "missing_days": missing_days,
            "completeness": completeness,
            "avg_daily_load": avg_daily_load,
            "max_daily_load": max_daily_load,
            "min_daily_load": min_daily_load,
            "missing_meter_days": missing_meter_days,
            "interpolated_days": interpolated_days,
            "dirty_days": dirty_days,
            "meter_count": len(meter_configs_by_meter),
            "meters": list(meter_configs_by_meter.values()),
        }

    def _to_customer_list_item(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(doc["_id"]),
            "customer_name": doc.get("customer_name", ""),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "last_imported_at": doc.get("last_imported_at"),
            "last_aggregated_at": doc.get("last_aggregated_at"),
            "coverage_start": doc.get("coverage_start"),
            "coverage_end": doc.get("coverage_end"),
            "coverage_days": doc.get("coverage_days", 0),
            "missing_days": doc.get("missing_days", 0),
            "completeness": doc.get("completeness", 0.0),
            "avg_daily_load": doc.get("avg_daily_load", 0.0),
            "max_daily_load": doc.get("max_daily_load", 0.0),
            "min_daily_load": doc.get("min_daily_load", 0.0),
            "missing_meter_days": doc.get("missing_meter_days", 0),
            "interpolated_days": doc.get("interpolated_days", 0),
            "dirty_days": doc.get("dirty_days", 0),
            "meter_count": doc.get("meter_count", 0),
        }

    @staticmethod
    def _first_non_empty(values: List[Optional[str]]) -> Optional[str]:
        for value in values:
            if value:
                return str(value).strip()
        return None
