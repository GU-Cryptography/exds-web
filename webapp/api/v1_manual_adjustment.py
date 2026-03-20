from fastapi import APIRouter, HTTPException, Depends, Body
from typing import List, Dict, Any
from pydantic import BaseModel, Field, validator
from webapp.tools.mongo import DATABASE
from webapp.services.load_forecast_service import LoadForecastService
from webapp.tools.security import get_current_active_user
from webapp.api.dependencies.authz import require_permission
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/manual-adjustment", tags=["Manual Adjustment"])

def get_service():
    return LoadForecastService(DATABASE)

class SaveAdjustmentRequest(BaseModel):
    target_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    forecast_date: str = Field(..., description="发布日期 YYYY-MM-DD")
    customer_id: str = Field(..., description="客户ID")
    values: List[float] = Field(..., description="调整后的48点预测值")

    @validator('values')
    def validate_values_length(cls, v):
        if len(v) != 48:
            raise ValueError('values must contain exactly 48 items')
        return v

class ResetAdjustmentRequest(BaseModel):
    target_date: str = Field(..., description="目标日期 YYYY-MM-DD")
    forecast_date: str = Field(..., description="发布日期 YYYY-MM-DD")
    customer_id: str = Field(..., description="客户ID")

@router.post("/save", summary="保存手工调整")
def save_manual_adjustment(
    request: SaveAdjustmentRequest,
    service: LoadForecastService = Depends(get_service),
    current_user: Any = Depends(get_current_active_user),
    _ctx = Depends(require_permission("forecast:adjust:update"))
):
    user_info = {
        "username": current_user.username if hasattr(current_user, "username") else str(current_user),
        # Add other user info if available
    }
    
    success = service.save_manual_adjustment(
        request.target_date,
        request.forecast_date,
        request.customer_id,
        request.values,
        user_info
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Save failed. check if record exists.")
    
    return {"status": "success", "message": "Manual adjustment saved and aggregation triggered."}

@router.post("/reset", summary="重置手工调整")
def reset_manual_adjustment(
    request: ResetAdjustmentRequest,
    service: LoadForecastService = Depends(get_service),
    current_user: Any = Depends(get_current_active_user),
    _ctx = Depends(require_permission("forecast:adjust:update"))
):
    user_info = {
        "username": current_user.username if hasattr(current_user, "username") else str(current_user)
    }
    
    success = service.reset_manual_adjustment(
        request.target_date,
        request.forecast_date,
        request.customer_id,
        user_info
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Reset failed. Check if record exists or was modified.")
    
    return {"status": "success", "message": "Manual adjustment reset."}
