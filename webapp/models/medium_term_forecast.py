from typing import List, Optional, Dict
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from bson import ObjectId
from .characteristic_models import BaseMongoModel

class KeyCustomerBreakdownItem(BaseModel):
    name: str = Field(..., description="客户名称")
    value: float = Field(..., description="预测电量")

class DailyForecastItem(BaseModel):
    """每日预测明细"""
    target_date: str = Field(..., description="预测目标日期 YYYY-MM-DD")
    total_load: float = Field(..., description="全网预测总电量")
    total_curve: List[float] = Field(..., description="全网预测总曲线 (48点)")
    
    # 准确率回溯字段 (后期回填)
    actual_load: Optional[float] = Field(None, description="实测总电量")
    wmape: Optional[float] = Field(None, description="加权平均绝对百分比误差")
    
    # 关键客户预测明细 (可选，用于核对)
    key_customers_breakdown: Optional[List[KeyCustomerBreakdownItem]] = Field(None, description="Top10客户预测电量分解")

class MonthlyForecastItem(BaseModel):
    """月度预测明细"""
    target_month: str = Field(..., description="目标月份 YYYY-MM")
    total_energy: float = Field(..., description="预测月度总电量")
    typical_curve_workday: List[float] = Field(..., description="月度典型工作日曲线 (48点)")
    typical_curve_weekend: List[float] = Field(..., description="月度典型周末曲线 (48点)")

class MediumTermForecastResult(BaseMongoModel):
    """中长期负荷预测结果集合"""
    forecast_date: str = Field(..., description="预测发布日期 YYYY-MM-DD")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")
    operator: str = Field(default="system", description="触发人")
    
    daily_forecasts: List[DailyForecastItem] = Field(..., description="未来30天日预测")
    monthly_forecasts: List[MonthlyForecastItem] = Field(..., description="未来3个月月预测")

    class Settings:
        name = "medium_term_load_forecast"
