# -*- coding: utf-8 -*-
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Union

class TouUsage(BaseModel):
    """分时电量细项"""
    tip: float = 0.0
    peak: float = 0.0
    flat: float = 0.0
    valley: float = 0.0
    deep: float = 0.0

class DailyCurve(BaseModel):
    """单日48/96点负荷数据"""
    date: str
    values: List[float] = Field(default_factory=list)
    total: float
    tou_usage: Optional[TouUsage] = None

class DailyTotal(BaseModel):
    """单日电量数据（无曲线）"""
    date: str
    total: float
    tou_usage: Optional[TouUsage] = None

class MonthlyTotal(BaseModel):
    """月度电量数据"""
    month: str     # YYYY-MM
    total: float
    days_count: int
    tou_usage: Optional[TouUsage] = None

class CustomerLoadData(BaseModel):
    """通用客户数据容器"""
    customer_id: str
    curves: Optional[List[DailyCurve]] = None
    daily_totals: Optional[List[DailyTotal]] = None
    monthly_totals: Optional[List[MonthlyTotal]] = None
