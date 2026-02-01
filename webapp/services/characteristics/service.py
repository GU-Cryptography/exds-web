import logging
import numpy as np
import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from webapp.tools.mongo import DATABASE
from webapp.models.customer import Tag, Customer
from webapp.models.anomaly_alert import AnomalyAlert, get_severity_for_alert_type
from webapp.models.characteristic_models import (
    CustomerCharacteristics, LongTermMetrics, ShortTermMetrics, TagItem
)
from webapp.services.load_query_service import LoadQueryService
from webapp.services.contract_service import ContractService

# Import Engine Components
from .engine.context import LabelingContext
from .rules.long_term import ProductionTrendRule, StabilityRule, SeasonalRule, TemperatureSensitiveRule
from .rules.calendar import ProductionCalendarRule, HolidayProductionRule
from .rules.short_term_shift import WorkPatternRule
from .rules.short_term_asset import PhotovoltaicRule, StorageArbitrageRule
from .rules.short_term_behavior import BehaviorPatternRule
from .rules.short_term_cost import CostSensitivityRule
from .rules.anomaly import (
    AnomalyDetectionRule,
    ShapeAnomalyRule, 
    PeakShiftAnomalyRule, 
    ScaleAnomalyRule, 
    VolatilityAnomalyRule, 
    ExtremeAnomalyRule,
    DaySurgeRule
)

# Import Algorithms
from .algorithms.statistics import calculate_cv
from .algorithms.stl_decomposition import calculate_trend_slope
from .algorithms.clustering import calculate_cosine_similarity

from .algorithms.clustering import calculate_cosine_similarity

from webapp.services.weather_service import WeatherService
from webapp.services.tou_service import get_tou_rule_by_date

logger = logging.getLogger(__name__)

class CharacteristicService:
    """
    负荷特征分析服务 (新版)
    基于规则引擎的标签生成系统，同时兼容旧版指标计算
    """
    def __init__(self):
        # 初始化规则库
        self.rules = [
            # Long Term
            ProductionTrendRule(),
            StabilityRule(),
            ProductionCalendarRule(), 
            HolidayProductionRule(), 
            SeasonalRule(), 
            TemperatureSensitiveRule(),
            # Short Term - Shift
            WorkPatternRule(),
            # Short Term - Asset
            PhotovoltaicRule(),
            StorageArbitrageRule(),
            # Short Term - Behavior
            BehaviorPatternRule(),
            # Short Term - Cost
            CostSensitivityRule(),
            # Anomaly Detection (细分)
            ShapeAnomalyRule(),        # 形状异动
            PeakShiftAnomalyRule(),    # 重心异动
            ScaleAnomalyRule(),        # 力度异动
            VolatilityAnomalyRule(),   # 规律异动
            ExtremeAnomalyRule(),      # 剧烈异动 (2.5σ偏离)
            DaySurgeRule(),            # 日环比突变 (100%变化)
            AnomalyDetectionRule()     # IsolationForest 兜底
        ]
        
        self.contract_service = ContractService(DATABASE)
        self.weather_service = WeatherService(DATABASE) # Initialize Weather Service
        self.customers_col = DATABASE['customer_archives']
        self.char_collection = DATABASE['customer_characteristics']
        self.history_col = DATABASE['analysis_history_log']
        self.anomaly_alerts_col = DATABASE['customer_anomaly_alerts']

