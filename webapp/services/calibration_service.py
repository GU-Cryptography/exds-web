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
    def preview_calibration_status(customer_id: str, start_date: str, end_date: str) -> Dict:
        """
        预览各个户号的校验状态
        
        Returns:
            {
                "success": bool,
                "accounts": [
                    {
                        "account_no": str,
                        "meters": List[Dict],
                        "status": "balanced" | "imbalanced" | "missing_config" | "missing_data",
                        "mp_total": float,
                        "meter_total": float,
                        "diff_rate": float, # abs(mp - meter) / mp
                        "message": str
                    }
                ]
            }
        """
        try:
            structure = LoadAggregationService.get_customer_structure(customer_id)
            if not structure:
                return {"success": False, "message": "客户档案不存在", "accounts": []}
            
            result_accounts = []
            
            curr_start = datetime.strptime(start_date, "%Y-%m-%d")
            curr_end = datetime.strptime(end_date, "%Y-%m-%d")
            
            for acc in structure["accounts"]:
                account_no = acc["account_no"]
                mp_ids = acc["mp_ids"]
                meters = acc["meters"]
                
                # Check Config
                if not mp_ids or not meters:
                    result_accounts.append({
                        "account_no": account_no,
                        "meters": meters,
                        "mp_count": len(mp_ids) if mp_ids else 0,
                        "status": "missing_config",
                        "mp_total": 0,
                        "meter_total": 0,
                        "diff_rate": 0,
                        "message": "缺计量点或电表档案"
                    })
                    continue
                
                # Check Data
                total_mp = 0.0
                total_meter = 0.0
                valid_days = 0
                
                # To collect individual totals
                mps_detail = {mp_id: {"id": mp_id, "total": 0.0, "has_data": False} for mp_id in mp_ids}
                meters_detail = {m["meter_id"]: {"id": m["meter_id"], "total": 0.0, "ratio": m.get("allocation_ratio", 1.0), "has_data": False} for m in meters}
                
                # Helper to round values in breakdown
                def round_breakdown(d):
                    res = d.copy()
                    res["total"] = round(res["total"], 3)
                    return res

                loop_date = curr_start
                while loop_date <= curr_end:
                    d_str = loop_date.strftime("%Y-%m-%d")
                    
                    # 1. Individual MPs
                    for mp_id in mp_ids:
                        mp_res_single = LoadAggregationService.aggregate_mp_load(customer_id, d_str, mp_ids_override=[mp_id])
                        if mp_res_single:
                            val = mp_res_single.get("total", 0.0)
                            mps_detail[mp_id]["total"] += val
                            if val > 0:
                                mps_detail[mp_id]["has_data"] = True
                    
                    # 2. Individual Meters
                    for m_cfg in meters:
                        m_id = m_cfg["meter_id"]
                        m_res_single = LoadAggregationService.aggregate_meter_load(customer_id, d_str, meter_configs_override=[m_cfg])
                        if m_res_single:
                            val = m_res_single.get("total", 0.0)
                            meters_detail[m_id]["total"] += val
                            if val > 0:
                                meters_detail[m_id]["has_data"] = True
                    
                    # Aggregate MP for this account (for total balance check)
                    mp_res = LoadAggregationService.aggregate_mp_load(customer_id, d_str, mp_ids_override=mp_ids)
                    
                    # Aggregate Meter for this account
                    meter_res = LoadAggregationService.aggregate_meter_load(customer_id, d_str, meter_configs_override=meters)
                    
                    if mp_res or meter_res:
                        total_mp += mp_res.get("total", 0) if mp_res else 0
                        total_meter += meter_res.get("total", 0) if meter_res else 0
                        valid_days += 1
                        
                    loop_date += timedelta(days=1)
                
                if valid_days == 0:
                    result_accounts.append({
                        "account_no": account_no,
                        "meters": meters,
                        "mp_count": len(mp_ids),
                        "status": "missing_data",
                        "mp_total": 0,
                        "meter_total": 0,
                        "diff_rate": 0,
                        "message": "所选时段无有效双边数据",
                        "mps_breakdown": [round_breakdown(v) for v in mps_detail.values()],
                        "meters_breakdown": [round_breakdown(v) for v in meters_detail.values()]
                    })
                    continue
                
                # Calculate Diff
                diff = abs(total_mp - total_meter)
                # 只有当总电量显著大于0时才计算偏差率
                if total_mp > 0.001:
                    diff_rate = diff / total_mp
                else:
                    diff_rate = 1.0 if diff > 0.001 else 0.0
                
                status = "balanced"
                message = "数据平衡"
                
                if diff_rate > 0.02: # 2% Threshold
                    status = "imbalanced"
                    message = f"偏差 {(diff_rate*100):.1f}%"
                
                result_accounts.append({
                    "account_no": account_no,
                    "meters": meters,
                    "mp_count": len(mp_ids),
                    "status": status,
                    "mp_total": round(total_mp, 3),
                    "meter_total": round(total_meter, 3),
                    "diff_rate": round(diff_rate, 3),
                    "message": message,
                    "mps_breakdown": [round_breakdown(v) for v in mps_detail.values()],
                    "meters_breakdown": [round_breakdown(v) for v in meters_detail.values()]
                })
                
            return {
                "success": True,
                "accounts": result_accounts
            }
            
        except Exception as e:
            logger.error(f"预览校核状态失败: {e}")
            return {"success": False, "message": str(e), "accounts": []}

    @staticmethod
    def _fetch_matrix_data(customer_id: str, start_date: str, end_date: str, account_no: Optional[str] = None) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], List[str]]:
        """
        获取构建矩阵所需的数据
        Returns:
            A: (N_samples, N_meters) 电表负荷矩阵
            b: (N_samples,) 计量点总负荷向量
            meter_ids: 电表ID列表 (对应A的列)
        """
        try:
            # 1. 获取客户下的所有电表和计量点 (支持户号过滤)
            if account_no:
                structure = LoadAggregationService.get_customer_structure(customer_id)
                if not structure:
                    logger.warning(f"[Calibration] Customer structure not found for {customer_id}")
                    return None, None, []
                    
                target_acc = next((a for a in structure.get("accounts", []) if a["account_no"] == account_no), None)
                if not target_acc:
                    logger.warning(f"[Calibration] Account {account_no} not found in customer {customer_id}")
                    logger.debug(f"[Calibration] Available accounts: {[a.get('account_no') for a in structure.get('accounts', [])]}")
                    return None, None, []
                expected_meters = target_acc["meters"]
                mp_ids_scope = target_acc["mp_ids"]
                logger.info(f"[Calibration] Account {account_no}: {len(expected_meters)} meters, {len(mp_ids_scope)} MPs")
            else:
                expected_meters = LoadAggregationService.get_customer_meters(customer_id)
                mp_ids_scope = None # Use default all
                logger.info(f"[Calibration] Full customer: {len(expected_meters) if expected_meters else 0} meters")
            
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
                # Pass override if specific account
                mp_res = LoadAggregationService.aggregate_mp_load(customer_id, date_str, mp_ids_override=mp_ids_scope)
                
                if not mp_res or not mp_res.get("values"):
                    logger.debug(f"[Calibration] No MP data for {date_str}")
                    curr += timedelta(days=1)
                    continue  # Skip dates without MP data
                
                # Log MP coverage but don't skip (relaxed)
                mp_coverage = mp_res.get("coverage", 0)
                if mp_coverage < 1.0:
                    logger.info(f"[Calibration] MP coverage {mp_coverage:.2%} for {date_str}, proceeding anyway")

                mp_values = mp_res["values"] # 48 points
                # Fetch Meter Data using aggregate_meter_load for consistency with preview
                meter_res = LoadAggregationService.aggregate_meter_load(
                    customer_id, date_str, 
                    meter_configs_override=expected_meters
                )
                
                if not meter_res or not meter_res.get("values"):
                    logger.debug(f"[Calibration] No Meter data for {date_str}")
                    curr += timedelta(days=1)
                    continue
                
                meter_values = meter_res["values"]  # 48 points, already aggregated
                
                # For coefficient calibration, we need per-meter values, not aggregated
                # But since we're using aggregated data, we treat the whole customer as single "meter"
                # This is a simplified approach - for true per-meter coefficients, we'd need raw data
                
                # Simplified: Use aggregated meter load as single column in matrix
                daily_meter_matrix = [meter_values]  # 1 meter, 48 points
                
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
            
            # Return actual meter IDs for coefficient mapping
            # Note: With aggregated approach, we get single coefficient applied to all meters equally
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
    def calculate_recommended_coefficients(customer_id: str, start_date: str, end_date: str, account_no: Optional[str] = None) -> Dict:
        """
        计算推荐系数
        优化算法：
        1. 先尝试1:1匹配电表和计量点（误差<0.5%视为匹配）
        2. 匹配成功的电表系数直接设为1.0
        3. 未匹配的电表通过最小二乘法计算系数
        """
        try:
            # 1. 获取账户结构
            structure = LoadAggregationService.get_customer_structure(customer_id)
            if not structure:
                return {"success": False, "message": "客户档案不存在"}
            
            if account_no:
                target_acc = next((a for a in structure.get("accounts", []) if a["account_no"] == account_no), None)
                if not target_acc:
                    return {"success": False, "message": f"户号 {account_no} 不存在"}
                mp_ids = target_acc["mp_ids"]
                meters = target_acc["meters"]
            else:
                # 全客户计算
                mp_ids = []
                meters = []
                for acc in structure.get("accounts", []):
                    mp_ids.extend(acc.get("mp_ids", []))
                    meters.extend(acc.get("meters", []))
            
            if not mp_ids or not meters:
                return {"success": False, "message": "缺少计量点或电表档案"}
            
            meter_ids = [m["meter_id"] for m in meters]
            
            # 2. 收集多日48点曲线数据 (Auto-Expand Logic)
            
            # Helper: Fetch data for a specific date range
            def fetch_range_data(s_date, e_date):
                c_mp = {mid: [] for mid in mp_ids}
                c_meter = {m["meter_id"]: [] for m in meters}
                v_days = 0
                valid_date_list = []
                
                curr = datetime.strptime(s_date, "%Y-%m-%d")
                end_dt = datetime.strptime(e_date, "%Y-%m-%d")
                
                while curr <= end_dt:
                    d_str = curr.strftime("%Y-%m-%d")
                    day_valid = True
                    
                    # 1. Check Meters strict validity
                    day_meter_vals = {}
                    for m_cfg in meters:
                        m_id = m_cfg["meter_id"]
                        
                        # Get readings
                        meter_doc = RAW_METER_DATA.find_one({
                            "meter_id": m_id, "date": d_str
                        })
                        
                        if not meter_doc: 
                            day_valid = False; break
                            
                        readings = meter_doc.get("readings", [])
                        multiplier = m_cfg.get("multiplier", 1)
                        
                        # Fetch adjacent days for gap filling
                        prev_d = (curr - timedelta(days=1)).strftime("%Y-%m-%d")
                        next_d = (curr + timedelta(days=1)).strftime("%Y-%m-%d")
                        prev_doc = RAW_METER_DATA.find_one({"meter_id": m_id, "date": prev_d})
                        next_doc = RAW_METER_DATA.find_one({"meter_id": m_id, "date": next_d})
                        
                        prev_r = prev_doc.get("readings", []) if prev_doc else []
                        next_r = next_doc.get("readings", []) if next_doc else []
                        
                        calc_res = LoadAggregationService.calculate_meter_48_points(
                            readings, multiplier, prev_r, next_r
                        )
                        
                        if not calc_res["is_valid"]:
                            day_valid = False; break
                            
                        day_meter_vals[m_id] = calc_res["values"]
                    
                    if day_valid:
                        # 2. Get MP data
                        day_mp_vals = {}
                        any_mp = False
                        for mid in mp_ids:
                            res = LoadAggregationService.aggregate_mp_load(customer_id, d_str, mp_ids_override=[mid])
                            # MP validity check could be added here, currently assuming MP aggreg is robust enough
                            vals = res.get("values", [0.0]*48) if res else [0.0]*48
                            day_mp_vals[mid] = vals
                            if res: any_mp = True
                        
                        if any_mp:
                            for mid in mp_ids: c_mp[mid].extend(day_mp_vals[mid])
                            for m_id, vals in day_meter_vals.items(): c_meter[m_id].extend(vals)
                            v_days += 1
                            valid_date_list.append(d_str)
                            
                    curr += timedelta(days=1)
                return c_mp, c_meter, v_days, valid_date_list

            # Initial Attempt
            mp_curves, meter_curves, valid_days, used_dates = fetch_range_data(start_date, end_date)
            
            # Auto-Expand if insufficient data
            if valid_days == 0:
                logger.info(f"Calibration: Initial range {start_date} to {end_date} has no valid data. Auto-expanding...")
                # Expand +/- 3 days
                s_dt = datetime.strptime(start_date, "%Y-%m-%d")
                e_dt = datetime.strptime(end_date, "%Y-%m-%d")
                
                # Check previous 3 days
                if valid_days == 0:
                    new_s = (s_dt - timedelta(days=3)).strftime("%Y-%m-%d")
                    new_e = (s_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                     # Only if range is valid
                    if new_s <= new_e:
                        mp_curves, meter_curves, valid_days, used_dates = fetch_range_data(new_s, new_e)
                
                # Check next 3 days if still 0
                if valid_days == 0:
                    new_s = (e_dt + timedelta(days=1)).strftime("%Y-%m-%d")
                    new_e = (e_dt + timedelta(days=3)).strftime("%Y-%m-%d")
                    mp_curves, meter_curves, valid_days, used_dates = fetch_range_data(new_s, new_e)

            if valid_days == 0:
                return {"success": False, "message": "范围内(含自动扩展)无有效电表数据(存在断点或坏数据)"}

            # 转换为 numpy 数组进行计算
            b = np.sum([np.array(curve) for curve in mp_curves.values()], axis=0)
            
            # 3. 启发式逻辑: 识别 1:1 匹配
            matched_meters = {} # meter_id -> info
            remaining_meter_ids = [m["meter_id"] for m in meters]
            b_remaining = b.copy()
            
            CORR_THRESHOLD = 0.995
            ERROR_THRESHOLD = 0.05
            SMALL_LOAD_THRESHOLD = 0.05  # MWh, 小于此值启用 Fallback
            ZERO_LOAD_THRESHOLD = 0.001 # MWh, 小于此值视为无负荷，不参与回归
            
            # 3.1 零负荷预处理：剔除全天几乎为0的电表
            # 否则它们会形成全零列，导致 solver 错误赋值 或 结果不确定
            zero_load_meters = []
            for m_id in list(remaining_meter_ids):
                m_v = np.array(meter_curves[m_id])
                if np.sum(m_v) < ZERO_LOAD_THRESHOLD:
                    zero_load_meters.append(m_id)
                    remaining_meter_ids.remove(m_id)
                    matched_meters[m_id] = {
                        "recommended_value": 1.0, # 没电量也默认包含，防止被误关
                        "match_type": "零负荷(默认)",
                        "matched_mp": None
                    }
            
            # 3.2 检查是否启用 Small Load Fallback
            # 如果 MP 总电量太小，波形特征不可靠，直接用总量占比分配
            total_mp_load = np.sum(b)
            use_fallback = total_mp_load < SMALL_LOAD_THRESHOLD

            if not use_fallback:
                # 正常逻辑：启发式匹配 + 回归
                # 对每个电表，检查是否与某个计量点高度吻合
                for m_id in list(remaining_meter_ids): # iter copy
                    m_v = np.array(meter_curves[m_id])
                    m_total = np.sum(m_v)
                    
                    for mp_id in mp_ids:
                        mp_v = np.array(mp_curves[mp_id])
                        mp_total = np.sum(mp_v)
                        
                        if mp_total < 0.0001: continue
                        
                        # 计算相关性
                        if np.std(m_v) < 1e-6 or np.std(mp_v) < 1e-6:
                            # 全平曲线用总量比对
                            err = abs(m_total - mp_total) / mp_total if mp_total > 0 else 1.0
                            is_match = err < 0.01
                        else:
                            corr = np.corrcoef(m_v, mp_v)[0, 1]
                            err = abs(m_total - mp_total) / mp_total
                            is_match = corr > CORR_THRESHOLD and err < ERROR_THRESHOLD
                        
                        if is_match:
                            matched_meters[m_id] = {
                                "recommended_value": 1.0,
                                "match_type": "1:1匹配",
                                "matched_mp": mp_id
                            }
                            # 从总目标中扣除对应的计量点贡献
                            if m_id in remaining_meter_ids:
                                remaining_meter_ids.remove(m_id)
                                b_remaining = b_remaining - mp_v
                            break 

            # 4. 对剩余电表执行计算 (回归 或 Fallback)
            meter_results = []
            # 先加入已匹配的结果
            for m_id, info in matched_meters.items():
                meter_results.append({
                    "meter_id": m_id,
                    **info
                })
            
            # 处理待回归电表
            if remaining_meter_ids:
                if use_fallback:
                    # Fallback Mode: 总量占比分配
                    # Ratio = Total_MP / Total_Meters_Remaining
                    # 但要注意已匹配部分已被扣除吗？ 
                    # 原则：Simple Ratio Distribution. 所有剩余电表共享同一系数
                    
                    # 重新计算剩余池的总量
                    total_residual_meter = sum([np.sum(meter_curves[mid]) for mid in remaining_meter_ids])
                    total_residual_mp = np.sum(b_remaining) # 此时 b_remaining = b (因为 use_fallback 跳过了 heuristic)
                    
                    if total_residual_meter > 0.0001:
                        common_ratio = total_residual_mp / total_residual_meter
                        # 约束 [0, 1]
                        common_ratio = max(0.0, min(1.0, common_ratio))
                    else:
                        common_ratio = 1.0 if total_residual_mp > 0 else 0.0
                        
                    for m_id in remaining_meter_ids:
                         meter_results.append({
                            "meter_id": m_id,
                            "recommended_value": round(common_ratio, 4),
                            "match_type": "总量占比(小负荷)",
                        })
                else:
                    # Regression Mode
                    A_list = []
                    for m_id in remaining_meter_ids:
                        A_list.append(meter_curves[m_id])
                    
                    A = np.array(A_list).T
                    b_orig = np.maximum(b_remaining, 0)
                    
                    # 数值归一化处理 (关键: 解决小电量下的精度问题)
                    max_val = max(np.max(A), np.max(b_orig))
                    if max_val > 1e-9:
                        A_norm = A / max_val
                        b_norm = b_orig / max_val
                    else:
                        A_norm = A
                        b_norm = b_orig
                        
                    try:
                        res = lsq_linear(A_norm, b_norm, bounds=(0, 1), lsmr_tol='auto')
                        x = res.x
                        
                        for i, m_id in enumerate(remaining_meter_ids):
                            val = float(x[i])
                            # 原则4: 如果电表和目标都是0 (阈值调低)，默认系数为1
                            # (其实前面 zero_load 已经过滤了一波，这里是 double check)
                            if np.sum(meter_curves[m_id]) < 1e-6 and np.sum(b_orig) < 1e-6:
                                val = 1.0
                                
                            meter_results.append({
                                "meter_id": m_id,
                                "recommended_value": round(val, 4),
                                "match_type": "最小二乘法",
                            })
                    except Exception as e:
                        logger.error(f"回归计算失败: {e}")
                        for m_id in remaining_meter_ids:
                            meter_results.append({
                                "meter_id": m_id,
                                "recommended_value": 1.0,
                                "match_type": "计算异常",
                            })
            
            # 处理全零电表 (Double Check，虽然前面 3.1 已经处理了)
            all_result_ids = [m["meter_id"] for m in meter_results]
            for m_cfg in meters:
                m_id = m_cfg["meter_id"]
                if m_id not in all_result_ids:
                    meter_results.append({
                        "meter_id": m_id,
                        "recommended_value": 1.0,
                        "match_type": "默认",
                    })

            # 5. 计算校验统计
            est_b = np.zeros_like(b)
            final_coeffs = {r["meter_id"]: r["recommended_value"] for r in meter_results}
            for m_id, curve in meter_curves.items():
                est_b += np.array(curve) * final_coeffs.get(m_id, 0.0)
            
            mp_total = np.sum(b)
            est_total = np.sum(est_b)
            residual = np.sum(np.abs(b - est_b))
            residual_rate = residual / mp_total if mp_total > 0.0001 else 0
            
            confidence = "High"
            if residual_rate > 0.05: confidence = "Medium"
            if residual_rate > 0.15: confidence = "Low"

            # Determine actual range string
            actual_range_str = f"{start_date} to {end_date}"
            if used_dates:
                sorted_dates = sorted(used_dates)
                if len(sorted_dates) > 1:
                    actual_range_str = f"{sorted_dates[0]} 至 {sorted_dates[-1]}"
                else:
                    actual_range_str = sorted_dates[0]

            return {
                "success": True,
                "sample_days": valid_days,
                "sample_points": valid_days * 48,
                "residual_rate": round(residual_rate, 4),
                "confidence": confidence,
                "matched_count": len(matched_meters),
                "unmatched_count": len(remaining_meter_ids),
                "actual_range": actual_range_str,
                "meter_results": meter_results,
                "data_summary": {
                    "mp_total": round(mp_total, 3),
                    "est_total": round(est_total, 3)
                }
            }
            
        except Exception as e:
            logger.error(f"计算推荐系数失败: {e}")
            return {"success": False, "message": str(e)}

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


