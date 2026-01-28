# -*- coding: utf-8 -*-
import logging
from typing import List, Optional, Dict
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

class TypicalCurveService:
    """
    典型曲线服务
    
    查询 typical_curves 集合
    字段: year, month, curve_type, name, holiday, points
    """
    
    def __init__(self, db=DATABASE):
        self.collection = db.typical_curves

    def get_curve_points(self, year: int, month: int, curve_type: str, holiday_name: str = None) -> Optional[List[float]]:
        """
        获取典型曲线的点位数据 (48点)
        
        Args:
            year: 年份
            month: 月份 (0-12)
            curve_type: 曲线类型 (market, business_general, business_all)
            holiday_name: 节假日名称 (例如 "国庆节")，如果有值则优先查找节假日曲线
        
        Returns:
            List[float] (48 points) or None if not found
        """
        try:
            query = {
                "year": year,
                "curve_type": curve_type
            }
            
            # 1. 优先查找节假日 (如果提供了 holiday_name)
            if holiday_name:
                holiday_query = query.copy()
                holiday_query["holiday"] = holiday_name
                # month 可能是 0 或特定月份，通常如果明确是 "国庆节" 且数据只存了一份，可能 month=0
                # 尝试查找 holiday 匹配的记录
                doc = self.collection.find_one(holiday_query)
                if doc and "points" in doc:
                    return doc["points"]
            
            # 2. 如果没找到或非节假日，查找对应月份的曲线
            # 月份曲线一般 holiday 字段为空或为 null
            month_query = query.copy()
            month_query["month"] = month
            # 排除 holiday 字段有值的 (避免混淆，虽然一般月份曲线不会填 holiday)
            # 但为了严谨，可以不加 holiday 限制，或者假设 month>0 就是月度曲线
            
            doc = self.collection.find_one(month_query)
            if doc and "points" in doc:
                return doc["points"]
                
            return None
            
        except Exception as e:
            logger.error(f"Error fetching typical curve: {e}")
            return None
