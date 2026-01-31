from typing import List, Tuple, Dict
import numpy as np
import pandas as pd
try:
    from statsmodels.tsa.seasonal import STL
    STATSMODELS_AVAILABLE = True
except ImportError:
    STATSMODELS_AVAILABLE = False

def decompose_series(
    dates: List[str], 
    values: List[float], 
    period: int = 7,
    robust: bool = True
) -> Dict[str, List[float]]:
    """
    使用 STL 进行时序分解
    :param dates: 日期列表
    :param values: 负荷值列表
    :param period: 周期 (周=7)
    :return: {trend, seasonal, resid}
    """
    if not STATSMODELS_AVAILABLE:
        # Fallback: return raw values as trend, others 0
        return {
            "trend": values,
            "seasonal": [0.0] * len(values),
            "resid": [0.0] * len(values)
        }
        
    if len(values) < period * 2:
        return {
            "trend": values,
            "seasonal": [0.0] * len(values),
            "resid": [0.0] * len(values)
        }

    # Construct Series
    s = pd.Series(values, index=pd.to_datetime(dates), name="load")
    
    # STL Decomposition
    stl = STL(s, period=period, robust=robust)
    res = stl.fit()
    
    return {
        "trend": res.trend.tolist(),
        "seasonal": res.seasonal.tolist(),
        "resid": res.resid.tolist()
    }

def calculate_trend_slope(trend: List[float]) -> float:
    """计算趋势项的线性回归斜率 (归一化后)"""
    n = len(trend)
    if n < 2: 
        return 0.0
    
    # Simple linear regression
    x = np.arange(n)
    y = np.array(trend)
    
    # Normalize y to avoid scale issues
    y_max = np.max(y)
    if y_max > 0:
        y = y / y_max
        
    slope, _ = np.polyfit(x, y, 1)
    return float(slope)
