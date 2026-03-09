# -*- coding: utf-8 -*-
"""零售月度结算服务。"""

import calendar
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from webapp.models.load_enums import FusionStrategy
from webapp.services.load_query_service import LoadQueryService
from webapp.services.retail_settlement_service import (
    DEFAULT_RATIOS,
    TOU_TYPE_MAP,
    TOU_TYPE_MAP_REV,
    RetailSettlementService,
)
from webapp.services.tou_service import get_month_tou_meta
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

EXCESS_PROFIT_THRESHOLD_PER_MWH = 10.0


class RetailMonthlySettlementService:
    STATUS_COLLECTION = "retail_settlement_monthly_status"
    CUSTOMER_COLLECTION = "retail_settlement_monthly"
    JOB_COLLECTION = "retail_monthly_jobs"

    def __init__(self):
        self.db = DATABASE
        self.retail_service = RetailSettlementService()

    def initialize_job(self, month: str, force: bool = False) -> str:
        job_id = uuid4().hex
        now = datetime.utcnow()
        self.db[self.JOB_COLLECTION].insert_one(
            {
                "_id": job_id,
                "month": month,
                "status": "pending",
                "force": force,
                "total_customers": 0,
                "processed_customers": 0,
                "success_count": 0,
                "failed_count": 0,
                "progress": 0,
                "current_customer": "",
                "message": "",
                "started_at": now,
                "updated_at": now,
            }
        )
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict]:
        return self.db[self.JOB_COLLECTION].find_one({"_id": job_id})

    def get_month_status(self, month: str) -> Optional[Dict]:
        return self.db[self.STATUS_COLLECTION].find_one({"_id": month})

    def get_customer_records(self, month: str) -> List[Dict]:
        return list(self.db[self.CUSTOMER_COLLECTION].find({"month": month}).sort("customer_name", 1))

    def validate_month_ready(self, month: str, allow_fallback: bool = False) -> Tuple[bool, str]:
        energy_doc = self.db["customer_monthly_energy"].find_one({"_id": month}, {"records": 1})
        if not energy_doc:
            return False, f"{month} 缺少客户月度电量记录"
        if len(energy_doc.get("records", [])) == 0:
            return False, f"{month} 客户月度电量记录为空"

        wholesale_doc = self.db["wholesale_settlement_monthly"].find_one({"_id": month}, {"_id": 1})
        if not wholesale_doc:
            return False, f"{month} 批发月度结算未执行"

        has_cap, cap_msg = self._check_monthly_cap_base_ready(month, allow_fallback=allow_fallback)
        if not has_cap:
            return False, cap_msg

        return True, ""

    def list_monthly_summaries(self, year: Optional[str] = None) -> List[Dict]:
        query: Dict = {}
        if year:
            query["_id"] = {"$regex": f"^{year}-"}

        customer_docs = list(
            self.db["customer_monthly_energy"]
            .find(query, {"_id": 1, "imported_at": 1, "records": 1})
            .sort("_id", 1)
        )

        status_query = {"_id": query["_id"]} if "_id" in query else {}
        status_map = {
            doc["_id"]: self._serialize_status(doc)
            for doc in self.db[self.STATUS_COLLECTION].find(status_query)
        }

        summaries: List[Dict] = []
        for doc in customer_docs:
            month = doc["_id"]
            status = status_map.get(month)

            wholesale_doc = self.db["wholesale_settlement_monthly"].find_one(
                {"_id": month}, {"settlement_items": 1}
            )
            wholesale_avg_price = None
            wholesale_total_cost = None
            if wholesale_doc:
                settlement_items = wholesale_doc.get("settlement_items", {}) or {}
                wholesale_avg_price = float(settlement_items.get("settlement_avg_price") or 0.0)
                wholesale_total_cost = float(settlement_items.get("settlement_fee_total") or 0.0)

            retail_avg_price = status.get("retail_avg_price") if status else None
            price_margin_per_mwh = None
            trigger_excess_refund = False
            if wholesale_avg_price is not None and retail_avg_price is not None:
                price_margin_per_mwh = retail_avg_price * 1000 - wholesale_avg_price
                trigger_excess_refund = price_margin_per_mwh > EXCESS_PROFIT_THRESHOLD_PER_MWH

            groups = self._group_monthly_energy_records(doc.get("records", []))
            total_energy_mwh = round(sum(float(r.get("energy_mwh") or 0.0) for r in doc.get("records", [])), 6)

            retail_total_fee = status.get("retail_total_fee") if status else None
            excess_refund_pool = status.get("excess_refund_pool") if status else None
            settlement_total_fee: Optional[float] = None
            settlement_avg_price: Optional[float] = None
            if retail_total_fee is not None and excess_refund_pool is not None:
                settlement_total_fee = round(retail_total_fee - excess_refund_pool, 2)
                retail_total_energy = status.get("retail_total_energy") if status else None
                if retail_total_energy and retail_total_energy > 0:
                    settlement_avg_price = round(settlement_total_fee / (retail_total_energy * 1000), 6)

            summaries.append(
                {
                    "month": month,
                    "customer_count": len(groups),
                    "wholesale_settled": bool(wholesale_doc),
                    "wholesale_avg_price": round(wholesale_avg_price, 6) if wholesale_avg_price is not None else None,
                    "wholesale_total_cost": round(wholesale_total_cost, 2) if wholesale_total_cost is not None else None,
                    "total_energy_mwh": total_energy_mwh,
                    "price_margin_per_mwh": round(price_margin_per_mwh, 6) if price_margin_per_mwh is not None else None,
                    "trigger_excess_refund": trigger_excess_refund,
                    "can_settle": bool(wholesale_doc) and len(groups) > 0,
                    "settlement_total_fee": settlement_total_fee,
                    "settlement_avg_price": settlement_avg_price,
                    "status": status,
                }
            )

        return summaries

    def run_monthly_settlement(self, month: str, job_id: str, force: bool = False) -> None:
        try:
            start_date, end_date = self._parse_month(month)
            end_date_str = end_date.strftime("%Y-%m-%d")
        except ValueError as exc:
            self._set_job_failed(job_id, str(exc))
            return

        ready, reason = self.validate_month_ready(month, allow_fallback=force)
        if not ready:
            self._set_job_failed(job_id, reason)
            return

        energy_doc = self.db["customer_monthly_energy"].find_one({"_id": month}, {"records": 1})
        customer_groups = self._group_monthly_energy_records(energy_doc.get("records", [])) if energy_doc else []
        if not customer_groups:
            self._set_job_failed(job_id, f"{month} 没有可用客户月度电量记录")
            return

        total_customers = len(customer_groups)
        self._update_job(
            job_id,
            {
                "status": "running",
                "force": force,
                "total_customers": total_customers,
                "processed_customers": 0,
                "success_count": 0,
                "failed_count": 0,
                "progress": 0,
                "current_customer": "",
                "message": "步骤1/3：按客户聚合月度48时段电量并计算零售结算",
            },
            initialize=False,
        )

        base_entries: List[Dict] = []
        processed = 0
        success = 0
        failed = 0

        for group in customer_groups:
            processed += 1
            customer_name = group["customer_name"]
            customer_ids = self._resolve_customer_ids(group["customer_nos"], customer_name)
            self._update_job(
                job_id,
                {
                    "processed_customers": processed,
                    "current_customer": customer_name,
                    "progress": int((processed / total_customers) * 70),
                    "message": "步骤1/3：按客户聚合月度48时段电量并计算零售结算",
                },
                initialize=False,
            )

            try:
                calc_result = self._calculate_customer_monthly_retail(
                    customer_ids=customer_ids,
                    customer_name=customer_name,
                    start_date=start_date,
                    end_date=end_date,
                    end_date_str=end_date_str,
                    allow_fallback=force,
                )
                entry = self._build_base_customer_entry(group, customer_ids, calc_result)
                base_entries.append(entry)
                success += 1
            except Exception as exc:
                logger.exception("月度结算客户失败 month=%s customer=%s err=%s", month, customer_name, exc)
                failed += 1

        if success == 0:
            self._set_job_failed(job_id, f"{month} 所有客户处理失败，未生成月度记录")
            return

        self._update_job(
            job_id,
            {
                "message": "步骤2/3：正在计算超额返还并更新客户月度结算",
                "progress": 80,
            },
            initialize=False,
        )

        status_doc = self._build_month_status(month, base_entries, force)

        # 第一步：先落地不含返还的客户月度结算记录
        self._persist_base_customer_entries(month, base_entries, status_doc)

        # 第二步：基于全量客户参数计算返还后，再回写每个客户返还字段
        self._apply_refund_to_customer_entries(month, base_entries, status_doc)

        # 最后写状态，保证状态与客户月结同批次同步
        self._upsert_status(status_doc)

        # 步骤3：重算该月客户日清月结版本
        self._update_job(
            job_id,
            {
                "message": "步骤3/3：正在重算月结口径日清数据",
                "progress": 92,
            },
            initialize=False,
        )
        recompute_result = self._recompute_monthly_daily_settlements(month, force=force)
        recompute_success = recompute_result.get("success", 0)
        recompute_failed = recompute_result.get("failed", 0)

        self._update_job(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "success_count": success,
                "failed_count": failed,
                "processed_customers": processed,
                "current_customer": "",
                "message": f"完成 {success} 个客户月度结算，日清重算 {recompute_success} 个客户（失败 {recompute_failed} 个）",
            },
            initialize=False,
        )

    def _group_monthly_energy_records(self, records: List[Dict]) -> List[Dict]:
        grouped: Dict[str, Dict] = {}
        for rec in records:
            customer_name = str(rec.get("customer_name") or "").strip()
            if not customer_name:
                customer_name = "未命名客户"
            row = grouped.setdefault(
                customer_name,
                {"customer_name": customer_name, "monthly_energy_mwh": 0.0, "customer_nos": set()},
            )
            row["monthly_energy_mwh"] += float(rec.get("energy_mwh") or 0.0)
            customer_no = str(rec.get("customer_no") or "").strip()
            if customer_no:
                row["customer_nos"].add(customer_no)

        result = []
        for _, value in grouped.items():
            result.append(
                {
                    "customer_name": value["customer_name"],
                    "monthly_energy_mwh": round(value["monthly_energy_mwh"], 6),
                    "customer_nos": sorted(list(value["customer_nos"])),
                }
            )
        result.sort(key=lambda x: x["customer_name"])
        return result

    def _resolve_customer_ids(self, customer_nos: List[str], customer_name: str) -> List[str]:
        candidate = self.db.customer_archives.find_one(
            {"user_name": customer_name},
            {"_id": 1},
        )
        if candidate:
            return [str(candidate["_id"])]

        ids: List[str] = []
        for no in customer_nos:
            clean_no = no.rstrip("0").rstrip(".") if "." in no else no
            for lookup_no in {no, clean_no}:
                doc = self.db.customer_archives.find_one(
                    {"accounts.account_id": lookup_no},
                    {"_id": 1},
                )
                if doc:
                    cid = str(doc["_id"])
                    if cid not in ids:
                        ids.append(cid)
                    break

        if not ids:
            logger.warning(
                "无法从档案中解析客户 ID：customer_name=%s, customer_nos=%s",
                customer_name,
                customer_nos,
            )
        return ids

    def _calculate_customer_monthly_retail(
        self,
        customer_ids: List[str],
        customer_name: str,
        start_date: date,
        end_date: date,
        end_date_str: str,
        allow_fallback: bool,
    ) -> Dict[str, Any]:
        if not customer_ids:
            raise ValueError(f"客户 {customer_name} 未解析到 customer_id")

        cap_price = self._get_monthly_cap_price(
            month=end_date_str[:7], date_str=end_date_str, allow_fallback=allow_fallback
        )
        fallback_tou_48 = self.retail_service._get_tou_48(end_date_str)
        if not fallback_tou_48 or len(fallback_tou_48) != 48:
            raise ValueError(f"{end_date_str} 峰谷时段定义异常")

        date_keys = self._build_date_keys(start_date, end_date)
        daily_load_by_date: Dict[str, List[float]] = {d: [0.0] * 48 for d in date_keys}
        for customer_id in customer_ids:
            customer_daily_loads = self._aggregate_customer_monthly_daily_load_values(
                customer_id=customer_id,
                start_date=start_date,
                end_date=end_date,
            )
            for d in date_keys:
                values = customer_daily_loads.get(d, [])
                for i in range(48):
                    daily_load_by_date[d][i] += float(values[i] if i < len(values) else 0.0)

        monthly_load_values = [0.0] * 48
        for values in daily_load_by_date.values():
            for i, value in enumerate(values):
                monthly_load_values[i] += float(value or 0.0)

        period_breakdown_maps: List[Dict[str, float]] = [dict() for _ in range(48)]
        for d in date_keys:
            tou_48 = self.retail_service._get_tou_48(d)
            if not tou_48 or len(tou_48) != 48:
                raise ValueError(f"{d} 峰谷时段定义异常")
            day_values = daily_load_by_date.get(d, [])
            for i in range(48):
                load_mwh = float(day_values[i] if i < len(day_values) else 0.0)
                if load_mwh <= 0:
                    continue
                period_key = TOU_TYPE_MAP.get(tou_48[i], "flat")
                period_breakdown_maps[i][period_key] = period_breakdown_maps[i].get(period_key, 0.0) + load_mwh

        total_energy = sum(monthly_load_values)
        if total_energy <= 0:
            raise ValueError(f"客户 {customer_name} 在 {start_date}~{end_date} 无 MP_ONLY 电量数据")

        contract = None
        selected_customer_id = None
        for customer_id in customer_ids:
            tmp = self.retail_service._find_active_contract(customer_id, end_date_str)
            if tmp:
                contract = tmp
                selected_customer_id = customer_id
                break

        if not contract:
            raise ValueError(f"客户 {customer_name} 在 {end_date_str} 无有效合同")

        package_info = self.retail_service._get_package_info(contract)
        if not package_info:
            raise ValueError(f"客户 {customer_name} 无法解析套餐定价配置")

        model_code = package_info.get("model_code", "")
        pricing_config = package_info.get("pricing_config", {})

        if model_code.startswith("price_spread"):
            is_time_based_pkg = model_code.endswith("_time") and not model_code.endswith("_non_time")
            price_result = self.retail_service._calculate_price_spread(
                pricing_config,
                end_date_str,
                is_time_based_package=is_time_based_pkg,
                total_load_mwh=total_energy,
                settlement_type="monthly",
            )
        elif model_code.startswith("fixed_linked"):
            price_result = self.retail_service._calculate_fixed_linked(
                pricing_config,
                end_date_str,
                settlement_type="monthly",
            )
        elif model_code.startswith("reference_linked"):
            is_time_based_pkg = model_code.endswith("_time") and not model_code.endswith("_non_time")
            price_result = self.retail_service._calculate_reference_linked(
                pricing_config,
                end_date_str,
                is_time_based_package=is_time_based_pkg,
                total_load_mwh=total_energy,
                settlement_type="monthly",
            )
        elif model_code.startswith("single_comprehensive"):
            price_result = self.retail_service._calculate_single_comprehensive(
                pricing_config,
                end_date_str,
                settlement_type="monthly",
            )
        else:
            raise ValueError(f"客户 {customer_name} 不支持的定价模型: {model_code}")

        final_prices = dict(price_result.get("final_prices", {}) or {})
        final_prices_48 = list(price_result.get("final_prices_48") or []) or None
        nominal_total_fee = self._calculate_total_fee(
            load_values=monthly_load_values,
            period_breakdown_maps=period_breakdown_maps,
            fallback_tou_48=fallback_tou_48,
            final_prices=final_prices,
            final_prices_48=final_prices_48,
        )
        nominal_avg_price = nominal_total_fee / (total_energy * 1000) if total_energy > 0 else 0.0
        ratio = cap_price / nominal_avg_price if nominal_avg_price > cap_price + 1e-12 and nominal_avg_price > 0 else 1.0
        is_capped = ratio < 1.0

        if is_capped:
            final_prices = {k: v * ratio for k, v in final_prices.items()}
            if final_prices_48 and len(final_prices_48) == 48:
                final_prices_48 = [v * ratio for v in final_prices_48]

        period_details: List[Dict[str, Any]] = []
        tou_summary: Dict[str, Dict[str, float]] = {
            k: {"load_mwh": 0.0, "fee": 0.0} for k in DEFAULT_RATIOS.keys()
        }
        period_allocated_costs = self._aggregate_customer_monthly_period_allocated_costs(
            customer_ids=customer_ids,
            month=end_date_str[:7],
        )
        total_fee = 0.0
        total_allocated_cost = 0.0
        for i in range(48):
            load_mwh = float(monthly_load_values[i] if i < len(monthly_load_values) else 0.0)
            breakdown_map = period_breakdown_maps[i] if i < len(period_breakdown_maps) else {}
            breakdown_items: List[Dict[str, float]] = []
            breakdown_fee_map: Dict[str, float] = {}
            period_keys = sorted(k for k, v in breakdown_map.items() if float(v or 0.0) > 0)
            is_mix = len(period_keys) > 1

            if len(period_keys) == 1:
                single_key = period_keys[0]
                unit_price = (
                    float(final_prices_48[i])
                    if final_prices_48 and len(final_prices_48) == 48
                    else float(final_prices.get(single_key, 0.0))
                )
                fee = unit_price * load_mwh * 1000
                breakdown_fee_map[single_key] = fee
                period_type = TOU_TYPE_MAP_REV.get(single_key, fallback_tou_48[i])
            elif is_mix:
                fee = 0.0
                for period_key in period_keys:
                    seg_load = float(breakdown_map.get(period_key, 0.0))
                    seg_unit_price = float(final_prices.get(period_key, 0.0))
                    seg_fee = seg_unit_price * seg_load * 1000
                    fee += seg_fee
                    breakdown_fee_map[period_key] = seg_fee
                    breakdown_items.append(
                        {
                            "period_type": TOU_TYPE_MAP_REV.get(period_key, "平段"),
                            "load_mwh": round(seg_load, 6),
                            "fee": round(seg_fee, 2),
                        }
                    )
                unit_price = (fee / (load_mwh * 1000)) if load_mwh > 0 else 0.0
                period_type = "period_type_mix"
            else:
                fallback_key = TOU_TYPE_MAP.get(fallback_tou_48[i], "flat")
                unit_price = (
                    float(final_prices_48[i])
                    if final_prices_48 and len(final_prices_48) == 48
                    else float(final_prices.get(fallback_key, 0.0))
                )
                fee = 0.0
                period_type = fallback_tou_48[i]

            allocated_cost = float(period_allocated_costs.get(i + 1, 0.0))
            wholesale_price = (allocated_cost / load_mwh) if load_mwh > 0 else 0.0
            total_fee += fee
            total_allocated_cost += allocated_cost

            if breakdown_fee_map:
                for period_key, period_fee in breakdown_fee_map.items():
                    tou_summary[period_key]["load_mwh"] += float(breakdown_map.get(period_key, 0.0))
                    tou_summary[period_key]["fee"] += period_fee
            elif load_mwh > 0:
                fallback_key = TOU_TYPE_MAP.get(period_type, "flat")
                tou_summary[fallback_key]["load_mwh"] += load_mwh
                tou_summary[fallback_key]["fee"] += fee

            detail = {
                "period": i + 1,
                "period_type": period_type,
                "load_mwh": round(load_mwh, 6),
                "unit_price": round(unit_price, 6),
                "fee": round(fee, 2),
                "allocated_cost": round(allocated_cost, 6),
                "wholesale_price": round(wholesale_price, 6),
            }
            if is_mix:
                detail["period_type_breakdown"] = breakdown_items

            period_details.append(
                detail
            )

        avg_price = total_fee / (total_energy * 1000) if total_energy > 0 else 0.0
        # 按要求：总采购金额来自 period_details.allocated_cost 聚合
        total_allocated_cost = sum(float(d.get("allocated_cost") or 0.0) for d in period_details)
        gross_profit = total_fee - total_allocated_cost
        tou_summary_out = {
            k: {
                "load_mwh": round(v["load_mwh"], 6),
                "fee": round(v["fee"], 2),
            }
            for k, v in tou_summary.items()
        }

        return {
            "customer_id": selected_customer_id,
            "contract_id": str(contract.get("_id", "")),
            "package_name": contract.get("package_name", ""),
            "model_code": model_code,
            "reference_price": self._to_plain(price_result.get("reference_price")),
            "fixed_prices": self._to_plain(price_result.get("fixed_prices")),
            "linked_config": self._to_plain(price_result.get("linked_config")),
            "final_prices": {k: round(float(v), 6) for k, v in final_prices.items()},
            "price_ratio_adjusted": bool(price_result.get("price_ratio_adjusted", False)),
            "price_ratio_adjusted_base": bool(price_result.get("price_ratio_adjusted_base", False)),
            "period_details": period_details,
            "tou_summary": tou_summary_out,
            "total_load_mwh": round(total_energy, 6),
            "total_fee": round(total_fee, 2),
            "avg_price": round(avg_price, 6),
            "total_allocated_cost": round(total_allocated_cost, 6),
            "gross_profit": round(gross_profit, 2),
            "nominal_avg_price": round(nominal_avg_price, 6),
            "cap_price": round(cap_price, 6),
            "is_capped": is_capped,
        }

    def _build_date_keys(self, start_date: date, end_date: date) -> List[str]:
        keys: List[str] = []
        current = start_date
        while current <= end_date:
            keys.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)
        return keys

    def _aggregate_customer_monthly_daily_load_values(
        self,
        customer_id: str,
        start_date: date,
        end_date: date,
    ) -> Dict[str, List[float]]:
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")
        curves = LoadQueryService.get_curve_series(
            customer_id=customer_id,
            start_date=start_str,
            end_date=end_str,
            strategy=FusionStrategy.MP_ONLY,
        )

        daily: Dict[str, List[float]] = {}
        for curve in curves:
            values = self._normalize_to_48(curve.values if curve else [])
            curve_date = str(getattr(curve, "date", "") or "").strip()
            if not curve_date:
                continue
            daily[curve_date] = [round(float(v or 0.0), 6) for v in values]
        return daily

    def _aggregate_customer_monthly_load_values(self, customer_id: str, start_date: date, end_date: date) -> List[float]:
        daily = self._aggregate_customer_monthly_daily_load_values(customer_id, start_date, end_date)
        monthly = [0.0] * 48
        for values in daily.values():
            for i, value in enumerate(values):
                monthly[i] += float(value or 0.0)
        return [round(v, 6) for v in monthly]

    def _normalize_to_48(self, values: List[float]) -> List[float]:
        vals = [float(v or 0.0) for v in values]
        if len(vals) == 48:
            return vals
        if len(vals) == 96:
            return [vals[i * 2] + vals[i * 2 + 1] for i in range(48)]
        if len(vals) > 48:
            return vals[:48]
        return vals + [0.0] * (48 - len(vals))

    def _aggregate_customer_monthly_period_allocated_costs(
        self,
        customer_ids: List[str],
        month: str,
    ) -> Dict[int, float]:
        if not customer_ids:
            return {}

        docs = list(
            self.db["retail_settlement_daily"].find(
                {
                    "customer_id": {"$in": customer_ids},
                    "settlement_type": "daily",
                    "date": {"$regex": f"^{month}-"},
                },
                {"period_details": 1},
            )
        )

        period_costs: Dict[int, float] = {}
        for doc in docs:
            for detail in (doc.get("period_details") or []):
                try:
                    period = int(detail.get("period"))
                except (TypeError, ValueError):
                    continue
                if not 1 <= period <= 48:
                    continue
                period_costs[period] = period_costs.get(period, 0.0) + float(detail.get("allocated_cost") or 0.0)
        return period_costs

    def _calculate_total_fee(
        self,
        load_values: List[float],
        period_breakdown_maps: List[Dict[str, float]],
        fallback_tou_48: List[str],
        final_prices: Dict[str, float],
        final_prices_48: Optional[List[float]],
    ) -> float:
        total_fee = 0.0
        for i in range(48):
            load_mwh = load_values[i] if i < len(load_values) else 0.0
            breakdown_map = period_breakdown_maps[i] if i < len(period_breakdown_maps) else {}
            period_keys = [k for k, v in breakdown_map.items() if float(v or 0.0) > 0]
            if len(period_keys) == 1:
                period_key = period_keys[0]
                if final_prices_48 and len(final_prices_48) == 48:
                    unit_price = final_prices_48[i]
                else:
                    unit_price = final_prices.get(period_key, 0.0)
                total_fee += unit_price * load_mwh * 1000
            elif len(period_keys) > 1:
                for period_key in period_keys:
                    seg_load = float(breakdown_map.get(period_key, 0.0))
                    unit_price = float(final_prices.get(period_key, 0.0))
                    total_fee += unit_price * seg_load * 1000
            else:
                period_key = TOU_TYPE_MAP.get(fallback_tou_48[i], "flat")
                unit_price = final_prices.get(period_key, 0.0)
                total_fee += unit_price * load_mwh * 1000
        return total_fee

    def _check_monthly_cap_base_ready(self, month: str, allow_fallback: bool) -> Tuple[bool, str]:
        doc = self.db["retail_settlement_prices"].find_one({"_id": month}, {"regular_prices": 1})
        if not doc:
            if allow_fallback:
                return True, ""
            return False, f"{month} 未发布零售结算价格定义，确认后可降级计算"

        regular_prices = doc.get("regular_prices", []) or []
        found = any((p.get("price_type_key") == "market_longterm_flat_avg" and p.get("value") is not None) for p in regular_prices)
        if found:
            return True, ""

        if allow_fallback:
            return True, ""
        return False, f"{month} 缺少 market_longterm_flat_avg，确认后可降级计算"

    def _get_monthly_cap_price(self, month: str, date_str: str, allow_fallback: bool) -> float:
        date_dt = datetime.strptime(date_str, "%Y-%m-%d")
        tou_meta = get_month_tou_meta(date_dt, self.db["tou_rules"])
        ratio = 0.15 if tou_meta.get("is_tip_month", False) else 0.10

        base_price = self._get_monthly_cap_base_price(month, allow_fallback=allow_fallback)
        return round(base_price * (1 + ratio), 6)

    def _get_monthly_cap_base_price(self, month: str, allow_fallback: bool) -> float:
        doc = self.db["retail_settlement_prices"].find_one({"_id": month}, {"regular_prices": 1})
        regular_prices = (doc or {}).get("regular_prices", []) or []
        for row in regular_prices:
            if row.get("price_type_key") == "market_longterm_flat_avg" and row.get("value") is not None:
                value = float(row.get("value"))
                return value / 1000.0 if value > 10 else value

        if not allow_fallback:
            raise ValueError(f"{month} 缺少 market_longterm_flat_avg，无法计算月度封顶价")

        sgcc = self.db["price_sgcc"].find_one({"_id": month}, {"avg_on_grid_price": 1})
        fallback = float((sgcc or {}).get("avg_on_grid_price") or 0.0)
        if fallback <= 0:
            raise ValueError(f"{month} market_longterm_flat_avg 缺失且无可用降级基准")

        logger.warning("%s 使用 avg_on_grid_price=%s 作为月封顶基准降级值", month, fallback)
        return fallback

    def _build_base_customer_entry(self, group: Dict, customer_ids: List[str], calc_result: Dict[str, Any]) -> Dict:
        customer_name = group["customer_name"]
        monthly_energy = float(group.get("monthly_energy_mwh") or 0.0)
        daily_energy = float(calc_result.get("total_load_mwh") or 0.0)
        retail_fee = float(calc_result.get("total_fee") or 0.0)
        retail_avg_price = retail_fee / daily_energy if daily_energy > 0 else 0.0
        total_allocated_cost = float(calc_result.get("total_allocated_cost") or 0.0)
        pre_wholesale_avg_price = total_allocated_cost / daily_energy if daily_energy > 0 else 0.0
        pre_gross_profit = retail_fee - total_allocated_cost
        pre_price_spread = retail_avg_price - pre_wholesale_avg_price
        balancing_energy = monthly_energy - daily_energy
        balancing_fee = balancing_energy * retail_avg_price
        total_energy = daily_energy + balancing_energy
        retail_total_fee = retail_fee + balancing_fee
        total_fee_before_refund = retail_total_fee
        settlement_avg_price = total_fee_before_refund / total_energy if total_energy > 0 else 0.0

        primary_customer_id = customer_ids[0] if customer_ids else None

        return {
            "customer_id": calc_result.get("customer_id") or primary_customer_id,
            "customer_name": customer_name,
            "contract_id": calc_result.get("contract_id", ""),
            "package_name": calc_result.get("package_name", ""),
            "model_code": calc_result.get("model_code", ""),
            "reference_price": calc_result.get("reference_price"),
            "fixed_prices": calc_result.get("fixed_prices"),
            "linked_config": calc_result.get("linked_config"),
            "final_prices": calc_result.get("final_prices", {}),
            "price_ratio_adjusted": bool(calc_result.get("price_ratio_adjusted", False)),
            "price_ratio_adjusted_base": bool(calc_result.get("price_ratio_adjusted_base", False)),
            "period_details": calc_result.get("period_details", []),
            "tou_summary": calc_result.get("tou_summary", {}),
            "total_allocated_cost": round(total_allocated_cost, 6),
            "nominal_avg_price": round(float(calc_result.get("nominal_avg_price") or 0.0), 6),
            "cap_price": round(float(calc_result.get("cap_price") or 0.0), 6),
            "is_capped": bool(calc_result.get("is_capped", False)),
            "daily_energy_mwh": round(daily_energy, 6),
            "balancing_energy_mwh": round(balancing_energy, 6),
            "balancing_fee": round(balancing_fee, 2),
            "total_energy_mwh": round(total_energy, 6),
            "retail_total_fee": round(retail_total_fee, 2),
            "total_fee_before_refund": round(total_fee_before_refund, 2),
            "pre_energy_mwh": round(daily_energy, 6),
            "pre_retail_fee": round(retail_fee, 2),
            "pre_retail_unit_price": round(retail_avg_price, 3),
            "pre_wholesale_fee": round(total_allocated_cost, 6),
            "pre_wholesale_unit_price": round(pre_wholesale_avg_price, 3),
            "pre_gross_profit": round(pre_gross_profit, 2),
            "pre_price_spread_per_mwh": round(pre_price_spread, 3),
        }

    def _build_month_status(self, month: str, entries: List[Dict], force: bool) -> Dict:
        wholesale_doc = self.db["wholesale_settlement_monthly"].find_one({"_id": month})
        settlement_items = wholesale_doc.get("settlement_items", {}) if wholesale_doc else {}
        wholesale_avg_price = float(
            (settlement_items.get("settlement_avg_price") or 0.0) if wholesale_doc else 0.0
        )
        balancing_price = float((settlement_items.get("balancing_price") or 0.0) if wholesale_doc else 0.0)

        fund_surplus_deficit_total = float((settlement_items.get("fund_surplus_deficit_total") or 0.0) if wholesale_doc else 0.0)
        deviation_recovery_fee = float((settlement_items.get("deviation_recovery_fee") or 0.0) if wholesale_doc else 0.0)
        actual_monthly_volume = float((settlement_items.get("actual_monthly_volume") or 0.0) if wholesale_doc else 0.0)

        surplus_unit_price = 0.0
        if actual_monthly_volume > 0:
            surplus_unit_price = round((fund_surplus_deficit_total - deviation_recovery_fee) / actual_monthly_volume, 6)

        retail_total_energy = sum(entry["total_energy_mwh"] for entry in entries)
        retail_total_fee = 0.0
        for entry in entries:
            _, sttl_retail_fee, _ = self._calculate_post_balancing_retail(
                entry=entry,
                balancing_price=balancing_price,
            )
            retail_total_fee += sttl_retail_fee
        retail_avg_price = retail_total_fee / (retail_total_energy * 1000) if retail_total_energy > 0 else 0.0

        excess_profit_per_mwh = max(
            retail_avg_price * 1000 - wholesale_avg_price - EXCESS_PROFIT_THRESHOLD_PER_MWH,
            0.0,
        )
        excess_profit_total = excess_profit_per_mwh * retail_total_energy
        excess_refund_pool = excess_profit_total * 0.8

        now = datetime.utcnow()
        return {
            "_id": month,
            "month": month,
            "wholesale_settled": bool(wholesale_doc),
            "wholesale_avg_price": round(wholesale_avg_price, 6),
            "balancing_price": round(balancing_price, 6),
            "surplus_unit_price": surplus_unit_price,
            "retail_daily_recomputed": False,
            "retail_avg_price": round(retail_avg_price, 6),
            "retail_total_energy": round(retail_total_energy, 6),
            "retail_total_fee": round(retail_total_fee, 2),
            "excess_profit_threshold": EXCESS_PROFIT_THRESHOLD_PER_MWH,
            "excess_profit_total": round(excess_profit_total, 2),
            "excess_refund_pool": round(excess_refund_pool, 2),
            "force": force,
            "updated_at": now,
            "created_at": now,
        }

    def _persist_base_customer_entries(self, month: str, entries: List[Dict], status_doc: Dict) -> None:
        collection = self.db[self.CUSTOMER_COLLECTION]
        now = datetime.utcnow()

        for entry in entries:
            doc_id = self._build_customer_doc_id(month, entry["customer_name"])
            balancing_price = float(status_doc.get("balancing_price") or 0.0)
            surplus_unit_price = float(status_doc.get("surplus_unit_price", 0.0))
            
            balancing_wholesale_fee = round(entry["balancing_energy_mwh"] * balancing_price, 2)
            surplus_fee = round(entry["total_energy_mwh"] * surplus_unit_price, 2)
            
            balancing_retail_fee, post_balancing_retail_fee, post_balancing_retail_unit_price = (
                self._calculate_post_balancing_retail(entry=entry, balancing_price=balancing_price)
            )

            # 回写 entry，保证后续返还阶段沿用同一“调平按批发侧调平价”口径
            entry["balancing_fee"] = balancing_retail_fee
            entry["retail_total_fee"] = post_balancing_retail_fee
            entry["total_fee_before_refund"] = post_balancing_retail_fee

            wholesale_total_fee = round(entry.get("total_allocated_cost", 0.0) + balancing_wholesale_fee + surplus_fee, 6)
            customer_wholesale_avg_price = (
                wholesale_total_fee / entry["total_energy_mwh"] if entry["total_energy_mwh"] > 0 else 0.0
            )
            post_balancing_gross_profit = round(entry["total_fee_before_refund"] - wholesale_total_fee, 2)
            post_balancing_spread = post_balancing_retail_unit_price - customer_wholesale_avg_price
            payload = {
                "month": month,
                "settlement_type": "monthly",
                "customer_id": entry["customer_id"],
                "customer_name": entry["customer_name"],
                "contract_id": entry.get("contract_id", ""),
                "package_name": entry.get("package_name", ""),
                "model_code": entry.get("model_code", ""),
                "price_model": {
                    "reference_price": entry.get("reference_price"),
                    "fixed_prices": entry.get("fixed_prices"),
                    "linked_config": entry.get("linked_config"),
                    "final_prices": entry.get("final_prices", {}),
                    "price_ratio_adjusted": entry.get("price_ratio_adjusted", False),
                    "price_ratio_adjusted_base": entry.get("price_ratio_adjusted_base", False),
                    "is_capped": entry.get("is_capped", False),
                    "nominal_avg_price": entry.get("nominal_avg_price", 0.0),
                    "cap_price": entry.get("cap_price", 0.0),
                },
                "period_details": entry.get("period_details", []),
                "tou_summary": entry.get("tou_summary", {}),
                "pre_energy_mwh": entry.get("pre_energy_mwh", entry["daily_energy_mwh"]),
                "pre_retail_fee": entry.get("pre_retail_fee", 0.0),
                "pre_retail_unit_price": entry.get("pre_retail_unit_price", 0.0),
                "pre_wholesale_fee": entry.get("pre_wholesale_fee", round(entry.get("total_allocated_cost", 0.0), 6)),
                "pre_wholesale_unit_price": entry.get("pre_wholesale_unit_price", 0.0),
                "pre_gross_profit": entry.get("pre_gross_profit", 0.0),
                "pre_price_spread_per_mwh": entry.get("pre_price_spread_per_mwh", 0.0),
                "sttl_balancing_energy_mwh": round(entry["balancing_energy_mwh"], 6),
                "sttl_balancing_retail_fee": balancing_retail_fee,
                "sttl_balancing_wholesale_fee": balancing_wholesale_fee,
                "sttl_energy_mwh": round(entry["total_energy_mwh"], 6),
                "sttl_retail_fee": post_balancing_retail_fee,
                "sttl_retail_unit_price": round(post_balancing_retail_unit_price, 3),
                "sttl_wholesale_fee": wholesale_total_fee,
                "sttl_wholesale_unit_price": round(customer_wholesale_avg_price, 3),
                "sttl_gross_profit": post_balancing_gross_profit,
                "sttl_price_spread_per_mwh": round(post_balancing_spread, 3),
                "final_excess_refund_fee": 0.0,
                "final_energy_mwh": round(entry["total_energy_mwh"], 6),
                "final_retail_fee": post_balancing_retail_fee,
                "final_retail_unit_price": round(post_balancing_retail_unit_price, 3),
                "final_wholesale_fee": wholesale_total_fee,
                "final_wholesale_unit_price": round(customer_wholesale_avg_price, 3),
                "final_gross_profit": post_balancing_gross_profit,
                "final_price_spread_per_mwh": round(post_balancing_spread, 3),
                "updated_at": now,
            }
            collection.update_one(
                {"_id": doc_id},
                {
                    "$set": payload,
                    "$unset": {
                        "reference_price": "",
                        "fixed_prices": "",
                        "linked_config": "",
                        "final_prices": "",
                        "price_ratio_adjusted": "",
                        "price_ratio_adjusted_base": "",
                        "nominal_avg_price": "",
                        "cap_price": "",
                        "is_capped": "",
                        "period_load_values": "",
                        "total_allocated_cost": "",
                        "balancing_wholesale_fee": "",
                        "wholesale_total_fee": "",
                        "customer_wholesale_avg_price": "",
                        "gross_profit": "",
                        "daily_energy_mwh": "",
                        "balancing_energy_mwh": "",
                        "balancing_fee": "",
                        "total_energy_mwh": "",
                        "retail_total_fee": "",
                        "total_fee": "",
                        "wholesale_avg_price": "",
                        "excess_refund_fee": "",
                        "settlement_avg_price": "",
                        "retail_fee": "",
                        "retail_avg_price": "",
                        "balancing_avg_price": "",
                        "monthly_retail_total_fee_before_balancing": "",
                        "monthly_retail_avg_price_before_balancing": "",
                        "excess_refund_unit_price": "",
                        "excess_refund_ratio": "",
                        "refund_allocated_at": "",
                        "stage_pre_balancing": "",
                        "stage_post_balancing": "",
                        "stage_post_refund": "",
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )

    def _apply_refund_to_customer_entries(self, month: str, entries: List[Dict], status_doc: Dict) -> None:
        collection = self.db[self.CUSTOMER_COLLECTION]
        total_energy_for_ratio = sum(entry["total_energy_mwh"] for entry in entries)
        if total_energy_for_ratio <= 0:
            return

        refund_pool = float(status_doc.get("excess_refund_pool") or 0.0)
        now = datetime.utcnow()

        for entry in entries:
            ratio = entry["total_energy_mwh"] / total_energy_for_ratio if total_energy_for_ratio > 0 else 0.0
            refund_amount = refund_pool * ratio
            settlement_fee = round(entry["total_fee_before_refund"] - refund_amount, 2)
            settlement_avg_price = settlement_fee / entry["total_energy_mwh"] if entry["total_energy_mwh"] > 0 else 0.0
            
            balancing_price = float(status_doc.get("balancing_price") or 0.0)
            surplus_unit_price = float(status_doc.get("surplus_unit_price", 0.0))
            
            balancing_wholesale_fee = round(
                entry["balancing_energy_mwh"] * balancing_price,
                2,
            )
            surplus_fee = round(entry["total_energy_mwh"] * surplus_unit_price, 2)
            
            wholesale_total_fee = round(entry.get("total_allocated_cost", 0.0) + balancing_wholesale_fee + surplus_fee, 6)
            customer_wholesale_avg_price = (
                wholesale_total_fee / entry["total_energy_mwh"] if entry["total_energy_mwh"] > 0 else 0.0
            )
            post_refund_spread = settlement_avg_price - customer_wholesale_avg_price
            gross_profit = round(
                settlement_fee - wholesale_total_fee,
                2,
            )

            doc_id = self._build_customer_doc_id(month, entry["customer_name"])
            collection.update_one(
                {"_id": doc_id},
                {
                    "$set": {
                        "final_excess_refund_fee": round(refund_amount, 2),
                        "final_energy_mwh": round(entry["total_energy_mwh"], 6),
                        "final_retail_fee": settlement_fee,
                        "final_retail_unit_price": round(settlement_avg_price, 3),
                        "final_wholesale_fee": wholesale_total_fee,
                        "final_wholesale_unit_price": round(customer_wholesale_avg_price, 3),
                        "final_gross_profit": gross_profit,
                        "final_price_spread_per_mwh": round(post_refund_spread, 3),
                        "updated_at": now,
                    }
                },
            )

    def _calculate_post_balancing_retail(self, entry: Dict[str, Any], balancing_price: float) -> Tuple[float, float, float]:
        """计算调平后零售电费/单价。

        规则：
        1) 统一口径：调平前电费采用 sum(period_details.fee)；
        2) 当 balancing_energy_mwh < 0 时，调平电价不参与，按调平前零售单价计算调平电费；
        3) 当 balancing_energy_mwh >= 0 时，调平电费按批发侧月度调平电价执行；
        2) 对原先触发封顶的客户，先回退到封顶前名义电价口径，再判断加调平后是否仍封顶；
        3) 若仍封顶，调平后单价维持封顶价。
        """
        period_details = entry.get("period_details", []) or []
        pre_retail_fee = float(sum(float(d.get("fee") or 0.0) for d in period_details))
        if pre_retail_fee <= 0:
            pre_retail_fee = float(entry.get("pre_retail_fee", 0.0))
        pre_energy_mwh = float(entry.get("pre_energy_mwh", entry.get("daily_energy_mwh", 0.0)))
        balancing_energy_mwh = float(entry.get("balancing_energy_mwh", 0.0))
        total_energy_mwh = float(entry.get("total_energy_mwh", 0.0))
        pre_retail_unit_price = (
            pre_retail_fee / pre_energy_mwh if pre_energy_mwh > 0 else float(entry.get("pre_retail_unit_price", 0.0))
        )

        if total_energy_mwh <= 0:
            return 0.0, 0.0, 0.0

        is_capped = bool(entry.get("is_capped", False))
        cap_price_kwh = float(entry.get("cap_price", 0.0))
        nominal_avg_price_kwh = float(entry.get("nominal_avg_price", 0.0))

        # 调平电费基础规则（负调平按调平前零售单价，正调平按批发侧调平电价）
        balancing_retail_fee_candidate = (
            balancing_energy_mwh * pre_retail_unit_price
            if balancing_energy_mwh < 0
            else balancing_energy_mwh * balancing_price
        )

        # 非封顶客户：直接按批发侧调平电价补调平电费
        if not is_capped:
            balancing_retail_fee = round(balancing_retail_fee_candidate, 2)
            sttl_retail_fee = round(pre_retail_fee + balancing_retail_fee, 2)
            sttl_retail_unit_price = sttl_retail_fee / total_energy_mwh
            return balancing_retail_fee, sttl_retail_fee, sttl_retail_unit_price

        # 封顶客户：先回退名义电价，再判断调平后是否仍封顶
        nominal_pre_fee = nominal_avg_price_kwh * pre_energy_mwh * 1000.0
        candidate_total_fee = nominal_pre_fee + balancing_retail_fee_candidate
        candidate_unit_price_mwh = candidate_total_fee / total_energy_mwh if total_energy_mwh > 0 else 0.0
        cap_unit_price_mwh = cap_price_kwh * 1000.0

        if cap_unit_price_mwh > 0 and candidate_unit_price_mwh > cap_unit_price_mwh + 1e-9:
            sttl_retail_unit_price = cap_unit_price_mwh
            sttl_retail_fee = round(sttl_retail_unit_price * total_energy_mwh, 2)
        else:
            sttl_retail_fee = round(candidate_total_fee, 2)
            sttl_retail_unit_price = sttl_retail_fee / total_energy_mwh if total_energy_mwh > 0 else 0.0

        balancing_retail_fee = round(sttl_retail_fee - pre_retail_fee, 2)
        return balancing_retail_fee, sttl_retail_fee, sttl_retail_unit_price

    def _build_customer_doc_id(self, month: str, customer_name: str) -> str:
        safe_name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fa5_-]", "_", customer_name).strip("_")
        if not safe_name:
            safe_name = "unknown"
        return f"{month}_{safe_name}"

    def _parse_month(self, month: str) -> Tuple[date, date]:
        inst = datetime.strptime(month, "%Y-%m")
        first_day = inst.replace(day=1).date()
        last_day = inst.replace(day=calendar.monthrange(inst.year, inst.month)[1]).date()
        return first_day, last_day

    def _serialize_status(self, doc: Optional[Dict]) -> Optional[Dict]:
        if not doc:
            return None
        payload = doc.copy()
        for field in ("created_at", "updated_at"):
            if isinstance(payload.get(field), datetime):
                payload[field] = payload[field].isoformat()
        return payload

    def _to_plain(self, value: Any) -> Any:
        if value is None:
            return None
        if hasattr(value, "model_dump"):
            return value.model_dump()
        return value

    def _set_job_failed(self, job_id: str, message: str) -> None:
        logger.error("月度结算任务失败 job_id=%s, message=%s", job_id, message)
        self._update_job(
            job_id,
            {
                "status": "failed",
                "message": message,
                "updated_at": datetime.utcnow(),
            },
            initialize=False,
        )

    def _update_job(self, job_id: str, fields: Dict, initialize: bool = True) -> None:
        payload = fields.copy()
        payload["updated_at"] = datetime.utcnow()
        self.db[self.JOB_COLLECTION].update_one(
            {"_id": job_id},
            {"$set": payload},
            upsert=initialize,
        )

    # ========== 月结口径日清重算 ==========

    def _recompute_monthly_daily_settlements(self, month: str, force: bool = True) -> Dict[str, Any]:
        """月结完成后，为该月所有客户写入 settlement_type='monthly' 的日清记录。

        规则（参见实施方案 4.1/4.2）：
        - 采购侧：当天 PLATFORM_DAILY 时段批发价 + surplus_unit_price（度电资金余缺分摊，元/MWh）
        - 零售侧：月结 final_prices（5时段，元/kWh）- refund_unit_price_kwh（度电超额返还，元/kWh），允许负价
        - 调平电量不参与（批零同价，价差收益为0）
        """
        status_doc = self.get_month_status(month)
        if not status_doc:
            logger.error("月结日清重算失败：月结状态不存在 month=%s", month)
            return {"success": 0, "failed": 0, "error": "月结状态不存在"}

        surplus_unit_price = float(status_doc.get("surplus_unit_price", 0.0))

        customer_docs = self.get_customer_records(month)
        if not customer_docs:
            logger.warning("月结日清重算：month=%s 无客户月结记录", month)
            return {"success": 0, "failed": 0, "error": "无客户月结记录"}

        start_date, end_date = self._parse_month(month)
        date_keys = self._build_date_keys(start_date, end_date)

        success = 0
        failed = 0
        failed_customers: List[str] = []

        for monthly_doc in customer_docs:
            customer_name = monthly_doc.get("customer_name", "")
            try:
                self._recompute_customer_daily(
                    monthly_doc=monthly_doc,
                    date_keys=date_keys,
                    surplus_unit_price=surplus_unit_price,
                    force=force,
                )
                success += 1
            except Exception as exc:
                logger.exception(
                    "月结日清重算客户失败 month=%s customer=%s err=%s", month, customer_name, exc
                )
                failed += 1
                failed_customers.append(customer_name)

        # 更新月结状态
        now = datetime.utcnow()
        self.db[self.STATUS_COLLECTION].update_one(
            {"_id": month},
            {
                "$set": {
                    "retail_daily_recomputed": True,
                    "retail_daily_recomputed_at": now,
                    "retail_daily_recomputed_count": success,
                    "retail_daily_recomputed_failed": failed,
                }
            },
        )
        logger.info(
            "月结日清重算完成 month=%s success=%s failed=%s failed_customers=%s",
            month,
            success,
            failed,
            failed_customers,
        )
        return {"success": success, "failed": failed, "failed_customers": failed_customers}

    def _recompute_customer_daily(
        self,
        monthly_doc: Dict[str, Any],
        date_keys: List[str],
        surplus_unit_price: float,
        force: bool = True,
    ) -> None:
        """对单个客户按月重算日清月结版本，按日循环调用 _upsert_customer_monthly_daily_record。"""
        customer_id = monthly_doc.get("customer_id")
        customer_name = monthly_doc.get("customer_name", "")

        if not customer_id:
            raise ValueError(f"客户 {customer_name} 月结记录中缺少 customer_id")

        # 1. 读取月结 5 时段价格（元/kWh），来自 price_model.final_prices
        price_model = monthly_doc.get("price_model", {}) or {}
        final_prices_5: Dict[str, float] = price_model.get("final_prices", {}) or {}
        if not final_prices_5:
            raise ValueError(f"客户 {customer_name} 月结记录 price_model.final_prices 为空")

        # 提取高精度的 48 时段单价（从月结明细中反推，以保证加总后消除舍入与模型差异）
        period_details_in_doc = monthly_doc.get("period_details", [])
        final_prices_48: List[float] = []
        if period_details_in_doc and len(period_details_in_doc) == 48:
            sorted_details = sorted(period_details_in_doc, key=lambda x: x.get("period", 0))
            final_prices_48 = [float(p.get("unit_price", 0.0)) for p in sorted_details]

        # 2. 计算度电返还价差（元/kWh）
        #    分母使用 final_energy_mwh（与方案 4.2 公式一致），允许结果为 0
        final_excess_refund_fee = float(monthly_doc.get("final_excess_refund_fee", 0.0))
        final_energy_mwh = float(monthly_doc.get("final_energy_mwh", 0.0))
        refund_unit_price_kwh = (
            final_excess_refund_fee / (final_energy_mwh * 1000) if final_energy_mwh > 0 else 0.0
        )

        # 3. 批量读取客户整月每日 48 时段负荷（MP_ONLY）
        start_dt = datetime.strptime(date_keys[0], "%Y-%m-%d").date()
        end_dt = datetime.strptime(date_keys[-1], "%Y-%m-%d").date()
        customer_daily_loads = self._aggregate_customer_monthly_daily_load_values(
            customer_id=customer_id,
            start_date=start_dt,
            end_date=end_dt,
        )

        # 4. 逐日重算写库
        for date_str in date_keys:
            try:
                load_values = customer_daily_loads.get(date_str, [])
                if not load_values or sum(load_values) <= 0:
                    logger.debug(
                        "月结日清重算：客户 %s 在 %s 无负荷，跳过", customer_name, date_str
                    )
                    continue
                self._upsert_customer_monthly_daily_record(
                    customer_id=customer_id,
                    customer_name=customer_name,
                    contract_id=monthly_doc.get("contract_id", ""),
                    package_name=monthly_doc.get("package_name", ""),
                    model_code=monthly_doc.get("model_code", ""),
                    date_str=date_str,
                    load_values=load_values,
                    final_prices_5=final_prices_5,
                    final_prices_48=final_prices_48,
                    refund_unit_price_kwh=refund_unit_price_kwh,
                    surplus_unit_price=surplus_unit_price,
                    actual_monthly_volume=final_energy_mwh,
                    force=force,
                )
            except Exception as exc:
                logger.warning(
                    "月结日清重算单日失败 customer=%s date=%s err=%s", customer_name, date_str, exc
                )

    def _upsert_customer_monthly_daily_record(
        self,
        customer_id: str,
        customer_name: str,
        contract_id: str,
        package_name: str,
        model_code: str,
        date_str: str,
        load_values: List[float],
        final_prices_5: Dict[str, float],
        final_prices_48: List[float],
        refund_unit_price_kwh: float,
        surplus_unit_price: float,
        actual_monthly_volume: float = 0.0,
        force: bool = True,
    ) -> None:
        """计算并写入单客户单日月结口径日清记录（settlement_type='monthly'）。

        采购侧（元/MWh）：procure_price_p = day_wholesale_price_p + surplus_unit_price
        零售侧（元/kWh）：unit_price_p = final_prices_5[period_type_p] - refund_unit_price_kwh（允许负价）
        调平不含：仅写入当日 MP_ONLY 负荷，不包含调平电量。
        """
        collection = self.db["retail_settlement_daily"]

        if not force:
            existing = collection.find_one(
                {"customer_id": customer_id, "date": date_str, "settlement_type": "monthly"}
            )
            if existing:
                return

        # 获取当日峰谷时段（与月结计算逻辑一致，按该日实际定义）
        tou_48 = self.retail_service._get_tou_48(date_str)
        if not tou_48 or len(tou_48) != 48:
            raise ValueError(f"{date_str} 峰谷时段定义异常")

        # 获取当日 PLATFORM_DAILY 批发时段价格（元/MWh）
        try:
            wholesale_prices_48 = self.retail_service._get_wholesale_period_prices(date_str)
        except Exception as exc:
            raise ValueError(f"{date_str} 无法获取批发时段价格：{exc}") from exc

        # 逐时段计算
        period_details: List[Dict[str, Any]] = []
        tou_summary: Dict[str, Dict[str, float]] = {
            k: {"load_mwh": 0.0, "fee": 0.0} for k in DEFAULT_RATIOS
        }
        total_fee = 0.0
        total_allocated_cost = 0.0
        total_load = 0.0

        for i in range(48):
            load_mwh = float(load_values[i] if i < len(load_values) else 0.0)
            period_type_cn = tou_48[i]
            period_key = TOU_TYPE_MAP.get(period_type_cn, "flat")

            # 零售单价（元/kWh）= 月结48时段高精度价格 或 5时段价格 - 度电返还价差（允许负价）
            if final_prices_48 and len(final_prices_48) == 48:
                base_price = float(final_prices_48[i])
            else:
                base_price = float(final_prices_5.get(period_key, 0.0))
                
            unit_price_kwh = base_price - refund_unit_price_kwh
            fee = unit_price_kwh * load_mwh * 1000

            # 采购单价（元/MWh）= 当日现货时段价 + 月度资金余缺度电分摊（允许负值）
            day_wholesale_price = float(
                wholesale_prices_48[i] if i < len(wholesale_prices_48) else 0.0
            )
            procure_price_mwh = day_wholesale_price + surplus_unit_price
            allocated_cost = load_mwh * procure_price_mwh

            total_fee += fee
            total_allocated_cost += allocated_cost
            total_load += load_mwh

            tou_summary[period_key]["load_mwh"] += load_mwh
            tou_summary[period_key]["fee"] += fee

            period_details.append(
                {
                    "period": i + 1,
                    "period_type": period_type_cn,
                    "load_mwh": round(load_mwh, 6),
                    "unit_price": round(unit_price_kwh, 6),
                    "fee": round(fee, 2),
                    "wholesale_price": round(procure_price_mwh, 6),
                    "allocated_cost": round(allocated_cost, 6),
                }
            )

        avg_price = total_fee / (total_load * 1000) if total_load > 0 else 0.0
        gross_profit = total_fee - total_allocated_cost
        tou_summary_out = {
            k: {"load_mwh": round(v["load_mwh"], 6), "fee": round(v["fee"], 2)}
            for k, v in tou_summary.items()
        }

        now = datetime.utcnow()
        doc = {
            "customer_id": customer_id,
            "customer_name": customer_name,
            "date": date_str,
            "contract_id": contract_id,
            "package_name": package_name,
            "model_code": model_code,
            "settlement_type": "monthly",
            "actual_monthly_volume": round(actual_monthly_volume, 6),
            "period_details": period_details,
            "tou_summary": tou_summary_out,
            "total_load_mwh": round(total_load, 6),
            "total_fee": round(total_fee, 2),
            "avg_price": round(avg_price, 6),
            "total_allocated_cost": round(total_allocated_cost, 6),
            "gross_profit": round(gross_profit, 2),
            "updated_at": now,
        }

        collection.update_one(
            {"customer_id": customer_id, "date": date_str, "settlement_type": "monthly"},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

    def _upsert_status(self, doc: Dict) -> None:
        existing = self.db[self.STATUS_COLLECTION].find_one({"_id": doc["_id"]})
        if existing:
            doc["created_at"] = existing.get("created_at", doc["created_at"])
        self.db[self.STATUS_COLLECTION].update_one(
            {"_id": doc["_id"]},
            {"$set": doc},
            upsert=True,
        )
