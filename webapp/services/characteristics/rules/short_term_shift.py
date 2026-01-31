from typing import Optional
from webapp.models.customer import Tag
from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext
from ..algorithms.statistics import calculate_load_rate
from ..algorithms.clustering import match_template
from ..constants import SHIFT_LOAD_RATE_THRESHOLD

# 定义标准班次模板 (归一化后)
# 实际生产中应从 DB 加载
PATTERNS = {
    "单班(早8晚5)": [0.1]*32 + [0.8]*38 + [0.1]*26, # 简单模拟
    "单班(高基荷)": [0.35]*32 + [0.9]*38 + [0.35]*26, # 办公/商业 (夜间有负荷)
    "双班(早8晚12)": [0.1]*32 + [0.8]*64,
    "三班倒": [0.8]*96
}

class WorkPatternRule(BaseRule):
    """生产班次规则 (基于负荷率和模板匹配)"""
    @property
    def rule_id(self): return "shift_pattern_analysis"
    
    @property
    def category(self): return "short_term"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.normalized_series:
            return None
            
        # 1. 简单逻辑：连续生产
        # 如果平均负荷率很高，通常是连续生产 (三班倒)
        if context.load_rate > SHIFT_LOAD_RATE_THRESHOLD:
             return self.create_tag("连续生产", confidence=context.load_rate, reason=f"日均负荷率 {context.load_rate:.2f} 高")
             
        # 2. 复杂逻辑：模板匹配
        # 对非连续生产的，尝试匹配单班/双班
        best_name, dist = match_template(context.normalized_series, PATTERNS)
        
        # 距离越小置信度越高。假设 dist=0 -> conf=1.0, dist=10 -> conf=0.0
        # 这里的 scaling 需要调试
        confidence = max(0.0, 1.0 - dist / 40.0) 
        
        if confidence > 0.6:
            # 映射模板名称到标签
            tag_name = best_name
            if "单班" in best_name: tag_name = "单班生产"
            elif "双班" in best_name: tag_name = "双班生产"
            
            return self.create_tag(tag_name, confidence=confidence, reason=f"匹配模板 '{best_name}' (dist={dist:.1f})")
            
        return self.create_tag("不规律生产", confidence=0.5, reason="无法匹配已知班次模板")
