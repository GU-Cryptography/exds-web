import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
import numpy as np
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.models.medium_term_forecast import (
    MediumTermForecastResult, DailyForecastItem, MonthlyForecastItem
)
from webapp.models.characteristic_models import CustomerCharacteristics
from webapp.services.contract_service import ContractService
from webapp.services.load_query_service import LoadQueryService
from webapp.services.characteristics.algorithms.statistics import calculate_cv

logger = logging.getLogger(__name__)

class MediumTermForecastService:
    """
    中长期负荷预测服务
    策略: "分而治之" (Divide and Conquer)
    1. High Regularity (Score >= 80): 历史映射 (History Mapping)
    2. Medium Regularity (50 <= Score < 80): 趋势外推 + 双基线 (Trend + Dual-Baseline)
    3. Low Regularity (Score < 50): 均值填充 (Flat Average)
    """
    def __init__(self):
        self.db = DATABASE
        self.collection = self.db['medium_term_load_forecast']
        self.char_col = self.db['customer_characteristics']
        self.contract_service = ContractService(self.db)
        # LoadQueryService is static

    def execute_forecast(self, forecast_date_str: str = None, operator: str = "system") -> str:
        """
        [手动触发] 执行一次完整预测
        :param forecast_date_str: 预测发布日期 (YYYY-MM-DD), 默认为今天
        :return: 生成的 forecast_id
        """
        if not forecast_date_str:
            forecast_date_str = datetime.now().strftime("%Y-%m-%d")
            
        forecast_date = datetime.strptime(forecast_date_str, "%Y-%m-%d")
        logger.info(f"Starting Medium-Term Forecast for release date: {forecast_date_str}")

        # 1. 确定预测范围 (未来30天)
        # Start from Tomorrow
        start_date = forecast_date + timedelta(days=1)
        end_date = forecast_date + timedelta(days=30)
        target_dates = [(start_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(30)]

        # 2. 获取所有活跃客户
        # 使用 forecast_date 作为基准，查询在未来30天内有效的客户
        # 简化起见，查询 start_date 当天有效的客户
        active_customers = self.contract_service.get_active_customers(
            start_date.strftime("%Y-%m-%d"), 
            end_date.strftime("%Y-%m-%d")
        )
        logger.info(f"Found {len(active_customers)} active customers for forecast period.")

        # 3. 逐户预测并聚合
        # customer_forecasts: Dict[str, List[float]] = {} # 暂不需要存储单户日电量，若需要可在此扩展

        # 预加载所有特征
        char_map = self._load_customer_characteristics(active_customers)

        total_curves_map: Dict[str, List[float]] = {d: [0.0]*48 for d in target_dates} # date -> 48 points sum
        total_loads_map: Dict[str, float] = {d: 0.0 for d in target_dates}
        
        # Store daily loads for Top 10 calculation: List of Dict[customer_id, load]
        daily_customer_limits = [{} for _ in range(30)]

        for cust_id in active_customers:
            char = char_map.get(cust_id)
            score = char.get("regularity_score", 0) if char else 0
            
            # Predict Returns: List of 48-point curves for each date
            curves_30d = [] 
            if score >= 80:
                curves_30d = self._predict_curves_high(cust_id, char, target_dates)
            elif score >= 50:
                curves_30d = self._predict_curves_medium(cust_id, char, target_dates)
            else:
                # low strategy might need char or not, pass it safely
                curves_30d = self._predict_curves_low(cust_id, char, target_dates)
            
            # Aggregate
            for idx, date_str in enumerate(target_dates):
                if idx >= len(curves_30d): break
                
                daily_curve = curves_30d[idx]
                if not daily_curve: daily_curve = [0.0]*48
                
                daily_sum = sum(daily_curve)
                
                # Add to total curve
                current_total_curve = total_curves_map[date_str]
                # Ensure length matches
                if len(current_total_curve) == 48 and len(daily_curve) == 48:
                     total_curves_map[date_str] = [x + y for x, y in zip(current_total_curve, daily_curve)]
                
                # Add to total load
                total_loads_map[date_str] += daily_sum
                
                # Record for Top 10
                daily_customer_limits[idx][cust_id] = daily_sum

        # 5. 构建结果对象
        daily_forecast_items = []
        for idx, date_str in enumerate(target_dates):
            total_load = total_loads_map[date_str]
            total_curve = total_curves_map[date_str]
            
            # Identify Top 10 customers for this day
            daily_breakdown = []
            if idx < len(daily_customer_limits):
                # Sort by load desc
                sorted_custs = sorted(daily_customer_limits[idx].items(), key=lambda x: x[1], reverse=True)[:10]
                for cid, load in sorted_custs:
                    c_name = char_map.get(cid, {}).get("customer_name", cid) if char_map else cid
                    daily_breakdown.append({"name": c_name, "value": round(load, 2)})

            item = DailyForecastItem(
                target_date=date_str,
                total_load=round(total_load, 2),
                total_curve=[round(x, 2) for x in total_curve],
                key_customers_breakdown=daily_breakdown
            )
            daily_forecast_items.append(item)

        # 6. 月度预测 (Placeholder)
        # 6. 月度预测
        # 使用生成的日预测数据聚合第一个月，并简单外推后两个月
        monthly_forecast_items = self._predict_monthly_3_months(forecast_date, daily_forecast_items)

        # 7. Save
        result = MediumTermForecastResult(
            forecast_date=forecast_date_str,
            operator=operator,
            daily_forecasts=daily_forecast_items,
            monthly_forecasts=monthly_forecast_items
        )
        
        ins_result = self.collection.insert_one(result.model_dump())
        return str(ins_result.inserted_id)

    def verify_accuracy(self, target_date: str) -> Dict[str, float]:
        """
        [手动触发] 计算指定日期的准确率 (T+1 回溯)
        :param target_date: 目标日期 YYYY-MM-DD (通常是昨天)
        """
        # 1. 获取该日期的实际负荷
        actual_curve_96 = LoadQueryService.get_system_total_curve(target_date)
        if not actual_curve_96 or not actual_curve_96.values:
            logger.warning(f"No actual data for {target_date}, cannot verify.")
            return {"error": "No actual data"}
            
        # Resample 96 -> 48
        actual_curve_48 = [(actual_curve_96.values[i] + actual_curve_96.values[i+1]) for i in range(0, 96, 2)] # Sum or Avg?
        # Power(MW) * Time(h). If 96 points, typically MW. Energy is Integrate.
        # If "values" are Power (MW), then 48 point value (half hour) should be average of two 15-min points?
        # Definition: 48点通常是 96点每两个点的平均值 (代表30分钟的平均功率)
        actual_curve_48 = [(actual_curve_96.values[i] + actual_curve_96.values[i+1])/2.0 for i in range(0, 96, 2)]
        actual_total_load = sum(actual_curve_48) * 0.5 # MWh? Depends on unit. Assuming curve is MW, then sum * 0.5h is MWh.
        # But wait, `total_load` in our system is usually Sum of points? 
        # `curve.total` in LoadQueryService is aggregated.
        # Let's use `actual_curve_96.total` if available as the Truth for Total Load.
        actual_total_energy = actual_curve_96.total
        
        # 2. 查找所有预测了该日期的记录
        # find documents where daily_forecasts.target_date == target_date
        records = self.collection.find({"daily_forecasts.target_date": target_date})
        
        updated_count = 0
        wmape_sum = 0
        count = 0
        
        for doc in records:
            # Locate the specific item in the array
            forecasts = doc.get("daily_forecasts", [])
            updated_items = []
            found = False
            
            for item in forecasts:
                if item["target_date"] == target_date:
                     forecast_curve = item["total_curve"] # 48 points
                     
                     # Calculate WMAPE
                     # WMAPE = Sum(|Act - Fcst|) / Sum(Act)
                     diff_sum = sum([abs(a - f) for a, f in zip(actual_curve_48, forecast_curve)])
                     sum_act = sum(actual_curve_48)
                     wmape = 0.0
                     if sum_act > 0:
                         wmape = diff_sum / sum_act
                     
                     item["actual_load"] = round(actual_total_energy, 2)
                     item["wmape"] = round(wmape, 4)
                     found = True
                     
                     wmape_sum += wmape
                     count += 1
                updated_items.append(item)
            
            if found:
                self.collection.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"daily_forecasts": updated_items}}
                )
                updated_count += 1
                
        avg_wmape = (wmape_sum / count) if count > 0 else 0
        return {
            "target_date": target_date,
            "updated_records": updated_count,
            "avg_wmape": avg_wmape,
            "actual_load": actual_total_energy
        }

    # --- Internal Algorithms (Placeholders for now) ---

    def _predict_curves_high(self, cust_id: str, char: Dict, target_dates: List[str]) -> List[List[float]]:
        """
        High Regularity: History Mapping
        简单实现: 使用 characteristic.baseline_curve (典型曲线) * 随机波动
        TODO: 真正的 History Mapping 应该找去年同期 or 上个月同周期的曲线
        """
        baseline = char.get("baseline_curve") or [0.1]*48
        if len(baseline) == 96:
            baseline = [(baseline[i]+baseline[i+1])/2 for i in range(0, 96, 2)]
            
        # 区分工作日/周末 (Triple-Baseline)
        bl_workday = char.get("baseline_workday") or baseline
        bl_weekend = char.get("baseline_weekend") or baseline
        
        results = []
        for date_str in target_dates:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            
            # Select Baseline
            if self._is_holiday(dt):
                # TODO: Legal Holiday Baseline
                selected_curve = bl_weekend # Fallback to weekend
            elif dt.weekday() >= 5:
                selected_curve = bl_weekend
            else:
                selected_curve = bl_workday
                
            # Apply Trend (Optional, from long_term metrics)
            # For now, just return baseline
            results.append(selected_curve)
        return results

    def _predict_curves_medium(self, cust_id: str, char: Dict, target_dates: List[str]) -> List[List[float]]:
        """Medium: Trend + Dual Baseline"""
        # Similar logic to High for now, but theoretically should apply trend
        return self._predict_curves_high(cust_id, char, target_dates)

    def _predict_curves_low(self, cust_id: str, char: Dict, target_dates: List[str]) -> List[List[float]]:
        """Low: Flat Average"""
        # Use simple average if baseline exists, else very small load
        baseline = char.get("baseline_curve") if char else None
        if not baseline:
             # Try to search history? No, too slow. Return 0.
             return [[0.0]*48 for _ in target_dates]
             
        if len(baseline) == 96:
            baseline = [(baseline[i]+baseline[i+1])/2 for i in range(0, 96, 2)]
            
        avg_val = sum(baseline) / len(baseline)
        flat_curve = [avg_val] * 48
        return [flat_curve for _ in target_dates]
        
    def _predict_monthly_3_months(self, forecast_date: datetime, daily_items: List[DailyForecastItem]) -> List[MonthlyForecastItem]:
        """
        生成未来3个月的月度预测
        """
        results = []
        
        # Determine 3 months
        # Start from forecast_date + 1 day
        start_dt = forecast_date + timedelta(days=1)
        
        # Simple iteration to get 3 months: Current Month (start_dt's month) + Next + Next
        # Logic: If Today is 10-31, Start is 11-01. M1=11, M2=12, M3=1.
        curr_m = start_dt.year * 12 + (start_dt.month - 1)
        target_months_y_m = []
        for i in range(3):
            y = (curr_m + i) // 12
            m = (curr_m + i) % 12 + 1
            target_months_y_m.append((y, m))
            
        # Calculate M1 from daily_items
        # Filter items belonging to M1 (y, m)
        m1_y, m1_m = target_months_y_m[0]
        m1_items = [item for item in daily_items 
                   if item.target_date.startswith(f"{m1_y:04d}-{m1_m:02d}")]
        
        m1_total = sum([x.total_load for x in m1_items])
        m1_days = len(m1_items)
        if m1_days > 0:
            m1_avg = m1_total / m1_days
        else:
            m1_avg = 0 # Should not happen if start_dt match
            
        # Helper to get days in month
        def days_in_month(y, m):
            if m == 12:
                nd = datetime(y+1, 1, 1) - datetime(y, m, 1)
            else:
                nd = datetime(y, m+1, 1) - datetime(y, m, 1)
            return nd.days

        for i, (y, m) in enumerate(target_months_y_m):
            t_month_str = f"{y:04d}-{m:02d}"
            
            # Calculate Total Energy
            dim = days_in_month(y, m)
            
            if i == 0 and m1_days > 0:
                # If fully covered (dim == m1_days), use m1_total
                # If partial, extrapolate
                energy = m1_avg * dim
            else:
                # M2, M3: Base on M1 avg (maybe adjust for seasonality later?)
                # Simple Extrapolation
                energy = m1_avg * dim
                
            # Typical curves (Placeholder: Use M1's avg workday/weekend from daily_items?)
            # Simple fallback for curves
            typ_wd = [energy/dim/48]*48
            typ_we = [energy/dim/48]*48
            
            if i == 0 and m1_items:
                 # Calculate real typical from M1 items
                 wd_curves = []
                 we_curves = []
                 for item in m1_items:
                     dt = datetime.strptime(item.target_date, "%Y-%m-%d")
                     if dt.weekday() >= 5:
                         we_curves.append(item.total_curve)
                     else:
                         wd_curves.append(item.total_curve)
                 
                 if wd_curves:
                     typ_wd = np.mean(np.array(wd_curves), axis=0).tolist()
                 if we_curves:
                     typ_we = np.mean(np.array(we_curves), axis=0).tolist()

            results.append(MonthlyForecastItem(
                target_month=t_month_str,
                total_energy=round(energy, 2),
                typical_curve_workday=[round(x, 2) for x in typ_wd],
                typical_curve_weekend=[round(x, 2) for x in typ_we]
            ))
            
        return results

    def _load_customer_characteristics(self, customer_ids: List[str]) -> Dict[str, Dict]:
        """Batch load characteristics"""
        docs = self.char_col.find({"customer_id": {"$in": customer_ids}})
        return {d["customer_id"]: d for d in docs}
        
    def _is_holiday(self, date_obj: datetime) -> bool:
        """Simple holiday check (Calendar library or DB)"""
        # Placeholder
        return False
