"""
异动检测规则 (细化版 v2)
包含: 形状异动, 重心异动, 力度异动, 规律异动, 剧烈异动, 日环比突变
新增: 绝对电量阈值过滤（小客户不触发异动告警）
"""
from typing import Optional, List
import numpy as np

from webapp.models.customer import Tag
from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext
from ..algorithms.clustering import calculate_cosine_similarity
from ..algorithms.statistics import calculate_cv

# ============ 全局阈值 ============
# 绝对电量阈值: 低于此值的客户不触发异动告警 (单位: MWh)
# 理由: 小客户的异动对整体交易影响可忽略
MIN_LOAD_FOR_ANOMALY_ALERT = 20.0  # 20 MWh


class ShapeAnomalyRule(BaseRule):
    """
    形状异动规则
    检测用电曲线形态的质变 (如换班次、加光伏)
    
    判定逻辑:
    - 当日曲线与典型曲线(30天平均)的余弦相似度 < 0.85
    """
    SIMILARITY_THRESHOLD = 0.85
    
    @property
    def rule_id(self) -> str:
        return "rule_anomaly_shape_01"
    
    @property
    def category(self) -> str:
        return "anomaly"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 需要当日曲线和典型曲线
        if not context.load_series or len(context.load_series) < 48:
            return None
        if not context.typical_load_series or len(context.typical_load_series) < 48:
            return None
            
        # 转换为相同长度
        current = context.load_series
        typical = context.typical_load_series
        
        # 归一化到相同长度 (96点)
        if len(current) == 48:
            current = [v for v in current for _ in range(2)]
        if len(typical) == 48:
            typical = [v for v in typical for _ in range(2)]
            
        # 计算余弦相似度
        similarity = calculate_cosine_similarity(current, typical)
        
        if similarity < self.SIMILARITY_THRESHOLD:
            return self.create_tag(
                "形状异动",
                confidence=min((self.SIMILARITY_THRESHOLD - similarity) * 3, 1.0),
                reason=f"曲线相似度仅 {similarity:.2f}，生产模式可能发生质变"
            )
        return None


class PeakShiftAnomalyRule(BaseRule):
    """
    重心异动规则
    检测用电高峰时段的转移 (如错峰生产)
    
    判定逻辑:
    - 当日峰值时刻与典型峰值时刻偏差 > 2 小时
    """
    PEAK_SHIFT_THRESHOLD_HOURS = 2
    
    @property
    def rule_id(self) -> str:
        return "rule_anomaly_peak_shift_01"
    
    @property
    def category(self) -> str:
        return "anomaly"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.load_series or len(context.load_series) < 48:
            return None
        if not context.typical_load_series or len(context.typical_load_series) < 48:
            return None
            
        current = np.array(context.load_series)
        typical = np.array(context.typical_load_series)
        
        # 找到峰值索引
        current_peak_idx = int(np.argmax(current))
        typical_peak_idx = int(np.argmax(typical))
        
        # 转换为小时 (假设96点 = 24小时, 每点15分钟)
        points_per_hour = len(current) / 24  # 4 for 96-point, 2 for 48-point
        current_peak_hour = current_peak_idx / points_per_hour
        typical_peak_hour = typical_peak_idx / points_per_hour
        
        shift = abs(current_peak_hour - typical_peak_hour)
        
        if shift > self.PEAK_SHIFT_THRESHOLD_HOURS:
            return self.create_tag(
                "重心异动",
                confidence=min(shift / 6, 1.0),  # 6小时偏移 = 100% 置信度
                reason=f"峰值时刻从 {typical_peak_hour:.1f}时 → {current_peak_hour:.1f}时，偏移 {shift:.1f}小时"
            )
        return None


