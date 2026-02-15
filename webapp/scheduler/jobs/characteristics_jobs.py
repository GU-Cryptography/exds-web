# -*- coding: utf-8 -*-
"""
客户特征分析任务

事件驱动的自动特征分析任务,监听负荷聚合成功事件,自动触发特征画像刷新
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any

from webapp.tools.mongo import DATABASE
from webapp.scheduler.logger import TaskLogger
from webapp.services.characteristics.service import CharacteristicService
from webapp.services.load_query_service import LoadQueryService

logger = logging.getLogger(__name__)

# ========== 内存缓存 ==========

# 全局缓存: {task_key: {"date": "YYYY-MM-DD", "status": "SUCCESS/FAILED"}}
_daily_execution_cache: Dict[str, Dict[str, str]] = {}

def _is_executed_today(task_key: str, date: str) -> bool:
    """检查今天是否已执行过"""
    if task_key in _daily_execution_cache:
        cached_date = _daily_execution_cache[task_key].get("date")
        if cached_date != date:
            _daily_execution_cache[task_key] = {}
        elif "status" in _daily_execution_cache[task_key]:
            return True
            
    record = DATABASE["task_execution_logs"].find_one({
        "task_type": task_key,
        "trigger_type": "event",
        "status": {"$in": ["SUCCESS", "FAILED"]},
        "start_time": {
            "$gte": datetime.strptime(date, "%Y-%m-%d"),
            "$lt": datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)
        }
    })
    
    if record:
        _mark_executed(task_key, date, record["status"])
        return True
    return False

def _mark_executed(task_key: str, date: str, status: str):
    """标记任务已执行"""
    _daily_execution_cache[task_key] = {
        "date": date,
        "status": status
    }

def _is_analysis_done_for_date(analysis_date: str) -> bool:
    """检查特定日期的特征分析是否已成功完成"""
    record = DATABASE["task_execution_logs"].find_one({
        "task_type": "characteristics_analysis",
        "status": "SUCCESS",
        "params.analysis_date": analysis_date
    })
    return record is not None

# ========== 事件驱动任务 ==========

async def event_driven_characteristics_analysis_job():
    """
    事件驱动的客户特征分析任务
    
    触发条件: 
    1. 负荷数据中出现了新的日期 (LoadQueryService.get_latest_data_date)
    2. 该新日期尚未完成特征分析 (SUCCESS 状态)
    3. 防止短时间内频繁重试今日任务
    """
    today = datetime.now().strftime("%Y-%m-%d")
    
    # 1. 获取最新负荷数据日期
    analysis_date = LoadQueryService.get_latest_data_date()
    if not analysis_date:
        logger.debug("Automatic trigger skip: No load data found.")
        return

    # 2. 检查该日期是否已经分析成功过
    if _is_analysis_done_for_date(analysis_date):
        logger.debug(f"Automatic trigger skip: Analysis for {analysis_date} already completed.")
        return

    # 3. 检查今日是否已运行过 (防止频繁重试)
    # 如果今日已运行但失败了，我们可以通过手动触发，或者等待明天自动触发，或者在这里加更复杂的重试逻辑
    if _is_executed_today("characteristics_analysis", today):
        logger.debug(f"Automatic trigger skip: Already attempted analysis task today.")
        return

    # 4. 准备执行参数
    task_id = await TaskLogger.log_task_start(
        task_type="characteristics_analysis",
        trigger_type="event",
        params={
            "execution_date": today, 
            "analysis_date": analysis_date,
            "trigger_source": "load_data_update"
        }
    )
    
    logger.info(f"🚀 Starting automated characteristic analysis: {task_id} for data date {analysis_date}")
    
    try:
        service = CharacteristicService()
        result = service.analyze_all_customers(analysis_date)
        
        # 5. 记录结果
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS",
            summary=f"完成 {analysis_date} 特征分析",
            details=result
        )
        _mark_executed("characteristics_analysis", today, "SUCCESS")
        logger.info(f"✅ Automated characteristic analysis finished: {task_id}")
        
    except Exception as e:
        logger.error(f"❌ Automated characteristic analysis failed: {e}", exc_info=True)
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="FAILED",
            summary=f"分析 {analysis_date} 失败",
            details={"error": str(e)}
        )
        _mark_executed("characteristics_analysis", today, "FAILED")
        logger.error(f"❌ Automated characteristic analysis failed: {str(e)}")
