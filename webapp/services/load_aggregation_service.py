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
    def aggregate_mp_load(customer_id: str, date: str) -> Optional[Dict]:
        """
        聚合单个客户单日的计量点数据
        
        Args:
            customer_id: 客户ID
            date: 日期（YYYY-MM-DD）
        
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
            expected_mps = LoadAggregationService.get_customer_metering_points(customer_id)
            if not expected_mps:
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
            
            # 计算覆盖率
            
            return {
                "values": [round(v, 4) for v in aggregated_values],
                "total": round(total, 4),
                "mp_count": len(found_mps),
                "missing_mps": sorted(list(missing_mps))
            }
        except Exception as e:
            logger.error(f"聚合计量点数据失败 customer={customer_id} date={date}: {e}")
            return None
    
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
    def aggregate_meter_load(customer_id: str, date: str) -> Optional[Dict]:
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
            prev_date = (dt.strptime(date, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
            prev_day_data = {doc["meter_id"]: doc.get("readings", []) 
                            for doc in RAW_METER_DATA.find({"meter_id": {"$in": list(found_meters)}, "date": prev_date})}
            
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
                if not readings or len(readings) < 2:
                    continue
                
                # 复制一份用于处理
                readings = list(readings)
                interpolated_points = []
                dirty_points = []
                
                # ========== 数据清洗与插值 ==========
                
                # 1. 找出缺口
                gaps = LoadAggregationService._find_gaps(readings)
                
                # 2. 处理缺口
                prev_readings = prev_day_data.get(meter_id, [])
                for gap_start, gap_length in gaps:
                    if gap_length > 3:
                        # 大缺口：尝试历史廓形填充
                        if not LoadAggregationService._profile_fill(
                            readings, gap_start, gap_length, prev_readings, interpolated_points
                        ):
                            # 失败则用线性插值
                            LoadAggregationService._linear_interpolate(
                                readings, gap_start, gap_length, interpolated_points
                            )
                    else:
                        # 小缺口：线性插值
                        LoadAggregationService._linear_interpolate(
                            readings, gap_start, gap_length, interpolated_points
                        )
                
                # ========== 差分计算 ==========
                load_values = []
                
                for i in range(1, len(readings)):
                    reading_curr = readings[i]
                    reading_prev = readings[i-1]
                    
                    if reading_curr is not None and reading_prev is not None:
                        diff = reading_curr - reading_prev
                        
                        # 示数回落：标记为脏数据
                        if diff < 0:
                            logger.warning(f"检测到示数回落(脏数据): meter={meter_id}, idx={i}")
                            dirty_points.append(i - 1)  # 标记时段索引
                            diff = 0  # 设为0避免负值
                        
                        load_values.append(diff * multiplier)
                    else:
                        load_values.append(0)
                
                # ========== 96转48对齐 ==========
                if len(load_values) >= 95:
                    load_48 = []
                    for i in range(0, 95, 2):
                        if i + 1 < len(load_values):
                            load_48.append(load_values[i] + load_values[i+1])
                        else:
                            load_48.append(load_values[i])
                    load_values = load_48[:48]
                    # 插值点索引也要转换
                    interpolated_points = list(set(p // 2 for p in interpolated_points if p < 96))
                    dirty_points = list(set(p // 2 for p in dirty_points if p < 96))
                elif len(load_values) >= 47:
                    while len(load_values) < 48:
                        load_values.append(0)
                    load_values = load_values[:48]
                else:
                    while len(load_values) < 48:
                        load_values.append(0)
                
                # 应用分配系数并累加
                for i, val in enumerate(load_values[:48]):
                    aggregated_values[i] += val * ratio / 1000  # 转换为 MWh
                
                all_interpolated_points.extend(interpolated_points)
                all_dirty_points.extend(dirty_points)
            
            total = sum(aggregated_values)
            
            result = {
                "values": [round(v, 4) for v in aggregated_values],
                "total": round(total, 4),
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
        
        if meter_total == 0:
            return None
        
        # 计算日电量误差
        daily_error_abs = mp_total - meter_total
        daily_error = daily_error_abs / meter_total
        
        # 判断是否超过阈值
        is_warning = abs(daily_error) > ERROR_THRESHOLD
        
        result = {
            "daily_error": round(daily_error, 4),
            "daily_error_abs": round(daily_error_abs, 4),
            "is_warning": is_warning
        }
        
        # 计算48点误差（可选，仅当两者都有48点数据时）
        mp_values = mp_load.get("values", [])
        meter_values = meter_load.get("values", [])
        
        if len(mp_values) == 48 and len(meter_values) == 48:
            point_errors = []
            for mp_val, meter_val in zip(mp_values, meter_values):
                if meter_val and meter_val != 0:
                    error = (mp_val - meter_val) / meter_val
                    point_errors.append(round(error, 4))
                elif mp_val == 0 and (meter_val == 0 or meter_val is None):
                    # 两边都是0，认为无误差
                    point_errors.append(0)
                else:
                    # mp有值但meter为0，标记为特殊情况
                    point_errors.append(None)
            result["point_errors"] = point_errors
        
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
calculate_deviation = LoadAggregationService.calculate_deviation
generate_unified_load_curve = LoadAggregationService.generate_unified_load_curve
upsert_unified_load_curve = LoadAggregationService.upsert_unified_load_curve
