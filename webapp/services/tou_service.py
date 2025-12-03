
from datetime import datetime, timedelta
from typing import Dict, Any
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
                start_str = interval.get("start")
                end_str = interval.get("end")
                val = interval.get("value")
                
                if not (start_str and end_str and val):
                    continue
                    
                h_start, m_start = map(int, start_str.split(':'))
                start_idx = (h_start * 60 + m_start) // 15
                
                if end_str == '24:00':
                    end_idx = 96
                else:
                    h_end, m_end = map(int, end_str.split(':'))
                    end_idx = (h_end * 60 + m_end) // 15
                
                for i in range(start_idx, min(end_idx, 96)):
                    timeline[i] = val

    # 3. 转换为 Dict[str, str] 映射 (00:00, 00:15, ... 23:45)
    time_to_period_map = {}
    for i in range(96):
        time_obj = datetime(2000, 1, 1) + timedelta(minutes=15 * i)
        time_to_period_map[time_obj.strftime("%H:%M")] = timeline[i]
        
    return time_to_period_map
