# -*- coding: utf-8 -*-
"""
负荷数据聚合任务

事件驱动的自动聚合任务,监听 RPA 下载成功事件,自动触发数据聚合
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any
from bson import ObjectId

from webapp.tools.mongo import DATABASE, get_config
from webapp.scheduler.logger import TaskLogger
from webapp.services.contract_service import ContractService
from webapp.services.load_aggregation_service import LoadAggregationService

async def _get_active_customers(date_str: str) -> list:
    """
    获取指定日期所在月份的有效签约客户
    
    Args:
        date_str: YYYY-MM-DD
        
    Returns:
        [{"customer_id": str, "customer_name": str}, ...]
    """
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        # 当月第一天
        start_of_month = datetime(dt.year, dt.month, 1)
        # 下个月第一天 (即当月结束时间点)
        if dt.month == 12:
            next_month = datetime(dt.year + 1, 1, 1)
        else:
            next_month = datetime(dt.year, dt.month + 1, 1)
            
        end_of_month = next_month - timedelta(seconds=1)
        
        contract_service = ContractService(DATABASE)
        # 获取重叠的客户信息
        return contract_service.get_signed_customers_in_range(start_of_month, end_of_month)
        
    except Exception as e:
        logger.error(f"查询活跃客户失败: {e}")
        return []

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
        now = datetime.now()
        # 优化：RPA 任务通常在凌晨 6 点后完成，此前无需频繁查询数据库
        # 配置化：从 [SCHEDULE].run_times 读取第一个时间点作为开始时间
        # 示例 run_times = 06:00,09:10,12:00,21:00 -> 取 06:00 -> 6点
        run_times_str = get_config("SCHEDULE", "run_times", "06:00")
        try:
            first_time = run_times_str.split(',')[0].strip()
            start_hour = int(first_time.split(':')[0])
        except Exception as e:
            logger.warning(f"解析 [SCHEDULE].run_times 失败: {run_times_str}, 使用默认值 6. Error: {e}")
            start_hour = 6
        
        if now.hour < start_hour:
            # logger.debug(f"当前时间早于 {start_hour}:00, 跳过聚合任务")
            return

        today = now.strftime("%Y-%m-%d")
        
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
        active_customers_count = result.get('active_customers_count', 0)
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
    增量聚合所有当月有效签约客户的数据
    
    逻辑:
    1. 查找当月有有效零售合同的所有客户
    2. 对每个客户,找出 unified_load_curve 中缺失的日期
    3. 调用 LoadAggregationService.upsert_unified_load_curve 进行聚合
    
    Args:
        trigger_date: 触发日期 (用于确定"当月", YYYY-MM-DD)
    
    Returns:
        {
            "customers_processed": int,  # 成功聚合的客户数
            "dates_aggregated": int,     # 聚合的日期数
            "records_aggregated": int,   # 聚合的记录数
            "active_customers_count": int # 当月活跃客户总数
        }
    """
    # 1. 获取当月有效签约客户
    active_customers = await _get_active_customers(trigger_date)
    
    if not active_customers:
        logger.warning(f"没有找到 {trigger_date} 当月的有效签约客户")
        return {
            "customers_processed": 0,
            "dates_aggregated": 0,
            "records_aggregated": 0,
            "active_customers_count": 0
        }
    
    logger.info(f"开始执行增量聚合 (当月活跃客户数: {len(active_customers)})...")
    
    customers_processed = 0
    dates_aggregated_set = set()
    records_aggregated = 0
    
    # 3. 对每个客户进行增量聚合
    for customer in active_customers:
        customer_id = str(customer["customer_id"])
        customer_name = customer.get("customer_name", "未知")
        
        try:
            # 查找该客户待处理的日期 (包含缺失、不完整、过期)
            pending_tasks = LoadAggregationService.get_pending_tasks([customer_id])
            missing_dates = pending_tasks.get(customer_id, [])
            
            if not missing_dates:
                # 虽然没有缺失日期，但也算作成功处理（因为数据已完整）
                # 但为了 customers_processed 语义准确（成功聚合了数据），这里暂不计数
                # 或者如果它是"检查通过"，也算 processed? 
                # 通常 customers_processed 指的是发生变更。如果没变更，就不算。
                continue 
            
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
        "records_aggregated": records_aggregated,
        "active_customers_count": len(active_customers)
    }





async def _get_active_customers_count(date_str: str = None) -> int:
    """
    [已弃用] 获取当前签约客户数
    现在由 _aggregate_all_customers 直接返回准确的基数
    """
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")
    customers = await _get_active_customers(date_str)
    return len(customers)


async def _create_alert(level: str, category: str, title: str, content: str):
    """创建系统告警"""
    import uuid
    
    # 使用本地时间作为ID部分 (虽然 uuid 足够唯一，但保留时间戳习惯)
    now_local = datetime.now()
    alert_id = f"alert_{now_local.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"
    
    DATABASE["system_alerts"].insert_one({
        "alert_id": alert_id,
        "level": level,
        "category": category,
        "title": title,
        "content": content,
        "service_type": "web",
        "task_type": "load_aggregation",
        "status": "ACTIVE",
        "created_at": now_local, # 修正为本地时间
        "resolved_at": None
    })
    
    logger.warning(f"🚨 告警已创建: {alert_id} - {title}")
