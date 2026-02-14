import logging
from datetime import datetime, timedelta
from webapp.models.settlement import SettlementVersion
from webapp.services.settlement_service import SettlementService
from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.services.load_query_service import LoadQueryService
from webapp.scheduler.logger import TaskLogger

logger = logging.getLogger(__name__)

async def event_driven_settlement_job():
    """
    事件驱动结算任务 (间隙补全模式)
    """
    logger.info("🚀 开始执行事件驱动结算调度 (间隙补全模式)...")
    
    # 注册任务开始
    task_id = await TaskLogger.log_task_start(
        service_type="settlement_service",
        task_type="event_driven_settlement",
        task_name="事件驱动结算补齐",
        trigger_type="schedule"
    )
    
    settlement_service = SettlementService()
    retail_service = RetailSettlementService()
    
    processed_count = 0
    skipped_dates = []
    error_count = 0
    
    # 安全上限：最多同步到昨天
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    try:
        # 1. 获取最新数据日期 (使用过滤了未来日期的版本)
        latest_load_date = LoadQueryService.get_latest_data_date()
        if not latest_load_date:
            await TaskLogger.log_task_end(task_id, "skipped", "未找到任何有效聚合负荷数据，取消运行")
            return
            
        sync_limit = min(latest_load_date, yesterday_str)
        
        # 2. 获取已结算的最新日期 (以 PRELIMINARY 为准)
        latest_settled_date = await settlement_service.get_latest_results_date(SettlementVersion.PRELIMINARY)
        
        # 定义开始日期: latest_settled_date + 1天
        if not latest_settled_date:
            start_dt = datetime.strptime(sync_limit, "%Y-%m-%d") - timedelta(days=7)
        else:
            start_dt = datetime.strptime(latest_settled_date, "%Y-%m-%d") + timedelta(days=1)
            
        end_dt = datetime.strptime(sync_limit, "%Y-%m-%d")
        
        if start_dt > end_dt:
            await TaskLogger.log_task_end(task_id, "success", summary="结算数据已是最新，无需补齐")
            return

        curr_dt = start_dt
        while curr_dt <= end_dt:
            date_str = curr_dt.strftime("%Y-%m-%d")
            logger.info(f"⏳ 正在检查 {date_str} 结算基础数据...")
            
            try:
                # 检查批发侧数据完整性 (价格/负荷/合同)
                basis_data = await settlement_service._fetch_basis_data_preliminary(date_str)
                if not basis_data:
                    logger.warning(f"⏩ 跳过 {date_str}: 基础数据缺失或格式异常")
                    skipped_dates.append(f"{date_str}(数据不全)")
                    curr_dt += timedelta(days=1)
                    continue

                # A. 零售侧结算 (计算结果存在 upsert 逻辑)
                retail_res = retail_service.calculate_all_customers_daily(date_str)
                
                # B. 日前预结算
                await settlement_service.calculate_daily_settlement(
                    target_date=date_str, 
                    version=SettlementVersion.PRELIMINARY,
                    force=False
                )
                
                # C. 平台日报结算
                await settlement_service.calculate_daily_settlement(
                    target_date=date_str, 
                    version=SettlementVersion.PLATFORM_DAILY,
                    force=False
                )
                
                processed_count += 1
                logger.info(f"✅ {date_str} 结算补全完成")
                
            except Exception as ex:
                logger.error(f"❌ {date_str} 结算执行过程中出错: {ex}")
                error_count += 1
                
            curr_dt += timedelta(days=1)
            
        # 汇总任务日志
        summary = f"执行完成。处理: {processed_count}天"
        if skipped_dates:
            summary += f", 跳过: {len(skipped_dates)}天 ({', '.join(skipped_dates[:3])}...)"
        if error_count:
            summary += f", 失败: {error_count}天"
            
        await TaskLogger.log_task_end(
            task_id, 
            "success" if error_count == 0 else "failed",
            summary=summary,
            details={
                "processed_days": processed_count,
                "skipped_days": len(skipped_dates),
                "error_days": error_count,
                "skipped_list": skipped_dates
            }
        )
        
    except Exception as e:
        logger.error(f"💥 结算调度逻辑发生致命故障: {e}")
        await TaskLogger.log_task_end(task_id, "failed", error={"message": str(e)})

    logger.info("🏁 结算间隙补全调度任务结束")

    logger.info("🏁 结算间隙补全调度任务结束")
