
from datetime import datetime, timedelta
from typing import Dict, Any, List
from webapp.tools.mongo import DATABASE

# 默认集合
DEFAULT_TOU_COLLECTION = DATABASE['tou_rules']

def get_tou_rule_by_date(date: datetime, collection=None) -> Dict[str, str]:
    """
    获取指定日期的分时电价规则 (Base + Patch 模式)
    
    :param date: 查询日期
    :param collection: MongoDB集合对象 (可选，默认使用 webapp.tools.mongo.DATABASE['tou_rules'])
    :return: Dict[str, str] 时间点(HH:MM)到类型(峰/平/谷)的映射，共96个点
    """
    if collection is None:
        collection = DEFAULT_TOU_COLLECTION

    target_date_str = date.strftime("%Y-%m-%d")
    target_month = date.month
    
    # 1. 获取基础规则 (Base Rule)
    # 查找适用于当前月份且生效日期早于等于目标日期的最新基础规则
    base_query = {
        "type": "base",
        "months": target_month,
        "activation_date": {"$lte": date}
    }
    # 按生效日期倒序排列，取最新的一条
    base_rule_doc = collection.find_one(
        base_query,
        sort=[("activation_date", -1)]
    )
    
    # 初始化 96 点时间轴
    timeline = ["平段"] * 96
    base_activation_date = None
    if base_rule_doc and "timelines" in base_rule_doc:
        timeline = list(base_rule_doc["timelines"])
        base_activation_date = base_rule_doc["activation_date"]
    
    # 2. 获取补丁规则 (Patch Rules)
    # 补丁的生效日期必须与基础规则的生效日期一致，以确保版本匹配
    patch_query = {
        "type": "patch",
        "dates": target_date_str,
        "activation_date": base_activation_date
    }
    
    # 如果没有找到基础规则，或者基础规则没有生效日期，则不查找补丁
    if not base_activation_date:
        patch_cursor = [] 
    else:
        patch_cursor = collection.find(patch_query).sort("priority", 1)
    
    for patch in patch_cursor:
        if "patch_intervals" in patch:
            for interval in patch["patch_intervals"]:
                start_str, end_str, val = interval.get("start"), interval.get("end"), interval.get("value")
                if not (start_str and end_str and val):
                    continue
                    
                h_start, m_start = map(int, start_str.split(':'))
                start_idx = (h_start * 60 + m_start) // 15
                end_idx = 96 if end_str == '24:00' else (int(end_str.split(':')[0]) * 60 + int(end_str.split(':')[1])) // 15
                
                for i in range(start_idx, min(end_idx, 96)):
                    timeline[i] = val

    # 3. 动态节假日补丁 (江西 2024-05 之后政策)
    # 针对重大节假日 (春节, 劳动节, 国庆节) 自动应用 12:00-14:00 深谷电价
    if base_activation_date and base_activation_date >= datetime(2024, 5, 1):
        from webapp.services.holiday_service import get_holiday_service
        hs = get_holiday_service()
        h_name = hs.get_holiday_name(date.date())
        if h_name in ["春节", "劳动节", "国庆节", "中秋国庆节"]:
            # 12:00 (index 48) - 14:00 (index 56)
            for i in range(48, 56):
                timeline[i] = "深谷"

    # 4. 转换为 Dict[str, str] 映射
    time_to_period_map = {}
    for i in range(96):
        time_obj = datetime(2000, 1, 1) + timedelta(minutes=15 * i)
        time_to_period_map[time_obj.strftime("%H:%M")] = timeline[i]
        
    return time_to_period_map

def get_tou_versions(collection=None) -> List[str]:
    """
    获取所有可用的分时电价版本日期
    """
    if collection is None:
        collection = DEFAULT_TOU_COLLECTION
        
    # 获取所有基础规则的生效日期
    versions = collection.distinct("activation_date", {"type": "base"})
    
    # 排序并格式化
    sorted_versions = sorted([v for v in versions if v], reverse=True)
    return [v.strftime("%Y-%m-%d") for v in sorted_versions]

