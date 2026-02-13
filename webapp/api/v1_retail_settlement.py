# -*- coding: utf-8 -*-
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from datetime import datetime

from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.models.retail_settlement import RetailSettlementDaily

router = APIRouter(prefix="/retail-settlement", tags=["Retail Settlement"])

service = RetailSettlementService()

class RetailCalculationRequest(BaseModel):
    date: str = Field(..., description="结算日期 YYYY-MM-DD")
    force: bool = Field(False, description="是否强制重算")

class ResponseModel(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None

@router.post("/calculate", response_model=ResponseModel)
def calculate_retail_settlement(req: RetailCalculationRequest):
    """
    触发指定日期的零售侧全量核算
    """
    try:
        # 校验日期格式
        datetime.strptime(req.date, "%Y-%m-%d")
        
        result = service.calculate_all_customers_daily(req.date, force=req.force)
        
        if not result or result.get("failed", 0) > 0 and result.get("success", 0) == 0:
             return ResponseModel(code=400, message="Calculation failed or no data found", data=result)
            
        return ResponseModel(code=200, message="Calculation completed", data=result)
        
    except ValueError as ve:
        return ResponseModel(code=400, message=f"Invalid date format: {ve}", data=None)
    except Exception as e:
        return ResponseModel(code=500, message=f"Internal Error: {str(e)}", data=None)

@router.get("/daily", response_model=ResponseModel)
def get_retail_daily_settlement(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    customer_id: Optional[str] = None,
    include_details: bool = False
):
    """
    获取零售侧结算数据
    """
    try:
        query = {
            "date": {"$gte": start_date, "$lte": end_date}
        }
        if customer_id:
            query["customer_id"] = customer_id
        
        # 默认不返回明细以提升性能
        projection = None
        if not include_details:
            projection = {"period_details": 0}
            
        cursor = service.db["retail_settlement_daily"].find(query, projection).sort("date", 1)
        
        results = []
        for doc in cursor:
            # 兼容处理 ID
            if "_id" in doc:
                doc["_id"] = str(doc["_id"])
            results.append(doc)

        return ResponseModel(code=200, data=results)

    except Exception as e:
        return ResponseModel(code=500, message=str(e), data=[])
