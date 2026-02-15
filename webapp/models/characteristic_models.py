from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Literal, Any, Dict
from datetime import datetime
from bson import ObjectId

class PyObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler):
        from pydantic_core import core_schema
        return core_schema.union_schema([
            core_schema.is_instance_schema(ObjectId),
            core_schema.no_info_plain_validator_function(cls.validate),
        ], serialization=core_schema.plain_serializer_function_ser_schema(
            lambda x: str(x)
        ))

    @classmethod
    def validate(cls, v):
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str):
            if not ObjectId.is_valid(v):
                raise ValueError("Invalid ObjectId")
            return ObjectId(v)
        raise ValueError("Invalid ObjectId")

class BaseMongoModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True
    )
    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")

# --- Metric Models ---

class LongTermMetrics(BaseModel):
    """长周期指标 (基于近1年日电量)"""
    data_start: str = Field(..., description="数据开始日期 YYYY-MM-DD")
    data_end: str = Field(..., description="数据结束日期 YYYY-MM-DD")
    avg_daily_load: float = Field(..., description="日均电量 kWh")
    total_annual_load: float = Field(..., description="年累计电量 kWh")
    trend_slope: Optional[float] = Field(None, description="趋势线斜率")
    recent_3m_growth: Optional[float] = Field(None, description="近3月环比增长率")
    cv: float = Field(..., description="日电量变异系数")
    zero_days: int = Field(0, description="零电量天数")
    weekend_ratio: Optional[float] = Field(None, description="周末/工作日电量比")
    spring_festival_ratio: Optional[float] = Field(None, description="春节期间/平时比")
    post_holiday_recovery_ratio: Optional[float] = Field(None, description="节后第1周/平时比")
    
    # 季节性均值
    summer_avg: Optional[float] = Field(None, description="7月日均")
    winter_avg: Optional[float] = Field(None, description="1月日均")
    spring_autumn_avg: Optional[float] = Field(None, description="4/10月日均")
    temp_correlation: Optional[float] = Field(None, description="日电量-气温相关系数")

class ShortTermMetrics(BaseModel):
    """短周期指标 (基于近30天48点曲线)"""
    data_start: str = Field(..., description="数据开始日期 YYYY-MM-DD")
    data_end: str = Field(..., description="数据结束日期 YYYY-MM-DD")
    avg_curve: List[float] = Field(..., description="48点均值曲线 (归一化)")
    std_curve: Optional[List[float]] = Field(None, description="48点标准差曲线")
    
    avg_load_rate: float = Field(..., description="平均负荷率")
    min_max_ratio: float = Field(..., description="最小/最大负荷比")
    peak_hour: Optional[int] = Field(None, description="峰值时刻 (0-47)")
    valley_hour: Optional[int] = Field(None, description="谷值时刻 (0-47)")
    
    day_night_ratio: Optional[float] = Field(None, description="白/夜电量比")
    weekend_ratio: Optional[float] = Field(None, description="周末/工作日电量比")
    curve_similarity: Optional[float] = Field(None, description="日曲线间平均余弦相似度")
    cv: Optional[float] = Field(None, description="日内变异系数")
    
    # 分时电量占比
    tip_ratio: Optional[float] = Field(None, description="尖峰电量占比")
    peak_ratio: Optional[float] = Field(None, description="高峰电量占比")
    flat_ratio: Optional[float] = Field(None, description="平段电量占比")
    valley_ratio: Optional[float] = Field(None, description="低谷电量占比")
    deep_ratio: Optional[float] = Field(None, description="深谷电量占比")
    
    price_sensitivity_score: Optional[float] = Field(None, description="价格敏感度评分 (0-100)")

class TagItem(BaseModel):
    """特征标签项 (Characteristics 中使用)"""
    name: str
    category: str
    confidence: Optional[float] = 1.0
    source: Optional[str] = "AUTO"

class AnalysisTagSnapshot(BaseModel):
    """分析历史中的标签快照详情"""
    name: str
    category: Optional[str] = None
    source: Optional[str] = "AUTO"
    confidence: Optional[float] = 1.0
    rule_id: Optional[str] = None
    reason: Optional[str] = None

# --- Collection Models ---

