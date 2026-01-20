# -*- coding: utf-8 -*-
"""
系数校核服务
提供基于最小二乘法的分配系数自动推荐功能
"""
import logging
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from scipy.optimize import lsq_linear

from webapp.services.load_aggregation_service import LoadAggregationService, RAW_METER_DATA, CUSTOMER_ARCHIVES, RAW_MP_DATA
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

class CalibrationService:
    """
    系数校核服务
    核心算法: 约束最小二乘法 (Constrained Least Squares)
    目标: min || A * x - b ||^2
          s.t. 0 <= x <= 1
    """

    @staticmethod
    def _fetch_matrix_data(customer_id: str, start_date: str, end_date: str) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], List[str]]:
        """
        获取构建矩阵所需的数据
        Returns:
            A: (N_samples, N_meters) 电表负荷矩阵
            b: (N_samples,) 计量点总负荷向量
            meter_ids: 电表ID列表 (对应A的列)
        """
        try:
            # 1. 获取客户下的所有电表和计量点
            expected_meters = LoadAggregationService.get_customer_meters(customer_id)
            if not expected_meters:
                logger.warning(f"客户 {customer_id} 无电表档案")
                return None, None, []
            
            meter_ids = [m["meter_id"] for m in expected_meters]
            meter_multipliers = {m["meter_id"]: m.get("multiplier", 1) for m in expected_meters}
            
            # 2. 遍历日期构建数据
            A_rows = []
            b_val = []
            
            curr = datetime.strptime(start_date, "%Y-%m-%d")
            end = datetime.strptime(end_date, "%Y-%m-%d")
            
            while curr <= end:
                date_str = curr.strftime("%Y-%m-%d")
                
                # Fetch MP Total (Target b)
                mp_res = LoadAggregationService.aggregate_mp_load(customer_id, date_str)
                if not mp_res or not mp_res.get("values"):
                    curr += timedelta(days=1)
                    continue  # Skip dates without MP data
                
                # Check MP coverage (Standard: reliability check)
                if mp_res.get("coverage", 0) < 1.0: # Only use fully reliable MP data
                     curr += timedelta(days=1)
                     continue

                mp_values = mp_res["values"] # 48 points
                
                # Fetch Meter Data (Features A)
                # We need individual meter loads, so we can't use aggregate_meter_load directly.
                # We replicate the cleaning logic but keep meters separate.
                
                # Batch fetch raw meter data for this day
                raw_docs = list(RAW_METER_DATA.find({
                    "meter_id": {"$in": meter_ids},
                    "date": date_str
                }))
                
                found_meters_map = {d["meter_id"]: d for d in raw_docs}
                
                # Check if all meters cover this day (Strict alignment for calibration)
                # If any meter is missing, we can't solve the equation reliably for that day
                if len(found_meters_map) < len(meter_ids):
                     curr += timedelta(days=1)
                     continue
                
                daily_meter_matrix = [] # 48 rows, M columns
                valid_day = True
                
                # Calculate load for each meter (Column)
                for mid in meter_ids:
                    doc = found_meters_map.get(mid)
                    multiplier = meter_multipliers.get(mid, 1)
                    readings = doc.get("readings", [])
                    
                    if not readings or len(readings) < 2:
                        valid_day = False
                        break
                        
                    # Use helper to process readings to 48-point load
                    # Note: We use a helper function to avoid duplicating logic excessively
                    load_48 = CalibrationService._process_single_meter_readings(mid, readings, multiplier, date_str)
                    
                    if not load_48:
                        valid_day = False
                        break
                        
                    daily_meter_matrix.append(load_48)
                
                if valid_day:
                    # Transpose: daily_meter_matrix is (M_meters, 48_points)
                    # We need (48_points, M_meters) for A rows
                    daily_meter_matrix_T = np.array(daily_meter_matrix).T
                    
                    A_rows.append(daily_meter_matrix_T)
                    b_val.extend(mp_values)
                
                curr += timedelta(days=1)
            
            if not A_rows:
                return None, None, []
                
            # Stack all days
            A = np.vstack(A_rows) # (Total_Points, N_meters)
            b = np.array(b_val)   # (Total_Points,)
            
            return A, b, meter_ids
            
        except Exception as e:
            logger.error(f"构建校核矩阵失败: {e}")
            return None, None, []

    @staticmethod
    def _process_single_meter_readings(meter_id: str, readings: list, multiplier: float, date_str: str) -> Optional[List[float]]:
        """
        处理单个电表的原始示数，转换为48点负荷 (复用LoadAggregationService的核心逻辑)
        """
        # Get prev day data for gap filling
        prev_date = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        prev_doc = RAW_METER_DATA.find_one({"meter_id": meter_id, "date": prev_date})
        prev_readings = prev_doc.get("readings", []) if prev_doc else []
        
        readings = list(readings)
        interpolated = []
        
        # 1. Fill Gaps
        gaps = LoadAggregationService._find_gaps(readings)
        for gap_start, gap_len in gaps:
            if gap_len > 3:
                 if not LoadAggregationService._profile_fill(readings, gap_start, gap_len, prev_readings, interpolated):
                     LoadAggregationService._linear_interpolate(readings, gap_start, gap_len, interpolated)
            else:
                 LoadAggregationService._linear_interpolate(readings, gap_start, gap_len, interpolated)
                 
        # 2. Diff
        load_values = []
        for i in range(1, len(readings)):
            curr = readings[i]
            prev = readings[i-1]
            if curr is not None and prev is not None:
                diff = curr - prev
                if diff < 0: diff = 0 # Dirty data handling
                load_values.append(diff * multiplier)
            else:
                load_values.append(0)
                
        # 3. 96 to 48
        load_48 = []
        if len(load_values) >= 95:
            for i in range(0, 95, 2):
                val = load_values[i] + (load_values[i+1] if i+1 < len(load_values) else 0)
                load_48.append(val)
        elif len(load_values) >= 47:
             load_48 = load_values[:48]
             while len(load_48) < 48: load_48.append(0)
        else:
             return None # Data too short
             
        # Normalize to MWh (Same as Aggregation Service)
        return [v / 1000.0 for v in load_48[:48]]

    @staticmethod
    def calculate_recommended_coefficients(customer_id: str, start_date: str, end_date: str) -> Dict:
        """
        计算推荐系数
        """
        A, b, meter_ids = CalibrationService._fetch_matrix_data(customer_id, start_date, end_date)
        
        if A is None or len(meter_ids) == 0:
            return {
                "success": False,
                "message": "指定范围内无有效双边数据 (需同时具备完整电表和计量点数据)",
                "details": {"sample_days": 0}
            }
            
        n_samples = A.shape[0]
        n_days = n_samples // 48
        
        # Leats Squares with Bounds [0, 1]
        # lsq_linear solves min ||Ax - b||^2 s.t. lb <= x <= ub
        res = lsq_linear(A, b, bounds=(0, 1), lsmr_tol='auto', verbose=0)
        
        coeffs = res.x
        
        # Calculate Residuals
        # Total Error = sum(|Ax - b|) / sum(b)
        est_load = A @ coeffs
        total_abs_error = np.sum(np.abs(est_load - b))
        total_mp_load = np.sum(b)
        
        residual_rate = 0.0
        if total_mp_load > 0:
            residual_rate = total_abs_error / total_mp_load
            
        # Determine Confidence
        confidence = "Low"
        if n_days >= 7 and residual_rate < 0.01:
            confidence = "High"
        elif n_days >= 3 and residual_rate < 0.03:
            confidence = "Medium"
            
        # Format Results
        meter_results = []
        for i, mid in enumerate(meter_ids):
            meter_results.append({
                "meter_id": mid,
                "recommended_value": round(float(coeffs[i]), 4)
            })
            
        return {
            "success": True,
            "sample_days": n_days,
            "sample_points": n_samples,
            "residual_rate": round(residual_rate, 4),
            "confidence": confidence,
            "meter_results": meter_results,
            "data_summary": {
                "mp_total": round(float(total_mp_load), 2),
                "est_total": round(float(np.sum(est_load)), 2)
            }
        }

    @staticmethod
    def apply_coefficients(customer_id: str, coefficients: List[Dict], update_history: bool = False, history_range: Tuple[str, str] = None) -> Dict:
        """
        应用系数配置
        Args:
            coefficients: [{"meter_id": "xxx", "value": 0.98}, ...]
        """
        try:
            from bson import ObjectId
            try:
                cid = ObjectId(customer_id)
            except:
                cid = customer_id
                
            customer = CUSTOMER_ARCHIVES.find_one({"_id": cid})
            if not customer:
                return {"success": False, "message": "客户不存在"}
                
            # 1. Update Archives
            modified_count = 0
            accounts = customer.get("accounts", [])
            updated = False
            
            coeff_map = {item["meter_id"]: item["value"] for item in coefficients}
            
            for account in accounts:
                for meter in account.get("meters", []):
                    mid = meter.get("meter_id")
                    if mid in coeff_map:
                        meter["allocation_ratio"] = coeff_map[mid]
                        updated = True
                        modified_count += 1
            
            if updated:
                CUSTOMER_ARCHIVES.update_one(
                    {"_id": cid},
                    {"$set": {"accounts": accounts}}
                )
            
            # 2. Trigger History Recalculation
            recalc_result = {"triggered": False}
            if update_history and history_range:
                start, end = history_range
                # Async trigger or simple loop? For now simple loop (MVP)
                # In production this should be a background task
                curr = datetime.strptime(start, "%Y-%m-%d")
                end_dt = datetime.strptime(end, "%Y-%m-%d")
                processed = 0
                
                while curr <= end_dt:
                    d_str = curr.strftime("%Y-%m-%d")
                    LoadAggregationService.upsert_unified_load_curve(customer_id, d_str)
                    processed += 1
                    curr += timedelta(days=1)
                    
                recalc_result = {
                    "triggered": True,
                    "processed_days": processed,
                    "range": f"{start} to {end}"
                }
                
            return {
                "success": True, 
                "message": f"成功更新 {modified_count} 个电表的系数",
                "recalculation": recalc_result
            }
            
        except Exception as e:
            logger.error(f"应用系数失败: {e}")
            return {"success": False, "message": str(e)}
