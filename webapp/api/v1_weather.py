"""
天气数据 API
提供天气站点管理和天气数据查询接口
"""
import logging
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Query, HTTPException, Body
from pydantic import BaseModel
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/weather", tags=["weather"])

# 集合定义
WEATHER_LOCATIONS = DATABASE['weather_locations']
WEATHER_ACTUALS = DATABASE['weather_actuals']
WEATHER_FORECASTS = DATABASE['weather_forecasts']


# Pydantic 模型
class WeatherLocationCreate(BaseModel):
    location_id: str
    name: str
    latitude: float
    longitude: float
    enabled: bool = True


class WeatherLocationUpdate(BaseModel):
    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    enabled: Optional[bool] = None


# 天气类型判断
def get_weather_type(precipitation: float, cloud_cover: float, temperature: float) -> dict:
    """根据降水量、云量和温度判断天气类型"""
    if precipitation > 0:
        if temperature < 0:
            if precipitation > 5:
                return {"icon": "❄️", "text": "大雪"}
            return {"icon": "🌨️", "text": "小雪"}
        if temperature <= 2:
            return {"icon": "🌨️", "text": "雨夹雪"}
        if precipitation > 8:
            return {"icon": "🌧️", "text": "大雨"}
        if precipitation > 2.5:
            return {"icon": "🌧️", "text": "中雨"}
        return {"icon": "🌦️", "text": "小雨"}
    if cloud_cover < 20:
        return {"icon": "☀️", "text": "晴"}
    if cloud_cover < 50:
        return {"icon": "🌤️", "text": "少云"}
    if cloud_cover < 80:
        return {"icon": "⛅", "text": "多云"}
    return {"icon": "☁️", "text": "阴"}


# ========== 站点管理 API ==========

@router.get("/locations", summary="获取站点列表")
def get_weather_locations():
    """获取所有天气站点"""
    try:
        locations = list(WEATHER_LOCATIONS.find({}, {'_id': 0}))
        return locations
    except Exception as e:
        logger.error(f"获取站点列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/locations", summary="创建站点")