def get_tou_summary(version_date: datetime, collection=None) -> Dict[str, Any]:
    """
    获取指定版本的年度分时规则摘要
    返回格式:
    {
        "version": "2025-07-01",
        "months": {
            "1": ["平段", "平段", ...], # 96点
            ...
        },
        "coefficients": { ... }
    }
    """
    if collection is None:
        collection = DEFAULT_TOU_COLLECTION
        
    # 默认系数定义
    default_coefficients = {
        "尖峰": 1.8,
        "高峰": 1.6,
        "平段": 1.0,
        "低谷": 0.4,
        "深谷": 0.3
    }
    
    summary = {
        "version": version_date.strftime("%Y-%m-%d"),
        "months": {},
        "coefficients": {}
    }
    
    # 使用聚合管道一次性获取所有月份的最新规则
    pipeline = [
        # 1. 筛选生效日期早于等于版本日期的基础规则
        {"$match": {
            "type": "base",
            "activation_date": {"$lte": version_date}
        }},
        # 2. 按生效日期倒序排列，确保最新的在前面
        {"$sort": {"activation_date": -1}},
        # 3. 展开 months 数组，以便按单月分组
        {"$unwind": "$months"},
        # 4. 按月份分组，取第一条（即最新的）
        {"$group": {
            "_id": "$months",
            "timelines": {"$first": "$timelines"},
            "coefficients": {"$first": "$coefficients"},
        }},
        # 5. 按月份排序
        {"$sort": {"_id": 1}}
    ]
    
    results = list(collection.aggregate(pipeline))
    
    # 收集所有实际使用的时段类型
    used_periods = set()
    
    # 填充结果
    for doc in results:
        month = str(doc["_id"])
        timeline = doc.get("timelines", ["平段"] * 96)
        summary["months"][month] = timeline
        
        # 收集该月使用的时段类型
        used_periods.update(timeline)
        
        # 尝试更新系数 (如果有)
        if "coefficients" in doc and doc["coefficients"]:
             summary["coefficients"].update(doc["coefficients"])
             
    # 填补缺失月份（如果有）
    for m in range(1, 13):
        if str(m) not in summary["months"]:
            summary["months"][str(m)] = ["平段"] * 96
            
    # 只保留实际使用的时段的系数，并补充缺失的默认值
    filtered_coefficients = {}
    for period in used_periods:
        if period in summary["coefficients"]:
            filtered_coefficients[period] = summary["coefficients"][period]
        elif period in default_coefficients:
            filtered_coefficients[period] = default_coefficients[period]
        else:
            # 未知类型，使用默认值1.0
            filtered_coefficients[period] = 1.0
            
    summary["coefficients"] = filtered_coefficients
            
    return summary

def get_period_indices_by_date(date: datetime, collection=None) -> Dict[str, List[int]]:
    """
    获取指定日期的分时时段索引列表 (用于准确度计算)
    
    Args:
        date: 目标日期
        collection: MongoDB集合 (可选)
        
    Returns:
        Dict[str, List[int]]: j键为时段名称(如"高峰"), 值为0-95的索引列表
    """
    # 获取时间点到时段的映射 (00:00 -> "平段")
    time_map = get_tou_rule_by_date(date, collection)
    indices_map = {}
    
    # 按时间顺序遍历 (确保索引 0 对应 00:00)
    sorted_times = sorted(time_map.keys())
    
    for idx, time_str in enumerate(sorted_times):
        period = time_map[time_str]
        if period not in indices_map:
            indices_map[period] = []
        indices_map[period].append(idx)
        
    return indices_map

def get_month_tou_meta(date: datetime, collection=None) -> Dict[str, Any]:
    """
    获取指定月份的TOU元数据 (系数, 是否尖峰月)
    
    Args:
        date: 目标月份中的任意日期
        collection: MongoDB集合 (可选)
        
    Returns:
        {
            "coefficients": Dict[str, float], # 系数 (Tip, Peak, Flat, Valley, Deep)
            "is_tip_month": bool,             # 是否包含尖峰时段
            "timelines": List[str]            # 96点时段类型
        }
    """
    if collection is None:
        collection = DEFAULT_TOU_COLLECTION
        
    # Reuse existing logic via get_tou_rule_by_date logic, but need direct access to metadata
    # Base Rule Query
    base_query = {
        "type": "base",
        "months": date.month,
        "activation_date": {"$lte": date}
    }
    
    doc = collection.find_one(
        base_query,
        sort=[("activation_date", -1)]
    )
    
    if not doc:
        # Default fallback
        return {
            "coefficients": {"尖峰": 1.8, "高峰": 1.6, "平段": 1.0, "低谷": 0.4, "深谷": 0.3},
            "is_tip_month": False,
            "timelines": ["平段"] * 96
        }
        
    timelines = doc.get("timelines", ["平段"] * 96)
    coefficients = doc.get("coefficients", {"尖峰": 1.8, "高峰": 1.6, "平段": 1.0, "低谷": 0.4, "深谷": 0.3})
    
    # Check if "尖峰" exists in timelines
    is_tip_month = "尖峰" in timelines
    
    return {
        "coefficients": coefficients,
        "is_tip_month": is_tip_month,
        "timelines": timelines
    }
