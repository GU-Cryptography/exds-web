# -*- coding: utf-8 -*-
"""
节假日判断服务

提供统一的节假日判断接口，包含手动维护的中国法定节假日配置。
"""

from datetime import date
from typing import Optional, Dict, List

# --- 核心配置字典 ---
# 在这里手动定义每年的假日（放假日）和调休日（需要上班的周末）。
MANUAL_HOLIDAYS = {
    2024: {
        'holidays': {
            '元旦': ['2024-01-01'],
            '春节': ['2024-02-10', '2024-02-11', '2024-02-12', '2024-02-13', '2024-02-14', '2024-02-15', '2024-02-16', '2024-02-17'],
            '清明节': ['2024-04-04', '2024-04-05', '2024-04-06'],
            '劳动节': ['2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05'],
            '端午节': ['2024-06-10'],
            '中秋节': ['2024-09-15', '2024-09-16', '2024-09-17'],
            '国庆节': ['2024-10-01', '2024-10-02', '2024-10-03', '2024-10-04', '2024-10-05', '2024-10-06', '2024-10-07'],
        },
        'workdays': [
            '2024-02-04',  # 春节调休
            '2024-02-18',  # 春节调休
            '2024-04-07',  # 清明节调休
            '2024-04-28',  # 劳动节调休
            '2024-05-11',  # 劳动节调休
            '2024-09-14',  # 中秋节调休
            '2024-09-29',  # 国庆节调休
            '2024-10-12',  # 国庆节调休
        ]
    },
    2025: {
        'holidays': {
            '元旦': ['2025-01-01'],
            '春节': ['2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04'],
            '清明节': ['2025-04-04', '2025-04-05', '2025-04-06'],
            '劳动节': ['2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05'],
            '端午节': ['2025-05-31', '2025-06-01', '2025-06-02'],
            '中秋国庆节': ['2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08'],
        },
        'workdays': [
            '2025-01-26',  # 春节调休
            '2025-02-08',  # 春节调休
            '2025-04-27',  # 劳动节调休
            '2025-05-11',  # 劳动节调休
            '2025-09-28',  # 国庆节调休
            '2025-10-11',  # 国庆节调休
        ]
    },
    2026: {
        'holidays': {
            '元旦': ['2026-01-01', '2026-01-02', '2026-01-03'],
            '春节': ['2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23'],
            '清明节': ['2026-04-04', '2026-04-05', '2026-04-06'],
            '劳动节': ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'],
            '端午节': ['2026-06-19', '2026-06-20', '2026-06-21'],
            '中秋节': ['2026-09-25', '2026-09-26', '2026-09-27'],
            '国庆节': ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
        },
        'workdays': [
            '2026-01-04',  # 元旦调休
            '2026-02-14',  # 春节调休
            '2026-02-28',  # 春节调休
            '2026-05-09',  # 劳动节调休
            '2026-09-20',  # 国庆节调休
            '2026-10-10',  # 国庆节调休
        ]
    }
}


def get_china_day_types(years: List[int]) -> Dict[date, str]:
    """生成日期类型映射"""
    day_types = {}
    for year in years:
        if year not in MANUAL_HOLIDAYS:
            continue
        year_config = MANUAL_HOLIDAYS[year]
        # 处理节假日
        for _, day_str_list in year_config.get('holidays', {}).items():
            for day_str in day_str_list:
                day_types[date.fromisoformat(day_str)] = "holiday"
        # 处理调休工作日
        for day_str in year_config.get('workdays', []):
            day_types[date.fromisoformat(day_str)] = "adjusted_workday" # 修改为 adjusted_workday
    return day_types


def get_china_holiday_names_map(years: List[int]) -> Dict[date, str]:
    """生成节假日名称映射"""
    holiday_names = {}
    for year in years:
        if year not in MANUAL_HOLIDAYS:
            continue
        year_config = MANUAL_HOLIDAYS[year]
        for name, day_str_list in year_config.get('holidays', {}).items():
            for day_str in day_str_list:
                holiday_names[date.fromisoformat(day_str)] = name
    return holiday_names


class HolidayService:
    """节假日判断服务"""
    
    def __init__(self, years: List[int] = None):
        """初始化"""
        if years is None:
            years = [2024, 2025, 2026]
        self._day_types = get_china_day_types(years)
        self._holiday_names = get_china_holiday_names_map(years)
    
    def get_day_type(self, d: date) -> str:
        """获取日期类型"""
        if d in self._day_types:
            return self._day_types[d]
        # 不在配置中，根据星期几判断
        if d.weekday() >= 5:  # 周六=5, 周日=6
            return 'weekend'
        return 'workday'
    
    def get_holiday_name(self, d: date) -> Optional[str]:
        """获取节假日名称"""
        return self._holiday_names.get(d)
    
    def is_holiday(self, d: date) -> bool:
        """判断是否为节假日"""
        return self.get_day_type(d) == 'holiday'
    
    def is_weekend(self, d: date) -> bool:
        """判断是否为周末（非调休）"""
        return self.get_day_type(d) == 'weekend'
    
    def is_workday(self, d: date) -> bool:
        """判断是否为工作日（包括普通工作日和调休工作日）"""
        day_type = self.get_day_type(d)
        return day_type in ('workday', 'adjusted_workday')
    
    def get_day_info(self, d: date) -> Dict:
        """获取日期的完整信息"""
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
