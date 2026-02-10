from fastapi import APIRouter, Query, HTTPException, Depends
from typing import List, Dict, Any, Optional
from webapp.tools.mongo import DATABASE
from webapp.services.load_forecast_service import LoadForecastService
from webapp.tools.security import get_current_active_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/load-forecast", tags=["Load Forecast"])

def get_service():
    return LoadForecastService(DATABASE)

@router.get("/versions", summary="获取预测版本列表")
def get_versions(
    target_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
    service: LoadForecastService = Depends(get_service),
    current_user: Any = Depends(get_current_active_user)
):
    return service.get_versions(target_date)

@router.get("/data", summary="获取预测数据")
def get_forecast_data(
    target_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
    forecast_date: str = Query(..., description="发布日期 YYYY-MM-DD"),
    customer_id: str = Query("AGGREGATE", description="客户ID"),
    service: LoadForecastService = Depends(get_service),
    current_user: Any = Depends(get_current_active_user)
):
    data = service.get_forecast_data(target_date, forecast_date, customer_id)
    if not data:
        raise HTTPException(status_code=404, detail="未找到预测数据")
    return data

@router.get("/customers", summary="获取签约客户预测列表")
def get_customer_list(
    target_date: str = Query(..., description="目标日期 YYYY-MM-DD"),
    forecast_date: str = Query(..., description="发布日期 YYYY-MM-DD"),
    service: LoadForecastService = Depends(get_service),
    current_user: Any = Depends(get_current_active_user)
):
    return service.get_customer_list(target_date, forecast_date)
@router.get("/performance-overview", summary="获取负荷预测概览指标")
def get_performance_overview(
    customer_id: str = Query("AGGREGATE", description="客户ID"),
    gap: Optional[int] = Query(None, description="提前天数(Gap)"),
    service: LoadForecastService = Depends(get_service),
    current_user: Any = Depends(get_current_active_user)
):
    return service.get_performance_overview(customer_id, gap)
