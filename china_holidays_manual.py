# -*- coding: utf-8 -*-
"""
本模块提供中国法定节假日和调休工作日的手动配置数据。

中国的节假日安排每年由国务院发布，规则不固定（例如春节假期长度、调休规则）。
因此，通过手动维护一个配置字典是确保节假日特征准确性的最可靠方法。

要添加新年份的数据，只需在 `MANUAL_HOLIDAYS` 字典中增加一个新的年份条目即可。
"""
from datetime import date
from typing import List, Dict

# --- 核心配置字典 ---
# 在这里手动定义每年的假日（放假日）和调休日（需要上班的周末）。
# 结构:
# {
#     年份: {
#         'holidays': { '节假日名称': [日期字符串列表] },
#         'workdays': [日期字符串列表]
#     }
# }
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
    """
    根据给定的年份列表，生成一个详细的日期类型映射字典。

    Args:
        years: 一个包含年份整数的列表，例如 [2024, 2025]。

    Returns:
        一个字典，键是 `datetime.date` 对象，值是表示该日期类型的字符串 ('holiday' 或 'workday')。
    """
    day_types = {}
    for year in years:
        if year not in MANUAL_HOLIDAYS:
            print(f"警告: {year} 年的假日信息未在 MANUAL_HOLIDAYS 中定义，将跳过该年份。")
            continue

        year_config = MANUAL_HOLIDAYS[year]

        # 1. 处理节假日
        for holiday_name, day_str_list in year_config.get('holidays', {}).items():
            for day_str in day_str_list:
                day_types[date.fromisoformat(day_str)] = "holiday"

        # 2. 处理调休工作日
        for day_str in year_config.get('workdays', []):
            day_types[date.fromisoformat(day_str)] = "workday"

    return day_types


def get_china_holiday_names_map(years: List[int]) -> Dict[date, str]:
    """
    根据年份列表，生成节假日日期到节假日名称的映射字典。

    Args:
        years: 一个包含年份整数的列表。

    Returns:
        一个字典，键是 `datetime.date` 对象，值是节假日的中文名称。
    """
    holiday_names = {}
    for year in years:
        if year not in MANUAL_HOLIDAYS:
            continue

        year_config = MANUAL_HOLIDAYS[year]
        for name, day_str_list in year_config.get('holidays', {}).items():
            for day_str in day_str_list:
                holiday_names[date.fromisoformat(day_str)] = name

    return holiday_names


# --- 测试执行块 ---
if __name__ == "__main__":
    print("--- 开始执行日期类型生成测试 ---")

    # 测试年份
    target_years = [2024]

    # 1. 测试日期类型生成
    china_day_types_2024 = get_china_day_types(target_years)

    # 验证关键日期
    holiday_date = date(2024, 10, 1)  # 国庆节
    workday_date = date(2024, 2, 4)   # 春节前的调休工作日
    normal_date = date(2024, 10, 9)  # 国庆节后的普通工作日

    print(f"日期类型: {holiday_date} -> {china_day_types_2024.get(holiday_date)}")
    print(f"日期类型: {workday_date} -> {china_day_types_2024.get(workday_date)}")
    print(f"日期类型: {normal_date} -> {china_day_types_2024.get(normal_date)} (None表示正常工作日或周末)")

    # 2. 测试节假日名称生成
    print("\n--- 开始执行节假日名称生成测试 ---")
    holiday_names_2024 = get_china_holiday_names_map(target_years)

    # 验证关键节假日名称
    spring_festival_date = date(2024, 2, 12)
    national_day_date = date(2024, 10, 3)

    print(f"节假日名称: {spring_festival_date} -> {holiday_names_2024.get(spring_festival_date)}")
    print(f"节假日名称: {national_day_date} -> {holiday_names_2024.get(national_day_date)}")
    print(f"非节假日名称: {normal_date} -> {holiday_names_2024.get(normal_date)}")

    print("\n--- 测试执行结束 ---")
