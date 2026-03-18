import logging
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

from bson import ObjectId

from webapp.services.intent_customer_diagnosis_service import IntentCustomerDiagnosisService
from webapp.services.retail_monthly_settlement_service import EXCESS_PROFIT_THRESHOLD_PER_MWH

logger = logging.getLogger(__name__)


class IntentCustomerRetailSimulationService(IntentCustomerDiagnosisService):
    def _get_active_package_doc(self, package_id: str) -> Dict[str, Any]:
        if not ObjectId.is_valid(package_id):
            raise ValueError("无效的套餐ID")
        doc = self.package_collection.find_one({"_id": ObjectId(package_id), "status": "active"})
        if not doc:
            raise ValueError("未找到可用的活跃零售套餐")
        return doc

    def _serialize_mongo_value(self, value: Any) -> Any:
        if isinstance(value, BaseModel):
            return self._serialize_mongo_value(value.model_dump())
        if isinstance(value, dict):
            return {str(key): self._serialize_mongo_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._serialize_mongo_value(item) for item in value]
        if isinstance(value, tuple):
            return [self._serialize_mongo_value(item) for item in value]
        if isinstance(value, Decimal):
            return float(value)
        return value

    def _save_retail_result(self, result: Dict[str, Any]) -> None:
        payload = self._serialize_mongo_value(result.copy())
        payload.pop("_id", None)
        created_at = payload.pop("created_at", datetime.now())
        self.retail_result_collection.update_one(
            {
                "customer_id": result["customer_id"],
                "settlement_month": result["settlement_month"],
                "package_id": result["package_id"],
            },
            {"$set": payload, "$setOnInsert": {"created_at": created_at}},
            upsert=True,
        )

    def _build_single_retail_simulation(
        self,
        profile_doc: Dict[str, Any],
        package_doc: Dict[str, Any],
        wholesale_doc: Dict[str, Any],
        curve_docs: List[Dict[str, Any]],
        settlement_month: str,
    ) -> Dict[str, Any]:
        date_keys = [str(doc.get("date")) for doc in curve_docs if str(doc.get("date"))]
        if not date_keys:
            raise ValueError(f"{settlement_month} 缺少有效日期")

        monthly_load_values = [0.0] * 48
        period_breakdown_maps: List[Dict[str, float]] = [defaultdict(float) for _ in range(48)]
        wholesale_period_costs = [0.0] * 48
        daily_details: List[Dict[str, Any]] = []
        daily_contexts: List[Dict[str, Any]] = []
        total_energy_mwh = 0.0
        pre_wholesale_fee = 0.0

        for curve_doc in curve_docs:
            date_str = str(curve_doc.get("date"))
            values = self._normalize_to_48(curve_doc.get("values") or [])
            tou_48 = self.retail_settlement_service._get_tou_48(date_str)
            wholesale_prices = self.retail_settlement_service._get_wholesale_period_prices(date_str)
            if not tou_48 or len(tou_48) != 48:
                raise ValueError(f"{date_str} 缺少峰谷时段定义")

            day_energy = 0.0
            day_cost = 0.0
            day_breakdown: Dict[str, float] = defaultdict(float)
            day_period_breakdown_maps: List[Dict[str, float]] = [defaultdict(float) for _ in range(48)]
            for index in range(48):
                load_mwh = float(values[index] if index < len(values) else 0.0)
                price_mwh = float(wholesale_prices[index] if index < len(wholesale_prices) else 0.0)
                period_key = self._map_tou_period_key(tou_48[index])
                allocated_cost = load_mwh * price_mwh

                monthly_load_values[index] += load_mwh
                period_breakdown_maps[index][period_key] += load_mwh
                wholesale_period_costs[index] += allocated_cost
                day_energy += load_mwh
                day_cost += allocated_cost
                day_breakdown[period_key] += load_mwh
                day_period_breakdown_maps[index][period_key] += load_mwh

            total_energy_mwh += day_energy
            pre_wholesale_fee += day_cost
            daily_contexts.append(
                {
                    "date": date_str,
                    "load_values": [float(v or 0.0) for v in values],
                    "period_breakdown_maps": [dict(item) for item in day_period_breakdown_maps],
                    "day_energy": day_energy,
                    "day_cost": day_cost,
                }
            )
            daily_details.append(
                {
                    "date": date_str,
                    "total_load_mwh": round(day_energy, 6),
                    "total_allocated_cost": round(day_cost, 2),
                    "total_fee": 0.0,
                    "gross_profit": 0.0,
                    "avg_price": 0.0,
                    "retail_avg_price": 0.0,
                    "wholesale_avg_price": round(day_cost / day_energy, 6) if day_energy > 0 else 0.0,
                    "price_spread_per_mwh": 0.0,
                    "period_breakdown": dict(day_breakdown),
                }
            )

        regular_date, holiday_date, regular_tou_48, holiday_tou_48 = (
            self.retail_monthly_service._find_monthly_template_dates(date_keys)
        )
        model_code = str(package_doc.get("model_code") or "")
        pricing_config = dict(package_doc.get("pricing_config") or {})

        regular_price_result = self.retail_monthly_service._build_price_result_for_date(
            model_code=model_code,
            pricing_config=pricing_config,
            date_str=regular_date,
            total_energy=total_energy_mwh,
        )
        holiday_price_result: Optional[Dict[str, Any]] = None
        if holiday_date:
            holiday_price_result = self.retail_monthly_service._build_price_result_for_date(
                model_code=model_code,
                pricing_config=pricing_config,
                date_str=holiday_date,
                total_energy=total_energy_mwh,
            )

        nominal_total_fee = self.retail_monthly_service._calculate_nominal_total_fee_with_templates(
            monthly_load_values=monthly_load_values,
            period_breakdown_maps=period_breakdown_maps,
            regular_tou_48=regular_tou_48,
            holiday_tou_48=holiday_tou_48,
            price_result_regular=regular_price_result,
            price_result_holiday=holiday_price_result,
        )
        nominal_avg_price_kwh = (
            nominal_total_fee / (total_energy_mwh * 1000.0) if total_energy_mwh > 0 else 0.0
        )
        cap_price_kwh = self.retail_monthly_service._get_monthly_cap_price(
            month=settlement_month,
            date_str=regular_date,
            allow_fallback=True,
        )
        cap_total_fee = cap_price_kwh * total_energy_mwh * 1000.0
        is_capped = cap_price_kwh > 0 and nominal_total_fee > cap_total_fee + 1e-6
        scale_ratio = (cap_total_fee / nominal_total_fee) if is_capped and nominal_total_fee > 0 else 1.0

        scaled_regular = (
            self.retail_monthly_service._scale_price_result(regular_price_result, scale_ratio)
            if is_capped
            else regular_price_result
        )
        scaled_holiday = (
            self.retail_monthly_service._scale_price_result(holiday_price_result, scale_ratio)
            if is_capped and holiday_price_result
            else holiday_price_result
        )

        pre_retail_fee = self.retail_monthly_service._calculate_nominal_total_fee_with_templates(
            monthly_load_values=monthly_load_values,
            period_breakdown_maps=period_breakdown_maps,
            regular_tou_48=regular_tou_48,
            holiday_tou_48=holiday_tou_48,
            price_result_regular=scaled_regular,
            price_result_holiday=scaled_holiday,
        )
        pre_retail_unit_price = pre_retail_fee / total_energy_mwh if total_energy_mwh > 0 else 0.0

        wholesale_summary = wholesale_doc.get("summary", {}) or {}
        sttl_wholesale_fee = float(wholesale_summary.get("total_cost") or 0.0)
        sttl_energy_mwh = float(wholesale_summary.get("total_energy_mwh") or total_energy_mwh)
        sttl_wholesale_unit_price = (
            sttl_wholesale_fee / sttl_energy_mwh if sttl_energy_mwh > 0 else 0.0
        )

        balancing_energy_mwh = sttl_energy_mwh - total_energy_mwh
        balancing_reference_price = float(wholesale_summary.get("unit_cost_yuan_per_mwh") or 0.0)
        balancing_retail_fee = balancing_energy_mwh * pre_retail_unit_price
        sttl_retail_fee = pre_retail_fee + balancing_retail_fee
        sttl_retail_unit_price = sttl_retail_fee / sttl_energy_mwh if sttl_energy_mwh > 0 else 0.0
        sttl_balancing_wholesale_fee = sttl_wholesale_fee - pre_wholesale_fee
        sttl_gross_profit = sttl_retail_fee - sttl_wholesale_fee
        sttl_price_spread = sttl_retail_unit_price - sttl_wholesale_unit_price

        excess_profit_per_mwh = max(
            sttl_retail_unit_price - sttl_wholesale_unit_price - EXCESS_PROFIT_THRESHOLD_PER_MWH,
            0.0,
        )
        excess_profit_total = excess_profit_per_mwh * sttl_energy_mwh
        refund_ratio = 0.8 if excess_profit_total > 0 else 0.0
        refund_amount = excess_profit_total * refund_ratio

        final_retail_fee = sttl_retail_fee - refund_amount
        final_retail_unit_price = final_retail_fee / sttl_energy_mwh if sttl_energy_mwh > 0 else 0.0
        final_gross_profit = final_retail_fee - sttl_wholesale_fee
        final_price_spread = final_retail_unit_price - sttl_wholesale_unit_price
        gross_margin = final_gross_profit / final_retail_fee if final_retail_fee else 0.0

        price_model = self._build_intent_price_model(
            package_doc=package_doc,
            regular_price_result=scaled_regular,
            nominal_avg_price_kwh=nominal_avg_price_kwh,
            cap_price_kwh=cap_price_kwh,
            is_capped=is_capped,
        )
        period_details = self._build_intent_period_details(
            monthly_load_values=monthly_load_values,
            period_breakdown_maps=period_breakdown_maps,
            regular_tou_48=regular_tou_48,
            holiday_tou_48=holiday_tou_48,
            scaled_regular=scaled_regular,
            scaled_holiday=scaled_holiday,
            wholesale_period_costs=wholesale_period_costs,
            surplus_unit_price=float(wholesale_summary.get("surplus_unit_price") or 0.0),
        )

        daily_surplus_unit_price = float(wholesale_summary.get("surplus_unit_price") or 0.0)
        refund_unit_price_kwh = (refund_amount / (sttl_energy_mwh * 1000.0)) if sttl_energy_mwh > 0 else 0.0
        for day, day_context in zip(daily_details, daily_contexts):
            load_mwh = float(day_context.get("day_energy") or 0.0)
            base_cost = float(day_context.get("day_cost") or 0.0)
            day_retail_fee_before_refund = self.retail_monthly_service._calculate_nominal_total_fee_with_templates(
                monthly_load_values=list(day_context.get("load_values") or []),
                period_breakdown_maps=list(day_context.get("period_breakdown_maps") or []),
                regular_tou_48=regular_tou_48,
                holiday_tou_48=holiday_tou_48,
                price_result_regular=scaled_regular,
                price_result_holiday=scaled_holiday,
            )
            day_refund_fee = load_mwh * 1000.0 * refund_unit_price_kwh
            retail_fee = day_retail_fee_before_refund - day_refund_fee
            retail_avg_price = retail_fee / load_mwh if load_mwh > 0 else 0.0
            wholesale_cost = base_cost + (load_mwh * daily_surplus_unit_price)
            wholesale_avg_price = (wholesale_cost / load_mwh) if load_mwh > 0 else 0.0
            gross_profit = retail_fee - wholesale_cost
            day["total_fee"] = round(retail_fee, 2)
            day["avg_price"] = round(retail_avg_price, 6)
            day["retail_avg_price"] = round(retail_avg_price, 6)
            day["wholesale_avg_price"] = round(wholesale_avg_price, 6)
            day["gross_profit"] = round(gross_profit, 2)
            day["price_spread_per_mwh"] = round(retail_avg_price - wholesale_avg_price, 6) if load_mwh > 0 else 0.0
            day["total_allocated_cost"] = round(wholesale_cost, 2)
            day["refund_fee"] = round(day_refund_fee, 2)

        pre_stage = {
            "energy_mwh": round(total_energy_mwh, 6),
            "retail_fee": round(pre_retail_fee, 2),
            "retail_unit_price": round(pre_retail_unit_price, 6),
            "wholesale_fee": round(pre_wholesale_fee, 2),
            "wholesale_unit_price": round(pre_wholesale_fee / total_energy_mwh, 6)
            if total_energy_mwh > 0
            else 0.0,
            "gross_profit": round(pre_retail_fee - pre_wholesale_fee, 2),
            "price_spread_per_mwh": round((pre_retail_fee - pre_wholesale_fee) / total_energy_mwh, 6)
            if total_energy_mwh > 0
            else 0.0,
        }
        sttl_stage = {
            "balancing_energy_mwh": round(balancing_energy_mwh, 6),
            "balancing_retail_fee": round(balancing_retail_fee, 2),
            "balancing_wholesale_fee": round(sttl_balancing_wholesale_fee, 2),
            "balancing_reference_price": round(balancing_reference_price, 6),
            "energy_mwh": round(sttl_energy_mwh, 6),
            "retail_fee": round(sttl_retail_fee, 2),
            "retail_unit_price": round(sttl_retail_unit_price, 6),
            "wholesale_fee": round(sttl_wholesale_fee, 2),
            "wholesale_unit_price": round(sttl_wholesale_unit_price, 6),
            "gross_profit": round(sttl_gross_profit, 2),
            "price_spread_per_mwh": round(sttl_price_spread, 6),
        }
        refund_context = {
            "trigger_excess_refund": refund_amount > 0,
            "retail_avg_price_before_refund": round(sttl_retail_unit_price, 6),
            "wholesale_avg_price": round(sttl_wholesale_unit_price, 6),
            "excess_profit_threshold_per_mwh": EXCESS_PROFIT_THRESHOLD_PER_MWH,
            "excess_profit_per_mwh": round(excess_profit_per_mwh, 6),
            "excess_profit_total": round(excess_profit_total, 2),
            "refund_pool": round(refund_amount, 2),
            "refund_ratio": refund_ratio,
            "refund_allocated_method": "single_customer_full_amount",
        }
        final_stage = {
            "energy_mwh": round(sttl_energy_mwh, 6),
            "retail_fee": round(final_retail_fee, 2),
            "retail_unit_price": round(final_retail_unit_price, 6),
            "wholesale_fee": round(sttl_wholesale_fee, 2),
            "wholesale_unit_price": round(sttl_wholesale_unit_price, 6),
            "gross_profit": round(final_gross_profit, 2),
            "price_spread_per_mwh": round(final_price_spread, 6),
            "gross_margin": round(gross_margin, 6),
            "excess_refund_fee": round(refund_amount, 2),
        }

        now = datetime.now()
        return {
            "_id": f"{str(profile_doc['_id'])}_{settlement_month}_{str(package_doc['_id'])}",
            "customer_id": str(profile_doc["_id"]),
            "customer_name": profile_doc.get("customer_name", ""),
            "settlement_month": settlement_month,
            "package_id": str(package_doc["_id"]),
            "package_name": package_doc.get("package_name", ""),
            "model_code": model_code,
            "price_model": price_model,
            "pre_stage": pre_stage,
            "sttl_stage": sttl_stage,
            "refund_context": refund_context,
            "final_stage": final_stage,
            "period_details": period_details,
            "daily_details": daily_details,
            "pre_energy_mwh": pre_stage["energy_mwh"],
            "pre_retail_fee": pre_stage["retail_fee"],
            "pre_retail_unit_price": pre_stage["retail_unit_price"],
            "pre_wholesale_fee": pre_stage["wholesale_fee"],
            "pre_wholesale_unit_price": pre_stage["wholesale_unit_price"],
            "pre_gross_profit": pre_stage["gross_profit"],
            "pre_price_spread_per_mwh": pre_stage["price_spread_per_mwh"],
            "sttl_balancing_energy_mwh": sttl_stage["balancing_energy_mwh"],
            "sttl_balancing_retail_fee": sttl_stage["balancing_retail_fee"],
            "sttl_balancing_wholesale_fee": sttl_stage["balancing_wholesale_fee"],
            "sttl_energy_mwh": sttl_stage["energy_mwh"],
            "sttl_retail_fee": sttl_stage["retail_fee"],
            "sttl_retail_unit_price": sttl_stage["retail_unit_price"],
            "sttl_wholesale_fee": sttl_stage["wholesale_fee"],
            "sttl_wholesale_unit_price": sttl_stage["wholesale_unit_price"],
            "sttl_gross_profit": sttl_stage["gross_profit"],
            "sttl_price_spread_per_mwh": sttl_stage["price_spread_per_mwh"],
            "final_energy_mwh": final_stage["energy_mwh"],
            "final_retail_fee": final_stage["retail_fee"],
            "final_retail_unit_price": final_stage["retail_unit_price"],
            "final_wholesale_fee": final_stage["wholesale_fee"],
            "final_wholesale_unit_price": final_stage["wholesale_unit_price"],
            "final_gross_profit": final_stage["gross_profit"],
            "final_price_spread_per_mwh": final_stage["price_spread_per_mwh"],
            "final_excess_refund_fee": final_stage["excess_refund_fee"],
            "created_at": now,
            "updated_at": now,
        }

    def _build_intent_price_model(
        self,
        package_doc: Dict[str, Any],
        regular_price_result: Dict[str, Any],
        nominal_avg_price_kwh: float,
        cap_price_kwh: float,
        is_capped: bool,
    ) -> Dict[str, Any]:
        return {
            "reference_price": regular_price_result.get("reference_price"),
            "fixed_prices": regular_price_result.get("fixed_prices"),
            "linked_config": regular_price_result.get("linked_config"),
            "final_prices": {
                key: round(float(value or 0.0), 6)
                for key, value in (regular_price_result.get("final_prices", {}) or {}).items()
            },
            "final_prices_48": [
                round(float(value or 0.0), 6)
                for value in (regular_price_result.get("final_prices_48") or [])
            ],
            "price_ratio_adjusted": bool(regular_price_result.get("price_ratio_adjusted", False)),
            "price_ratio_adjusted_base": bool(
                regular_price_result.get("price_ratio_adjusted_base", False)
            ),
            "is_capped": is_capped,
            "nominal_avg_price": round(nominal_avg_price_kwh, 6),
            "cap_price": round(cap_price_kwh, 6),
            "package_type": package_doc.get("package_type"),
            "is_green_power": bool(package_doc.get("is_green_power", False)),
        }

    def _build_intent_period_details(
        self,
        monthly_load_values: List[float],
        period_breakdown_maps: List[Dict[str, float]],
        regular_tou_48: List[str],
        holiday_tou_48: Optional[List[str]],
        scaled_regular: Dict[str, Any],
        scaled_holiday: Optional[Dict[str, Any]],
        wholesale_period_costs: List[float],
        surplus_unit_price: float,
    ) -> List[Dict[str, Any]]:
        period_details: List[Dict[str, Any]] = []
        for index in range(48):
            load_mwh = float(monthly_load_values[index] if index < len(monthly_load_values) else 0.0)
            breakdown_map = dict(period_breakdown_maps[index] if index < len(period_breakdown_maps) else {})
            active_keys = sorted(key for key, value in breakdown_map.items() if float(value or 0.0) > 0)
            is_mix = len(active_keys) > 1

            breakdown_items = []
            if len(active_keys) == 1:
                period_key = active_keys[0]
                retail_unit_price_kwh = self.retail_monthly_service._get_monthly_template_unit_price(
                    index=index,
                    period_key=period_key,
                    regular_tou_48=regular_tou_48,
                    holiday_tou_48=holiday_tou_48,
                    price_result_regular=scaled_regular,
                    price_result_holiday=scaled_holiday,
                )
                retail_fee = load_mwh * retail_unit_price_kwh * 1000.0
            elif is_mix:
                period_key = 'period_type_mix'
                retail_fee = 0.0
                for key in active_keys:
                    seg_load_value = float(breakdown_map.get(key, 0.0) or 0.0)
                    if seg_load_value <= 0:
                        continue
                    seg_unit_price = self.retail_monthly_service._get_monthly_template_unit_price(
                        index=index,
                        period_key=key,
                        regular_tou_48=regular_tou_48,
                        holiday_tou_48=holiday_tou_48,
                        price_result_regular=scaled_regular,
                        price_result_holiday=scaled_holiday,
                    )
                    seg_fee = seg_load_value * seg_unit_price * 1000.0
                    retail_fee += seg_fee
                    breakdown_items.append(
                        {
                            "period_type": self._map_period_key_cn(key),
                            "load_mwh": round(seg_load_value, 6),
                            "fee": round(seg_fee, 2),
                        }
                    )
                retail_unit_price_kwh = retail_fee / (load_mwh * 1000.0) if load_mwh > 0 else 0.0
            else:
                fallback_key = self._map_tou_period_key(regular_tou_48[index])
                period_key = fallback_key
                retail_unit_price_kwh = self.retail_monthly_service._get_monthly_template_unit_price(
                    index=index,
                    period_key=fallback_key,
                    regular_tou_48=regular_tou_48,
                    holiday_tou_48=holiday_tou_48,
                    price_result_regular=scaled_regular,
                    price_result_holiday=scaled_holiday,
                )
                retail_fee = 0.0

            retail_unit_price_mwh = retail_unit_price_kwh * 1000.0
            wholesale_cost = float(wholesale_period_costs[index] if index < len(wholesale_period_costs) else 0.0)
            wholesale_cost += load_mwh * surplus_unit_price
            wholesale_unit_price = wholesale_cost / load_mwh if load_mwh > 0 else 0.0
            gross_profit = retail_fee - wholesale_cost

            period_details.append(
                {
                    "period": index + 1,
                    "time_label": self._build_period_label(index),
                    "period_type": self._map_period_key_cn(period_key) if not is_mix else "period_type_mix",
                    "load_mwh": round(load_mwh, 6),
                    "unit_price": round(retail_unit_price_kwh, 6),
                    "fee": round(retail_fee, 2),
                    "wholesale_price": round(wholesale_unit_price, 6),
                    "allocated_cost": round(wholesale_cost, 2),
                    "retail_unit_price": round(retail_unit_price_mwh, 6),
                    "retail_revenue": round(retail_fee, 2),
                    "wholesale_unit_price": round(wholesale_unit_price, 6),
                    "wholesale_cost": round(wholesale_cost, 2),
                    "gross_profit": round(gross_profit, 2),
                    "spread_yuan_per_mwh": round(gross_profit / load_mwh, 6) if load_mwh > 0 else 0.0,
                    "period_type_breakdown": breakdown_items,
                }
            )
        return period_details

    @staticmethod
    def _map_tou_period_key(period_type: str) -> str:
        return {
            "尖峰": "tip",
            "高峰": "peak",
            "平段": "flat",
            "低谷": "valley",
            "深谷": "deep",
        }.get(period_type, "flat")

    @staticmethod
    def _map_period_key_cn(period_key: str) -> str:
        return {
            "tip": "尖峰",
            "peak": "高峰",
            "flat": "平段",
            "valley": "低谷",
            "deep": "深谷",
        }.get(period_key, period_key)
