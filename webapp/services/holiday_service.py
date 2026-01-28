# -*- coding: utf-8 -*-
"""
节假日判断服务

封装 china_holidays_manual.py 的功能，提供统一的节假日判断接口。
"""

from datetime import date
from typing import Optional, Dict, List

# 导入手动维护的节假日配置
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from china_holidays_manual import get_china_day_types, get_china_holiday_names_map, MANUAL_HOLIDAYS


class HolidayService:
    """节假日判断服务"""
    
    def __init__(self, years: List[int] = None):
        """
        初始化节假日服务
        
        Args:
            years: 需要加载的年份列表，默认加载2024-2026年
        """
        if years is None:
            years = [2024, 2025, 2026]
        
        self._day_types = get_china_day_types(years)
        self._holiday_names = get_china_holiday_names_map(years)
    
    def get_day_type(self, d: date) -> str:
        """
        获取日期类型
        
        Args:
            d: 日期对象
            
        Returns:
            'holiday' - 节假日
            'adjusted_workday' - 调休工作日（周末但需上班）
            'weekend' - 普通周末
            'workday' - 普通工作日
        """
        if d in self._day_types:
            return self._day_types[d]
        
        # 不在配置中，根据星期几判断
        if d.weekday() >= 5:  # 周六=5, 周日=6
            return 'weekend'
        return 'workday'
    
    def get_holiday_name(self, d: date) -> Optional[str]:
        """
        获取节假日名称
        
        Args:
            d: 日期对象
            
        Returns:
            节假日名称，如果不是节假日则返回None
        """
        return self._holiday_names.get(d)
    
    def is_holiday(self, d: date) -> bool:
        """判断是否为节假日"""
        return self.get_day_type(d) == 'holiday'
    
    def is_weekend(self, d: date) -> bool:
        """判断是否为周末（非调休）"""
        return self.get_day_type(d) == 'weekend'
    
    def is_workday(self, d: date) -> bool:
        """判断是否为工作日（包括调休工作日）"""
        day_type = self.get_day_type(d)
        return day_type in ('workday', 'adjusted_workday')
    
    def get_day_info(self, d: date) -> Dict:
        """
        获取日期的完整信息
        
        Returns:
            {
                'date': '2026-01-01',
                'day_type': 'holiday',
                'holiday_name': '元旦',
                'weekday': 3  # 0=周一, 6=周日
            }
        """
        return {
            'date': d.isoformat(),
            'day_type': self.get_day_type(d),
            'holiday_name': self.get_holiday_name(d),
            'weekday': d.weekday()
        }


# 单例实例
_holiday_service = None

def get_holiday_service() -> HolidayService:
    """获取节假日服务单例"""
    global _holiday_service
    if _holiday_service is None:
        _holiday_service = HolidayService()
    return _holiday_service
