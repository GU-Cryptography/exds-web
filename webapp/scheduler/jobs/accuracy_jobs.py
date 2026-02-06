# -*- coding: utf-8 -*-
"""
预测准确度计算任务

监听日前出清数据下载任务 (day_ahead)，一旦成功，触发对相关日期的准确度计算。
"""
import logging
import asyncio
import functools
from datetime import datetime, timedelta
from typing import Dict, Any
import uuid

from webapp.tools.mongo import DATABASE, get_config
from webapp.scheduler.logger import TaskLogger
from webapp.services.accuracy_service import evaluate_forecast_accuracy

logger = logging.getLogger(__name__)

# ========== 内存缓存 ==========
_daily_execution_cache: Dict[str, Dict[str, str]] = {}

def _is_executed_today(task_key: str, date: str) -> bool:
    """检查今天是否已执行过 (无论成功失败，避免重复触发)"""
    if task_key in _daily_execution_cache:
        cached = _daily_execution_cache[task_key]
        if cached.get("date") == date:
             # 如果内存中有记录(无论成功失败)，都视为已执行，避免短时间内重复尝试
             # 如果需要重试，需重启服务或手动清理缓存
            return True
            
    # 2. 缓存未命中,查询数据库 (防止服务重启后重复执行)
    # 查询今天是否有执行记录（无论成功失败）
    db_record = DATABASE["task_execution_logs"].find_one({
        "task_type": task_key,
        "trigger_type": "event",
        "start_time": {
            "$gte": datetime.strptime(date, "%Y-%m-%d"),
            "$lt": datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)
        }
    })
    
    if db_record:
        # 查到记录,写入缓存并返回 True
        _mark_executed(task_key, date, db_record.get("status", "UNKNOWN"))
        return True
        
    return False

def _mark_executed(task_key: str, date: str, status: str):
    """标记任务执行状态"""
    _daily_execution_cache[task_key] = {"date": date, "status": status}

async def event_driven_accuracy_job():
    """
    事件驱动的准确度计算任务
    
    触发条件: 
    1. 每天执行一次
    2. 依赖 task_execution_logs 中 task_type="day_ahead" 且 status="SUCCESS"
    """
    task_key = "forecast_accuracy_daily"
    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now()
    
    try:
        # 优化：RPA 任务通常在凌晨 6 点后完成，此前无需频繁查询数据库
        # 配置化：从 [SCHEDULE].run_times 读取第一个时间点作为开始时间
        run_times_str = get_config("SCHEDULE", "run_times", "06:00")
        try:
            first_time = run_times_str.split(',')[0].strip()
            start_hour = int(first_time.split(':')[0])
        except Exception as e:
            logger.warning(f"解析 [SCHEDULE].run_times 失败: {run_times_str}, 使用默认值 6. Error: {e}")
            start_hour = 6
        
        if now.hour < start_hour:
            return

        # 1. 检查是否已执行
        if _is_executed_today(task_key, today):
            return

        # 2. 检查前置任务 (日前数据下载) 是否成功
        # 参考 aggregation_jobs.py，使用 task_execution_records 集合
        # 用户指定: 读取 task_key 为 day_ahead 的子任务状态
        dependency = DATABASE["task_execution_records"].find_one({
            "task_key": "day_ahead",  # 根据用户指示使用 task_key
            "status": "SUCCESS",
            "execution_date": today   # task_execution_records 使用日期字符串
        })
        
        if not dependency:
            # 前置任务未完成，跳过
            return
            
        logger.info(f"检测到日前数据下载成功 (Details: {dependency.get('details', 'N/A')})，开始计算准确度...")
        
        # 3. 开始执行
        task_id = await TaskLogger.log_task_start(
            service_type="forecast",
            task_type=task_key,
            task_name="预测准确度计算 (事件驱动)",
            trigger_type="event"
        )
        
        # 4. 执行计算
        # 策略：尝试计算 昨天(T-1) 和 今天(T) 的准确度
        # 确保能覆盖 T日的实时修正后对 T-1 的回顾，以及 T日的最新预测
        today_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        target_dates = [today_date - timedelta(days=1), today_date]
        
        # 定义需要评估的配置列表
        evaluations = [
            {
                "forecast_type": "d1_price",
                "actual_collection": "day_ahead_spot_price", # 使用日前物理出清电价
                "actual_field": "avg_clearing_price",
                "forecast_collection": "price_forecast_results",
                "forecast_field": "predicted_price"
            },
            # 可扩展其他类型
        ]
        
        
        results_summary = []
        has_data = False
        loop = asyncio.get_running_loop()
        
        for target_date in target_dates:
            date_str = target_date.strftime("%Y-%m-%d")
            for config in evaluations:
                try:
                    # Run blocking calculation in thread pool to avoid blocking scheduler
                    evaluated_ids = await loop.run_in_executor(
                        None,
                        functools.partial(
                            evaluate_forecast_accuracy,
                            target_date=target_date,
                            forecast_type=config["forecast_type"],
                            actual_collection=config["actual_collection"],
                            actual_field=config["actual_field"],
                            forecast_collection=config["forecast_collection"],
                            forecast_field=config["forecast_field"],
                            points_per_day=96,
                            force_update=True
                        )
                    )
                    
                    if evaluated_ids:
                        results_summary.append(f"[{date_str}] {config['forecast_type']}: {len(evaluated_ids)} 条")
                        has_data = True
                    else:
                        logger.debug(f"[{date_str}] {config['forecast_type']}: 无数据")
                except Exception as e:
                    logger.error(f"计算 {config['forecast_type']} ({date_str}) 准确度失败: {e}")
                    results_summary.append(f"[{date_str}] {config['forecast_type']}: 失败")

        final_summary = ", ".join(results_summary) if results_summary else "无有效准确度数据生成"
        status = "SUCCESS" if has_data else "SKIPPED" # 如果都没有数据，标记为 SKIPPED? 或者 SUCCESS 但提示无数据

        # 5. 记录结束
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS", # 任务本身在逻辑上是成功的（完成了检查流程）
            summary=f"准确度计算完成。结果: {final_summary}",
            details={
                "dependency_task_id": dependency.get("task_id"),
                "target_dates": [d.strftime("%Y-%m-%d") for d in target_dates],
                "results": results_summary
            }
        )
        
        _mark_executed(task_key, today, "SUCCESS") # 标记为已执行，避免今天再次重试

    except Exception as e:
        logger.error(f"❌ 准确度计算任务异常: {e}")
        if 'task_id' in locals():
             await TaskLogger.log_task_end(task_id, "FAILED", f"执行异常: {str(e)}", error={"message": str(e)})
        
        # 创建系统告警
        await _create_alert(
            level="P2",
            category="TASK_FAILED",
            title="预测准确度计算失败",
            content=f"准确度计算任务执行异常: {str(e)}"
        )

async def _create_alert(level: str, category: str, title: str, content: str):
    """创建系统告警 (参考 aggregation_jobs.py)"""
    alert_id = f"alert_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
    
    DATABASE["system_alerts"].insert_one({
        "alert_id": alert_id,
        "level": level,
        "category": category,
        "title": title,
        "content": content,
        "service_type": "forecast",
        "task_type": "forecast_accuracy",
        "status": "ACTIVE",
        "created_at": datetime.now(),
        "resolved_at": None
    })
    
    logger.warning(f"🚨 告警已创建: {alert_id} - {title}")
