import numpy as np
from typing import List, Optional

def calculate_load_rate(series: List[float]) -> float:
    """计算负荷率 (平均负荷 / 最大负荷)"""
    if not series:
        return 0.0
    
    arr = np.array(series)
    max_val = float(np.max(arr))
    if max_val <= 1e-6:
        return 0.0
    
    avg_val = float(np.mean(arr))
    return avg_val / max_val

def calculate_cv(series: List[float]) -> float:
    """计算离散系数 (标准差 / 平均值)"""
    if not series:
        return 0.0
    
    arr = np.array(series)
    mean_val = float(np.mean(arr))
    if mean_val <= 1e-6:
        return 0.0
        
    std_val = float(np.std(arr))
    return std_val / mean_val

def calculate_zero_count(series: List[float], threshold: float = 1e-6) -> int:
    """计算零值点个数"""
    return sum(1 for x in series if x < threshold)

def calculate_ramp_rate(series: List[float]) -> float:
    """计算最大爬坡率 (相邻点最大差值 / max_load)"""
    if not series or len(series) < 2:
        return 0.0
        
    arr = np.array(series)
    max_val = float(np.max(arr))
    if max_val <= 1e-6:
        return 0.0
        
    diff = np.abs(np.diff(arr))
    max_diff = float(np.max(diff))
    return max_diff / max_val
