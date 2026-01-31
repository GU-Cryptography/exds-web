"""
短周期规则：成本偏好类
识别：成本敏感型、刚性用电型
"""
from typing import Optional, Dict

from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext
from webapp.models.customer import Tag


class CostSensitivityRule(BaseRule):
    """
    成本偏好类规则
    基于尖峰时段电量占比判断用户对电价的敏感程度
    
    判定逻辑（基于分时电量占比 tou_info）：
    - 成本敏感型 💰: 尖峰时段电量占比 < 行业平均 - 2σ (或绝对值 < 15%)
    - 刚性用电型 💸: 尖峰时段电量占比 > 行业平均 + 1σ (或绝对值 > 35%)
    
    注：需要 context.tou_info 包含 peak/flat/valley 占比
    """
    
    # 行业基准（可配置）- 假设尖峰时段一般占比约 25%
    INDUSTRY_PEAK_RATIO_MEAN = 0.25
    INDUSTRY_PEAK_RATIO_STD = 0.08
    
    # 简化阈值
    COST_SENSITIVE_THRESHOLD = 0.20   # 尖峰占比低于20%认为敏感 (was 0.15)
    RIGID_USAGE_THRESHOLD = 0.30       # 尖峰占比高于30%认为刚性 (was 0.35)
    
    @property
    def rule_id(self) -> str:
        return "rule_short_cost_01"
    
    @property
    def category(self) -> str:
        return "short_term"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 需要分时电量信息
        tou_info = context.tou_info
        if not tou_info:
            return None
            
        # 获取尖峰时段占比 (Tip + Peak)
        # tou_info 格式: {'tip': 0.1, 'peak': 0.3, 'flat': 0.4, ...}
        peak_ratio = tou_info.get('peak', 0) + tou_info.get('tip', 0)
        
        if peak_ratio <= 0:
            return None
            
        # 判断逻辑
        if peak_ratio < self.COST_SENSITIVE_THRESHOLD:
            return self.create_tag(
                "成本敏感型",
                confidence=min(0.6 + (self.COST_SENSITIVE_THRESHOLD - peak_ratio) * 3, 1.0),
                reason=f"尖峰时段电量占比仅 {peak_ratio*100:.1f}%，明显避峰用电"
            )
            
        if peak_ratio > self.RIGID_USAGE_THRESHOLD:
            return self.create_tag(
                "刚性用电型",
                confidence=min(0.6 + (peak_ratio - self.RIGID_USAGE_THRESHOLD) * 2, 1.0),
                reason=f"尖峰时段电量占比达 {peak_ratio*100:.1f}%，对电价不敏感"
            )
            
        return None
