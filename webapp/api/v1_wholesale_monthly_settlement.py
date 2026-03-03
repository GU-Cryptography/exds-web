import logging
from typing import Any, Dict

from bson import json_util
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from webapp.services.wholesale_monthly_settlement_service import (
    WholesaleMonthlySettlementService,
)
from webapp.tools.security import User, get_current_active_user

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/wholesale-monthly-settlement",
    tags=["批发月度结算"],
)

service = WholesaleMonthlySettlementService()


class ImportResult(BaseModel):
    month: str
    overwritten: bool


class ImportResponse(BaseModel):
    status: str = "success"
    data: ImportResult


@router.get("/years", summary="获取批发月度结算年份列表")
def get_years() -> Dict[str, Any]:
    try:
        years = service.list_years()
        return {"years": years}
    except Exception as exc:
        logger.error("get_years failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/year/{year}", summary="获取指定年份12个月月结数据")
def get_year_data(
    year: int,
) -> Dict[str, Any]:
    try:
        if year < 2000 or year > 2100:
            raise HTTPException(status_code=400, detail="年份不合法")
        rows = service.get_year_rows(year)
        return {"year": year, "rows": json_util.loads(json_util.dumps(rows))}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_year_data failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{month}", summary="获取指定月份批发月度结算数据")
def get_month_detail(month: str) -> Dict[str, Any]:
    try:
        doc = service.get_month_detail(month)
        if not doc:
            raise HTTPException(status_code=404, detail=f"月份 {month} 数据不存在")
        return json_util.loads(json_util.dumps(doc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_month_detail failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/import", response_model=ImportResponse, summary="导入批发月度结算Excel")
async def import_monthly_settlement(
    file: UploadFile = File(...),
    overwrite: bool = Query(False, description="是否覆盖同月已有数据"),
    current_user: User = Depends(get_current_active_user),
) -> ImportResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名为空")
    if not file.filename.lower().endswith((".xls", ".xlsx")):
        raise HTTPException(status_code=400, detail="仅支持 .xls/.xlsx 文件")

    try:
        content = await file.read()
        result = service.import_excel(
            file_content=content,
            file_name=file.filename,
            imported_by=current_user.username,
            overwrite=overwrite,
        )
        return ImportResponse(data=ImportResult(**result))
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "requires_confirm": True,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("import_monthly_settlement failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{month}/reconciliation", summary="获取指定月份月结与日清聚合对账")
def get_reconciliation(month: str) -> Dict[str, Any]:
    try:
        data = service.get_reconciliation(month)
        return json_util.loads(json_util.dumps(data))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error("get_reconciliation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
