from typing import Optional
from datetime import datetime
import numpy as np
from webapp.models.customer import Tag
from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext
from ..algorithms.stl_decomposition import decompose_series, calculate_trend_slope
from ..algorithms.statistics import calculate_cv, calculate_zero_count
from ..constants import (
    TREND_SLOPE_THRESHOLD, 
    SEASONALITY_STRENGTH_THRESHOLD,
    STABILITY_CV_THRESHOLD,
    ZERO_COUNT_RATIO_THRESHOLD
)

class ProductionTrendRule(BaseRule):
    """经营趋势规则 (基于 STL 趋势项斜率)"""
    @property
    def rule_id(self): return "rule_long_trend_01"
    
    @property
    def category(self): return "long_term"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # 需要足够的数据点 (至少14天)
        if not context.long_term_values or len(context.long_term_values) < 14:
            return None
            
        # 使用 STL 分解
        # values should be list of floats
        decomp = decompose_series(
            context.long_term_dates, 
            context.long_term_values, 
            period=7 # Weekly seasonality
        )
        
        slope = calculate_trend_slope(decomp["trend"])
        
        if slope > TREND_SLOPE_THRESHOLD:
             return self.create_tag("产能扩张", confidence=min(slope * 5, 1.0), reason=f"趋势斜率 {slope:.2f} (增长)")
        elif slope < -TREND_SLOPE_THRESHOLD:
             return self.create_tag("产能收缩", confidence=min(abs(slope) * 5, 1.0), reason=f"趋势斜率 {slope:.2f} (下降)")
        else:
             # 平稳判定，需结合波动率
             # 只有 slope 小且 cv 小才算稳健
             # Get CV from metrics? No, calculate directly here or rely on metrics calculated?
             # Context only has raw values. Calculate CV here.
             cv = calculate_cv(context.long_term_values)
             if cv < 0.3:
                 return self.create_tag("经营稳健", confidence=1.0 - abs(slope * 100), reason=f"趋势斜率 {slope:.5f} (CV={cv:.2f})")
             else:
                 return None # 波动大，不给稳健标签，留给 StabilityRule 判定 "波动剧烈"

class StabilityRule(BaseRule):
    """稳定性规则 (基于 CV 和 零值)"""
    @property
    def rule_id(self): return "rule_long_stability_01"
    
    @property
    def category(self): return "long_term"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        series = context.long_term_values
        if not series:
            return None

            
        # 1. Check Shutdown (Zero Count)
        zero_cnt = calculate_zero_count(series)
        zero_ratio = zero_cnt / len(series)
        if zero_ratio > ZERO_COUNT_RATIO_THRESHOLD:
            return self.create_tag("间歇停产型", confidence=1.0, reason=f"零值天数占比 {zero_ratio:.1%}")
            
        # 2. Check Stability (CV)
        cv = calculate_cv(series)
        if cv < STABILITY_CV_THRESHOLD:
             return self.create_tag("极度规律型", confidence=0.9, reason=f"离散系数 CV={cv:.2f} 低")
        elif cv > 0.5: # Hardcoded high threshold
             return self.create_tag("剧烈波动型", confidence=0.8, reason=f"离散系数 CV={cv:.2f} 高")
             
        return None

