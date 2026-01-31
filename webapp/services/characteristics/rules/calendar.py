from typing import Optional, List, Dict
from datetime import datetime, timedelta
import numpy as np

from ..engine.base_rule import BaseRule
from ..engine.context import LabelingContext
from webapp.models.customer import Tag

# Hardcoded Spring Festival Dates (Year -> Date String)
SPRING_FESTIVAL_DATES = {
    2023: "2023-01-22",
    2024: "2024-02-10",
    2025: "2025-01-29",
    2026: "2026-02-17",
    2027: "2027-02-06"
}

class ProductionCalendarRule(BaseRule):
    """
    生产日历规则 (基于长周期)
    识别：标准双休型、周末生产型
    """
    @property
    def rule_id(self): return "rule_long_calendar_01"
    
    @property
    def category(self): return "long_term"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.long_term_values or not context.long_term_dates:
            return None
            
        wd_loads = []
        we_loads = []
        
        # Simple classification: Mon-Fri = Workday(0-4), Sat-Sun = Weekend(5-6)
        # Note: Ideally we should exclude holidays from workdays, but for long term general pattern, simple check is often enough.
        
        for d_str, val in zip(context.long_term_dates, context.long_term_values):
            if val <= 0: continue # Skip zero load
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            if dt.weekday() >= 5:
                we_loads.append(val)
            else:
                wd_loads.append(val)
                
        if not wd_loads or not we_loads:
            return None
            
        avg_wd = np.mean(wd_loads)
        avg_we = np.mean(we_loads)
        
        if avg_wd <= 0: return None
        
        ratio = avg_we / avg_wd
        
        # 1. Weekend Production (周末生产型)
        # Ratio ~ 1.0 (e.g., > 0.95)
        if ratio > 0.90: # Relaxed slightly from 0.95 to capture more
             return self.create_tag(
                "周末生产型", 
                confidence=min((ratio - 0.90) * 10 + 0.5, 1.0),
                reason=f"周末/工作日负荷比 {ratio:.2f} (无明显周末停产)"
            )
            
        # 2. Standard Double Off (标准双休型)
        # Ratio low (e.g., < 0.6)
        if ratio < 0.60:
            return self.create_tag(
                "标准双休型",
                confidence=min((0.60 - ratio) * 2 + 0.6, 1.0),
                reason=f"周末/工作日负荷比 {ratio:.2f} (周末显著降负荷)"
            )
            
        # Optional: Weekend Single Off (周末单休型) if 0.6 <= ratio <= 0.85?
        # User explicitly asked for "Weekend Single Off" in previous prompts, though not in latest table.
        # But latest table has "Standard Double Off" and "Weekend Production".
        # Let's add "Weekend Single Off" for completeness if it falls in between.
        if 0.60 <= ratio <= 0.85:
             return self.create_tag(
                "周末单休型",
                confidence=0.7,
                reason=f"周末/工作日负荷比 {ratio:.2f} (疑似单休或部分停产)"
            )
            
        return None

class HolidayProductionRule(BaseRule):
    """
    节日生产规则 (基于长周期)
    识别：春节深调型、节后慢热型
    """
    @property
    def rule_id(self): return "rule_long_holiday_01"
    
    @property
    def category(self): return "long_term"

    def evaluate(self, context: LabelingContext) -> Optional[Tag]:
        if not context.long_term_values:
            return None
            
        # Determine the relevant year(s) in the data
        # Data is usually 365 days back.
        # Check if we cover a Spring Festival.
        
        # Build a map of date -> value
        date_val_map = dict(zip(context.long_term_dates, context.long_term_values))
        
        # Find which SF falls in range
        sf_year = None
        sf_date_str = None
        
        data_start = context.long_term_dates[0]
        data_end = context.long_term_dates[-1]
        
        for year, date_str in SPRING_FESTIVAL_DATES.items():
            if date_str >= data_start and date_str <= data_end:
                sf_year = year
                sf_date_str = date_str
                break
                
        if not sf_date_str:
            return None # No Spring Festival in data range
            
        # Calculate "Normal" Level (e.g. avg of month before SF, excluding week before)
        sf_dt = datetime.strptime(sf_date_str, "%Y-%m-%d")
        
        # Baseline: 30 days before SF (minus 7 days immediately before to avoid ramp down)
        base_start = sf_dt - timedelta(days=37)
        base_end = sf_dt - timedelta(days=7)
        
        baseline_vals = []
        curr = base_start
        while curr <= base_end:
            d_s = curr.strftime("%Y-%m-%d")
            if d_s in date_val_map:
                baseline_vals.append(date_val_map[d_s])
            curr += timedelta(days=1)
            
        if not baseline_vals:
            return None
            
        baseline_avg = np.mean(baseline_vals)
        if baseline_avg <= 0: return None
        
        # 1. Spring Festival Deep Drop (春节深调型)
        # SF Period: Eve to Day 7 (8 days) or roughly 7-14 days?
        # Spec: "Load < Normal * N%, Duration > M Days"
        # Let's check SF Day to SF+7 (7 days)
        sf_vals = []
        curr = sf_dt
        check_end = sf_dt + timedelta(days=6)
        
        while curr <= check_end:
            d_s = curr.strftime("%Y-%m-%d")
            if d_s in date_val_map:
                sf_vals.append(date_val_map[d_s])
            curr += timedelta(days=1)
            
        if sf_vals:
            sf_avg = np.mean(sf_vals)
            ratio = sf_avg / baseline_avg
            
            if ratio < 0.5: # < 50% of normal
                return self.create_tag(
                    "春节深调型",
                    confidence=min((0.5 - ratio) * 2 + 0.6, 1.0),
                    reason=f"春节期间负荷仅为平时的 {ratio:.0%}"
                )
                
        # 2. Post-Holiday Slow (节后慢热型)
        # Spec: "Post-holiday 1st week < Normal * K%"
        # Post-Holiday: SF+7 to SF+13
        post_start = sf_dt + timedelta(days=7)
        post_end = sf_dt + timedelta(days=13)
        
        post_vals = []
        curr = post_start
        while curr <= post_end:
            d_s = curr.strftime("%Y-%m-%d")
            if d_s in date_val_map:
                post_vals.append(date_val_map[d_s])
            curr += timedelta(days=1)
            
        if post_vals:
            post_avg = np.mean(post_vals)
            post_ratio = post_avg / baseline_avg
            
            if post_ratio < 0.7: # Still < 70% after 1 week
                 return self.create_tag(
                    "节后慢热型",
                    confidence=min((0.7 - post_ratio) * 2 + 0.6, 1.0),
                    reason=f"节后首周负荷仅为平时的 {post_ratio:.0%}"
                )
        
        return None
