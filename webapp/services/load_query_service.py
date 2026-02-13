# -*- coding: utf-8 -*-
"""
负荷曲线查询服务
独立于 API 层，提供给 API、预测、结算等模块调用
"""

import logging
from typing import List, Dict, Optional, Any, Union
from pydantic import BaseModel
from datetime import datetime
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.models.load_enums import FusionStrategy
from webapp.services.contract_service import ContractService
from webapp.schemas.load_structs import (
    DailyCurve, DailyTotal, MonthlyTotal, CustomerLoadData, TouUsage
)

logger = logging.getLogger(__name__)

CUSTOMER_ARCHIVES = DATABASE['customer_archives']
UNIFIED_LOAD_CURVE = DATABASE['unified_load_curve']

contract_service = ContractService(DATABASE)

try:
    import pandas as pd
except ImportError:
    pd = None

class LoadQueryService:
    
    @staticmethod
    def _get_fusion_expression(strategy: FusionStrategy) -> Dict:
        """
        构建 MongoDB Aggregation 的融合策略表达式
        用于 $project 阶段，计算 effective_load 和 effective_source
        """
        # 定义字段引用
        mp_valid = {"$and": [{"$ifNull": ["$mp_load", False]}, {"$gt": ["$mp_load.mp_count", 0]}]}
        meter_valid = {"$and": [{"$ifNull": ["$meter_load", False]}, {"$gt": ["$meter_load.meter_count", 0]}]}
        
        mp_val = "$mp_load"
        meter_val = "$meter_load"
        
        # 构造条件表达式 (MongoDB $cond)
        if strategy == FusionStrategy.MP_ONLY:
            cond = {"$cond": {
                "if": mp_valid,
                "then": mp_val,
                "else": None
            }}
        elif strategy == FusionStrategy.METER_ONLY:
            cond = {"$cond": {
                "if": meter_valid,
                "then": meter_val,
                "else": None
            }}
        elif strategy == FusionStrategy.METER_PRIORITY:
            cond = {"$cond": {
                "if": meter_valid,
                "then": meter_val,
                "else": {"$cond": {
                    "if": mp_valid,
                    "then": mp_val,
                    "else": None
                }}
            }}
        elif strategy == FusionStrategy.MP_COMPLETE:
            # 1. 如果MP完整 (无缺失)，优先用 MP
            mp_is_complete = {"$and": [
                mp_valid,
                {"$eq": [{"$size": {"$ifNull": ["$mp_load.missing_mps", []]}}, 0]}
            ]}
            
            # 2. 如果Meter完整 (无缺失)，优先用 Meter
            meter_is_complete = {"$and": [
                meter_valid,
                {"$eq": [{"$size": {"$ifNull": ["$meter_load.missing_meters", []]}}, 0]}
            ]}
            
            # 3. 都不完整，取日电量大的那个
            # 注意: 如果某个不存在，total 为 null/0
            mp_total = {"$ifNull": ["$mp_load.total", 0]}
            meter_total = {"$ifNull": ["$meter_load.total", 0]}

            cond = {"$cond": {
                "if": mp_is_complete,
                "then": mp_val,
                "else": {"$cond": {
                    "if": meter_is_complete,
                    "then": meter_val,
                    "else": {"$cond": {
                        "if": {"$gte": [mp_total, meter_total]},
                        "then": mp_val,
                        "else": meter_val
                    }}
                }}
            }}
        else: # MP_PRIORITY (Default)
            cond = {"$cond": {
                "if": mp_valid,
                "then": mp_val,
                "else": {"$cond": {
                    "if": meter_valid,
                    "then": meter_val,
                    "else": None
                }}
            }}
            
        return cond

    @staticmethod
    def _format_dataframe(data: List[BaseModel], index_key: str = 'date') -> Any:
        """辅助方法：将 Pydantic 列表转换为 Pandas DataFrame"""
        if pd is None:
            logger.warning("Pandas not installed, returning raw list")
            return data
            
        if not data:
            return pd.DataFrame()
            
        dicts = [d.dict() for d in data]
        df = pd.DataFrame(dicts)
        if index_key in df.columns:
            df[index_key] = pd.to_datetime(df[index_key])
            df.set_index(index_key, inplace=True)
        return df

    @staticmethod
    def get_latest_data_date(customer_id: Optional[str] = None) -> Optional[str]:
        """查询统一负荷曲线的最新数据日期"""
        query = {}
        if customer_id:
            query["customer_id"] = customer_id
            
        latest_doc = UNIFIED_LOAD_CURVE.find_one(query, sort=[("date", -1)])
        return latest_doc.get("date") if latest_doc else None

    # =========================================================================
    # 1. 基础查询接口 (单客户)
    # =========================================================================

    @staticmethod
    def get_daily_curve(
        customer_id: str, 
        date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE
    ) -> Optional[DailyCurve]:
        """获取单个客户单日的负荷曲线"""
        try:
            curve = UNIFIED_LOAD_CURVE.find_one({
                "customer_id": customer_id,
                "date": date
            })
            if not curve:
                return None
                
            # 复用 Python 层的简单融合逻辑（单条无需聚合管道）
            fused = LoadQueryService._apply_fusion_strategy_legacy(curve, strategy)
            if fused["source"] == "none":
                return None
                
            return DailyCurve(
                date=date, 
                values=fused["values"], 
                total=fused["total"],
                tou_usage=fused.get("tou_usage")
            )
        except Exception as e:
            logger.error(f"get_daily_curve failed: {e}")
            return None

    @staticmethod
    def get_curve_series(
        customer_id: str, 
        start_date: str, 
        end_date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE,
        return_df: bool = False
    ) -> Union[List[DailyCurve], Any]:
        """获取单个客户连续多日的负荷曲线"""
        pipeline = [
            {"$match": {
                "customer_id": customer_id,
                "date": {"$gte": start_date, "$lte": end_date}
            }},
            {"$sort": {"date": 1}},
            {"$project": {
                "date": 1,
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            # 过滤掉无数据天
            {"$match": {"effective": {"$ne": None}}},
            {"$project": {
                "date": 1,
                "values": "$effective.values",
                "total": "$effective.total",
                "tou_usage": "$effective.tou_usage"
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        result = [DailyCurve(**d) for d in docs]
        
        if return_df:
            return LoadQueryService._format_dataframe(result)
        return result

    @staticmethod
    def get_daily_totals(
        customer_id: str, 
        start_date: str, 
        end_date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE,
        return_df: bool = False
    ) -> Union[List[DailyTotal], Any]:
        """获取单个客户连续多日的日电量"""
        pipeline = [
            {"$match": {
                "customer_id": customer_id,
                "date": {"$gte": start_date, "$lte": end_date}
            }},
            {"$sort": {"date": 1}},
            {"$project": {
                "date": 1,
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            {"$project": {
                "date": 1,
                "total": "$effective.total",
                "tou_usage": "$effective.tou_usage"
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        result = [DailyTotal(**d) for d in docs]
        
        if return_df:
            return LoadQueryService._format_dataframe(result)
        return result

    @staticmethod
    def get_monthly_totals(
        customer_id: str, 
        start_month: str, 
        end_month: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE
    ) -> List[MonthlyTotal]:
        """获取单个客户连续多月的月电量"""
        # 构造日期范围
        try:
            sy, sm = map(int, start_month.split("-"))
            ey, em = map(int, end_month.split("-"))
            s_date = f"{sy:04d}-{sm:02d}-01"
            # 结束日期需推算到下月1号前
            if em == 12:
                e_date = f"{ey+1:04d}-01-01"
            else:
                e_date = f"{ey:04d}-{em+1:02d}-01"
        except:
            return []

        pipeline = [
            {"$match": {
                "customer_id": customer_id,
                "date": {"$gte": s_date, "$lt": e_date}
            }},
            {"$project": {
                "month": {"$substr": ["$date", 0, 7]}, # YYYY-MM
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            {"$group": {
                "_id": "$month",
                "total": {"$sum": "$effective.total"},
                "tou_tip": {"$sum": {"$ifNull": ["$effective.tou_usage.tip", 0]}},
                "tou_peak": {"$sum": {"$ifNull": ["$effective.tou_usage.peak", 0]}},
                "tou_flat": {"$sum": {"$ifNull": ["$effective.tou_usage.flat", 0]}},
                "tou_valley": {"$sum": {"$ifNull": ["$effective.tou_usage.valley", 0]}},
                "tou_deep": {"$sum": {"$ifNull": ["$effective.tou_usage.deep", 0]}},
                "days_count": {"$sum": 1}
            }},
            {"$sort": {"_id": 1}},
            {"$project": {
                "month": "$_id",
                "total": {"$round": ["$total", 2]},
                "days_count": 1,
                "tou_usage": {
                    "tip": {"$round": ["$tou_tip", 3]},
                    "peak": {"$round": ["$tou_peak", 3]},
                    "flat": {"$round": ["$tou_flat", 3]},
                    "valley": {"$round": ["$tou_valley", 3]},
                    "deep": {"$round": ["$tou_deep", 3]}
                },
                "_id": 0
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        return [MonthlyTotal(**d) for d in docs]

    # =========================================================================
    # 2. 聚合查询接口 (多客户求和)
    # =========================================================================

    @staticmethod
    def aggregate_curve_series(
        customer_ids: List[str], 
        start_date: str, 
        end_date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE,
        return_df: bool = False
    ) -> Union[List[DailyCurve], Any]:
        """获取多个客户的聚合负荷曲线（叠加）"""
        if not customer_ids:
            return [] if not return_df else pd.DataFrame()

        pipeline = [
            {"$match": {
                "customer_id": {"$in": customer_ids},
                "date": {"$gte": start_date, "$lte": end_date}
            }},
            {"$project": {
                "date": 1,
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            # 按日期分组，对 values 数组进行对应位相加
            {"$group": {
                "_id": "$date",
                "total": {"$sum": "$effective.total"},
                "tou_usage_matrix": {"$push": "$effective.tou_usage"},
                # 假设所有有效曲线长度一致 (48或96)，使用 $reduce 进行数组相加比较复杂
                # 这里使用 unwind -> group 的方式虽然不是最高效，但最通用
                "values_matrix": {"$push": "$effective.values"}
            }},
            {"$sort": {"_id": 1}}
        ]
        
        # 注意：MangoDB 直接做数组对应位相加比较困难（需要 $zip + $map + $sum），
        # 且点数可能不一致（48 vs 96）。
        # 这里采用：在 Python 层做最终的数组叠加，避免复杂的 Aggregation 逻辑导致性能问题或错误
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        result = []
        
        for doc in docs:
            date = doc["_id"]
            total = doc["total"]
            matrices = doc["values_matrix"]
            
            # Python 层数组相加
            # 自动适应长度，分别统计 48点和96点
            # 简单起见，假设主要是 48点，或者把 96点降采样? 
            # 策略：以第一个非空数组长度为基准，或者取最大长度
            
            # 快速叠加
            final_values = []
            if matrices:
                # 找出最长长度
                max_len = max((len(x) for x in matrices if x), default=0)
                if max_len > 0:
                    sum_arr = [0.0] * max_len
                    for arr in matrices:
                        if not arr: continue
                        # 处理长度不一致情况 (简单的对齐，实际很少见混合)
                        check_len = len(arr)
                        if check_len == max_len:
                            for i, v in enumerate(arr):
                                if v: sum_arr[i] += v
                        elif check_len == 48 and max_len == 96:
                            # 简单的倍增扩充 (不插值)
                            for i, v in enumerate(arr):
                                if v: 
                                    sum_arr[i*2] += v
                                    sum_arr[i*2+1] += v
                        # 其他情况暂忽略
                    final_values = [round(x, 4) for x in sum_arr]
            
            # TOU 细项叠加
            final_tou = {"tip": 0.0, "peak": 0.0, "flat": 0.0, "valley": 0.0, "deep": 0.0}
            tou_matrices = doc.get("tou_usage_matrix", [])
            for tou in tou_matrices:
                if not tou: continue
                for k in final_tou.keys():
                    final_tou[k] += tou.get(k, 0.0)
            
            # 四舍五入
            final_tou = {k: round(v, 4) for k, v in final_tou.items()}
            
            result.append(DailyCurve(
                date=date, 
                values=final_values, 
                total=round(total, 4),
                tou_usage=final_tou
            ))
            
        if return_df:
            return LoadQueryService._format_dataframe(result)
        return result

    @staticmethod
    def aggregate_daily_totals(
        customer_ids: List[str], 
        start_date: str, 
        end_date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE,
        return_df: bool = False
    ) -> Union[List[DailyTotal], Any]:
        """获取多个客户的聚合日电量（叠加）"""
        if not customer_ids:
            return [] if not return_df else pd.DataFrame()

        pipeline = [
            {"$match": {
                "customer_id": {"$in": customer_ids},
                "date": {"$gte": start_date, "$lte": end_date}
            }},
            {"$project": {
                "date": 1,
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            {"$group": {
                "_id": "$date",
                "total": {"$sum": "$effective.total"},
                "tou_tip": {"$sum": {"$ifNull": ["$effective.tou_usage.tip", 0]}},
                "tou_peak": {"$sum": {"$ifNull": ["$effective.tou_usage.peak", 0]}},
                "tou_flat": {"$sum": {"$ifNull": ["$effective.tou_usage.flat", 0]}},
                "tou_valley": {"$sum": {"$ifNull": ["$effective.tou_usage.valley", 0]}},
                "tou_deep": {"$sum": {"$ifNull": ["$effective.tou_usage.deep", 0]}}
            }},
            {"$sort": {"_id": 1}},
            {"$project": {
                "date": "$_id",
                "total": 1,
                "tou_usage": {
                    "tip": {"$round": ["$tou_tip", 3]},
                    "peak": {"$round": ["$tou_peak", 3]},
                    "flat": {"$round": ["$tou_flat", 3]},
                    "valley": {"$round": ["$tou_valley", 3]},
                    "deep": {"$round": ["$tou_deep", 3]}
                },
                "_id": 0
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        result = [DailyTotal(**d) for d in docs]
        
        if return_df:
            return LoadQueryService._format_dataframe(result)
        return result

    @staticmethod
    def aggregate_monthly_totals(
        customer_ids: List[str], 
        start_month: str, 
        end_month: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE
    ) -> List[MonthlyTotal]:
        """获取多个客户的聚合月电量（叠加）"""
        if not customer_ids:
            return []

        try:
            sy, sm = map(int, start_month.split("-"))
            ey, em = map(int, end_month.split("-"))
            s_date = f"{sy:04d}-{sm:02d}-01"
            if em == 12:
                e_date = f"{ey+1:04d}-01-01"
            else:
                e_date = f"{ey:04d}-{em+1:02d}-01"
        except:
            return []

        pipeline = [
            {"$match": {
                "customer_id": {"$in": customer_ids},
                "date": {"$gte": s_date, "$lt": e_date}
            }},
            {"$project": {
                "month": {"$substr": ["$date", 0, 7]},
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            # 先按 月份+客户 聚合一次（算出每户月电量，避免天数重复统计问题? 不，直接按月聚合即可）
            # 需求是：所有客户在该月的总电量
            {"$group": {
                "_id": "$month",
                "total": {"$sum": "$effective.total"},
                "tou_tip": {"$sum": {"$ifNull": ["$effective.tou_usage.tip", 0]}},
                "tou_peak": {"$sum": {"$ifNull": ["$effective.tou_usage.peak", 0]}},
                "tou_flat": {"$sum": {"$ifNull": ["$effective.tou_usage.flat", 0]}},
                "tou_valley": {"$sum": {"$ifNull": ["$effective.tou_usage.valley", 0]}},
                "tou_deep": {"$sum": {"$ifNull": ["$effective.tou_usage.deep", 0]}},
                "days_count": {"$sum": 1} 
            }},
            {"$sort": {"_id": 1}},
            {"$project": {
                "month": "$_id",
                "total": 1,
                "days_count": 1,
                "tou_usage": {
                    "tip": {"$round": ["$tou_tip", 3]},
                    "peak": {"$round": ["$tou_peak", 3]},
                    "flat": {"$round": ["$tou_flat", 3]},
                    "valley": {"$round": ["$tou_valley", 3]},
                    "deep": {"$round": ["$tou_deep", 3]}
                },
                "_id": 0
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        return [MonthlyTotal(**d) for d in docs]

    @staticmethod
    def batch_get_curve_series(
        customer_ids: List[str], 
        start_date: str, 
        end_date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE
    ) -> Dict[str, List[DailyCurve]]:
        """
        批量获取多个客户的负荷曲线数据
        返回: Dict[customer_id, List[DailyCurve]]
        """
        if not customer_ids:
            return {}

        pipeline = [
            {"$match": {
                "customer_id": {"$in": customer_ids},
                "date": {"$gte": start_date, "$lte": end_date}
            }},
            {"$sort": {"date": 1}},
            {"$project": {
                "customer_id": 1,
                "date": 1,
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            {"$project": {
                "customer_id": 1,
                "date": 1,
                "values": "$effective.values",
                "total": "$effective.total",
                "tou_usage": "$effective.tou_usage"
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        
        result = {cid: [] for cid in customer_ids}
        for d in docs:
            cid = d.get("customer_id")
            if cid in result:
                result[cid].append(DailyCurve(
                    date=d["date"],
                    values=d["values"],
                    total=d["total"],
                    tou_usage=d.get("tou_usage")
                ))
        return result

    @staticmethod
    def batch_get_daily_totals(
        customer_ids: List[str], 
        start_date: str, 
        end_date: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE
    ) -> Dict[str, List[DailyTotal]]:
        """
        批量获取多个客户的日电量数据
        返回: Dict[customer_id, List[DailyTotal]]
        """
        if not customer_ids:
            return {}

        pipeline = [
            {"$match": {
                "customer_id": {"$in": customer_ids},
                "date": {"$gte": start_date, "$lte": end_date}
            }},
            {"$sort": {"date": 1}},
            {"$project": {
                "customer_id": 1,
                "date": 1,
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            {"$project": {
                "customer_id": 1,
                "date": 1,
                "total": "$effective.total",
                "tou_usage": "$effective.tou_usage"
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        
        result = {cid: [] for cid in customer_ids}
        for d in docs:
            cid = d.get("customer_id")
            if cid in result:
                result[cid].append(DailyTotal(
                    date=d["date"], 
                    total=d["total"],
                    tou_usage=d.get("tou_usage")
                ))
        return result

    @staticmethod
    def batch_get_monthly_totals(
        customer_ids: List[str], 
        start_month: str, 
        end_month: str, 
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE
    ) -> Dict[str, List[MonthlyTotal]]:
        """
        批量获取多个客户的月电量数据
        返回: Dict[customer_id, List[MonthlyTotal]]
        """
        if not customer_ids:
            return {}

        # 构造日期范围
        try:
            sy, sm = map(int, start_month.split("-"))
            ey, em = map(int, end_month.split("-"))
            s_date = f"{sy:04d}-{sm:02d}-01"
            if em == 12:
                e_date = f"{ey+1:04d}-01-01"
            else:
                e_date = f"{ey:04d}-{em+1:02d}-01"
        except:
            return {}

        pipeline = [
            {"$match": {
                "customer_id": {"$in": customer_ids},
                "date": {"$gte": s_date, "$lt": e_date}
            }},
            {"$project": {
                "customer_id": 1,
                "month": {"$substr": ["$date", 0, 7]}, # YYYY-MM
                "effective": LoadQueryService._get_fusion_expression(strategy)
            }},
            {"$match": {"effective": {"$ne": None}}},
            {"$group": {
                "_id": {"customer_id": "$customer_id", "month": "$month"},
                "total": {"$sum": "$effective.total"},
                "tou_tip": {"$sum": {"$ifNull": ["$effective.tou_usage.tip", 0]}},
                "tou_peak": {"$sum": {"$ifNull": ["$effective.tou_usage.peak", 0]}},
                "tou_flat": {"$sum": {"$ifNull": ["$effective.tou_usage.flat", 0]}},
                "tou_valley": {"$sum": {"$ifNull": ["$effective.tou_usage.valley", 0]}},
                "tou_deep": {"$sum": {"$ifNull": ["$effective.tou_usage.deep", 0]}},
                "days_count": {"$sum": 1}
            }},
            {"$sort": {"_id.month": 1}},
            {"$project": {
                "customer_id": "$_id.customer_id",
                "month": "$_id.month",
                "total": {"$round": ["$total", 2]},
                "days_count": 1,
                "tou_usage": {
                    "tip": {"$round": ["$tou_tip", 3]},
                    "peak": {"$round": ["$tou_peak", 3]},
                    "flat": {"$round": ["$tou_flat", 3]},
                    "valley": {"$round": ["$tou_valley", 3]},
                    "deep": {"$round": ["$tou_deep", 3]}
                },
                "_id": 0
            }}
        ]
        
        docs = list(UNIFIED_LOAD_CURVE.aggregate(pipeline))
        
        result = {cid: [] for cid in customer_ids}
        for d in docs:
            cid = d.get("customer_id")
            if cid in result:
                result[cid].append(MonthlyTotal(**d))
        return result

    # =========================================================================
    # 3. 签约客户快捷接口
    # =========================================================================

    @staticmethod
    def get_signed_customers_aggregated_load(
        month: str,  # YYYY-MM
        data_type: str = 'daily', # curve, daily, monthly
        strategy: FusionStrategy = FusionStrategy.MP_COMPLETE,
        return_df: bool = False
    ) -> Union[List[Any], Any]:
        """
        获取指定月份签约客户的聚合负荷。
        注意：签约客户列表是按月变化的。这里获取该月所有 有效签约 的客户，
        并计算它们在该月的聚合数据。
        """
        try:
            year, mon = map(int, month.split("-"))
            start_date = f"{year:04d}-{mon:02d}-01"
            # 计算月底
            if mon == 12:
                next_start = f"{year+1:04d}-01-01"
            else:
                next_start = f"{year:04d}-{mon+1:02d}-01"
            
            # 1. 获取签约客户ID
            # 使用 ContractService 查找在该月份内有效的合同
            customer_ids = contract_service.get_active_customers(start_date, next_start)
            
            if not customer_ids:
                return [] if not return_df else (pd.DataFrame() if pd else [])

            # 2. 根据类型调用聚合接口
            # 注意 end_date 是 next_start 的前一天 (如果不包含 next_start)
            # 简单起见，传入 next_start，聚合查询用的 $lt next_start 吗？
            # 之前的接口是 $lte end_date。所以需要计算 month end date str.
            import datetime
            last_day = (datetime.datetime.strptime(next_start, "%Y-%m-%d") - datetime.timedelta(days=1)).strftime("%Y-%m-%d")

            if data_type == 'curve':
                return LoadQueryService.aggregate_curve_series(
                    customer_ids, start_date, last_day, strategy, return_df
                )
            elif data_type == 'daily':
                return LoadQueryService.aggregate_daily_totals(
                    customer_ids, start_date, last_day, strategy, return_df
                )
            elif data_type == 'monthly':
                 # 对于 monthly，只需传入 month 即可
                 return LoadQueryService.aggregate_monthly_totals(
                     customer_ids, month, month, strategy
                 )
            else:
                raise ValueError(f"Unknown data_type: {data_type}")
                
        except Exception as e:
            logger.error(f"get_signed_customers_aggregated_load failed: {e}")
            return []

    # =========================================================================
    # 4. 保留接口 (兼容旧代码)
    # =========================================================================

    @staticmethod
    def get_diagnosis_curves(
        customer_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        detail_date: Optional[str] = None
    ) -> Dict:
        """
        [Legacy] 获取诊断详情页面的负荷比对曲线数据
        被 webapp/api/v1_load_diagnosis.py 引用
        """
        if detail_date:
            # 返回48点曲线对比
            curve = UNIFIED_LOAD_CURVE.find_one({
                "customer_id": customer_id,
                "date": detail_date
            })
            
            if not curve:
                return {"date": detail_date, "mp_values": [], "meter_values": [], "point_errors": []}
            
            mp_values = curve.get("mp_load", {}).get("values", []) if curve.get("mp_load") else []
            meter_values = curve.get("meter_load", {}).get("values", []) if curve.get("meter_load") else []
            deviation = curve.get("deviation") or {}
            
            return {
                "date": detail_date,
                "mp_values": mp_values,
                "meter_values": meter_values,
                "mp_total": curve.get("mp_load", {}).get("total") if curve.get("mp_load") else None,
                "meter_total": curve.get("meter_load", {}).get("total") if curve.get("meter_load") else None,
                "daily_error": deviation.get("daily_error"),
                "point_errors": deviation.get("point_errors", [])
            }
        else:
            # 返回日电量对比
            if not start_date or not end_date:
                return {"start_date": start_date, "end_date": end_date, "daily_comparison": [], "warning_dates": []}

            curves = list(UNIFIED_LOAD_CURVE.find({
                "customer_id": customer_id,
                "date": {"$gte": start_date, "$lte": end_date}
            }).sort("date", 1))
            
            daily_comparison = []
            warning_dates = []
            
            for curve in curves:
                date = curve.get("date")
                mp_total = curve.get("mp_load", {}).get("total") if curve.get("mp_load") else None
                meter_total = curve.get("meter_load", {}).get("total") if curve.get("meter_load") else None
                deviation = curve.get("deviation", {})
                daily_error = deviation.get("daily_error")
                is_warning = deviation.get("is_warning", False)
                
                daily_comparison.append({
                    "date": date,
                    "mp_total": mp_total,
                    "meter_total": meter_total,
                    "daily_error": daily_error,
                    "is_warning": is_warning
                })
                
                if is_warning:
                    warning_dates.append({
                        "date": date,
                        "error": daily_error
                    })
            
            return {
                "start_date": start_date,
                "end_date": end_date,
                "daily_comparison": daily_comparison,
                "warning_dates": warning_dates
            }

    @staticmethod
    def _apply_fusion_strategy_legacy(
        curve: Dict, 
        strategy: FusionStrategy
    ) -> Dict:
        """
        [Inner Legacy Helper] 供 get_daily_curve 使用
        """
        mp_load = curve.get("mp_load")
        meter_load = curve.get("meter_load")
        
        if strategy == FusionStrategy.MP_ONLY:
            if mp_load:
                return {
                    "values": mp_load.get("values", []), 
                    "total": mp_load.get("total", 0), 
                    "tou_usage": mp_load.get("tou_usage"),
                    "source": "mp"
                }
            return {"values": [], "total": 0, "source": "none"}
        
        elif strategy == FusionStrategy.METER_ONLY:
            if meter_load:
                return {
                    "values": meter_load.get("values", []), 
                    "total": meter_load.get("total", 0), 
                    "tou_usage": meter_load.get("tou_usage"),
                    "source": "meter"
                }
            return {"values": [], "total": 0, "source": "none"}
        
        elif strategy == FusionStrategy.METER_PRIORITY:
            if meter_load:
                return {
                    "values": meter_load.get("values", []), 
                    "total": meter_load.get("total", 0), 
                    "tou_usage": meter_load.get("tou_usage"),
                    "source": "meter"
                }
            elif mp_load:
                return {
                    "values": mp_load.get("values", []), 
                    "total": mp_load.get("total", 0), 
                    "tou_usage": mp_load.get("tou_usage"),
                    "source": "mp"
                }
            return {"values": [], "total": 0, "source": "none"}
            
        elif strategy == FusionStrategy.MP_COMPLETE:
            # 1. MP数据完整 (无缺失)，优先用 MP
            mp_count = mp_load.get("mp_count", 0) if mp_load else 0
            mp_missing_count = len(mp_load.get("missing_mps", [])) if mp_load else 0
            mp_is_complete = (mp_count > 0 and mp_missing_count == 0)

            if mp_is_complete:
                return {
                    "values": mp_load.get("values", []), 
                    "total": mp_load.get("total", 0), 
                    "tou_usage": mp_load.get("tou_usage"),
                    "source": "mp"
                }
            
            # 2. Meter数据完整 (无缺失)，优先用 Meter
            meter_count = meter_load.get("meter_count", 0) if meter_load else 0
            meter_missing_count = len(meter_load.get("missing_meters", [])) if meter_load else 0
            meter_is_complete = (meter_count > 0 and meter_missing_count == 0)

            if meter_is_complete:
                return {
                    "values": meter_load.get("values", []), 
                    "total": meter_load.get("total", 0), 
                    "tou_usage": meter_load.get("tou_usage"),
                    "source": "meter"
                }

            # 3. 都不完整，取日电量大的那个
            mp_total = mp_load.get("total", 0) if mp_load else 0
            meter_total = meter_load.get("total", 0) if meter_load else 0
            
            if mp_total >= meter_total and mp_load:
                 return {
                    "values": mp_load.get("values", []), 
                    "total": mp_load.get("total", 0), 
                    "tou_usage": mp_load.get("tou_usage"),
                    "source": "mp"
                }
            elif meter_load:
                return {
                    "values": meter_load.get("values", []), 
                    "total": meter_load.get("total", 0), 
                    "tou_usage": meter_load.get("tou_usage"),
                    "source": "meter"
                }

            return {"values": [], "total": 0, "source": "none"}
        
        else:  # MP_PRIORITY (默认)
            if mp_load:
                return {
                    "values": mp_load.get("values", []), 
                    "total": mp_load.get("total", 0), 
                    "tou_usage": mp_load.get("tou_usage"),
                    "source": "mp"
                }
            if meter_load:
                return {
                    "values": meter_load.get("values", []), 
                    "total": meter_load.get("total", 0), 
                    "tou_usage": meter_load.get("tou_usage"),
                    "source": "meter"
                }
            return {"values": [], "total": 0, "source": "none"}