class SeasonalRule(BaseRule):
    """
    季节性规则 (基于长周期)
    识别：冬夏双峰型
    """
    @property
    def rule_id(self): return "rule_long_season_01"
    
    @property
    def category(self): return "long_term"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.long_term_values or not context.long_term_dates:
            return None
            
        # Calculate Monthly Averages
        month_sums = {}
        month_counts = {}
        
        for d_str, val in zip(context.long_term_dates, context.long_term_values):
            if val <= 0: continue
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            m = dt.month
            month_sums[m] = month_sums.get(m, 0.0) + val
            month_counts[m] = month_counts.get(m, 0) + 1
            
        month_avgs = {}
        for m in range(1, 13):
            if month_counts.get(m, 0) > 5: # Require at least few days to be valid
                month_avgs[m] = month_sums[m] / month_counts[m]
                
        # 1. Winter/Summer Peak (冬夏双峰型)
        # Spec: Jul or Jan > Spring/Autumn * N
        
        summer_val = month_avgs.get(7)
        winter_val = month_avgs.get(1)
        spring_val = month_avgs.get(4)
        autumn_val = month_avgs.get(10)
        
        baseline_vals = []
        if spring_val: baseline_vals.append(spring_val)
        if autumn_val: baseline_vals.append(autumn_val)
        
        if not baseline_vals:
            # Fallback
            baseline_avg = np.mean(context.long_term_values)
        else:
            baseline_avg = np.mean(baseline_vals)
            
        is_peak = False
        peak_months = []
        
        # Threshold N = 1.3
        threshold = 1.3
        
        if summer_val and summer_val > baseline_avg * threshold:
            is_peak = True
            peak_months.append("夏季单峰型")
            
        if winter_val and winter_val > baseline_avg * threshold:
            is_peak = True
            peak_months.append("冬季单峰型")
            
        if is_peak:
            return self.create_tag(
                "冬夏双峰型",
                confidence=0.8,
                reason=f"典型月份(1/7月)负荷显著高于春秋: {'/'.join(peak_months)}突出"
            )
            
        return None

class TemperatureSensitiveRule(BaseRule):
    """
    气温敏感性规则
    识别：气温敏感型、气温钝化型
    依赖: WeatherService
    """
    @property
    def rule_id(self): return "rule_long_temp_sensitive_01"
    
    @property
    def category(self): return "long_term"
    
    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        # Requires weather service availability
        if not hasattr(context, 'weather_service') or not context.weather_service:
           return None
           
        if not context.customer_info or 'location' not in context.customer_info:
            return None
            
        location_name = context.customer_info['location']
        if not location_name: return None
        
        # 1. Get Location ID
        weather_service = context.weather_service
        loc_id = weather_service.get_location_id_by_name(location_name)
        if not loc_id:
            return None
            
        # 2. Get Weather Data
        if not context.long_term_dates: return None
        start_date = context.long_term_dates[0]
        end_date = context.long_term_dates[-1]
        
        temp_map = weather_service.get_daily_weather_series(loc_id, start_date, end_date)
        if len(temp_map) < 30: # Need sufficient weather data
            return None
            
        # 3. Align Load and Temp
        loads = []
        temps = []
        
        for d_str, val in zip(context.long_term_dates, context.long_term_values):
            if val <= 0: continue
            if d_str in temp_map:
                loads.append(val)
                temps.append(temp_map[d_str])
        
        if len(loads) < 30:
            return None
            
        # 4. Calculate Correlation
        if len(set(loads)) < 2 or len(set(temps)) < 2: return None # Constant values
        
        corr = np.corrcoef(loads, temps)[0, 1]
        
        # 5. Tagging
        # High Correlation (Positive or Negative?)
        # Usually U-shaped curve, so linear correlation might be weak over whole year.
        # Ideally, we should check correlation in Summer (T > 20) and Winter (T < 10) separately.
        # But per user spec: "Correlation > R1". Assuming linear for now or segmenting?
        # Let's try simple linear first. Actually, for electricity, it's U-shape. 
        # A simple linear correlation might be near zero if symmetric.
        # "Temperature Sensitive" usually means "High Load at Extremes".
        # Let's calculate correlation of Load vs ABS(Temp - BaseTemp). BaseTemp approx 18-20C.
        
        base_temp = 20.0
        dist_from_base = [abs(t - base_temp) for t in temps]
        
        corr_sensitivity = np.corrcoef(loads, dist_from_base)[0, 1]
        
        # Thresholds
        if corr_sensitivity > 0.6:
            return self.create_tag(
                "气温敏感型",
                confidence=min((corr_sensitivity - 0.6) * 2.5 + 0.5, 1.0),
                reason=f"负荷与温差(基准20度)高度相关, coef={corr_sensitivity:.2f}"
            )
            
        if abs(corr_sensitivity) < 0.2:
             return self.create_tag(
                "气温钝化型",
                confidence=0.8,
                reason=f"负荷与气温相关性低, coef={corr_sensitivity:.2f}"
            )
            
        return None

