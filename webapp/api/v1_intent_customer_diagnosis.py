import json
import logging
from typing import List

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile, status

from webapp.models.intent_customer_diagnosis import (
    DeleteIntentCustomerRequest,
    ImportMeterConfig,
    ImportResult,
    IntentCustomerListResponse,
    LoadSummaryResponse,
    PreviewResponse,
)
from webapp.services.intent_customer_diagnosis_service import IntentCustomerDiagnosisService
from webapp.tools.mongo import DATABASE as db_instance
from webapp.tools.security import (
    User,
    get_current_active_user,
    get_user,
    verify_password,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intent-customer-diagnosis", tags=["intent-customer-diagnosis"])


@router.get("/customers", response_model=IntentCustomerListResponse, summary="获取意向客户列表")
async def list_intent_customers(
    current_user: User = Depends(get_current_active_user),
):
    del current_user
    service = IntentCustomerDiagnosisService()
    return service.list_customers()


@router.post("/preview", response_model=PreviewResponse, summary="预解析意向客户电表文件")
async def preview_intent_customer_files(
    files: List[UploadFile] = File(..., description="电表数据文件"),
    current_user: User = Depends(get_current_active_user),
):
    del current_user
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少上传一个文件")

    service = IntentCustomerDiagnosisService()
    file_payloads = [(file.filename or "unknown.xlsx", await file.read()) for file in files]
    return service.preview_files(file_payloads)


@router.post("/import", response_model=ImportResult, summary="导入并聚合意向客户电表数据")
async def import_intent_customer_files(
    meter_configs_json: str = Form(..., description="倍率配置JSON"),
    files: List[UploadFile] = File(..., description="电表数据文件"),
    current_user: User = Depends(get_current_active_user),
):
    del current_user
    try:
        raw_configs = json.loads(meter_configs_json)
        meter_configs = [ImportMeterConfig(**item).model_dump() for item in raw_configs]
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"倍率配置格式错误: {exc}") from exc

    service = IntentCustomerDiagnosisService()
    try:
        file_payloads = [(file.filename or "unknown.xlsx", await file.read()) for file in files]
        return service.import_customer_data(
            files=file_payloads,
            meter_configs=meter_configs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("意向客户导入失败: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="导入失败") from exc


@router.get(
    "/customers/{customer_id}/load-data",
    response_model=LoadSummaryResponse,
    summary="获取意向客户负荷数据",
)
async def get_intent_customer_load_data(
    customer_id: str,
    month: str,
    date: str,
    current_user: User = Depends(get_current_active_user),
):
    del current_user
    service = IntentCustomerDiagnosisService()
    try:
        return service.get_customer_load_data(customer_id=customer_id, month=month, date=date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete("/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除意向客户")
async def delete_intent_customer(
    customer_id: str,
    payload: DeleteIntentCustomerRequest = Body(...),
    current_user: User = Depends(get_current_active_user),
):
    user_in_db = get_user(db_instance, current_user.username)
    if not user_in_db or not verify_password(payload.password, user_in_db.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码验证失败")

    service = IntentCustomerDiagnosisService()
    try:
        service.delete_customer(customer_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return None