def create_weather_location(location: WeatherLocationCreate):
    """创建新的天气站点"""
    try:
        # 检查是否已存在
        if WEATHER_LOCATIONS.find_one({"location_id": location.location_id}):
            raise HTTPException(status_code=400, detail="站点ID已存在")
        
        WEATHER_LOCATIONS.insert_one(location.model_dump())
        return {"message": "创建成功", "location_id": location.location_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建站点失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/locations/{location_id}", summary="更新站点")
def update_weather_location(location_id: str, update: WeatherLocationUpdate):
    """更新天气站点信息"""
    try:
        update_data = {k: v for k, v in update.model_dump().items() if v is not None}
        if not update_data:
            raise HTTPException(status_code=400, detail="没有要更新的字段")
        
        result = WEATHER_LOCATIONS.update_one(
            {"location_id": location_id},
            {"$set": update_data}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="站点不存在")
        
        return {"message": "更新成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新站点失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/locations/{location_id}", summary="删除站点")
def delete_weather_location(location_id: str):
    """删除天气站点"""
    try:
        result = WEATHER_LOCATIONS.delete_one({"location_id": location_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="站点不存在")
        return {"message": "删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除站点失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ========== 历史天气 API ==========

@router.get("/actuals", summary="获取历史天气数据")
def get_weather_actuals(
    location_id: str = Query(..., description="站点ID"),
    date: str = Query(..., description="日期 YYYY-MM-DD")
):
    """获取指定站点和日期的历史天气数据（24小时）"""
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d")
        start_time = target_date.replace(hour=0, minute=0, second=0)
        end_time = target_date.replace(hour=23, minute=59, second=59)
        
        query = {
            "location_id": location_id,
            "timestamp": {"$gte": start_time, "$lte": end_time}
        }
        
        docs = list(WEATHER_ACTUALS.find(query, {'_id': 0}).sort("timestamp", 1))
        
        # 格式化时间戳
        for doc in docs:
            if 'timestamp' in doc and isinstance(doc['timestamp'], datetime):
                doc['timestamp'] = doc['timestamp'].isoformat()
        
        return docs
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效")
    except Exception as e:
        logger.error(f"获取历史天气失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



def calculate_daily_summary(docs: List[dict], date_str: str) -> dict:
    """计算每日天气概览（08:00-20:00 优先逻辑）"""
    if not docs:
        return {
            "date": date_str,
            "weather_type": "无数据",
            "weather_icon": "❓",
            "min_temp": None,
            "max_temp": None
        }

    # 1. 计算全天 (24h) 的最低/最高气温
    temps_24h = [d.get('apparent_temperature', 0) for d in docs if d.get('apparent_temperature') is not None]
    min_temp = round(min(temps_24h), 1) if temps_24h else None
    max_temp = round(max(temps_24h), 1) if temps_24h else None

    # 2. 筛选 08:00 - 20:00 的数据用于天气类型判断
    daytime_docs = []
    for d in docs:
        # 兼容 timestamp (actuals) 和 target_timestamp (forecasts)
        ts = d.get('timestamp') or d.get('target_timestamp')
        if isinstance(ts, datetime) and 8 <= ts.hour <= 20:
            daytime_docs.append(d)
    
    # 如果没有白天数据（极端情况），回退到使用全天数据
    calc_docs = daytime_docs if daytime_docs else docs

    # 3. 计算聚合统计指标
    # 注意：温度和云量使用平均值
    temps = [d.get('apparent_temperature', 0) for d in calc_docs if d.get('apparent_temperature') is not None]
    precips = [d.get('precipitation', 0) for d in calc_docs]
    clouds = [d.get('cloud_cover', 0) for d in calc_docs]

    avg_cloud = sum(clouds) / len(clouds) if clouds else 0
    avg_temp = sum(temps) / len(temps) if temps else 0
    
    # 4. 恶劣天气优先原则：使用最大小时降水量判断是否降水
    # 只要白天时段出现过降水（max > 0），就判定为雨/雪
    max_precip = max(precips) if precips else 0
    
    # 使用 max_precip 传入判断函数，确保捕获短时强降水
    weather = get_weather_type(max_precip, avg_cloud, avg_temp)
    
    return {
        "date": date_str,
        "weather_type": weather["text"],
        "weather_icon": weather["icon"],
        "min_temp": min_temp,
        "max_temp": max_temp,
        # 这里原来的 key 叫 avg_precipitation 但实际返回的是 sum，保持兼容性
        "avg_precipitation": round(sum(precips), 2),
        "avg_cloud_cover": round(avg_cloud, 1)
    }


@router.get("/actuals/summary", summary="获取历史天气概览")
def get_weather_actuals_summary(
    location_id: str = Query(..., description="站点ID"),
    date: str = Query(..., description="日期 YYYY-MM-DD")
):
    """
    获取指定日期的天气概览（天气类型、最高最低温度）
    - 过去日期：返回历史实况数据
    - 今天或未来日期：返回最新预测数据
    """
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d")
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        start_time = target_date.replace(hour=0, minute=0, second=0)
        end_time = target_date.replace(hour=23, minute=59, second=59)
        
        # 判断是否为今天或未来日期
        if target_date >= today:
            # 查询预测数据：查找最新的 forecast_date 的预测
            # 获取最新的预测发布日期
            latest_forecast = WEATHER_FORECASTS.find_one(
                {
                    "location_id": location_id,
                    "target_timestamp": {"$gte": start_time, "$lte": end_time}
                },
                {"forecast_date": 1},
                sort=[("forecast_date", -1)]
            )
            
            if latest_forecast:
                forecast_date = latest_forecast["forecast_date"]
                query = {
                    "location_id": location_id,
                    "forecast_date": forecast_date,
                    "target_timestamp": {"$gte": start_time, "$lte": end_time}
                }
                docs = list(WEATHER_FORECASTS.find(query, {'_id': 0}))
                summary = calculate_daily_summary(docs, date)
                summary["data_source"] = "forecast"
                summary["forecast_date"] = forecast_date.strftime("%Y-%m-%d") if isinstance(forecast_date, datetime) else str(forecast_date)
                return summary
            else:
                # 没有预测数据，返回空
                return {
                    "date": date,
                    "weather_type": "无数据",
                    "weather_icon": "❓",
                    "min_temp": None,
                    "max_temp": None,
                    "data_source": "none"
                }
        else:
            # 历史日期：查询实况数据
            query = {
                "location_id": location_id,
                "timestamp": {"$gte": start_time, "$lte": end_time}
            }
            docs = list(WEATHER_ACTUALS.find(query, {'_id': 0}))
            summary = calculate_daily_summary(docs, date)
            summary["data_source"] = "actuals"
            return summary

    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效")
    except Exception as e:
        logger.error(f"获取天气概览失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ========== 预测天气 API ==========

@router.get("/forecasts", summary="获取预测天气数据")
def get_weather_forecasts(
    location_id: str = Query(..., description="站点ID"),
    forecast_date: str = Query(..., description="预测发布日期 YYYY-MM-DD"),
    target_date: str = Query(..., description="目标日期 YYYY-MM-DD")
):
    """获取指定预测发布日和目标日期的天气预测数据（24小时）"""
    try:
        fc_date = datetime.strptime(forecast_date, "%Y-%m-%d")
        tgt_date = datetime.strptime(target_date, "%Y-%m-%d")
        
        start_time = tgt_date.replace(hour=0, minute=0, second=0)
        end_time = tgt_date.replace(hour=23, minute=59, second=59)
        
        query = {
            "location_id": location_id,
            "forecast_date": fc_date.replace(hour=0, minute=0, second=0),
            "target_timestamp": {"$gte": start_time, "$lte": end_time}
        }
        
        docs = list(WEATHER_FORECASTS.find(query, {'_id': 0}).sort("target_timestamp", 1))
        
        # 格式化时间戳
        for doc in docs:
            if 'target_timestamp' in doc and isinstance(doc['target_timestamp'], datetime):
                doc['timestamp'] = doc['target_timestamp'].isoformat()
            if 'forecast_date' in doc and isinstance(doc['forecast_date'], datetime):
                doc['forecast_date'] = doc['forecast_date'].strftime("%Y-%m-%d")
        
        return docs
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效")
    except Exception as e:
        logger.error(f"获取预测天气失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/forecasts/summary", summary="获取预测天气概览")
def get_weather_forecasts_summary(
    location_id: str = Query(..., description="站点ID"),
    forecast_date: str = Query(..., description="预测发布日期 YYYY-MM-DD")
):
    """获取指定预测发布日的未来天气概览（返回所有可用数据）"""
    try:
        fc_date = datetime.strptime(forecast_date, "%Y-%m-%d")
        
        # 查询该预测发布日的所有未来数据（不限制天数）
        start_date = fc_date + timedelta(days=1)  # D+1 开始
        
        query = {
            "location_id": location_id,
            "forecast_date": fc_date.replace(hour=0, minute=0, second=0),
            "target_timestamp": {"$gte": start_date}
        }
        
        docs = list(WEATHER_FORECASTS.find(query, {'_id': 0}))
        
        # 按天分组
        daily_data = {}
        for doc in docs:
            ts = doc.get('target_timestamp')
            if isinstance(ts, datetime):
                day_key = ts.strftime("%Y-%m-%d")
                if day_key not in daily_data:
                    daily_data[day_key] = []
                daily_data[day_key].append(doc)
        
        # 计算每日概览
        summaries = []
        for day in sorted(daily_data.keys()):
            summaries.append(calculate_daily_summary(daily_data[day], day))
        
        return summaries
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效")
    except Exception as e:
        logger.error(f"获取预测概览失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/forecast-dates", summary="获取可用的预测发布日期")
def get_available_forecast_dates(
    location_id: str = Query(..., description="站点ID"),
    target_date: Optional[str] = Query(None, description="目标日期 YYYY-MM-DD（可选）")
):
    """获取指定站点可用的预测发布日期列表"""
    try:
        query = {"location_id": location_id}
        
        if target_date:
            tgt_date = datetime.strptime(target_date, "%Y-%m-%d")
            start_time = tgt_date.replace(hour=0, minute=0, second=0)
            end_time = tgt_date.replace(hour=23, minute=59, second=59)
            query["target_timestamp"] = {"$gte": start_time, "$lte": end_time}
        
        # 获取唯一的 forecast_date
        pipeline = [
            {"$match": query},
            {"$group": {"_id": "$forecast_date"}},
            {"$sort": {"_id": -1}},
            {"$limit": 10}
        ]
        
        results = list(WEATHER_FORECASTS.aggregate(pipeline))
        
        dates = []
        for r in results:
            fc_date = r['_id']
            if isinstance(fc_date, datetime):
                dates.append(fc_date.strftime("%Y-%m-%d"))
        
        return dates
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式无效")
    except Exception as e:
        logger.error(f"获取预测日期失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
