# -*- coding: utf-8 -*-
"""零售月度结算服务。"""

import calendar
import logging
import re
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

EXCESS_PROFIT_THRESHOLD_PER_MWH = 10.0


class RetailMonthlySettlementService:
    STATUS_COLLECTION = "retail_settlement_monthly_status"
    CUSTOMER_COLLECTION = "customer_retail_monthly_settlement"
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

    def validate_month_ready(self, month: str) -> Tuple[bool, str]:
        energy_doc = self.db["customer_monthly_energy"].find_one({"_id": month}, {"records": 1})
        if not energy_doc:
            return False, f"{month} 缺少客户月度电量记录"
        if len(energy_doc.get("records", [])) == 0:
            return False, f"{month} 客户月度电量记录为空"

        wholesale_doc = self.db["wholesale_settlement_monthly"].find_one({"_id": month}, {"_id": 1})
        if not wholesale_doc:
            return False, f"{month} 批发月度结算未执行"

        return True, ""

    def list_monthly_summaries(self, year: Optional[str] = None) -> List[Dict]:
        query: Dict = {}
        if year:
            query["_id"] = {"$regex": f"^{year}-"}

        customer_docs = list(
            self.db["customer_monthly_energy"]
            .find(query, {"_id": 1, "imported_at": 1, "records": 1})
            .sort("_id", 1)  # 升序，1月在前
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
            # 月度总电量：求 customer_monthly_energy 中所有 records energy_mwh 合计
            total_energy_mwh = round(sum(float(r.get("energy_mwh") or 0.0) for r in doc.get("records", [])), 6)

            # 结算汇总计算（需有 status 才有意义）
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
                    "wholesale_avg_price": round(wholesale_avg_price, 6)
                    if wholesale_avg_price is not None
                    else None,
                    "wholesale_total_cost": round(wholesale_total_cost, 2)
                    if wholesale_total_cost is not None
                    else None,
                    "total_energy_mwh": total_energy_mwh,
                    "price_margin_per_mwh": round(price_margin_per_mwh, 6)
                    if price_margin_per_mwh is not None
                    else None,
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
        except ValueError as exc:
            self._set_job_failed(job_id, str(exc))
            return

        ready, reason = self.validate_month_ready(month)
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
                "message": "步骤1/2：正在执行客户月度正式日清重算",
            },
            initialize=False,
        )

        base_entries: List[Dict] = []
        processed = 0
        success = 0
        failed = 0
        daily_energy_total = 0.0

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
                    "message": "步骤1/2：正在执行客户月度正式日清重算",
                },
                initialize=False,
            )

            try:
                self._recompute_customer_monthly_daily(customer_ids, start_date, end_date, force)
                daily_energy, retail_fee = self._aggregate_monthly_daily(customer_ids, customer_name, start_date, end_date)
                entry = self._build_base_customer_entry(group, customer_ids, daily_energy, retail_fee)
                base_entries.append(entry)
                daily_energy_total += entry["daily_energy_mwh"]
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
                "message": "步骤2/2：正在计算超额返还并更新客户月度结算",
                "progress": 80,
            },
            initialize=False,
        )

        status_doc = self._build_month_status(month, base_entries, daily_energy_total, force)
        self._upsert_status(status_doc)

        # 第一步：先落地不含返还的客户月度结算记录
        self._persist_base_customer_entries(month, base_entries, status_doc)

        # 第二步：基于全量客户参数计算返还后，再回写每个客户返还字段
        self._apply_refund_to_customer_entries(month, base_entries, status_doc)

        self._update_job(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "success_count": success,
                "failed_count": failed,
                "processed_customers": processed,
                "current_customer": "",
                "message": f"完成 {success} 个客户月度结算",
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
        """按客户名称优先查找 customer_id，作为主要匹配方式。
        customer_monthly_energy.customer_no 格式存在浮点后缀问题（如 3600188726280.0），
        直接按名称查找 customer_archives 最可靠。"""
        # 1. 先按名称精确查找
        candidate = self.db.customer_archives.find_one(
            {"user_name": customer_name},
            {"_id": 1},
        )
        if candidate:
            return [str(candidate["_id"])]

        # 2. 名称未命中，逐个 customer_no 清理格式后匹配（去除浮点 .0 后缀）
        ids: List[str] = []
        for no in customer_nos:
            # customer_monthly_energy 中可能存 "3600188726280.0"，档案中是 "3600188726280"
            clean_no = no.rstrip('0').rstrip('.') if '.' in no else no
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
                customer_name, customer_nos
            )
        return ids

    def _recompute_customer_monthly_daily(
        self, customer_ids: List[str], start_date: date, end_date: date, force: bool
    ) -> None:
        for customer_id in customer_ids:
            current = start_date
            while current <= end_date:
                self.retail_service.calculate_customer_daily(
                    customer_id=customer_id,
                    date_str=current.strftime("%Y-%m-%d"),
                    force=force,
                    settlement_type="monthly",
                )
                current += timedelta(days=1)

    def _aggregate_monthly_daily(
        self, customer_ids: List[str], customer_name: str, start_date: date, end_date: date
    ) -> Tuple[float, float]:
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        query: Dict = {
            "settlement_type": "monthly",
            "date": {"$gte": start_str, "$lte": end_str},
        }
        if customer_ids:
            query["customer_id"] = {"$in": customer_ids}
        else:
            query["customer_name"] = customer_name

        cursor = self.db["retail_settlement_daily"].find(query, {"total_load_mwh": 1, "total_fee": 1})
        energy = 0.0
        fee = 0.0
        for doc in cursor:
            energy += float(doc.get("total_load_mwh") or 0.0)
            fee += float(doc.get("total_fee") or 0.0)
        return energy, fee

    def _build_base_customer_entry(
        self, group: Dict, customer_ids: List[str], daily_energy: float, retail_fee: float
    ) -> Dict:
        customer_name = group["customer_name"]
        monthly_energy = float(group.get("monthly_energy_mwh") or 0.0)
        retail_avg_price = retail_fee / (daily_energy * 1000) if daily_energy > 0 else 0.0
        balancing_energy = monthly_energy - daily_energy
        balancing_fee = balancing_energy * retail_avg_price * 1000
        total_energy = daily_energy + balancing_energy
        # retail_total_fee = 日清电费 + 调平电费（零售电费，未扣返还）
        retail_total_fee = retail_fee + balancing_fee
        # total_fee_before_refund 与 retail_total_fee 相同，待返还回写时 total_fee 会被更新
        total_fee_before_refund = retail_total_fee
        settlement_avg_price = total_fee_before_refund / (total_energy * 1000) if total_energy > 0 else 0.0

        primary_customer_id = customer_ids[0] if customer_ids else None

        return {
            "customer_id": primary_customer_id,
            "customer_name": customer_name,
            "daily_energy_mwh": round(daily_energy, 6),
            "retail_fee": round(retail_fee, 2),
            "retail_avg_price": round(retail_avg_price, 6),
            "balancing_energy_mwh": round(balancing_energy, 6),
            "balancing_fee": round(balancing_fee, 2),
            "balancing_avg_price": round(retail_avg_price, 6),
            "total_energy_mwh": round(total_energy, 6),
            "retail_total_fee": round(retail_total_fee, 2),
            "total_fee_before_refund": round(total_fee_before_refund, 2),
            "settlement_avg_price": round(settlement_avg_price, 6),
        }

    def _build_month_status(self, month: str, entries: List[Dict], daily_energy_total: float, force: bool) -> Dict:
        wholesale_doc = self.db["wholesale_settlement_monthly"].find_one({"_id": month})
        wholesale_avg_price = float(
            wholesale_doc.get("settlement_items", {}).get("settlement_avg_price") if wholesale_doc else 0.0
        )

        # 月度状态与客户月度结算记录保持同口径：
        # 电量取 total_energy_mwh（日清+调平），费用取 retail_total_fee（日清+调平，未扣返还）
        retail_total_energy = sum(entry["total_energy_mwh"] for entry in entries)
        retail_total_fee = sum(entry["retail_total_fee"] for entry in entries)
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
            "retail_daily_recomputed": True,
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
            payload = {
                "month": month,
                "customer_id": entry["customer_id"],
                "customer_name": entry["customer_name"],
                "daily_energy_mwh": entry["daily_energy_mwh"],
                "retail_fee": entry["retail_fee"],
                "retail_avg_price": entry["retail_avg_price"],
                "balancing_energy_mwh": entry["balancing_energy_mwh"],
                "balancing_fee": entry["balancing_fee"],
                "balancing_avg_price": entry["balancing_avg_price"],
                "total_energy_mwh": entry["total_energy_mwh"],
                # retail_total_fee = 日清电费 + 调平电费（零售电费，不含返还扣减，字段固化不会被回写覆盖）
                "retail_total_fee": entry["retail_total_fee"],
                # total_fee 初始等于 retail_total_fee，阶段2返还回写后变为结算电费
                "total_fee": entry["total_fee_before_refund"],
                "wholesale_avg_price": status_doc["wholesale_avg_price"],
                "excess_refund_fee": 0.0,
                "excess_refund_unit_price": 0.0,
                "excess_refund_ratio": 0.0,
                "settlement_avg_price": entry["settlement_avg_price"],
                "refund_allocated_at": None,
                "updated_at": now,
            }
            collection.update_one(
                {"_id": doc_id},
                {"$set": payload, "$setOnInsert": {"created_at": now}},
                upsert=True,
            )

    def _apply_refund_to_customer_entries(self, month: str, entries: List[Dict], status_doc: Dict) -> None:
        collection = self.db[self.CUSTOMER_COLLECTION]
        total_energy_for_ratio = sum(entry["total_energy_mwh"] for entry in entries)
        if total_energy_for_ratio <= 0:
            return

        # 使用状态表已确定的返还池，避免重复计算带来的口径/精度偏差
        refund_pool = float(status_doc.get("excess_refund_pool") or 0.0)
        now = datetime.utcnow()

        for entry in entries:
            ratio = entry["total_energy_mwh"] / total_energy_for_ratio if total_energy_for_ratio > 0 else 0.0
            refund_amount = refund_pool * ratio
            refund_unit_price = refund_amount / entry["total_energy_mwh"] if entry["total_energy_mwh"] > 0 else 0.0
            settlement_fee = round(entry["total_fee_before_refund"] - refund_amount, 2)
            # 结算均价：扣返还后的结算电费 / 总电量
            settlement_avg_price = settlement_fee / (entry["total_energy_mwh"] * 1000) if entry["total_energy_mwh"] > 0 else 0.0

            doc_id = self._build_customer_doc_id(month, entry["customer_name"])
            collection.update_one(
                {"_id": doc_id},
                {
                    "$set": {
                        "total_fee": settlement_fee,
                        "excess_refund_fee": round(refund_amount, 2),
                        "excess_refund_unit_price": round(refund_unit_price, 6),
                        "excess_refund_ratio": round(ratio, 6),
                        "settlement_avg_price": round(settlement_avg_price, 6),
                        "refund_allocated_at": now,
                        "updated_at": now,
                    }
                },
            )

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

    def _resolve_customer(self, customer_no: str, fallback_name: str) -> Tuple[Optional[str], str]:
        """按 account_id 查找（自动清理浮点 .0 后缀）。已被 _resolve_customer_ids 弃用，保留兼容。"""
        if not customer_no:
            return None, fallback_name

        # 清理浮点后缀："3600188726280.0" -> "3600188726280"
        clean_no = customer_no.rstrip('0').rstrip('.') if '.' in customer_no else customer_no

        for no in {customer_no, clean_no}:
            candidate = self.db.customer_archives.find_one(
                {"accounts.account_id": no},
                {"_id": 1, "user_name": 1},
            )
            if candidate:
                return str(candidate["_id"]), candidate.get("user_name") or fallback_name
        return None, fallback_name

    def _serialize_status(self, doc: Optional[Dict]) -> Optional[Dict]:
        if not doc:
            return None
        payload = doc.copy()
        for field in ("created_at", "updated_at"):
            if isinstance(payload.get(field), datetime):
                payload[field] = payload[field].isoformat()
        return payload

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

    def _upsert_status(self, doc: Dict) -> None:
        existing = self.db[self.STATUS_COLLECTION].find_one({"_id": doc["_id"]})
        if existing:
            doc["created_at"] = existing.get("created_at", doc["created_at"])
        self.db[self.STATUS_COLLECTION].update_one(
            {"_id": doc["_id"]},
            {"$set": doc},
            upsert=True,
        )
