from typing import Optional
import numpy as np
from webapp.models.customer import Tag
from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext

class PhotovoltaicRule(BaseRule):
    """光伏自备识别规则 (午间洼地 + 晴天关联)"""
    @property
    def rule_id(self): return "rule_short_asset_pv"
    
    @property
    def category(self): return "short_term"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.normalized_series or len(context.normalized_series) != 96:
            return None
            
        # 1. 检查特定时段 (11:00-13:00, index 44-52) 是否存在凹陷
        # 对比 10:00 (index 40) 和 14:00 (index 56)
        # 简单逻辑：午间均值 < (早均值 + 晚均值)/2 * 0.8
        
        noon_indices = slice(44, 53) # 11:00-13:00 (4 points/hr * 2hr = 8 points?) No, 15min/pt. 
        # 11:00 is 11*4 = 44. 13:00 is 13*4 = 52.
        
        morning_indices = slice(32, 40) # 08:00-10:00
        afternoon_indices = slice(56, 64) # 14:00-16:00
        
        series = np.array(context.normalized_series)
        noon_avg = np.mean(series[noon_indices])
        flank_avg = (np.mean(series[morning_indices]) + np.mean(series[afternoon_indices])) / 2
        
        if flank_avg > 0.3 and noon_avg < flank_avg * 0.7:
            # 发现午间凹陷
            reason = f"午间负荷凹陷 (午={noon_avg:.2f}, 侧={flank_avg:.2f})"
            confidence = 0.7
            
            # 2. 结合天气数据 (如果有)
            if context.weather_data:
                condition = context.weather_data.get("condition", "")
                if "晴" in condition:
                    confidence += 0.2
                    reason += " + 晴天增强"
                elif "雨" in condition:
                    confidence -= 0.1 # 雨天光伏也可能有发电，但较弱；如果雨天也有深凹陷可能是吃饭休息? 
                    # 真正的光伏应该是：晴天凹陷深，雨天凹陷浅。
                    # 这里如果是单日判定，比较难。
            
            return self.create_tag("光伏自备", confidence=confidence, reason=reason)
            
        return None

class StorageArbitrageRule(BaseRule):
    """储能套利识别规则 (谷充峰放)"""
    @property
    def rule_id(self): return "rule_short_asset_storage"
    
    @property
    def category(self): return "short_term"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 需要分时电价信息才能判断是否在"谷时段"充电
        # 这里仅做简单波形判断：夜间(00:00-06:00)有突增平台，且非连续生产
        
        # 暂不实现复杂逻辑，仅占位
        return None
