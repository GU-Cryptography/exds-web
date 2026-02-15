from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from datetime import datetime
import numpy as np

@dataclass
class LabelingContext:
    """
    标签计算上下文
    包含单个客户在特定日期的所有必要数据
    """
    # 基础信息
    customer_id: str
    date: datetime
    
    # 负荷数据
    load_series: List[float]  # 原始96点负荷 (用于短周期分析)
    total_load: float         # 当日日用电量
    
    # 长周期数据 (用于趋势、稳定性分析)
    long_term_dates: List[str] = field(default_factory=list) # 日期序列 (YYYY-MM-DD)
    long_term_values: List[float] = field(default_factory=list) # 日电量序列
    
    # 典型负荷 (用于班次识别、光伏识别等通用特征)
    typical_load_series: List[float] = field(default_factory=list)
    typical_workday_series: List[float] = field(default_factory=list) # 工作日典型曲线
    typical_weekend_series: List[float] = field(default_factory=list) # 周末典型曲线

    # 预计算特征 (避免重复计算)
    normalized_series: List[float] = field(default_factory=list) # 归一化曲线 (0-1)
    
    # 统计特征
    min_load: float = 0.0
    max_load: float = 0.0
    avg_load: float = 0.0
    load_rate: float = 0.0    # 负荷率 (avg/max)
    peak_valley_diff: float = 0.0 # 峰谷差
    peak_valley_ratio: float = 0.0 # 峰谷差率
    
    # 外部数据 (可选)
    weather_data: Optional[Dict[str, Any]] = None # 天气数据 (temp_max, temp_min, condition)
    tou_info: Optional[Dict[str, float]] = None   # 分时电量占比 (peak, flat, valley)
    holiday_info: Optional[str] = None            # 节假日名称 (如 not None 则为传佳节)
    
    # 客户元数据
    contract_capacity: float = 0.0
    industry_category: Optional[str] = None
    
    # New Injected Dependencies (Optional)
    customer_info: Optional[Dict] = None 
    weather_service: Any = None
    
    def __post_init__(self):
        """初始化后自动计算基础统计量"""
        # 优先使用典型曲线进行特征分析，如果无典型曲线则使用当日曲线
        target_series = self.typical_load_series if self.typical_load_series else self.load_series
        
        if not target_series:
            return

        series_np = np.array(target_series)
        self.max_load = float(np.max(series_np))
        self.min_load = float(np.min(series_np))
        self.avg_load = float(np.mean(series_np))
        
        if self.max_load > 0:
            self.load_rate = self.avg_load / self.max_load
            self.normalized_series = (series_np / self.max_load).tolist()
            self.peak_valley_diff = self.max_load - self.min_load
            self.peak_valley_ratio = self.peak_valley_diff / self.max_load
