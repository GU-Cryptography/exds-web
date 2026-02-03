# -*- coding: utf-8 -*-
"""
调度器核心模块

管理所有定时任务和事件驱动任务
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from apscheduler.executors.asyncio import AsyncIOExecutor

from webapp.scheduler.jobs.aggregation_jobs import (
    event_driven_load_aggregation_job
)

logger = logging.getLogger(__name__)

# 创建调度器实例
scheduler = AsyncIOScheduler(
    jobstores={"default": MemoryJobStore()},
    executors={"default": AsyncIOExecutor()},
    job_defaults={
        "coalesce": True,  # 合并错过的任务
        "max_instances": 1,  # 每个任务最多1个实例
        "misfire_grace_time": 60  # 错过任务的宽限时间(秒)
    }
)


def setup_scheduler(app):
    """
    设置调度器并注册任务
    
    Args:
        app: FastAPI 应用实例
    """
    
    # ========== 事件驱动任务 ==========
    
    # 负荷数据聚合 (每5分钟检查 RPA 下载状态)
    scheduler.add_job(
        event_driven_load_aggregation_job,
        'interval',
        minutes=5,
        id='web_event_load_aggregation',
        replace_existing=True
    )
    
    # ========== 生命周期管理 ==========
    
    @app.on_event("startup")
    async def start_scheduler():
        """启动调度器"""
        scheduler.start()
        jobs = scheduler.get_jobs()
        logger.info("✅ APScheduler 已启动")
        logger.info(f"📋 已注册 {len(jobs)} 个定时任务:")
        for job in jobs:
            logger.info(f"  - {job.id}: {job.next_run_time}")
    
    @app.on_event("shutdown")
    async def stop_scheduler():
        """停止调度器"""
        scheduler.shutdown()
        logger.info("🛑 APScheduler 已停止")
