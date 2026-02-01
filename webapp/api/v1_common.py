import logging
import calendar
import statistics
from typing import List, Dict
from datetime import datetime, timedelta
from fastapi import APIRouter, Query, HTTPException

from webapp.tools.mongo import DATABASE
from webapp.services.tou_service import get_tou_rule_by_date, get_tou_versions, get_tou_summary

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1-common"])

USER_COLLECTION = DATABASE['user_load_data']

@router.get("/users", summary="获取所有唯一的用户列表")
def get_users():
    pipeline = [
        {'$group': {'_id': "$user_id", 'user_name': {'$first': '$user_name'}}},
        {'$project': {'user_id': '$_id', 'user_name': '$user_name', '_id': 0}},
        {'$sort': {'user_name': 1}}
    ]
    return list(USER_COLLECTION.aggregate(pipeline))

@router.get("/meters", summary="获取指定用户的所有电表列表")
def get_meters(user_id: str = Query(..., description="要查询的用户的ID")):
    query = {'user_id': user_id}
    meter_ids = USER_COLLECTION.distinct("meter_id", query)
    return [{"meter_id": meter_id} for meter_id in sorted(meter_ids)]

@router.get("/load_curve", summary="获取指定电表一个或多个日期的负荷曲线")
def get_load_curve(meter_id: str = Query(..., description="电表ID"), date: List[str] = Query(..., description="查询的日期列表, 格式 YYYY-MM-DD")):
    response_data = {}
    for date_str in date:
        try:
            start_date = datetime.strptime(date_str, "%Y-%m-%d")
            end_date = start_date + timedelta(days=1)
            query = {"meter_id": meter_id, "timestamp": {"$gte": start_date, "$lt": end_date}}
            projection = {"timestamp": 1, "load_value": 1, "_id": 0}
            cursor = USER_COLLECTION.find(query, projection).sort("timestamp", 1)
            points = [{"time": doc["timestamp"].strftime("%H:%M"), "value": doc["load_value"]} for doc in cursor]
            response_data[date_str] = points
        except ValueError:
            response_data[date_str] = {"error": "Invalid date format."}
            continue
    return response_data

@router.get("/daily_energy", summary="获取指定电表一个或多个月份的日电量数据")
def get_daily_energy(meter_id: str = Query(..., description="电表ID"), month: List[str] = Query(..., description="查询的月份列表, 格式 YYYY-MM")):
    response_data = {}
    for month_str in month:
        try:
            year, mon = map(int, month_str.split('-'))
            start_date = datetime(year, mon, 1)
            end_date = datetime(year, mon, calendar.monthrange(year, mon)[1], 23, 59, 59)
            pipeline = [
                {'$match': {'meter_id': meter_id, 'timestamp': {'$gte': start_date, '$lte': end_date}}},
                {'$group': {'_id': {'$dayOfMonth': '$timestamp'}, 'energy': {'$sum': '$load_value'}}},
                {'$sort': {'_id': 1}},
                {'$project': {'day': '$_id', 'energy': '$energy', '_id': 0}}
            ]
            response_data[month_str] = list(USER_COLLECTION.aggregate(pipeline))
        except ValueError:
            response_data[month_str] = {"error": "Invalid month format."}
            continue
    return response_data

@router.get("/available-dates", summary="获取指定电表所有存在数据的日期")
def get_available_dates(meter_id: str = Query(..., description="电表ID")):
    pipeline = [
        {'$match': {'meter_id': meter_id}},
        {'$project': {'date': {'$dateToString': {'format': '%Y-%m-%d', 'date': '$timestamp'}}, '_id': 0}},
        {'$group': {'_id': '$date'}},
        {'$sort': {'_id': 1}}
    ]
    return [doc['_id'] for doc in USER_COLLECTION.aggregate(pipeline)]

def get_tou_rule_for_date(date: datetime) -> Dict[str, str]:
    """
    获取指定日期的分时电价规则 (Base + Patch 模式)
    (Delegate to tou_service)
    """
    return get_tou_rule_by_date(date)

@router.get("/tou-rules/versions", summary="获取所有可用的分时电价版本")
def get_tou_rule_versions():
    """
    获取所有可用的分时电价版本日期列表
    """
    try:
        return get_tou_versions()
    except Exception as e:
        logger.error(f"Error in get_tou_rule_versions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取分时电价版本失败: {str(e)}")

@router.get("/tou-rules/summary", summary="获取指定版本的分时电价规则摘要")
def get_tou_rule_summary(version: str = Query(..., description="版本日期, 格式 YYYY-MM-DD")):
    """
    获取指定版本的分时电价规则摘要，包含全年各月的分时定义
    """
    try:
        version_date = datetime.strptime(version, "%Y-%m-%d")
        return get_tou_summary(version_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效，请使用 YYYY-MM-DD 格式")
    except Exception as e:
        logger.error(f"Error in get_tou_rule_summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取分时电价规则摘要失败: {str(e)}")
