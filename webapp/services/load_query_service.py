# -*- coding: utf-8 -*-
"""
负荷曲线查询服务
独立于 API 层，提供给 API、预测、结算等模块调用
"""

import logging
from typing import List, Dict, Optional, Any
from webapp.tools.mongo import DATABASE
from webapp.models.load_enums import FusionStrategy

logger = logging.getLogger(__name__)

from datetime import datetime
from webapp.services.contract_service import ContractService
CUSTOMER_ARCHIVES = DATABASE['customer_archives']
UNIFIED_LOAD_CURVE = DATABASE['unified_load_curve']
# RETAIL_CONTRACTS is accessed via ContractService

contract_service = ContractService(DATABASE)

class LoadQueryService:
    
    @staticmethod
    def _apply_fusion_strategy(
        curve: Dict, 
        strategy: FusionStrategy
    ) -> Dict:
        """
        根据融合策略计算最终曲线
        
        Returns:
            {"values": [48点], "total": float, "source": "mp"/"meter"/"none"}
        """
        mp_load = curve.get("mp_load")
        meter_load = curve.get("meter_load")
        
        if strategy == FusionStrategy.MP_ONLY:
            if mp_load:
                return {"values": mp_load.get("values", []), "total": mp_load.get("total", 0), "source": "mp"}
            return {"values": [], "total": 0, "source": "none"}
        
        elif strategy == FusionStrategy.METER_ONLY:
            if meter_load:
                return {"values": meter_load.get("values", []), "total": meter_load.get("total", 0), "source": "meter"}
            return {"values": [], "total": 0, "source": "none"}
        
        elif strategy == FusionStrategy.METER_PRIORITY:
            if meter_load:
                return {"values": meter_load.get("values", []), "total": meter_load.get("total", 0), "source": "meter"}
            elif mp_load:
                return {"values": mp_load.get("values", []), "total": mp_load.get("total", 0), "source": "mp"}
            return {"values": [], "total": 0, "source": "none"}
            
        elif strategy == FusionStrategy.MP_COMPLETE:
            # 新策略：如果当日 MP 完整（无缺失计量点），则优先使用 MP 数据；否则回退使用电表数据
            if mp_load:
                mp_count = mp_load.get("mp_count", 0)
                missing_count = len(mp_load.get("missing_mps", []))
                # 只有当有计量点且缺失数为0时，才视为完整
                if mp_count > 0 and missing_count == 0:
                    return {"values": mp_load.get("values", []), "total": mp_load.get("total", 0), "source": "mp"}
            
            # 不完整或无 MP，则尝试电表
            if meter_load:
                return {"values": meter_load.get("values", []), "total": meter_load.get("total", 0), "source": "meter"}
            if mp_load:
                return {"values": mp_load.get("values", []), "total": mp_load.get("total", 0), "source": "mp"}
            return {"values": [], "total": 0, "source": "none"}
        
        else:  # MP_PRIORITY (默认)
            if mp_load:
                return {"values": mp_load.get("values", []), "total": mp_load.get("total", 0), "source": "mp"}
            if meter_load:
                return {"values": meter_load.get("values", []), "total": meter_load.get("total", 0), "source": "meter"}
            return {"values": [], "total": 0, "source": "none"}

    @staticmethod
    def get_signed_customers_in_range(start_date: str, end_date: str) -> List[str]:
        """获取指定时间范围内的签约客户ID列表"""
        try:
            return contract_service.get_active_customers(start_date, end_date)
        except Exception as e:
            logger.error(f"查询签约客户失败: {e}")
            return []

    @staticmethod
    def get_customer_curve(
        customer_id: Optional[str] = None,
        customer_name: Optional[str] = None,
        start_date: str = None,
        end_date: str = None,
        strategy: FusionStrategy = FusionStrategy.MP_PRIORITY
    ) -> List[Dict]:
        """
        获取单客户的融合负荷曲线
        优化：支持 customer_id 或 customer_name 二选一，直接返回曲线列表，减少档案查询次数
        """
        try:
            actual_cid = customer_id
            if not actual_cid and customer_name:
                # 如果只有名称，则查询一次档案获取ID
                customer = CUSTOMER_ARCHIVES.find_one({"user_name": customer_name})
                if customer:
                    actual_cid = str(customer["_id"])
            
            if not actual_cid:
                return []
            
            # 查询曲线数据
            curves = list(UNIFIED_LOAD_CURVE.find({
                "customer_id": actual_cid,
                "date": {"$gte": start_date, "$lte": end_date}
            }).sort("date", 1))
            
            result_curves = []
            for curve in curves:
                fused = LoadQueryService._apply_fusion_strategy(curve, strategy)
                result_curves.append({
                    "date": curve.get("date"),
                    "values": fused["values"],
                    "total": fused["total"],
                    "source": fused["source"]
                })
            
            return result_curves
        except Exception as e:
            logger.error(f"获取客户曲线失败 id={customer_id}: {e}", exc_info=True)
            raise

    @staticmethod
    def get_batch_customer_curves(
        start_date: str,
        end_date: str,
        customer_ids: Optional[List[str]] = None,
        month: Optional[str] = None,
        strategy: FusionStrategy = FusionStrategy.MP_PRIORITY,
        include_curves: bool = False
    ) -> Dict:
        """
        批量获取客户日电量和曲线
        """
        try:
            target_ids = []
            if customer_ids:
                target_ids = customer_ids
            elif month:
                # 兼容旧逻辑，根据月份生成时间范围
                try:
                    year, mon = map(int, month.split("-"))
                    start_date_range = f"{year:04d}-{mon:02d}-01"
                    if mon == 12:
                        end_date_range = f"{year+1:04d}-01-01"
                    else:
                        end_date_range = f"{year:04d}-{mon+1:02d}-01"
                    target_ids = LoadQueryService.get_signed_customers_in_range(start_date_range, end_date_range)
                except:
                    target_ids = []
            else:
                target_ids = UNIFIED_LOAD_CURVE.distinct("customer_id")
            
            if not target_ids:
                return {"signed_customer_count": 0, "customers": []}
            
            customers_result = []
            for cid in target_ids:
                curves = list(UNIFIED_LOAD_CURVE.find({
                    "customer_id": cid,
                    "date": {"$gte": start_date, "$lte": end_date}
                }).sort("date", 1))
                
                if not curves:
                    continue
                
                customer_name = curves[0].get("customer_name", "未知")
                daily_data = []
                for curve in curves:
                    fused = LoadQueryService._apply_fusion_strategy(curve, strategy)
                    item = {
                        "date": curve.get("date"),
                        "total": fused["total"],
                        "source": fused["source"]
                    }
                    if include_curves:
                        item["values"] = fused["values"]
                    daily_data.append(item)
                
                customers_result.append({
                    "customer_id": cid,
                    "customer_name": customer_name,
                    "daily_data": daily_data
                })
            
            return {
                "month": month,
                "signed_customer_count": len(target_ids),
                "include_curves": include_curves,
                "customers": customers_result
            }
        except Exception as e:
            logger.error(f"批量获取客户曲线失败: {e}", exc_info=True)
            raise

    @staticmethod
    def get_total_load_curve(
        start_date: str,
        end_date: str,
        month: Optional[str] = None,
        strategy: FusionStrategy = FusionStrategy.MP_PRIORITY,
        include_curves: bool = False
    ) -> Dict:
        """
        获取所有签约客户的总负荷日电量曲线
        """
        try:
            if month:
                # 兼容旧逻辑
                try:
                    year, mon = map(int, month.split("-"))
                    month_start = f"{year:04d}-{mon:02d}-01"
                    if mon == 12:
                        month_end = f"{year+1:04d}-01-01"
                    else:
                        month_end = f"{year:04d}-{mon+1:02d}-01"
                    customer_ids = LoadQueryService.get_signed_customers_in_range(month_start, month_end)
                except:
                    customer_ids = []
            else:
                customer_ids = UNIFIED_LOAD_CURVE.distinct("customer_id")
            
            if not customer_ids:
                return {"signed_customer_count": 0, "daily_totals": [], "curves": []}
            
            from collections import defaultdict
            daily_data = defaultdict(lambda: {"total": 0, "count": 0, "values": [0.0] * 48})
            
            for cid in customer_ids:
                curves = list(UNIFIED_LOAD_CURVE.find({
                    "customer_id": cid,
                    "date": {"$gte": start_date, "$lte": end_date}
                }))
                
                for curve in curves:
                    date = curve.get("date")
                    fused = LoadQueryService._apply_fusion_strategy(curve, strategy)
                    
                    if fused["source"] != "none":
                        daily_data[date]["total"] += fused["total"]
                        daily_data[date]["count"] += 1
                        
                        if include_curves and fused["values"]:
                            for i, v in enumerate(fused["values"]):
                                if i < 48:
                                    daily_data[date]["values"][i] += v if v else 0
            
            daily_totals = []
            curves_result = []
            for date in sorted(daily_data.keys()):
                d = daily_data[date]
                daily_totals.append({
                    "date": date,
                    "total_load": round(d["total"], 4),
                    "customer_count": d["count"]
                })
                if include_curves:
                    curves_result.append({
                        "date": date,
                        "values": [round(v, 4) for v in d["values"]]
                    })
            
            result = {
                "start_date": start_date,
                "end_date": end_date,
                "signed_customer_count": len(customer_ids),
                "daily_totals": daily_totals
            }
            
            if include_curves:
                result["curves"] = curves_result
            
            return result
        except Exception as e:
            logger.error(f"获取总负荷曲线失败: {e}", exc_info=True)
            raise
