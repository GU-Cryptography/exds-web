# -*- coding: utf-8 -*-
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field

from webapp.services.retail_monthly_settlement_service import RetailMonthlySettlementService
from webapp.services.retail_settlement_service import RetailSettlementService

router = APIRouter(prefix="/retail-settlement", tags=["Retail Settlement"])

service = RetailSettlementService()
monthly_service = RetailMonthlySettlementService()


class RetailCalculationRequest(BaseModel):
    date: str = Field(..., description="结算日期 YYYY-MM-DD")
    force: bool = Field(False, description="是否强制重算")


class MonthlyCalcRequest(BaseModel):
    month: str = Field(..., description="结算月份 YYYY-MM")
    force: bool = Field(False, description="是否强制重新计算")


class ResponseModel(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None


@router.post("/calculate", response_model=ResponseModel)
def calculate_retail_settlement(req: RetailCalculationRequest):
    try:
        datetime.strptime(req.date, "%Y-%m-%d")
        result = service.calculate_all_customers_daily(req.date, force=req.force)
        if not result or (result.get("failed", 0) > 0 and result.get("success", 0) == 0):
            return ResponseModel(code=400, message="Calculation failed or no data found", data=result)
        return ResponseModel(code=200, message="Calculation completed", data=result)
    except ValueError as exc:
        return ResponseModel(code=400, message=f"Invalid date format: {exc}", data=None)
    except Exception as exc:
        return ResponseModel(code=500, message=f"Internal Error: {exc}", data=None)


@router.get("/daily", response_model=ResponseModel)
def get_retail_daily_settlement(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    customer_id: Optional[str] = None,
    include_details: bool = False,
):
    try:
        query = {"date": {"$gte": start_date, "$lte": end_date}}
        if customer_id:
            query["customer_id"] = customer_id

        projection = None if include_details else {"period_details": 0}
        cursor = service.db["retail_settlement_daily"].find(query, projection).sort("date", 1)

        results = []
        for doc in cursor:
            if "_id" in doc:
                doc["_id"] = str(doc["_id"])
            results.append(doc)

        return ResponseModel(code=200, data=results)
    except Exception as exc:
        return ResponseModel(code=500, message=str(exc), data=[])


@router.post("/monthly-calc", response_model=ResponseModel)
def trigger_monthly_calc(req: MonthlyCalcRequest, background_tasks: BackgroundTasks):
    try:
        datetime.strptime(req.month, "%Y-%m")
    except ValueError:
        return ResponseModel(code=400, message="月份格式错误，需 YYYY-MM", data=None)

    ready, reason = monthly_service.validate_month_ready(req.month, allow_fallback=req.force)
    if not ready:
        return ResponseModel(code=400, message=reason, data=None)

    job_id = monthly_service.initialize_job(req.month, force=req.force)
    background_tasks.add_task(monthly_service.run_monthly_settlement, req.month, job_id, req.force)
    return ResponseModel(data={"job_id": job_id})


@router.get("/monthly-progress/{job_id}", response_model=ResponseModel)
def get_monthly_progress(job_id: str):
    job = monthly_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="未找到结算任务")
    job["job_id"] = job.pop("_id")
    return ResponseModel(data=job)


@router.get("/monthly-status", response_model=ResponseModel)
def get_monthly_status(month: str = Query(..., regex=r"^\d{4}-\d{2}$")):
    status = monthly_service.get_month_status(month)
    if not status:
        return ResponseModel(code=404, message="尚未生成月度状态", data=None)
    return ResponseModel(data=status)


@router.get("/monthly-summaries", response_model=ResponseModel)
def get_monthly_summaries(year: Optional[str] = Query(None, regex=r"^\d{4}$")):
    summaries = monthly_service.list_monthly_summaries(year)
    return ResponseModel(data={"summaries": summaries})


@router.get("/monthly-customers", response_model=ResponseModel)
def get_monthly_customers(month: str = Query(..., regex=r"^\d{4}-\d{2}$")):
    records = monthly_service.get_customer_records(month)
    for rec in records:
        rec["_id"] = str(rec["_id"])
    return ResponseModel(data=records)
