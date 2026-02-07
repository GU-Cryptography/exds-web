import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from bson import ObjectId
from pymongo.database import Database
from webapp.services.load_query_service import LoadQueryService
from webapp.services.tou_service import get_tou_rule_by_date

logger = logging.getLogger(__name__)

class LoadForecastService:
    """
    负荷预测服务层
    职责：
    - 聚合预测结果
    - 管理预测版本
    - 提供客户联动数据
    """
    def __init__(self, db: Database) -> None:
        self.db = db
        self.forecast_results = db['load_forecast_results']
        self.customer_archives = db['customer_archives']
        self.retail_contracts = db['retail_contracts']
        self.unified_load_curve = db['unified_load_curve']
        self.query_service = LoadQueryService

    def get_versions(self, target_date: str) -> List[Dict[str, Any]]:
        """获取指定目标日期的预测版本列表"""
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
            pipeline = [
                {"$match": {"target_date": target_dt}},
                {
                    "$group": {
                        "_id": "$forecast_date",
                        "forecast_id": {"$first": "$forecast_id"},
                        "created_at": {"$first": "$created_at"},
                        "gap": {"$first": "$gap"}
                    }
                },
                {"$sort": {"_id": -1}}, # 按发布日期降序
                {
                    "$project": {
                        "_id": 0,
                        "forecast_date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$_id"}},
                        "forecast_id": 1,
                        "created_at": {"$dateToString": {"format": "%Y-%m-%dT%H:%M:%S", "date": "$created_at"}},
                        "gap": 1
                    }
                }
            ]
            return list(self.forecast_results.aggregate(pipeline))
        except Exception as e:
            logger.error(f"Error get_versions: {e}")
            return []

    def get_forecast_data(self, target_date: str, forecast_date: str, customer_id: str = "AGGREGATE") -> Optional[Dict[str, Any]]:
        """获取特定版本的负荷数据"""
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
            forecast_dt = datetime.strptime(forecast_date, "%Y-%m-%d")
            
            query = {
                "target_date": target_dt,
                "forecast_date": forecast_dt,
                "customer_id": customer_id
            }
            
            doc = self.forecast_results.find_one(query, {"_id": 0})
            if not doc:
                if customer_id == "AGGREGATE":
                    # 返回骨架数据，避免前端 404 报错
                    doc = {
                        "customer_id": "AGGREGATE",
                        "target_date": target_dt,
                        "forecast_date": forecast_dt,
                        "values": [0] * 48,
                        "accuracy": {"wmape_accuracy": None, "pred_sum": 0}
                    }
                else:
                    return None
            
            # 基础字段转换 (如果是骨架数据也会走这里)
            for field in ["target_date", "forecast_date", "created_at"]:
                if doc.get(field) and hasattr(doc[field], 'isoformat'):
                    doc[field] = doc[field].isoformat()
                elif doc.get(field) and isinstance(doc[field], datetime):
                    doc[field] = doc[field].isoformat()
            
            # 如果存在精度信息中的日期，也转换
            if doc.get("accuracy") and doc["accuracy"].get("calculated_at"):
                doc["accuracy"]["calculated_at"] = doc["accuracy"]["calculated_at"].isoformat()

            # --- 增加实际负荷比对逻辑 (V2: 支持聚合) ---
            actual_values = None
            try:
                if customer_id == "AGGREGATE":
                    # 获取全网聚合实际负荷
                    from webapp.services.contract_service import ContractService
                    from webapp.tools.mongo import DATABASE
                    contract_service = ContractService(DATABASE)
                    active_ids = contract_service.get_active_customers(target_date, target_date)
                    
                    if active_ids:
                        agg_curve = self.query_service.aggregate_curve_series(
                            customer_ids=active_ids,
                            start_date=target_date,
                            end_date=target_date
                        )
                        if agg_curve and len(agg_curve) > 0:
                            actual_values = agg_curve[0].values
                else:
                    # 获取单客户实际负荷 (使用 query_service 确保逻辑一致，处理嵌套结构)
                    agg_curve = self.query_service.aggregate_curve_series(
                        customer_ids=[customer_id],
                        start_date=target_date,
                        end_date=target_date
                    )
                    if agg_curve and len(agg_curve) > 0:
                        actual_values = agg_curve[0].values
            except Exception as e:
                logger.error(f"Failed to get actual load for {target_date} (customer={customer_id}): {e}")
            
            doc["actual_values"] = actual_values
            
            # --- 增加 96 点时段类型 (V2: 确保对齐) ---
            # 根据用户反馈，负荷是 48 点 (30min 间隔)，从 00:30 到 24:00
            try:
                dt_obj = datetime.strptime(target_date, "%Y-%m-%d")
                tou_map = get_tou_rule_by_date(dt_obj)
                
                # 生成 48 点时段类型 (00:30, 01:00, ..., 24:00)
                period_types = []
                for i in range(1, 49):
                    minutes = i * 30
                    if minutes >= 1440:
                        period_key = "23:45" # 24:00 使用前一个点的规则
                    else:
                        h = minutes // 60
                        m = minutes % 60
                        period_key = f"{h:02d}:{m:02d}"
                        # 分时规则是 15min 一个点，00:30 匹配 00:30
                        # 如果规则库里没有 00:30 (理论上不应该)，取 00:15
                        if period_key not in tou_map:
                            prev_minutes = minutes - 15
                            period_key = f"{prev_minutes // 60:02d}:{prev_minutes % 60:02d}"

                    period_types.append(tou_map.get(period_key, "平段"))
                
                doc["period_types"] = period_types
            except Exception as e:
                logger.error(f"Failed to get TOU rules for {target_date}: {e}")
                doc["period_types"] = ["平段"] * 48

            return doc
        except Exception as e:
            logger.error(f"Error get_forecast_data: {e}")
            return None

    def get_customer_list(self, target_date: str, forecast_date: str) -> List[Dict[str, Any]]:
        """获取本年度所有签约客户及该版本的预测指标"""
        try:
            target_dt = datetime.strptime(target_date, "%Y-%m-%d")
            forecast_dt = datetime.strptime(forecast_date, "%Y-%m-%d")
            current_year = target_dt.year
            start_of_year = datetime(current_year, 1, 1)
            end_of_year = datetime(current_year, 12, 31, 23, 59, 59)

            # 1. 获取本年度签约客户ID列表
            signed_cids = self.retail_contracts.distinct(
                "customer_id",
                {
                    "$or": [
                        {"purchase_start_month": {"$gte": start_of_year, "$lte": end_of_year}},
                        {"start_date": {"$gte": start_of_year, "$lte": end_of_year}} # 兼容不同合同字段
                    ]
                }
            )
            
            # 2. 获取这些客户的基础信息（简称）
            customers = list(self.customer_archives.find(
                {"_id": {"$in": [ObjectId(cid) if ObjectId.is_valid(cid) else cid for cid in signed_cids]}},
                {"short_name": 1, "user_name": 1}
            ))
            customer_map = {str(c["_id"]): c.get("short_name") or c.get("user_name") for c in customers}

            # 3. 获取该版本的预测结果
            forecasts = list(self.forecast_results.find(
                {
                    "target_date": target_dt,
                    "forecast_date": forecast_dt,
                    "customer_id": {"$ne": "AGGREGATE"}
                },
                {"customer_id": 1, "accuracy.wmape_accuracy": 1, "accuracy.pred_sum": 1, "values": 1}
            ))
            forecast_map = {f["customer_id"]: f for f in forecasts}

            # 4. 批量获取这些客户的历史平均准度 (最近7天)
            history_map = {}
            if signed_cids:
                hist_pipeline = [
                    {
                        "$match": {
                            "customer_id": {"$in": signed_cids},
                            "accuracy.wmape_accuracy": {"$exists": True, "$ne": None}
                        }
                    },
                    {"$sort": {"target_date": -1}},
                    {
                        "$group": {
                            "_id": "$customer_id",
                            "accuracies": {"$push": "$accuracy.wmape_accuracy"}
                        }
                    },
                    {
                        "$project": {
                            "avg_accuracy": {"$avg": {"$slice": ["$accuracies", 7]}}
                        }
                    }
                ]
                hist_results = list(self.forecast_results.aggregate(hist_pipeline))
                history_map = {r["_id"]: r["avg_accuracy"] for r in hist_results}

            # 5. 合并结果
            result = []
            for cid_str in signed_cids:
                f_data = forecast_map.get(cid_str, {})
                
                # 计算预测电量 (如果 accuracy 中没有，则现场从 values 计算)
                pred_sum = f_data.get("accuracy", {}).get("pred_sum")
                if pred_sum is None and "values" in f_data:
                    pred_sum = sum(f_data["values"])
                
                result.append({
                    "customer_id": cid_str,
                    "short_name": customer_map.get(cid_str, "未知客户"),
                    "wmape": f_data.get("accuracy", {}).get("wmape_accuracy"),
                    "history_wmape": history_map.get(cid_str), # 个体历史准度
                    "pred_sum": round(pred_sum, 2) if pred_sum is not None else None,
                    "has_data": cid_str in forecast_map
                })
                
            return result
        except Exception as e:
            logger.error(f"Error get_customer_list: {e}")
            return []

    def get_performance_overview(self, customer_id: str = "AGGREGATE") -> Dict[str, Any]:
        """获取最近 7 个已结算（有实际值）版本的平均精度"""
        try:
            pipeline = [
                {
                    "$match": {
                        "customer_id": customer_id,
                        "accuracy.wmape_accuracy": {"$exists": True, "$ne": None}
                    }
                },
                {"$sort": {"target_date": -1}},
                {"$limit": 7},
                {
                    "$group": {
                        "_id": None,
                        "avg_accuracy": {"$avg": "$accuracy.wmape_accuracy"},
                        "count": {"$sum": 1},
                        "last_values": {"$push": "$accuracy.wmape_accuracy"}
                    }
                }
            ]
            
            results = list(self.forecast_results.aggregate(pipeline))
            if not results:
                return {"avg_accuracy": None, "count": 0}
                
            return {
                "avg_accuracy": round(results[0]["avg_accuracy"], 2),
                "count": results[0]["count"],
                "history": results[0]["last_values"]
            }
        except Exception as e:
            logger.error(f"Error get_performance_overview: {e}")
            return {"avg_accuracy": None, "count": 0}
