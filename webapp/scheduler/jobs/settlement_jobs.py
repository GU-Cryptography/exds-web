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
    
    settlement_service = SettlementService()
    retail_service = RetailSettlementService()
    
    # 1. 预检查：确定同步范围
    # 安全上限：最多同步到昨天
    yesterday_str = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    try:
        # 获取最新可用负荷数据日期
        latest_load_date = LoadQueryService.get_latest_data_date()
        if not latest_load_date:
            logger.info("⏩ 结算跳过: 未找到任何有效聚合负荷数据")
            return
            
        sync_limit = min(latest_load_date, yesterday_str)
        
        # 获取已结算的最新日期 (综合考虑所有版本，取进度最慢的作为补完起点)
        latest_prelim_date = await settlement_service.get_latest_results_date(SettlementVersion.PRELIMINARY)
        latest_platform_date = await settlement_service.get_latest_results_date(SettlementVersion.PLATFORM_DAILY)
        
        # 解析日期并取最小值
        dates_to_compare = []
        if latest_prelim_date: dates_to_compare.append(datetime.strptime(latest_prelim_date, "%Y-%m-%d"))
        if latest_platform_date: dates_to_compare.append(datetime.strptime(latest_platform_date, "%Y-%m-%d"))
        
        if not dates_to_compare:
            # 如果从未结算过，默认补齐最近7天
            start_dt = datetime.strptime(sync_limit, "%Y-%m-%d") - timedelta(days=7)
        else:
            # 补齐起点 = 进度最慢的版本日期 + 1天
            start_dt = min(dates_to_compare) + timedelta(days=1)
            
        end_dt = datetime.strptime(sync_limit, "%Y-%m-%d")
        
        if start_dt > end_dt:
            msg = f"⏩ 结算跳过: 数据已是最新 (PRELIMINARY: {latest_prelim_date or '无'}, PLATFORM_DAILY: {latest_platform_date or '无'})"
            logger.info(msg)
            return

        # 2. 确实有数据需要补齐，此时才开始记录数据库日志
        task_id = await TaskLogger.log_task_start(
            service_type="settlement_service",
            task_type="event_driven_settlement",
            task_name="事件驱动结算补齐",
            trigger_type="schedule"
        )

        processed_count = 0
        skipped_dates = []
        error_count = 0
        
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

                # A. 零售侧结算
                retail_service.calculate_all_customers_daily(date_str)
                
                # B. 日前预结算
                await settlement_service.calculate_daily_settlement(
                    date_str=date_str, 
                    version=SettlementVersion.PRELIMINARY,
                    force=False
                )
                
                # C. 平台日报结算
                await settlement_service.calculate_daily_settlement(
                    date_str=date_str, 
                    version=SettlementVersion.PLATFORM_DAILY,
                    force=False
                )
                
                processed_count += 1
                logger.info(f"✅ {date_str} 结算补全完成")
                
            except Exception as ex:
                logger.error(f"❌ {date_str} 结算执行过程中出错: {ex}")
                error_count += 1
                
            curr_dt += timedelta(days=1)
            
        # 3. 汇总并结束任务日志
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
                "skipped_list": skipped_dates,
                "range": f"{start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}"
            }
        )
        
    except Exception as e:
        logger.error(f"💥 结算调度逻辑发生致命故障: {e}")
        # 如果已经开始了任务记录，则需要闭环
        if 'task_id' in locals():
            await TaskLogger.log_task_end(task_id, "failed", error={"message": str(e)})

    logger.info("🏁 结算间隙补全调度任务结束")
