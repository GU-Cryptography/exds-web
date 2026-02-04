# -*- coding: utf-8 -*-
"""
任务日志记录器

用于记录定时任务和事件驱动任务的执行日志
"""
import logging
import uuid
from datetime import datetime
from typing import Optional, Dict, Any

from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


class TaskLogger:
    """任务日志记录器"""
    
    @staticmethod
    async def log_task_start(
        service_type: str,
        task_type: str,
        task_name: str,
        trigger_type: str = "schedule",
        trigger_source: Optional[str] = None
    ) -> str:
        """
        记录任务开始
        
        Args:
            service_type: 服务类型 (如 "web", "rpa", "forecast")
            task_type: 任务类型 (如 "load_aggregation")
            task_name: 任务名称 (如 "负荷数据聚合")
            trigger_type: 触发类型 ("schedule", "event", "manual")
            trigger_source: 触发来源 (可选,如 RPA 任务ID)
        
        Returns:
            task_id: 任务唯一标识
        """
        # 生成任务ID
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        random_suffix = uuid.uuid4().hex[:4]
        task_id = f"{service_type}_{task_type}_{timestamp}_{random_suffix}"
        
        # 写入数据库
        log_entry = {
            "task_id": task_id,
            "service_type": service_type,
            "task_type": task_type,
            "task_name": task_name,
            "trigger_type": trigger_type,
            "status": "RUNNING",
            "start_time": datetime.now(),
            "end_time": None,
            "duration": None,
            "summary": None,
            "details": None,
            "error": None,
            "created_at": datetime.now(),
            "updated_at": datetime.now()
        }
        
        if trigger_source:
            log_entry["trigger_source"] = trigger_source
        
        DATABASE["task_execution_logs"].insert_one(log_entry)
        
        logger.info(f"📝 任务开始: {task_id} - {task_name}")
        
        return task_id
    
    @staticmethod
    async def log_task_end(
        task_id: str,
        status: str,
        summary: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None
    ):
        """
        记录任务结束
        
        Args:
            task_id: 任务ID
            status: 任务状态 ("SUCCESS", "FAILED", "PARTIAL", "SKIPPED")
            summary: 执行摘要
            details: 详细信息
            error: 错误信息
        """
        # 查询任务开始时间
        task_record = DATABASE["task_execution_logs"].find_one({"task_id": task_id})
        
        if not task_record:
            logger.error(f"❌ 任务记录不存在: {task_id}")
            return
        
        # 计算耗时
        start_time = task_record["start_time"]
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        # 更新数据库
        update_data = {
            "status": status,
            "end_time": end_time,
            "duration": duration,
            "updated_at": datetime.now()
        }
        
        if summary:
            update_data["summary"] = summary
        
        if details:
            update_data["details"] = details
        
        if error:
            update_data["error"] = error
        
        DATABASE["task_execution_logs"].update_one(
            {"task_id": task_id},
            {"$set": update_data}
        )
        
        # 记录日志
        status_icon = {
            "SUCCESS": "✅",
            "FAILED": "❌",
            "PARTIAL": "⚠️",
            "SKIPPED": "⏭️"
        }.get(status, "❓")
        
        logger.info(f"{status_icon} 任务结束: {task_id} - {status} ({duration:.2f}秒)")
        
        if summary:
            logger.info(f"  摘要: {summary}")