class CustomerCharacteristics(BaseMongoModel):
    """客户特征画像集合"""
    customer_id: str
    customer_name: str
    short_name: Optional[str] = None
    updated_at: datetime
    data_date: Optional[str] = Field(None, description="分析所基于的负荷数据截止日期 YYYY-MM-DD")
    
    long_term: Optional[LongTermMetrics] = None
    short_term: Optional[ShortTermMetrics] = None
    
    baseline_curve: Optional[List[float]] = Field(None, description="基准曲线 (近30天均值，用于异动对比)")
    
    # 中长期预测专用基线 (归一化)
    baseline_workday: Optional[List[float]] = Field(None, description="工作日基准曲线 (归一化)")
    baseline_weekend: Optional[List[float]] = Field(None, description="周末基准曲线 (归一化)")
    
    tags: List[TagItem] = Field(default_factory=list)
    
    regularity_score: Optional[float] = Field(None, description="规律性评分 (0-100)")
    quality_rating: Optional[str] = Field(None, description="客户优劣评级 (A/B/C/D)")

class AnomalyRecord(BaseMongoModel):
    """客户异动记录集合"""
    customer_id: str
    customer_name: str
    
    anomaly_type: Literal["shape_drift", "scale_drift", "peak_shift", "stability_decay"]
    severity: Literal["high", "medium", "low"]
    
    detected_at: datetime
    observation_start: str
    observation_end: str
    
    metrics: dict = Field(default_factory=dict, description="异动指标数据")
    diagnosis: Optional[str] = Field(None, description="机器诊断结论")
    
    baseline_curve: Optional[List[float]] = None
    observation_curve: Optional[List[float]] = None
    
    status: Literal["pending", "confirmed", "ignored"] = "pending"
    resolution: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None

# --- API Response Models ---

class OverviewKpi(BaseModel):
    coverage_rate: float
    coverage_count: int
    total_customers: int
    dominant_tag: Optional[str]
    dominant_tag_percentage: float
    latest_data_date: Optional[str] = None
    anomaly_count_today: int
    avg_regularity_score: float
    irregular_load_weight: float

class TagDistributionItem(BaseModel):
    name: str
    value: int
    percentage: float

class TagDistribution(BaseModel):
    by_shift: List[TagDistributionItem]
    by_facility: List[TagDistributionItem]

class AnomalySummaryItem(BaseModel):
    id: str
    customer_id: str
    customer_name: str
    severity: str
    type: str
    description: str
    time: str

class CharacteristicsOverview(BaseModel):
    kpi: OverviewKpi
    distribution: TagDistribution
    anomalies: List[AnomalySummaryItem]

class CustomerCharacteristicListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[CustomerCharacteristics]


# --- 新增响应模型 ---

class TagCategoryDistribution(BaseModel):
    """按类别分组的标签分布"""
    category: str
    category_name: str
    items: List[TagDistributionItem]


class EnhancedTagDistribution(BaseModel):
    """增强版标签分布 (按类别)"""
    categories: List[TagCategoryDistribution]


class TagChangeItem(BaseModel):
    """单个客户的标签变化"""
    customer_id: str
    customer_name: str
    added_tags: List[str]
    removed_tags: List[str]


class TagChangesResponse(BaseModel):
    """标签变化响应"""
    date: str
    total_added: int
    total_removed: int
    changes: List[TagChangeItem]


class ScatterDataItem(BaseModel):
    """散点图数据点"""
    customer_id: str
    customer_name: str
    short_name: Optional[str] = None
    avg_daily_load: float  # 日均电量 (X轴)
    cv: float  # 离散系数 (Y轴)
    regularity_score: Optional[float] = None
    tags: List[str] = []


class ScatterDataResponse(BaseModel):
    """散点图数据响应"""
    items: List[ScatterDataItem]


class AnalysisHistoryItem(BaseModel):
    """分析历史记录项"""
    date: str
    execution_time: datetime
    tags: List[AnalysisTagSnapshot]
    rule_ids: List[str]
    metrics: Optional[Dict[str, Any]] = None  # 定量指标快照
    baseline_curve: Optional[List[float]] = None  # 当日基准负荷曲线快照


class AnalysisHistoryResponse(BaseModel):
    """分析历史响应"""
    customer_id: str
    items: List[AnalysisHistoryItem]


class AnomalyAlertItem(BaseModel):
    """异动告警项"""
    id: str
    customer_id: str
    customer_name: str
    alert_date: str
    alert_type: str
    severity: str
    confidence: float
    reason: str
    metrics: Optional[dict] = None
    acknowledged: bool
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    notes: Optional[str] = None
    rule_id: Optional[str] = None


class AnomalyAlertListResponse(BaseModel):
    """异动告警列表响应"""
    total: int
    items: List[AnomalyAlertItem]


class AcknowledgeRequest(BaseModel):
    """确认异动请求"""
    notes: Optional[str] = None
    acknowledged: bool = True

