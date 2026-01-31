from typing import List, Dict, Tuple
import numpy as np
try:
    from fastdtw import fastdtw
    from scipy.spatial.distance import euclidean
    FASTDTW_AVAILABLE = True
except ImportError:
    FASTDTW_AVAILABLE = False
    
def calculate_similarity_dtw(s1: List[float], s2: List[float]) -> float:
    """
    计算两个序列的 DTW 距离 (越小越相似)
    自动归一化处理
    """
    if not s1 or not s2:
        return float('inf')
        
    arr1 = np.array(s1)
    arr2 = np.array(s2)
    
    # Max-Min Normalization
    if np.max(arr1) > 0: arr1 = arr1 / np.max(arr1)
    if np.max(arr2) > 0: arr2 = arr2 / np.max(arr2)
    
    if FASTDTW_AVAILABLE:
        distance, _ = fastdtw(arr1, arr2, dist=lambda x, y: abs(x - y))
        return float(distance)
    else:
        # Fallback to Euclidean
        min_len = min(len(arr1), len(arr2))
        return float(np.linalg.norm(arr1[:min_len] - arr2[:min_len]))

def calculate_cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """计算余弦相似度"""
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    
    v1 = np.array(vec1)
    v2 = np.array(vec2)
    
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    
    if norm1 == 0 or norm2 == 0:
        return 0.0
        
    return float(np.dot(v1, v2) / (norm1 * norm2))

def match_template(target: List[float], templates: Dict[str, List[float]]) -> Tuple[str, float]:
    """
    匹配最佳模板
    :return: (best_template_name, min_distance)
    """
    best_name = None
    min_dist = float('inf')
    
    for name, tmpl in templates.items():
        dist = calculate_similarity_dtw(target, tmpl)
        if dist < min_dist:
            min_dist = dist
            best_name = name
            
    return best_name, min_dist
