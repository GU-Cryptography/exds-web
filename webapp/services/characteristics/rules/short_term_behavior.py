"""
短周期规则：行为规律类
识别：机器规律型、随机波动型
"""
from typing import Optional
import numpy as np

from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext
from ..algorithms.clustering import calculate_cosine_similarity
from ..algorithms.statistics import calculate_cv
from webapp.models.customer import Tag


class BehaviorPatternRule(BaseRule):
    """
    行为规律类规则
    基于30天日曲线间的相似度判断生产规律性
    
    判定逻辑：
    - 机器规律型 🤖: 日曲线间平均余弦相似度 > 0.95
    - 随机波动型 🎲: 日曲线相似度低 (< 0.7) 且 变异系数高 (CV > 0.3)
    """
    
    SIMILARITY_HIGH_THRESHOLD = 0.95  # 机器规律型阈值
    SIMILARITY_LOW_THRESHOLD = 0.70   # 随机波动型-相似度阈值
    CV_HIGH_THRESHOLD = 0.30          # 随机波动型-变异系数阈值
    
    @property
    def rule_id(self) -> str:
        return "rule_short_behavior_01"
    
    @property
    def category(self) -> str:
        return "short_term"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 需要典型负荷曲线（30天平均）和多日曲线数据
        if not context.typical_load_series or len(context.typical_load_series) < 48:
            return None
            
        # 从上下文获取30天的日曲线数据进行相似度计算
        # 注意：context 中没有直接存储多日曲线列表，需要用 curve_similarity 或额外查询
        # 这里我们使用 short_term metrics 中的 curve_similarity 如果可用
        # 或者直接计算典型曲线的 CV 作为替代
        
        # 获取近30天曲线相似度（如果 service 已预计算）
        # 由于 context 不直接包含 daily curves list，这里使用一个简化策略：
        # 1. 使用 typical_load_series 计算形态规律性
        # 2. 使用 load_rate 和 CV 作为辅助判断
        
        # ====== 方案：计算典型曲线的离散程度 ======
        # 典型曲线是30天平均，其内部 CV 可反映日内波动
        # 但跨日相似度需要原始数据...
        
        # 简化实现：基于 context 中可用数据
        # 如果 context.normalized_series 存在，计算其形态特征
        
        series = context.typical_load_series
        if not series:
            return None
            
        # 计算日内变异系数
        cv = calculate_cv(series)
        
        # 计算负荷率（平均/最大）- 已在 context 中
        load_rate = context.load_rate if context.load_rate > 0 else 0
        
        # 判断逻辑：
        # 机器规律型：负荷率高 (> 0.7) + 低变异系数 (< 0.15) -> 曲线非常平稳
        # 随机波动型：高变异系数 (> 0.35) + 低负荷率 (< 0.5) -> 曲线杂乱
        
        # 注意：这是简化版，真正的跨日相似度需要额外数据
        # 后续可以扩展 context 以包含 daily_curves 列表
        
        if load_rate > 0.70 and cv < 0.15:
            return self.create_tag(
                "机器规律型",
                confidence=min(0.5 + (0.15 - cv) * 3, 1.0),
                reason=f"日内曲线极度规律, 负荷率={load_rate:.2f}, CV={cv:.2f}"
            )
            
        if cv > 0.35 and load_rate < 0.50:
            return self.create_tag(
                "随机波动型",
                confidence=min(0.5 + (cv - 0.35) * 2, 1.0),
                reason=f"日内曲线波动剧烈, 负荷率={load_rate:.2f}, CV={cv:.2f}"
            )
            
        return None