class ScaleAnomalyRule(BaseRule):
    """
    力度异动规则
    检测用电量级的异常变化 (扩产、停产)
    
    判定逻辑:
    - 当日电量与近30天平均偏差 > 50%
    - 或当日电量 < 近30天平均的 20% (疑似停产)
    
    前置条件:
    - 当日电量 >= 20 MWh (过滤小客户)
    """
    SCALE_DEVIATION_THRESHOLD = 0.50  # 50% 偏差
    SHUTDOWN_THRESHOLD = 0.20         # 低于20%疑似停产
    
    @property
    def rule_id(self) -> str:
        return "rule_anomaly_scale_01"
    
    @property
    def category(self) -> str:
        return "anomaly"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 绝对电量过滤
        if context.total_load < MIN_LOAD_FOR_ANOMALY_ALERT:
            return None
        if not context.long_term_values or len(context.long_term_values) < 7:
            return None
            
        # 取近30天数据
        recent_values = context.long_term_values[-30:] if len(context.long_term_values) >= 30 else context.long_term_values
        avg_load = np.mean(recent_values)
        
        if avg_load <= 0:
            return None
            
        deviation = (context.total_load - avg_load) / avg_load
        ratio = context.total_load / avg_load
        
        # 疑似停产
        if ratio < self.SHUTDOWN_THRESHOLD:
            return self.create_tag(
                "力度异动",
                confidence=0.9,
                reason=f"当日电量仅为近期平均的 {ratio*100:.1f}%，疑似停产"
            )
            
        # 大幅偏离
        if abs(deviation) > self.SCALE_DEVIATION_THRESHOLD:
            direction = "激增" if deviation > 0 else "骤降"
            return self.create_tag(
                "力度异动",
                confidence=min(abs(deviation), 1.0),
                reason=f"当日电量{direction} {abs(deviation)*100:.1f}% (当日:{context.total_load:.1f}, 均值:{avg_load:.1f})"
            )
            
        return None


class VolatilityAnomalyRule(BaseRule):
    """
    规律异动规则
    检测用电波动模式的突变 (从规律变为杂乱)
    
    判定逻辑:
    - 近5天标准差 > 过去30天标准差 * 2
    """
    VOLATILITY_MULTIPLIER = 2.0
    
    @property
    def rule_id(self) -> str:
        return "rule_anomaly_volatility_01"
    
    @property
    def category(self) -> str:
        return "anomaly"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.long_term_values or len(context.long_term_values) < 35:
            return None  # 需要至少35天数据
            
        # 近5天
        recent_5 = context.long_term_values[-5:]
        # 过去30天 (排除最近5天)
        historical_30 = context.long_term_values[-35:-5]
        
        std_recent = np.std(recent_5)
        std_historical = np.std(historical_30)
        
        if std_historical <= 0:
            return None
            
        ratio = std_recent / std_historical
        
        if ratio > self.VOLATILITY_MULTIPLIER:
            return self.create_tag(
                "规律异动",
                confidence=min((ratio - self.VOLATILITY_MULTIPLIER) / 2, 1.0),
                reason=f"近5天波动率是历史的 {ratio:.1f} 倍，生产规律性下降"
            )
        return None


