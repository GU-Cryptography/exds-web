# -*- coding: utf-8 -*-
"""
负荷数据聚合服务
提供计量点数据聚合、电表数据聚合、误差计算等功能
"""

import logging
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.services.tou_service import get_tou_rule_by_date

logger = logging.getLogger(__name__)

# 集合定义
CUSTOMER_ARCHIVES = DATABASE['customer_archives']
UNIFIED_LOAD_CURVE = DATABASE['unified_load_curve']
RAW_MP_DATA = DATABASE['raw_mp_data']
RAW_METER_DATA = DATABASE['raw_meter_data']

# 误差阈值
ERROR_THRESHOLD = 0.05  # 5%


class LoadAggregationService:
    """负荷数据聚合服务"""
    
    @staticmethod
    def get_customer_metering_points(customer_id: str) -> List[str]:
        """
        获取客户的所有计量点编号
        
        Args:
            customer_id: 客户ID（customer_archives._id）
        
        Returns:
            计量点编号列表
        """
        try:
            # 尝试 ObjectId
            try:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": ObjectId(customer_id)})
            except:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": customer_id})
            
            if not customer:
                logger.warning(f"客户不存在: {customer_id}")
                return []
            
            mp_list = []
            for account in customer.get("accounts", []):
                for mp in account.get("metering_points", []):
                    mp_no = mp.get("mp_no")
                    if mp_no:
                        mp_list.append(mp_no)
            
            return mp_list
        except Exception as e:
            logger.error(f"获取客户计量点失败: {e}")
            return []
    
    @staticmethod
    def get_customer_structure(customer_id: str) -> Optional[Dict]:
        """
        获取客户的详细档案结构 (包含户号、计量点、电表关系)
        
        Returns:
            {
                "customer_name": str,
                "accounts": [
                    {
                        "account_no": str,
                        "mp_ids": [str],
                        "meters": [{meter_id, multiplier, allocation_ratio}]
                    }
                ]
            }
        """
        try:
            try:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": ObjectId(customer_id)})
            except:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": customer_id})
            
            if not customer:
                return None
            
            structure = {
                "customer_name": customer.get("name") or customer.get("customer_name"),
                "accounts": []
            }
            
            for account in customer.get("accounts", []):
                acc_info = {
                    "account_no": account.get("account_id") or account.get("account_no"),
                    "mp_ids": [],
                    "meters": []
                }
                
                # Extract MPs
                for mp in account.get("metering_points", []):
                    if mp.get("mp_no"):
                        acc_info["mp_ids"].append(mp.get("mp_no"))
                        
                # Extract Meters
                for meter in account.get("meters", []):
                    acc_info["meters"].append({
                        "meter_id": meter.get("meter_id"),
                        "multiplier": meter.get("multiplier", 1),
                        "allocation_ratio": meter.get("allocation_ratio")
                    })
                
                structure["accounts"].append(acc_info)
                
            return structure
            
        except Exception as e:
            logger.error(f"获取客户档案结构失败: {e}")
            return None

    @staticmethod
    def get_customer_meters(customer_id: str) -> List[Dict]:
        """
        获取客户的所有电表信息
        
        Args:
            customer_id: 客户ID
        
        Returns:
            电表信息列表 [{meter_id, multiplier, allocation_ratio}]
        """
        try:
            try:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": ObjectId(customer_id)})
            except:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": customer_id})
            
            if not customer:
                return []
            
            meters = []
            for account in customer.get("accounts", []):
                for meter in account.get("meters", []):
                    meters.append({
                        "meter_id": meter.get("meter_id"),
                        "multiplier": meter.get("multiplier", 1),
                        "allocation_ratio": meter.get("allocation_ratio")
                    })
            
            return meters
        except Exception as e:
            logger.error(f"获取客户电表失败: {e}")
            return []
    
    @staticmethod
    def aggregate_mp_load(customer_id: str, date: str, mp_ids_override: Optional[List[str]] = None) -> Optional[Dict]:
        """
        聚合单个客户单日的计量点数据
        
        Args:
            customer_id: 客户ID
            date: 日期（YYYY-MM-DD）
            mp_ids_override: 可选，指定要聚合的计量点ID列表 (若提供则忽略customer_id关联查询)
        
        Returns:
            {
                "values": [48点电量],
                "coverage": 覆盖率,
                "total": 日总电量,
                "missing_mps": [缺失计量点编号]
            } 或 None（无数据时）
        """
        try:
            # 获取应有的计量点列表
            if mp_ids_override is not None:
                expected_mps = mp_ids_override
            else:
                expected_mps = LoadAggregationService.get_customer_metering_points(customer_id)
            
            if not expected_mps:
                if not mp_ids_override:
                     logger.info(f"客户 {customer_id} 无计量点档案")
                return None
            
            # 查询该日的计量点数据
            mp_data = list(RAW_MP_DATA.find({
                "mp_id": {"$in": expected_mps},
                "date": date
            }))
            
            if not mp_data:
                return None
            
            # 找出已有和缺失的计量点
            found_mps = {doc["mp_id"] for doc in mp_data}
            missing_mps = list(set(expected_mps) - found_mps)
            
            # 聚合48点数据
            aggregated_values = [0.0] * 48
            for doc in mp_data:
                load_values = doc.get("load_values", [])
                for i, val in enumerate(load_values[:48]):
                    if val is not None:
                        aggregated_values[i] += val
            
            # 计算日总电量
            total = sum(aggregated_values)
            
            # 分时电量统计
            tou_usage = LoadAggregationService.calculate_tou_distribution(aggregated_values, date)
            
            return {
                "values": [round(v, 3) for v in aggregated_values],
                "total": round(total, 3),
                "tou_usage": tou_usage,
                "mp_count": len(found_mps),
                "missing_mps": sorted(list(missing_mps))
            }
        except Exception as e:
            logger.error(f"聚合计量点数据失败 customer={customer_id} date={date}: {e}")
            return None

    @staticmethod
    def calculate_tou_distribution(values: List[float], date_str: str) -> Dict[str, float]:
        """
        根据 48 点负荷曲线和当日分时规则，计算各类电量 (tip, peak, flat, valley, deep)
        每个点代表 30 分钟。
        """
        if not values or len(values) != 48:
            return {"tip": 0.0, "peak": 0.0, "flat": 0.0, "valley": 0.0, "deep": 0.0}

        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            tou_map = get_tou_rule_by_date(date_obj) # 96个点 00:00, 00:15 ...
            
            # 构造 96 个时间点序列用于索引
            keys_96 = []
            for h in range(24):
                for m in [0, 15, 30, 45]:
                    keys_96.append(f"{h:02d}:{m:02d}")
            
            # 时段映射
            type_map = {
                "尖峰": "tip",
                "高峰": "peak",
                "平段": "flat",
                "低谷": "valley",
                "深谷": "deep"
            }
            usage = {"tip": 0.0, "peak": 0.0, "flat": 0.0, "valley": 0.0, "deep": 0.0}
            
            for i, val in enumerate(values):
                if val is None: continue
                # 48点 i (如 i=0 代表 00:00-00:30) 对应 96点 2*i 和 2*i+1
                # 理论上分时规则变化通常在整点或半点，所以两个 15min 片段类型基本一致
                t_key = keys_96[2*i]
                p_type = tou_map.get(t_key, "平段")
                
                mapped_key = type_map.get(p_type, "flat")
                usage[mapped_key] += val
                
            return {k: round(v, 4) for k, v in usage.items()}
        except Exception as e:
            logger.error(f"计算分时电量分布失败: {e}")
            return {"tip": 0.0, "peak": 0.0, "flat": 0.0, "valley": 0.0, "deep": 0.0}
    
    @staticmethod
    def _find_gaps(readings: list) -> list:
        """找出示数数组中的缺口（None值的连续区间）"""
        gaps = []  # [(start_idx, length), ...]
        i = 0
        while i < len(readings):
            if readings[i] is None:
                start = i
                while i < len(readings) and readings[i] is None:
                    i += 1
                gaps.append((start, i - start))
            else:
                i += 1
        return gaps
    
    @staticmethod
    def calculate_meter_48_points(readings: List[float], multiplier: float, prev_readings: List[float] = None, next_readings: List[float] = None) -> Dict:
        """
        核心算法：将原始示数列表转换为48点负荷数据 (含清洗、插值、对齐)
        Args:
            readings: 当日示数列表
            multiplier: 倍率
            prev_readings: 前日示数 (用于修补头部缺口)
            next_readings: 次日示数 (用于修补尾部缺口)
        Returns:
            {
                "values": [48 float],
                "interpolated_indices": [int],
                "dirty_indices": [int], # 回落点
                "is_valid": bool # 是否适合用于高精度计算 (无大量缺口/回落)
            }
        """
        if not readings or len(readings) < 2:
            return {"values": [0.0]*48, "interpolated_indices": [], "dirty_indices": [], "is_valid": False}
            
        readings = list(readings)
        interpolated_points = []
        dirty_points = []
        
        # 1. 找出缺口
        gaps = LoadAggregationService._find_gaps(readings)
        
        # 2. 处理缺口
        for gap_start, gap_length in gaps:
            if gap_length > 3:
                # 大缺口：尝试历史廓形填充
                if not LoadAggregationService._profile_fill(
                    readings, gap_start, gap_length, prev_readings or [], interpolated_points
                ):
                    LoadAggregationService._linear_interpolate(readings, gap_start, gap_length, interpolated_points)
            else:
                LoadAggregationService._linear_interpolate(readings, gap_start, gap_length, interpolated_points)
                
        # 3. 差分计算
        load_values = []
        for i in range(1, len(readings)):
            curr = readings[i]
            prev = readings[i-1]
            if curr is not None and prev is not None:
                diff = curr - prev
                if diff < 0:
                    dirty_points.append(i-1)
                    diff = 0 # 脏数据归零
                load_values.append(diff * multiplier)
            else:
                load_values.append(0)
                
        # 4. 补齐最后一点 (针对96点数据)
        if len(readings) == 96 and len(load_values) == 95:
            if next_readings and len(next_readings) > 0 and next_readings[0] is not None and readings[-1] is not None:
                last_diff = next_readings[0] - readings[-1]
                if last_diff < 0:
                    last_diff = 0
                    dirty_points.append(95)
                load_values.append(last_diff * multiplier)
            else:
                load_values.append(load_values[-1] if load_values else 0)
                interpolated_points.append(95)
                
        # 5. 96转48对齐
        values_48 = []
        if len(load_values) >= 95:
            for i in range(0, 95, 2):
                val = load_values[i] + (load_values[i+1] if i+1 < len(load_values) else 0)
                values_48.append(val)
            # 索引映射
            interpolated_indices = list(set(p // 2 for p in interpolated_points if p < 96))
            dirty_indices = list(set(p // 2 for p in dirty_points if p < 96))
        else:
            # 简单截断或补零
            values_48 = load_values[:48]
            while len(values_48) < 48: values_48.append(0)
            interpolated_indices = interpolated_points
            dirty_indices = dirty_points
            
        # 6. 单位转换 (kWh -> MWh)
        values_48 = [v / 1000.0 for v in values_48[:48]]
        
        # 7. 质量判定
        # 如果有任何回落(dirty)或 插值(interpolated)超过 4个点(2小时)，视为不适合高精度校核
        is_valid = len(dirty_indices) == 0 and len(interpolated_indices) <= 4
        
        return {
            "values": values_48,
            "interpolated_indices": interpolated_indices,
            "dirty_indices": dirty_indices,
            "is_valid": is_valid
        }

    @staticmethod
    def _linear_interpolate(readings: list, start: int, length: int, interpolated_points: list):
        """线性插值填充缺口"""
        end = start + length
        # 找前后有效值
        prev_val = None
        next_val = None
        
        if start > 0:
            prev_val = readings[start - 1]
        if end < len(readings):
            next_val = readings[end]
        
        if prev_val is not None and next_val is not None:
            # 线性插值
            step = (next_val - prev_val) / (length + 1)
            for j in range(length):
                readings[start + j] = prev_val + step * (j + 1)
                interpolated_points.append(start + j)
        elif prev_val is not None:
            # 只有前值，保持不变
            for j in range(length):
                readings[start + j] = prev_val
                interpolated_points.append(start + j)
        elif next_val is not None:
            # 只有后值，保持不变
            for j in range(length):
                readings[start + j] = next_val
                interpolated_points.append(start + j)
    
    @staticmethod
    def _profile_fill(readings: list, start: int, length: int, prev_day_readings: list, interpolated_points: list) -> bool:
        """使用前一日廓形填充缺口"""
        if not prev_day_readings or len(prev_day_readings) != len(readings):
            return False
        
        end = start + length
        
        # 计算当日已知部分与前一日的比例因子
        valid_pairs = []
        for i in range(len(readings)):
            if readings[i] is not None and prev_day_readings[i] is not None and prev_day_readings[i] > 0:
                valid_pairs.append((readings[i], prev_day_readings[i]))
        
        if len(valid_pairs) < 5:  # 有效配对数太少，不可靠
            return False
        
        # 计算缩放因子 k = Σ(Current) / Σ(Ref)
        sum_curr = sum(p[0] for p in valid_pairs)
        sum_ref = sum(p[1] for p in valid_pairs)
        if sum_ref == 0:
            return False
        k = sum_curr / sum_ref
        
        # 用前一日的廓形×缩放因子填充
        for j in range(length):
            idx = start + j
            if prev_day_readings[idx] is not None:
                readings[idx] = prev_day_readings[idx] * k
                interpolated_points.append(idx)
            else:
                # 前一日也没数据，用线性插值
                return False
        
        return True
    
    @staticmethod
    def aggregate_meter_load(customer_id: str, date: str, meter_configs_override: Optional[List[Dict]] = None) -> Optional[Dict]:
        """
        聚合单个客户单日的电表示度数据
        
        业务逻辑：
        1. 检查所有电表数据完整性
        2. 高级数据清洗与插值：
           - 示数回落标记为脏数据
           - 连续缺口>3：历史廓形填充
           - 连续缺口≤3：线性插值
        3. 差分计算：Load[t] = (Reading[t] - Reading[t-1]) * Multiplier
        4. 96转48对齐：Load_48[i] = Load_96[2i] + Load_96[2i+1]
        5. 用户级聚合：User_Load[t] = Σ(Load_Meter[t] × Ratio) / 1000 (MWh)
        
        Args:
            customer_id: 客户ID
            date: 日期（YYYY-MM-DD）
        
        Returns:
            {
                "values": [48点电量 MWh],
                "total": 日总电量,
                "data_quality": {  # 可选
                    "interpolated_points": [被插值的时段索引],
                    "dirty_points": [脏数据时段索引]
                }
            } 或 None（数据不完整时）
        """
        try:
            # 获取客户档案中的电表列表（用于获取倍率和分配系数）
            if meter_configs_override is not None:
                expected_meters = meter_configs_override
            else:
                expected_meters = LoadAggregationService.get_customer_meters(customer_id)
            
            # 从档案中获取电表ID列表
            meter_ids_from_archive = [m["meter_id"] for m in expected_meters] if expected_meters else []
            
            # 也查询该日期所有与该客户相关的原始电表数据
            # 如果档案中有电表配置，按档案查询；否则按客户关联的所有电表查询
            if meter_ids_from_archive:
                meter_data = list(RAW_METER_DATA.find({
                    "meter_id": {"$in": meter_ids_from_archive},
                    "date": date
                }))
            else:
                # 无档案配置时，直接返回 None
                return None
            
            # 放宽完整性检查：至少有1个电表有数据即可聚合
            found_meters = {doc["meter_id"] for doc in meter_data}
            if len(found_meters) == 0:
                logger.debug(f"无电表数据: customer={customer_id}, date={date}")
                return None
            
            # 记录实际参与聚合的电表数量
            actual_meter_count = len(found_meters)
            expected_meter_count = len(meter_ids_from_archive)
            
            if actual_meter_count < expected_meter_count:
                missing = set(meter_ids_from_archive) - found_meters
                logger.debug(f"电表数据部分缺失: found={actual_meter_count}/{expected_meter_count}, missing={missing}")
            
            # 创建电表ID到参数的映射
            meter_params = {}
            for m in expected_meters:
                ratio = m.get("allocation_ratio")
                if ratio is None:
                    ratio = 1.0
                meter_params[m["meter_id"]] = {
                    "multiplier": m.get("multiplier", 1),
                    "ratio": ratio
                }
            
            # 获取前一日数据（用于历史廓形填充）
            from datetime import datetime as dt, timedelta
            curr_dt = dt.strptime(date, "%Y-%m-%d")
            prev_date = (curr_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            prev_day_data = {doc["meter_id"]: doc.get("readings", []) 
                            for doc in RAW_METER_DATA.find({"meter_id": {"$in": list(found_meters)}, "date": prev_date})}
            
            # 获取后一日数据（用于补齐最后一点 23:45-24:00）
            next_date = (curr_dt + timedelta(days=1)).strftime("%Y-%m-%d")
            next_day_data = {doc["meter_id"]: doc.get("readings", []) 
                            for doc in RAW_METER_DATA.find({"meter_id": {"$in": list(found_meters)}, "date": next_date})}
            
            # 聚合48点数据
            aggregated_values = [0.0] * 48
            all_interpolated_points = []
            all_dirty_points = []
            
            for doc in meter_data:
                meter_id = doc["meter_id"]
                # 优先使用档案中的参数，如果没有则使用默认值
                params = meter_params.get(meter_id, {"multiplier": 1, "ratio": 1.0})
                multiplier = params["multiplier"]
                ratio = params["ratio"]
                
                readings = doc.get("readings", [])
                
                # 调用共享计算方法
                prev_readings = prev_day_data.get(meter_id, [])
                next_readings = next_day_data.get(meter_id, [])
                
                calc_res = LoadAggregationService.calculate_meter_48_points(
                    readings, multiplier, prev_readings, next_readings
                )
                
                load_values_mwh = calc_res["values"]
                interpolated_points = calc_res["interpolated_indices"]
                dirty_points = calc_res["dirty_indices"]
                
                # 应用分配系数并累加 (已经在 calculate 中转为 MWh 了，这里只需乘 ratio)
                # 注意：calculate_meter_48_points 返回的是 MWh，但聚合逻辑可能期望保留精度在最后处理
                # 不过考虑到之前代码是在累加时 / 1000，shared method 已经做了 / 1000
                # 所以这里直接累加即可
                
                for i, val in enumerate(load_values_mwh):
                    aggregated_values[i] += val * ratio
                
                all_interpolated_points.extend(interpolated_points)
                all_dirty_points.extend(dirty_points)
            
            total = sum(aggregated_values)
            # 分时电量统计
            tou_usage = LoadAggregationService.calculate_tou_distribution(aggregated_values, date)
            
            result = {
                "values": [round(v, 3) for v in aggregated_values],
                "total": round(total, 3),
                "tou_usage": tou_usage,
                "meter_count": actual_meter_count,
                "missing_meters": sorted(list(missing)) if actual_meter_count < expected_meter_count else []
            }
            
            # 添加数据质量信息（如果有）
            if all_interpolated_points or all_dirty_points:
                result["data_quality"] = {
                    "interpolated_points": sorted(set(all_interpolated_points)),
                    "dirty_points": sorted(set(all_dirty_points))
                }
            
            return result
        except Exception as e:
            logger.error(f"聚合电表数据失败 customer={customer_id} date={date}: {e}")
            return None
    
    @staticmethod
    def aggregate_account_load(customer_id: str, account_no: str, date: str) -> Dict:
        """
        聚合指定户号的 MP 负荷与 Meter 负荷, 并作为对比。
        
        Args:
            customer_id: 客户ID
            account_no: 户号
            date: 日期 (YYYY-MM-DD)
            
        Returns:
            {
                "mp_load": Dict,        # aggregate_mp_load result
                "meter_load": Dict,     # aggregate_meter_load result
                "diff": float,          # Absolute diff volume
                "diff_rate": float,     # Difference rate (abs(diff) / mp_total)
                "status": str           # "balanced", "imbalanced", "missing_data"
            }
        """
        structure = LoadAggregationService.get_customer_structure(customer_id)
        if not structure:
             return {"status": "missing_config", "message": "Customer not found"}
             
        target_account = next((acc for acc in structure["accounts"] if acc["account_no"] == account_no), None)
        if not target_account:
             return {"status": "missing_config", "message": "Account not found"}
        
        mp_ids = target_account["mp_ids"]
        meters = target_account["meters"]
        
        # Aggregate MP
        mp_res = LoadAggregationService.aggregate_mp_load(customer_id, date, mp_ids_override=mp_ids)
        
        # Aggregate Meter
        meter_res = LoadAggregationService.aggregate_meter_load(customer_id, date, meter_configs_override=meters)
        
        # Handle cases where one or both are None/Empty
        mp_total = mp_res.get("total", 0) if mp_res else 0
        meter_total = meter_res.get("total", 0) if meter_res else 0
        
        if mp_total < 0.001 and meter_total < 0.001:
             return {
                "mp_load": mp_res,
                "meter_load": meter_res,
                "status": "balanced",
                "diff": 0,
                "diff_rate": 0
            }

        diff = abs(mp_total - meter_total)
        # 只有当 MP 总量显著大于 0 时才计算偏差率
        if mp_total > 0.001:
            diff_rate = diff / mp_total
        else:
            diff_rate = 1.0 if diff > 0.001 else 0.0
        
        status = "imbalanced" if diff_rate > 0.02 else "balanced"
        
        return {
            "mp_load": mp_res,
            "meter_load": meter_res,
            "diff": round(diff, 3),
            "diff_rate": round(diff_rate, 3),
            "status": status
        }

    @staticmethod
    def calculate_deviation(mp_load: Optional[Dict], meter_load: Optional[Dict]) -> Optional[Dict]:
        """
        计算计量点数据与电表数据的误差
        
        Args:
            mp_load: 计量点聚合结果
            meter_load: 电表聚合结果
        
        Returns:
            {
                "daily_error": 日电量误差百分比,
                "daily_error_abs": 绝对误差,
                "is_warning": 是否超过阈值,
                "point_errors": [48点误差百分比] (可选)
            } 或 None
        """
        if not mp_load or not meter_load:
            return None
        
        mp_total = mp_load.get("total", 0)
        meter_total = meter_load.get("total", 0)
        
        if meter_total < 0.001:
            if mp_total < 0.001:
                return {
                    "daily_error": 0.0,
                    "daily_error_abs": 0.0,
                    "is_warning": False
                }
            return None
        
        # 计算日电量误差
        daily_error_abs = mp_total - meter_total
        daily_error = daily_error_abs / meter_total
        
        # 判断是否超过阈值
        # 初始结果
        result = {
            "daily_error": round(daily_error, 3),
            "daily_error_abs": round(daily_error_abs, 3),
            "is_warning": False # Placeholder
        }
        
        # 计算48点误差（可选，仅当两者都有48点数据时）
        mp_values = mp_load.get("values", [])
        meter_values = meter_load.get("values", [])
        point_errors = []
        max_point_error = 0.0
        
        if len(mp_values) == 48 and len(meter_values) == 48:
            for mp_val, meter_val in zip(mp_values, meter_values):
                if meter_val and meter_val != 0:
                    error = (mp_val - meter_val) / meter_val
                    point_errors.append(round(error, 3))
                    if abs(error) > max_point_error: max_point_error = abs(error)
                elif mp_val == 0 and (meter_val == 0 or meter_val is None):
                    # 两边都是0，认为无误差
                    point_errors.append(0)
                else:
                    # mp有值但meter为0，标记为特殊情况
                    point_errors.append(None)
            result["point_errors"] = point_errors
        
        # 判断是否超过阈值 (日电量 > 5% 或 单点 > 5%)
        is_warning_daily = abs(daily_error) > ERROR_THRESHOLD
        is_warning_point = max_point_error > ERROR_THRESHOLD
        
        result["is_warning"] = is_warning_daily or is_warning_point
        
        return result
    
    @staticmethod
    def generate_unified_load_curve(
        customer_id: str, 
        date: str, 
        customer_name: str = None
    ) -> Optional[Dict]:
        """
        生成单条统一负荷曲线记录
        
        Args:
            customer_id: 客户ID
            date: 日期
            customer_name: 客户名称（可选）
        
        Returns:
            unified_load_curve 文档
        """
        # 聚合计量点数据
        mp_load = LoadAggregationService.aggregate_mp_load(customer_id, date)
        
        # 聚合电表数据
        meter_load = LoadAggregationService.aggregate_meter_load(customer_id, date)
        
        # 如果都没有数据，返回None
        if not mp_load and not meter_load:
            return None
        
        # 计算误差
        deviation = LoadAggregationService.calculate_deviation(mp_load, meter_load)
        
        # 获取客户名称
        if not customer_name:
            try:
                customer = CUSTOMER_ARCHIVES.find_one({"_id": ObjectId(customer_id)})
                customer_name = customer.get("user_name", "未知") if customer else "未知"
            except:
                customer_name = "未知"
        
        doc = {
            "customer_id": customer_id,
            "customer_name": customer_name,
            "date": date,
            "mp_load": mp_load,
            "meter_load": meter_load,
            "deviation": deviation,
            "updated_at": datetime.utcnow()
        }
        
        return doc
    
    @staticmethod
    def upsert_unified_load_curve(
        customer_id: str, 
        date: str,
        customer_name: str = None
    ) -> bool:
        """
        生成并写入/更新统一负荷曲线
        
        Returns:
            是否成功
        """
        try:
            doc = LoadAggregationService.generate_unified_load_curve(
                customer_id, date, customer_name
            )
            
            if not doc:
                logger.info(f"无数据可聚合: customer={customer_id}, date={date}")
                return False
            
            # upsert
            UNIFIED_LOAD_CURVE.update_one(
                {"customer_id": customer_id, "date": date},
                {"$set": doc},
                upsert=True
            )
            
            logger.info(f"已更新统一曲线: customer={customer_id}, date={date}")
            return True
        except Exception as e:
            logger.error(f"写入统一曲线失败: {e}")
            return False


# 便捷函数
aggregate_mp_load = LoadAggregationService.aggregate_mp_load
aggregate_meter_load = LoadAggregationService.aggregate_meter_load
calculate_tou_distribution = LoadAggregationService.calculate_tou_distribution
calculate_deviation = LoadAggregationService.calculate_deviation
generate_unified_load_curve = LoadAggregationService.generate_unified_load_curve
upsert_unified_load_curve = LoadAggregationService.upsert_unified_load_curve
