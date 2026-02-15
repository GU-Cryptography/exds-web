from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel

from webapp.tools.mongo import DATABASE
from webapp.services.medium_term_load_forecast import MediumTermForecastService
from webapp.tools.security import User, get_current_active_user

router = APIRouter()

class ForecastExecutionResponse(BaseModel):
    taskId: str
    status: str
    message: str

class VerificationResponse(BaseModel):
    target_date: str
    updated_records: int
    avg_wmape: float
    actual_load: float

@router.post("/execute", response_model=ForecastExecutionResponse, summary="手动触发中长期预测")
async def execute_forecast(
    background_tasks: BackgroundTasks,
    forecast_date: Optional[str] = Query(None, description="预测基准日期 YYYY-MM-DD"),
    current_user: User = Depends(get_current_active_user)
):
    """
    触发一次完整的中长期预测任务 (异步执行)
    """
    service = MediumTermForecastService()
    
    # 因为预测可能耗时较长 (30天 * 1000户)，建议放入 BackgroundTasks 或 Celery
    # 这里使用 FastAPI BackgroundTasks 简化实现
    
    def _run_task(f_date, operator):
        try:
            service.execute_forecast(f_date, operator)
        except Exception as e:
            print(f"Forecast Task Failed: {e}") # Replace with logger

    background_tasks.add_task(_run_task, forecast_date, current_user.username)
    
    return ForecastExecutionResponse(
        taskId="async-task-submitted", 
        status="PENDING", 
        message="Forecast task has been submitted to background."
    )

@router.post("/verify", response_model=VerificationResponse, summary="手动触发准确率回溯")
async def verify_accuracy(
    target_date: Optional[str] = Query(None, description="回溯目标日期 YYYY-MM-DD (默认昨日)"),
    current_user: User = Depends(get_current_active_user)
):
    """
    计算指定日期的 WMAPE 并更新历史记录
    """
    service = MediumTermForecastService()
    
    if not target_date:
        from datetime import datetime, timedelta
        target_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        
    result = service.verify_accuracy(target_date)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
        
    return VerificationResponse(**result)

@router.get("/", summary="获取最新的中长期预测结果")
async def get_latest_result(
    current_user: User = Depends(get_current_active_user)
):
    """
    获取最近一次发布的负荷预测结果
    """
    # Simple implementation: Sort by forecast_date desc, limit 1
    collection = DATABASE['medium_term_load_forecast']
    doc = collection.find_one({}, sort=[("created_at", -1)])
    
    if not doc:
        return None
        
    # Convert _id to str
    doc["id"] = str(doc.pop("_id"))
    return doc
