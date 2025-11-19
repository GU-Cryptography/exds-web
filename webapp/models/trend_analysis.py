from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field

class TimeSeriesPoint(BaseModel):
    """通用时序数据点模型"""
    time: str = Field(..., description="业务时间标签，如 00:15, 24:00")
    value: Optional[float] = Field(None, description="数值")
    timestamp: str = Field(..., description="ISO格式时间戳")

class PriceTrendData(BaseModel):
    """价格趋势数据项"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    vwap_da: Optional[float] = Field(None, description="日前加权平均价")
    vwap_rt: Optional[float] = Field(None, description="实时加权平均价")
    vwap_spread: Optional[float] = Field(None, description="VWAP价差 (RT-DA)")
    twap_da: Optional[float] = Field(None, description="日前算术平均价")
    twap_rt: Optional[float] = Field(None, description="实时算术平均价")
    twap_spread: Optional[float] = Field(None, description="TWAP价差 (RT-DA)")

class PeriodTrendData(BaseModel):
    """分时段趋势数据项"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    period_type: str = Field(..., description="时段类型：尖峰/峰/平/谷/深谷")
    vwap: Optional[float] = Field(None, description="该时段的日均VWAP")

class PriceTrendResponse(BaseModel):
    """价格趋势分析响应"""
    daily_trends: List[PriceTrendData] = Field(..., description="每日价格趋势列表")
    period_trends: Dict[str, List[PeriodTrendData]] = Field(..., description="分时段趋势列表，Key为时段类型")

class BoxPlotStats(BaseModel):
    """箱线图统计数据"""
    min: float
    q1: float
    median: float
    q3: float
    max: float

class WeekdayStats(BaseModel):
    """星期统计数据"""
    weekday: int = Field(..., description="星期几 (0=周一, 6=周日)")
    weekday_name: str = Field(..., description="星期名称")
    stats: BoxPlotStats = Field(..., description="箱线图统计")
    outliers: List[float] = Field(default=[], description="离群值")

class WeekdayAnalysisResponse(BaseModel):
    """星期特性分析响应"""
    distribution: List[WeekdayStats] = Field(..., description="周内价格分布统计")
    # 热力图数据结构较复杂，暂用通用字典或特定结构，这里简化处理
    heatmap_data: List[Dict[str, Any]] = Field(default=[], description="星期x时段热力图数据")

class VolatilityData(BaseModel):
    """波动性数据项"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    cv_rt: Optional[float] = Field(None, description="日内价格变异系数")
    max_ramp: Optional[float] = Field(None, description="最大价格爬坡")
    spread_std: Optional[float] = Field(None, description="价差标准差")

class VolatilityAnalysisResponse(BaseModel):
    """波动性分析响应"""
    daily_volatility: List[VolatilityData] = Field(..., description="每日波动性数据列表")

class ArbitrageData(BaseModel):
    """套利机会数据项"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    max_spread: float = Field(..., description="全天最大价差")
    best_strategy: str = Field(..., description="最优策略描述，如 '03:00买入 -> 19:00卖出'")
    buy_price: float = Field(..., description="买入价格")
    buy_time: str = Field(..., description="买入时间")
    sell_price: float = Field(..., description="卖出价格")
    sell_time: str = Field(..., description="卖出时间")
    period_type: str = Field(..., description="最优时段：上午/下午")

class ArbitrageAnalysisResponse(BaseModel):
    """储能套利机会分析响应"""
    daily_arbitrage: List[ArbitrageData] = Field(..., description="每日套利机会列表")
    summary: Dict[str, Any] = Field(..., description="聚合统计指标")

class AnomalyEventStats(BaseModel):
    """异常事件统计"""
    event_type: str = Field(..., description="事件类型：negative_price/zero_price/high_price/etc")
    count: int = Field(..., description="发生次数")
    days: int = Field(..., description="发生天数")
    avg_price: Optional[float] = Field(None, description="平均价格")
    max_price: Optional[float] = Field(None, description="最大价格")
    min_price: Optional[float] = Field(None, description="最小价格")

class ExtremumData(BaseModel):
    """极值数据项"""
    date: str = Field(..., description="日期 YYYY-MM-DD")
    max_price: float = Field(..., description="最高价")
    max_time: str = Field(..., description="最高价时间")
    min_price: float = Field(..., description="最低价")
    min_time: str = Field(..., description="最低价时间")
    range_value: float = Field(..., description="极差")

class AnomalyAnalysisResponse(BaseModel):
    """价格异常与极值分析响应"""
    events: Dict[str, AnomalyEventStats] = Field(..., description="各类异常事件统计")
    daily_extremums: List[ExtremumData] = Field(..., description="每日极值数据")
    risk_timeslots: List[Dict[str, Any]] = Field(..., description="高风险时段列表")
