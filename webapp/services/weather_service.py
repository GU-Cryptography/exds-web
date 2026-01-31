import logging
from typing import List, Optional, Dict
from datetime import datetime
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

class WeatherService:
    """
    气象服务
    负责天气数据的查询、统计和位置映射
    被 API 和 特征分析服务 共同调用
    """
    def __init__(self, db=None):
        self.db = db if db is not None else DATABASE
        self.collection_loc = self.db['weather_locations']
        self.collection_actuals = self.db['weather_actuals']
        self.collection_forecasts = self.db['weather_forecasts']
        
    def get_all_locations(self) -> List[dict]:
        """获取所有站点信息"""
        return list(self.collection_loc.find({}, {'_id': 0}))
        
    def get_location_id_by_name(self, location_name: str) -> Optional[str]:
        """
        根据中文名称获取 location_id
        :param location_name: e.g. "宜春市" or "宜春"
        :return: location_id (e.g. "yichun") or None
        """
        # Exact match
        loc = self.collection_loc.find_one({"name": location_name}, {"location_id": 1})
        if loc:
            return loc["location_id"]
            
        # Partial match (e.g. "宜春" matches "宜春市")
        # Ensure we don't match "南昌" to nothing if "南昌市" exists
        # Try finding where name contains input or input contains name
        # Simple regex: name like %input%
        loc = self.collection_loc.find_one({"name": {"$regex": location_name}}, {"location_id": 1})
        if loc:
            return loc["location_id"]
            
        return None

    def get_daily_weather_series(self, location_id: str, start_date: str, end_date: str) -> Dict[str, float]:
        """
        获取指定时间段的日均气温序列
        :return: { "2025-01-01": 12.5, ... }
        """
        s_dt = datetime.strptime(start_date, "%Y-%m-%d")
        e_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        
        pipeline = [
            {
                "$match": {
                    "location_id": location_id,
                    "timestamp": {"$gte": s_dt, "$lte": e_dt}
                }
            },
            {
                "$group": {
                    "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
                    "avg_temp": {"$avg": "$apparent_temperature"}
                }
            }
        ]
        
        results = list(self.collection_actuals.aggregate(pipeline))
        return {r["_id"]: r["avg_temp"] for r in results if r["avg_temp"] is not None}

    def calculate_daily_summary(self, docs: List[dict], date_str: str) -> dict:
        """
        计算每日天气概览（复用原有逻辑）
        """
        # 移入 v1_weather.py 中的逻辑
        from webapp.api.v1_weather import get_weather_type # reuse or re-implement? 
        # Better to re-implement purely here to avoid circular dependencies if v1 imports service.
        # Let's verify if I can import get_weather_type easily or just copy it. 
        # It's a small helper, I will copy it as static method or helper.
        return self._calculate_basic_summary(docs, date_str)

    def _calculate_basic_summary(self, docs: List[dict], date_str: str) -> dict:
        if not docs:
            return {
                "date": date_str,
                "weather_type": "无数据",
                "weather_icon": "❓",
                "min_temp": None,
                "max_temp": None
            }

        temps_24h = [d.get('apparent_temperature', 0) for d in docs if d.get('apparent_temperature') is not None]
        min_temp = round(min(temps_24h), 1) if temps_24h else None
        max_temp = round(max(temps_24h), 1) if temps_24h else None

        daytime_docs = []
        for d in docs:
            ts = d.get('timestamp') or d.get('target_timestamp')
            if isinstance(ts, datetime) and 8 <= ts.hour <= 20:
                daytime_docs.append(d)
        
        calc_docs = daytime_docs if daytime_docs else docs

        temps = [d.get('apparent_temperature', 0) for d in calc_docs if d.get('apparent_temperature') is not None]
        precips = [d.get('precipitation', 0) for d in calc_docs]
        clouds = [d.get('cloud_cover', 0) for d in calc_docs]

        avg_cloud = sum(clouds) / len(clouds) if clouds else 0
        avg_temp = sum(temps) / len(temps) if temps else 0
        max_precip = max(precips) if precips else 0
        
        weather_info = self._get_weather_type_helper(max_precip, avg_cloud, avg_temp)
        
        return {
            "date": date_str,
            "weather_type": weather_info["text"],
            "weather_icon": weather_info["icon"],
            "min_temp": min_temp,
            "max_temp": max_temp,
            "avg_precipitation": round(sum(precips), 2),
            "avg_cloud_cover": round(avg_cloud, 1)
        }

    @staticmethod
    def _get_weather_type_helper(precipitation: float, cloud_cover: float, temperature: float) -> dict:
        """Copied from v1_weather"""
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
