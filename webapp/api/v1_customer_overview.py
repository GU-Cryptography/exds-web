# -*- coding: utf-8 -*-
"""
客户负荷总览 API 路由
提供客户总览页面的数据接口
"""

from typing import Optional, Literal
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel

from webapp.tools.security import User
from webapp.api.v1 import get_current_active_user
from webapp.services.customer_overview_service import CustomerOverviewService
from webapp.tools.mongo import DATABASE

router = APIRouter()
overview_service = CustomerOverviewService(DATABASE)


# ---- Response Models ----

class TouUsageResponse(BaseModel):
    tip: float = 0.0
    peak: float = 0.0
    flat: float = 0.0
    valley: float = 0.0
    deep: float = 0.0


class KpiResponse(BaseModel):
    signed_customers_count: int
    signed_total_quantity: float
    signed_quantity_yoy: Optional[float] = None
    actual_total_usage: float
    actual_usage_yoy: Optional[float] = None
    avg_peak_valley_ratio: float
    tou_breakdown: TouUsageResponse


class ContributionItem(BaseModel):
    customer_id: str
    short_name: str
    usage: float
    percentage: float


class ContributionOthers(BaseModel):
    usage: float
    percentage: float


class ContributionResponse(BaseModel):
    top5: list[ContributionItem]
    others: ContributionOthers
    total: float


class GrowthItem(BaseModel):
    customer_id: str
    short_name: str
    change: float
    yoy_pct: Optional[float] = None


class GrowthRankingResponse(BaseModel):
    growth_top5: list[GrowthItem]
    decline_top5: list[GrowthItem]


class EfficiencyItem(BaseModel):
    customer_id: str
    short_name: str
    pv_ratio: float


class EfficiencyRankingResponse(BaseModel):
    high_pv_ratio: list[EfficiencyItem]
    low_pv_ratio: list[EfficiencyItem]


class CustomerListItem(BaseModel):
    customer_id: str
    customer_name: str
    short_name: str
    signed_quantity: float
    signed_yoy: Optional[float] = None
    signed_yoy_warning: bool = False
    actual_usage: float
    actual_yoy: Optional[float] = None
    peak_valley_ratio: float
    tou_breakdown: TouUsageResponse
    contract_start_month: int
    contract_end_month: int


class CustomerListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CustomerListItem]


# ---- Endpoints ----

@router.get("/overview/kpi", response_model=KpiResponse)
async def get_overview_kpi(
    year: int = Query(2026, ge=2026, le=2026, description="年份（仅支持2026）"),
    month: int = Query(..., ge=1, le=12, description="月份"),
    view_mode: Literal["monthly", "ytd"] = Query("monthly", description="视图模式"),
    current_user: User = Depends(get_current_active_user)
):
    """
    获取KPI卡片数据
    
    - **year**: 年份（当前仅支持2026）
    - **month**: 月份（1-12）
    - **view_mode**: 视图模式，monthly=月度视图，ytd=年累计视图
    """
    try:
        result = overview_service.get_overview_kpi(year, month, view_mode)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/overview/contribution", response_model=ContributionResponse)
async def get_contribution_chart(
    year: int = Query(2026, ge=2026, le=2026),
    month: int = Query(..., ge=1, le=12),
    view_mode: Literal["monthly", "ytd"] = Query("monthly"),
    current_user: User = Depends(get_current_active_user)
):
    """获取电量贡献构成图表数据"""
    try:
        result = overview_service.get_contribution_chart(year, month, view_mode)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/overview/growth-ranking", response_model=GrowthRankingResponse)
async def get_growth_ranking(
    year: int = Query(2026, ge=2026, le=2026),
    month: int = Query(..., ge=1, le=12),
    view_mode: Literal["monthly", "ytd"] = Query("monthly"),
    current_user: User = Depends(get_current_active_user)
):
    """获取涨跌龙虎榜数据"""
    try:
        result = overview_service.get_growth_ranking(year, month, view_mode)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/overview/efficiency-ranking", response_model=EfficiencyRankingResponse)
async def get_efficiency_ranking(
    year: int = Query(2026, ge=2026, le=2026),
    month: int = Query(..., ge=1, le=12),
    view_mode: Literal["monthly", "ytd"] = Query("monthly"),
    current_user: User = Depends(get_current_active_user)
):
    """获取峰谷比极值榜数据"""
    try:
        result = overview_service.get_efficiency_ranking(year, month, view_mode)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/overview/customers", response_model=CustomerListResponse)
async def get_customer_list(
    year: int = Query(2026, ge=2026, le=2026),
    month: int = Query(..., ge=1, le=12),
    view_mode: Literal["monthly", "ytd"] = Query("monthly"),
    search: Optional[str] = Query(None, description="搜索关键词"),
    sort_field: str = Query("signed_quantity", description="排序字段"),
    sort_order: Literal["asc", "desc"] = Query("desc", description="排序方向"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=-1, description="每页条数(-1表示获取全部)"),
    current_user: User = Depends(get_current_active_user)
):
    """获取客户资产明细列表"""
    try:
        result = overview_service.get_customer_list(
            year=year,
            month=month,
            view_mode=view_mode,
            search=search,
            sort_field=sort_field,
            sort_order=sort_order,
            page=page,
            page_size=page_size
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
