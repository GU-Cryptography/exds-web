# -*- coding: utf-8 -*-
"""
负荷数据聚合任务

事件驱动的自动聚合任务,监听 RPA 下载成功事件,自动触发数据聚合
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any
from bson import ObjectId

from webapp.tools.mongo import DATABASE
from webapp.scheduler.logger import TaskLogger
from webapp.services.load_aggregation_service import LoadAggregationService

logger = logging.getLogger(__name__)

# ========== 内存缓存 ==========

# 全局缓存: {task_key: {"date": "YYYY-MM-DD", "status": "SUCCESS/FAILED"}}
# 示例: {"load_aggregation": {"date": "2026-02-03", "status": "SUCCESS"}}
_daily_execution_cache: Dict[str, Dict[str, str]] = {}


def _is_executed_today(task_key: str, date: str) -> bool:
    """
    检查今天是否已执行过 (优先查缓存,缓存未命中则查数据库)
    
    Args:
        task_key: 任务标识 (如 "load_aggregation")
        date: 日期 (YYYY-MM-DD)
    
    Returns:
        True: 今天已执行过 (SUCCESS 或 FAILED)
        False: 今天还没执行
    """
    # 1. 检查缓存是否存在且日期匹配
    if task_key in _daily_execution_cache:
        cached_date = _daily_execution_cache[task_key].get("date")
        
        # 如果日期不同,清空缓存 (跨天自动重置)
        if cached_date != date:
            logger.debug(f"日期变更: {cached_date} -> {date}, 清空缓存")
            _daily_execution_cache[task_key] = {}
        elif "status" in _daily_execution_cache[task_key]:
            # 日期匹配且有状态,缓存命中
            status = _daily_execution_cache[task_key]["status"]
            logger.debug(f"缓存命中: {task_key}:{date} = {status}")
            return True
    
    # 2. 缓存未命中,查询数据库
    logger.debug(f"缓存未命中,查询数据库: {task_key}:{date}")
    
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
        # 查到记录,写入缓存
        status = record["status"]
        _mark_executed(task_key, date, status)
        logger.debug(f"数据库查询结果: {task_key}:{date} = {status}, 已写入缓存")
        return True
    
    logger.debug(f"数据库查询结果: {task_key}:{date} = 未执行")
    return False


def _mark_executed(task_key: str, date: str, status: str):
    """
    标记任务已执行 (写入缓存)
    
    Args:
        task_key: 任务标识
        date: 日期 (YYYY-MM-DD)
        status: 状态 (SUCCESS/FAILED)
    """
    _daily_execution_cache[task_key] = {
        "date": date,
        "status": status
    }
    logger.debug(f"缓存已更新: {task_key}:{date} = {status}")





# ========== 事件驱动任务 ==========

async def event_driven_load_aggregation_job():
    """
    事件驱动的负荷数据聚合任务
    
    触发频率: 每5分钟检查一次 RPA 下载状态
    执行策略: 每天只执行一次 (使用内存缓存优化)
    """
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        
        # 1. 检查今天是否已执行过 (优先查缓存)
        if _is_executed_today("load_aggregation", today):
            # 今天已执行过,静默跳过
            return
        
        # 2. 查询 RPA 下载成功记录
        rpa_record = DATABASE["task_execution_records"].find_one({
            "pipeline_name": "计量点负荷曲线",
            "status": "SUCCESS",
            "execution_date": today
        })
        
        if not rpa_record:
            # RPA 还没下载成功,静默跳过 (不记录日志,不告警)
            logger.debug(f"今天暂无 RPA 下载成功记录, 继续等待")
            return
        
        # 3. 发现 RPA 下载成功且今天还没聚合,开始执行
        task_id = await TaskLogger.log_task_start(
            service_type="web",
            task_type="load_aggregation",
            task_name="负荷数据聚合 (事件驱动)",
            trigger_type="event"
        )
        
        # 4. 执行聚合
        result = await _aggregate_all_customers(today)
        
        # 5. 检查数据质量 (聚合客户数 < 签约客户数)
        active_customers_count = await _get_active_customers_count()
        if result['customers_processed'] < active_customers_count:
            await _create_alert(
                level="P1",
                category="DATA_QUALITY",
                title="负荷数据聚合异常",
                content=f"仅成功聚合 {result['customers_processed']} 个客户,签约客户数为 {active_customers_count}"
            )
        
        # 6. 记录成功
        await TaskLogger.log_task_end(
            task_id=task_id,
            status="SUCCESS",
            summary=f"成功聚合 {result['customers_processed']} 个客户, {result['dates_aggregated']} 个日期, {result['records_aggregated']} 条记录",
            details={
                **result,
                "rpa_task_id": str(rpa_record["_id"])
            }
        )
        
        # 7. 写入缓存
        _mark_executed("load_aggregation", today, "SUCCESS")
        
        logger.info(f"✅ 聚合完成: {task_id}")
        
    except Exception as e:
        # 聚合执行失败,记录日志并告警
        if 'task_id' in locals():
            await TaskLogger.log_task_end(
                task_id=task_id,
                status="FAILED",
                summary=f"聚合失败: {str(e)}",
                error={"message": str(e)}
            )
            
            # 写入缓存 (失败也标记为已执行)
            _mark_executed("load_aggregation", today, "FAILED")
        
        # 聚合失败,立即创建告警 (1次失败即告警)
        await _create_alert(
            level="P1",
            category="TASK_FAILED",
            title="负荷数据聚合失败",
            content=f"聚合任务执行失败: {str(e)}"
        )
        
        logger.error(f"❌ 聚合失败: {str(e)}")
        raise


# ========== 共享业务逻辑 ==========

async def _aggregate_all_customers(trigger_date: str) -> Dict[str, Any]:
    """
    增量聚合所有客户的数据
    
    逻辑:
    1. 查找 raw_mp_data 和 raw_meter_data 中所有存在的日期
    2. 对每个客户,找出 unified_load_curve 中缺失的日期
    3. 调用 LoadAggregationService.upsert_unified_load_curve 进行聚合
    
    Args:
        trigger_date: 触发日期 (用于日志,不影响聚合逻辑)
    
    Returns:
        {
            "customers_processed": int,  # 成功聚合的客户数
            "dates_aggregated": int,     # 聚合的日期数
            "records_aggregated": int    # 聚合的记录数
        }
    """
    # 1. 获取所有客户
    customers = list(DATABASE["customer_archives"].find({}, {"_id": 1, "user_name": 1}))
    
    if not customers:
        logger.warning("没有找到任何客户")
        return {
            "customers_processed": 0,
            "dates_aggregated": 0,
            "records_aggregated": 0
        }
    
    # 2. 查找 raw_mp_data 和 raw_meter_data 中所有存在的日期
    mp_dates = DATABASE["raw_mp_data"].distinct("date")
    meter_dates = DATABASE["raw_meter_data"].distinct("date")
    all_dates = sorted(set(mp_dates + meter_dates))
    
    if not all_dates:
        logger.info("raw_mp_data 和 raw_meter_data 中没有数据")
        return {
            "customers_processed": 0,
            "dates_aggregated": 0,
            "records_aggregated": 0
        }
    
    logger.info(f"发现 {len(all_dates)} 个日期需要检查: {all_dates[0]} ~ {all_dates[-1]}")
    
    customers_processed = 0
    dates_aggregated_set = set()
    records_aggregated = 0
    
    # 3. 对每个客户进行增量聚合
    for customer in customers:
        customer_id = str(customer["_id"])
        customer_name = customer.get("user_name", "未知")
        
        try:
            # 查找该客户在 unified_load_curve 中已有的日期
            existing_dates = set(
                DATABASE["unified_load_curve"].distinct(
                    "date",
                    {"customer_id": customer_id}
                )
            )
            
            # 找出缺失的日期
            missing_dates = [d for d in all_dates if d not in existing_dates]
            
            if not missing_dates:
                continue  # 该客户所有日期都已聚合
            
            # 对每个缺失日期进行聚合
            customer_success = False
            for date in missing_dates:
                try:
                    success = LoadAggregationService.upsert_unified_load_curve(
                        customer_id=customer_id,
                        date=date,
                        customer_name=customer_name
                    )
                    
                    if success:
                        records_aggregated += 1
                        dates_aggregated_set.add(date)
                        customer_success = True
                        
                except Exception as e:
                    logger.warning(f"聚合失败 customer={customer_id} date={date}: {str(e)}")
                    continue
            
            if customer_success:
                customers_processed += 1
                
        except Exception as e:
            logger.warning(f"处理客户 {customer_id} 失败: {str(e)}")
            continue
    
    return {
        "customers_processed": customers_processed,
        "dates_aggregated": len(dates_aggregated_set),
        "records_aggregated": records_aggregated
    }


async def _get_active_customers_count() -> int:
    """
    获取当前签约客户数
    
    通过调用客户合同服务接口获取
    """
    # TODO: 调用客户合同服务接口
    # 临时实现: 查询 customer_archives 中的客户数
    count = DATABASE["customer_archives"].count_documents({})
    return count


async def _create_alert(level: str, category: str, title: str, content: str):
    """创建系统告警"""
    import uuid
    
    alert_id = f"alert_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
    
    DATABASE["system_alerts"].insert_one({
        "alert_id": alert_id,
        "level": level,
        "category": category,
        "title": title,
        "content": content,
        "service_type": "web",
        "task_type": "load_aggregation",
        "status": "ACTIVE",
        "created_at": datetime.utcnow(),
        "resolved_at": None
    })
    
    logger.warning(f"🚨 告警已创建: {alert_id} - {title}")