# ... (omitted parts) ...

    def analyze_customer(self, customer_id: str, date_str: str) -> Optional[List[Tag]]:
        """
        对单个客户进行特征分析
        :param customer_id: 客户ID
        :param date_str: 分析日期 (YYYY-MM-DD)
        :return: 生成的标签列表，如果失败则返回 None
        """
        try:
            date = datetime.strptime(date_str, "%Y-%m-%d")
            
            # 1. 构建数据上下文
            context = self._build_context(customer_id, date)
            if context is None:
                logger.warning(f"Skipping analysis for {customer_id}: No data context")
                return []
            
            # 2. 运行所有规则，收集标签
            tags = []
            for rule in self.rules:
                try:
                    tag = rule.evaluate(context)
                    if tag:
                        tags.append(tag)
                except Exception as e:
                    logger.error(f"Rule {rule.rule_id} failed for {customer_id}: {e}")
                    continue
            
            # 3. 计算遗留指标（用于向后兼容）
            long_term_metrics = self._calc_legacy_long_term(context, date)
            short_term_metrics = self._calc_legacy_short_term(customer_id, date)
            
            # 4. 保存结果
            self._save_results(customer_id, date, tags, long_term_metrics, short_term_metrics)
            
            # 5. 保存异动告警到历史记录
            self._save_anomaly_alerts(customer_id, context, date_str, tags)
            
            logger.info(f"Analyzed {customer_id}: {len(tags)} tags generated")
            return tags
            
        except Exception as e:
            logger.error(f"Failed to analyze customer {customer_id}: {e}", exc_info=True)
            return None

    def _build_context(self, customer_id: str, date: datetime) -> Optional[LabelingContext]:
        """构建数据上下文，聚合多源数据"""
        date_str = date.strftime("%Y-%m-%d")
        
        # A. 获取短周期数据 (昨日96点)
        curve = LoadQueryService.get_daily_curve(customer_id, date_str)
        # 允许 curve 为空，如果只做长周期? 不，Context必须有基础
        load_series = curve.values if curve else []
        total_load = curve.total if curve else 0.0
        
        # Calculate Tou Info
        tou_info = None
        if curve and curve.tou_usage and total_load > 0:
            u = curve.tou_usage
            tou_info = {
                "tip": u.tip / total_load,
                "peak": u.peak / total_load,
                "flat": u.flat / total_load,
                "valley": u.valley / total_load,
                "deep": u.deep / total_load
            }
        
        # B. 获取长周期数据 (过去365天日电量 - for Legacy Long Term metrics)
        start_date_hist = (date - timedelta(days=365)).strftime("%Y-%m-%d")
        daily_totals = LoadQueryService.get_daily_totals(
            customer_id, start_date_hist, date_str
        )
        
        long_term_dates = []
        long_term_values = []
        if daily_totals:
            long_term_dates = [dt.date for dt in daily_totals]
            long_term_values = [dt.total for dt in daily_totals]

        # C. 计算典型负荷曲线 (过去30天平均)
        # 用于班次识别等通用特征，比单日曲线更稳定
        start_date_recent = (date - timedelta(days=30)).strftime("%Y-%m-%d")
        recent_curves = LoadQueryService.get_curve_series(customer_id, start_date_recent, date_str)
        typical_load_series = []
        
        if recent_curves:
            valid_curves = [c.values for c in recent_curves if c.values and len(c.values) in [48, 96]]
            if valid_curves:
                # Normalize to 96 points for internal engine
                normalized_curves = []
                for vals in valid_curves:
                    if len(vals) == 48:
                        # Interpolate to 96
                        vals_96 = []
                        for v in vals:
                            vals_96.extend([v, v]) # Simple repeat
                        normalized_curves.append(vals_96)
                    else:
                        normalized_curves.append(vals)
                
                if normalized_curves:
                    matrix = np.array(normalized_curves)
                    avg_curve = np.mean(matrix, axis=0)
                    typical_load_series = avg_curve.tolist()

        # Calculate TOU Info (Aggregate from recent 30 days)
        tou_info = None
        if recent_curves:
            tip_sum = peak_sum = flat_sum = valley_sum = deep_sum = total_sum = 0.0
            count = 0
            for c in recent_curves:
                if c.tou_usage and c.total > 0:
                    tip_sum += c.tou_usage.tip
                    peak_sum += c.tou_usage.peak
                    flat_sum += c.tou_usage.flat
                    valley_sum += c.tou_usage.valley
                    deep_sum += c.tou_usage.deep
                    total_sum += c.total
                    count += 1
            
            if total_sum > 0:
                tou_info = {
                    "tip": tip_sum / total_sum,
                    "peak": peak_sum / total_sum,
                    "flat": flat_sum / total_sum,
                    "valley": valley_sum / total_sum,
                    "deep": deep_sum / total_sum
                }
        
        # Fallback to daily curve if aggregation failed
        if not tou_info and curve and curve.tou_usage and total_load > 0:
            u = curve.tou_usage
            tou_info = {
                "tip": u.tip / total_load,
                "peak": u.peak / total_load,
                "flat": u.flat / total_load,
                "valley": u.valley / total_load,
                "deep": u.deep / total_load
            }

        # 如果数据太少，可能无法构建有效 Context
        if not long_term_values and not load_series and not typical_load_series:
            return None
            
        # Get Customer Info for Location
        cust_profile = self.customers_col.find_one({"_id": customer_id}, {"location": 1})
        if not cust_profile: # Try ObjectId
             from bson import ObjectId
             try:
                 cust_profile = self.customers_col.find_one({"_id": ObjectId(customer_id)}, {"location": 1})
             except:
                 pass
        
        cust_info = {"location": cust_profile.get("location") if cust_profile else None}
            
        context = LabelingContext(
            customer_id=customer_id,
            date=date,
            load_series=load_series,
            total_load=total_load,
            long_term_dates=long_term_dates,
            long_term_values=long_term_values,
            typical_load_series=typical_load_series, 
            customer_info=cust_info, # Inject Customer Info
            weather_service=self.weather_service, # Inject Weather Service
            tou_info=tou_info # Inject TOU Info
        )
        return context

    def _calc_legacy_long_term(self, context: LabelingContext, end_date: datetime) -> Optional[LongTermMetrics]:
        """计算长周期指标 (移植自旧版)"""
        if not context.long_term_values:
            return None
            
        totals = [v for v in context.long_term_values if v is not None]
        dates = context.long_term_dates
        if not totals:
            return None
            
        avg_daily_load = float(np.mean(totals))
        total_annual_load = float(np.sum(totals))
        cv = calculate_cv(totals)
        zero_days = sum(1 for t in totals if t < 1.0)
        
        # Trend Slope (Linear Regression)
        # Note: Need to normalize? Old code normalized by mean.
        mean_val = np.mean(totals) if np.mean(totals) > 0 else 1.0
        norm_totals = [t/mean_val for t in totals]
        n = len(norm_totals)
        if n > 1:
            slope = float(np.polyfit(np.arange(n), norm_totals, 1)[0])
        else:
            slope = 0.0
            
        # Recent Growth (Last 90 vs Prev 90)
        recent_growth = 0.0
        if len(totals) >= 180:
            last_90 = np.sum(totals[-90:])
            prev_90 = np.sum(totals[-180:-90])
            if prev_90 > 0:
                recent_growth = float((last_90 - prev_90) / prev_90)
                
        # Seasonality (Simple Month Aggregation)
        summer_vals, winter_vals, sa_vals = [], [], []
        pk_vals, wd_vals = [], [] # Peak(Weekend?), Workday
        
        for d_str, val in zip(dates, totals):
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            m = dt.month
            if m == 7: summer_vals.append(val)
            elif m == 1: winter_vals.append(val)
            elif m in [4, 10]: sa_vals.append(val)
            
            if dt.weekday() >= 5: pk_vals.append(val) # Weekend
            else: wd_vals.append(val)
            
        summer_avg = float(np.mean(summer_vals)) if summer_vals else None
        winter_avg = float(np.mean(winter_vals)) if winter_vals else None
        sa_avg = float(np.mean(sa_vals)) if sa_vals else None
        
        wk_avg = np.mean(pk_vals) if pk_vals else 0
        wd_avg = np.mean(wd_vals) if wd_vals else 0
        weekend_ratio = float(wk_avg / wd_avg) if wd_avg > 0 else 1.0
        
        return LongTermMetrics(
            data_start=dates[0],
            data_end=dates[-1],
            avg_daily_load=round(avg_daily_load, 2),
            total_annual_load=round(total_annual_load, 2),
            trend_slope=round(slope, 5),
            recent_3m_growth=round(recent_growth, 4),
            cv=round(cv, 4),
            zero_days=zero_days,
            weekend_ratio=round(weekend_ratio, 2),
            summer_avg=round(summer_avg, 2) if summer_avg else None,
            winter_avg=round(winter_avg, 2) if winter_avg else None,
            spring_autumn_avg=round(sa_avg, 2) if sa_avg else None
        )

    def _calc_legacy_short_term(self, customer_id: str, end_date: datetime) -> Optional[ShortTermMetrics]:
        """计算短周期指标 (移植自旧版，需额外查询曲线)"""
        start_date = end_date - timedelta(days=30)
        start_date_str = start_date.strftime("%Y-%m-%d")
        end_date_str = end_date.strftime("%Y-%m-%d")
        
        curves = LoadQueryService.get_curve_series(customer_id, start_date_str, end_date_str)
        if not curves:
            return None
            
        valid_curves = [c.values for c in curves if c.values and len(c.values) in [48, 96]]
        if not valid_curves:
            return None
            
        # Normalize to 48 points
        normalized_curves = []
        for vals in valid_curves:
            if len(vals) == 96:
                vals = [(vals[i] + vals[i+1])/2 for i in range(0, 96, 2)]
            normalized_curves.append(vals)
            
        matrix = np.array(normalized_curves)
        avg_curve = np.mean(matrix, axis=0)
        std_curve = np.std(matrix, axis=0)
        
        max_val = np.max(avg_curve)
        if max_val > 0:
            norm_avg_curve = avg_curve / max_val # Usage?
        
        avg_load = float(np.mean(avg_curve))
        peak_val = float(np.max(avg_curve))
        valley_val = float(np.min(avg_curve))
        
        avg_load_rate = float(avg_load / peak_val) if peak_val > 0 else 0.0
        min_max_ratio = float(valley_val / peak_val) if peak_val > 0 else 0.0
        
        # Curve Similarity
        sims = [calculate_cosine_similarity(c, avg_curve.tolist()) for c in normalized_curves]
        avg_similarity = float(np.mean(sims))
        
        # TOU Ratios
        tip_sum = peak_sum = flat_sum = valley_sum = deep_sum = 0.0
        for c in curves:
            if c.tou_usage:
                tip_sum += c.tou_usage.tip
                peak_sum += c.tou_usage.peak
                flat_sum += c.tou_usage.flat
                valley_sum += c.tou_usage.valley
                deep_sum += c.tou_usage.deep
        grand_total = tip_sum + peak_sum + flat_sum + valley_sum + deep_sum
        
        # Price Sensitivity Score
        price_sensitivity = self._calc_price_sensitivity(avg_curve, end_date)
        
        return ShortTermMetrics(
            data_start=start_date_str,
            data_end=end_date_str,
            avg_curve=[round(x, 4) for x in avg_curve.tolist()],
            std_curve=[round(x, 4) for x in std_curve.tolist()],
            avg_load_rate=round(avg_load_rate, 4),
            min_max_ratio=round(min_max_ratio, 4),
            peak_hour=int(np.argmax(avg_curve)),
            valley_hour=int(np.argmin(avg_curve)),
            curve_similarity=round(avg_similarity, 4),
            cv=round(calculate_cv(avg_curve.tolist()), 4), # Note: Old code used avg of daily CVs, this uses CV of avg curve? Old: `mean(day_cvs)`. Correct if needed.
            tip_ratio=round(tip_sum/grand_total, 4) if grand_total else 0,
            peak_ratio=round(peak_sum/grand_total, 4) if grand_total else 0,
            flat_ratio=round(flat_sum/grand_total, 4) if grand_total else 0,
            valley_ratio=round(valley_sum/grand_total, 4) if grand_total else 0,
            valley_ratio=round(valley_sum/grand_total, 4) if grand_total else 0,
            deep_ratio=round(deep_sum/grand_total, 4) if grand_total else 0,
            price_sensitivity_score=price_sensitivity
        )

    def _calc_price_sensitivity(self, load_curve: np.ndarray, date_obj: datetime) -> Optional[float]:
        """
        计算价格敏感度评分 (0-100)
        基于负荷曲线与电价曲线的相关性
        """
        try:
            # 1. 获取当月分时电价规则
            tou_map = get_tou_rule_by_date(date_obj)
            if not tou_map or len(tou_map) != 96:
                return None
                
            # 2. 构建电价评分向量 (96点)
            # 尖峰(5) > 高峰(4) > 平段(3) > 低谷(2) > 深谷(1)
            score_map = {
                "尖峰": 5, "高峰": 4, "平段": 3, "低谷": 2, "深谷": 1
            }
            
            price_vector = []
            # tou_map keys are "00:00", "00:15", ... "23:45"
            # load_curve could be 48 or 96 points. The input avg_curve is from _calc_legacy_short_term which normalizes to 48 points!
            # Wait, _calc_legacy_short_term normalizes input to 48 points for avg_curve? 
            # Yes: "Normalize to 48 points... avg_curve = np.mean..."
            # So load_curve has 48 points.
            
            # We need to adapt price vector to 48 points (taking every second point or average)
            sorted_times = sorted(tou_map.keys()) # 00:00 to 23:45
            
            # 48 points -> 00:30, 01:00 ... (Original logic usually means 00:00-00:30 is point 0)
            # Let's align with the curve. 
            # If load_curve has 48 points, idx 0 represents 00:00-00:30.
            # TOU map has 00:00 and 00:15.
            # We take average score of 00:00 and 00:15 for point 0.
            
            for i in range(48):
                t1 = sorted_times[i*2]     # e.g. 00:00
                t2 = sorted_times[i*2 + 1] # e.g. 00:15
                
                s1 = score_map.get(tou_map[t1], 3)
                s2 = score_map.get(tou_map[t2], 3)
                price_vector.append((s1 + s2) / 2.0)
                
            # 3. 计算相关系数 (Pearson)
            if len(load_curve) != 48:
                return None
                
            # Normalize arrays
            load_arr = np.array(load_curve)
            price_arr = np.array(price_vector)
            
            # Standard Deviation check to avoid division by zero
            if np.std(load_arr) == 0 or np.std(price_arr) == 0:
                return 50.0 # Neutral
                
            correlation = np.corrcoef(load_arr, price_arr)[0, 1]
            
            # 4. 转换为评分 (0-100)
            # Corr = -1 (负相关, 价格高负荷低) -> Score 100
            # Corr = 1 (正相关, 价格高负荷高) -> Score 0
            # Corr = 0 -> Score 50
            
            score = (1 - correlation) * 50
            return max(0.0, min(100.0, round(score, 1)))
            
        except Exception as e:
            logger.error(f"Failed to calc price sensitivity: {e}")
            return None

    def _save_results(self, customer_id: str, date: datetime, tags: List[Tag], 
                     long_term: Optional[LongTermMetrics], short_term: Optional[ShortTermMetrics]):
        """持久化结果：更新客户画像 + 写入历史日志 + 更新特征表"""
        from bson import ObjectId
        
        try:
            oid = ObjectId(customer_id)
        except:
            oid = customer_id
            
        cust_profile = self.customers_col.find_one({"_id": oid}, {"user_name": 1, "tags": 1})
        cust_name = cust_profile.get("user_name", "Unknown") if cust_profile else "Unknown"
        
        # 1. Update Customer Archives Tags
        existing_tags = cust_profile.get("tags", []) if cust_profile else []
        manual_tags = [t for t in existing_tags if t.get("source") == "MANUAL"]
        new_auto_tags_dicts = [t.model_dump() for t in tags]
        final_tags = manual_tags + new_auto_tags_dicts
        
        self.customers_col.update_one(
            {"_id": oid},
            {"$set": {
                "tags": final_tags, 
                "updated_at": datetime.now()
            }}
        )
        
        
        # 2. 计算规律性评分和质量评级
        reg_score = 0
        quality = "C"
        if short_term:
            reg_score = min(100, int((short_term.curve_similarity or 0) * 100))
            if reg_score > 90 and long_term and long_term.cv < 0.2:
                quality = "A"
            elif reg_score > 80:
                quality = "B"
        
        # 3. 更新 customer_characteristics (不再存储标签副本)
        char_doc = CustomerCharacteristics(
            customer_id=customer_id,
            customer_name=cust_name,
            updated_at=datetime.now(),
            long_term=long_term,
            short_term=short_term,
            tags=[],  # 不再存储标签副本
            regularity_score=reg_score,
            quality_rating=quality,
            baseline_curve=short_term.avg_curve if short_term else None
        )
        
        self.char_collection.update_one(
            {"customer_id": customer_id},
            {"$set": char_doc.model_dump(exclude={"id", "tags"})},  # 排除 tags 字段
            upsert=True
        )

        # 3. Append to History Log
        log_entry = {
            "customer_id": customer_id,
            "date": date.strftime("%Y-%m-%d"),
            "execution_time": datetime.now(),
            "tags_snapshot": new_auto_tags_dicts,
            "rule_ids": [t.rule_id for t in tags]
        }
        self.history_col.update_one(
            {
                "customer_id": customer_id,
                "date": date.strftime("%Y-%m-%d")
            },
            {"$set": log_entry},
            upsert=True
        )

    def _save_anomaly_alerts(self, customer_id: str, context, date_str: str, tags: List[Tag]):
        """
        保存异动告警到历史记录集合
        只保存 category='anomaly' 的标签
        """
        # 获取客户名称
        cust_doc = self.customers_col.find_one({"_id": customer_id}, {"user_name": 1})
        if not cust_doc:
            from bson import ObjectId
            try:
                cust_doc = self.customers_col.find_one({"_id": ObjectId(customer_id)}, {"user_name": 1})
            except:
                pass
        cust_name = cust_doc.get("user_name", "未知") if cust_doc else "未知"
        
        # 过滤异动标签
        anomaly_tags = [t for t in tags if t.rule_id and t.rule_id.startswith("rule_anomaly")]
        
        if not anomaly_tags:
            return
            
        # 构建指标快照
        metrics_snapshot = {
            "total_load": round(context.total_load, 2) if context.total_load else 0,
            "load_rate": round(context.load_rate, 4) if context.load_rate else 0,
        }
        if context.long_term_values:
            recent_30 = context.long_term_values[-30:] if len(context.long_term_values) >= 30 else context.long_term_values
            metrics_snapshot["avg_load_30d"] = round(float(np.mean(recent_30)), 2)
            metrics_snapshot["std_load_30d"] = round(float(np.std(recent_30)), 2)
        
        # 为每个异动标签创建告警记录
        for tag in anomaly_tags:
            severity = get_severity_for_alert_type(tag.name, tag.confidence)
            
            alert = AnomalyAlert(
                customer_id=customer_id,
                customer_name=cust_name,
                alert_date=date_str,
                alert_type=tag.name,
                severity=severity,
                confidence=tag.confidence,
                reason=tag.reason or "",
                metrics=metrics_snapshot,
                rule_id=tag.rule_id or ""
            )
            
            # 使用 upsert 避免同一客户同一天同一类型的重复告警
            self.anomaly_alerts_col.update_one(
                {
                    "customer_id": customer_id,
                    "alert_date": date_str,
                    "alert_type": tag.name
                },
                {"$set": alert.model_dump()},
                upsert=True
            )
        
        if anomaly_tags:
            logger.info(f"Saved {len(anomaly_tags)} anomaly alerts for {customer_id} on {date_str}")

    def analyze_all_active_customers(self, date_str: str) -> Dict[str, int]:
        """批量分析所有签约客户"""
        # Fix: call with correct arguments
        customer_ids = self.contract_service.get_active_customers(date_str, date_str)
        
        success_count = 0
        fail_count = 0
        
        for cid in customer_ids:
            res = self.analyze_customer(cid, date_str)
            if res is not None: 
                success_count += 1
            else:
                fail_count += 1
                
        return {"total": len(customer_ids), "success": success_count, "fail": fail_count}

    def analyze_year_customers(self, year: int, target_date_str: str) -> Dict[str, int]:
        """
        批量分析指定年份所有签约客户 (无论当前是否生效)
        :param year: 年份 (e.g. 2026)
        :param target_date_str: 分析的目标日期 (通常是昨日)
        """
        start_date = f"{year}-01-01"
        end_date = f"{year}-12-31"
        
        # 获取该年份所有涉及的客户
        customer_ids = self.contract_service.get_active_customers(start_date, end_date)
        logger.info(f"Found {len(customer_ids)} customers for year {year}")
        
        success_count = 0
        fail_count = 0
        
        for cid in customer_ids:
            # 即使客户合同尚未开始，如果有历史负荷数据（续签情况），仍然可以分析
            res = self.analyze_customer(cid, target_date_str)
            if res is not None: # Returns list or empty list, None implies crash?
                # analyze_customer returns [] on warning/error, but let's assume it always returns list
                success_count += 1
            else:
                fail_count += 1
                
        return {"total": len(customer_ids), "success": success_count, "fail": fail_count}