class ExtremeAnomalyRule(BaseRule):
    """
    剧烈异动规则 (单日触发)
    检测单日极端波动 (需要立即关注)
    
    判定逻辑:
    - 当日电量偏离历史均值超过 2.5 个标准差 (原为3σ，降低阈值提高敏感度)
    - 或当日负荷率与历史平均负荷率差异超过 30%
    
    前置条件:
    - 当日电量 >= 20 MWh (过滤小客户)
    """
    SIGMA_THRESHOLD = 2.5  # 降低至 2.5-sigma 提高敏感度
    LOAD_RATE_DIFF_THRESHOLD = 0.30
    
    @property
    def rule_id(self) -> str:
        return "rule_anomaly_extreme_01"
    
    @property
    def category(self) -> str:
        return "anomaly"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 绝对电量过滤: 小客户不触发
        if context.total_load < MIN_LOAD_FOR_ANOMALY_ALERT:
            return None
            
        reasons = []
        confidence = 0.0
        
        # 检查 1: 电量 2.5-sigma 偏离
        if context.total_load > 0 and context.long_term_values and len(context.long_term_values) >= 30:
            recent_30 = context.long_term_values[-30:]
            mean = np.mean(recent_30)
            std = np.std(recent_30)
            
            if std > 0:
                z_score = abs(context.total_load - mean) / std
                if z_score > self.SIGMA_THRESHOLD:
                    direction = "异常高" if context.total_load > mean else "异常低"
                    reasons.append(f"电量{direction} ({z_score:.1f}σ)")
                    confidence = max(confidence, min(z_score / 4, 1.0))
        
        # 检查 2: 负荷率剧变
        if context.load_rate > 0 and context.typical_load_series:
            typical = np.array(context.typical_load_series)
            typical_max = np.max(typical)
            typical_avg = np.mean(typical)
            typical_load_rate = typical_avg / typical_max if typical_max > 0 else 0
            
            if typical_load_rate > 0:
                rate_diff = abs(context.load_rate - typical_load_rate)
                if rate_diff > self.LOAD_RATE_DIFF_THRESHOLD:
                    reasons.append(f"负荷率剧变 ({typical_load_rate:.2f}→{context.load_rate:.2f})")
                    confidence = max(confidence, min(rate_diff / 0.5, 1.0))
        
        if reasons:
            return self.create_tag(
                "剧烈异动",
                confidence=confidence,
                reason="; ".join(reasons) + " - 需立即关注"
            )
        return None


class DaySurgeRule(BaseRule):
    """
    日环比突变规则 (单日触发)
    检测相比前一日的剧烈变化
    
    判定逻辑:
    - 当日电量相比前一日变化超过 100% (翻倍或腰斩以上)
    
    前置条件:
    - 当日电量 >= 20 MWh (过滤小客户)
    """
    DAY_OVER_DAY_THRESHOLD = 1.0  # 100% 变化
    
    @property
    def rule_id(self) -> str:
        return "rule_anomaly_day_surge_01"
    
    @property
    def category(self) -> str:
        return "anomaly"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 绝对电量过滤
        if context.total_load < MIN_LOAD_FOR_ANOMALY_ALERT:
            return None
            
        # 需要至少2天数据来比较
        if not context.long_term_values or len(context.long_term_values) < 2:
            return None
            
        yesterday = context.long_term_values[-1]  # 最后一天是分析日的前一天
        today = context.total_load
        
        if yesterday <= 0:
            return None
            
        change_ratio = (today - yesterday) / yesterday
        
        if abs(change_ratio) > self.DAY_OVER_DAY_THRESHOLD:
            direction = "激增" if change_ratio > 0 else "骤降"
            return self.create_tag(
                "日环比突变",
                confidence=min(abs(change_ratio) / 2, 1.0),
                reason=f"相比昨日{direction} {abs(change_ratio)*100:.0f}% (昨:{yesterday:.1f}→今:{today:.1f} MWh)"
            )
        return None


# 保留原有的通用异常检测作为兜底
class AnomalyDetectionRule(BaseRule):
    """异动检测规则 (基于孤立森林) - 作为兜底规则"""
    @property
    def rule_id(self): return "rule_anomaly_iforest_01"
    
    @property
    def category(self): return "anomaly"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        try:
            from sklearn.ensemble import IsolationForest
        except ImportError:
            return None
            
        if not context.long_term_values or len(context.long_term_values) < 30:
            return None
            
        if context.total_load <= 0:
            return None
            
        X = np.array(context.long_term_values).reshape(-1, 1)
        
        clf = IsolationForest(contamination=0.05, random_state=42)
        clf.fit(X)
        
        current_val = np.array([[context.total_load]])
        pred = clf.predict(current_val)
        score = clf.decision_function(current_val)
        
        if pred[0] == -1 and score[0] < -0.2:
            confidence = min(0.5 - float(score[0]), 1.0)
            confidence = max(confidence, 0.5)
            
            return self.create_tag(
                "用电异动", 
                confidence=confidence, 
                reason=f"IsolationForest 判定异常 (score={score[0]:.2f})"
            )
            
        return None
