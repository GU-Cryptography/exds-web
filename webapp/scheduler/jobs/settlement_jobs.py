import logging
from datetime import datetime, timedelta
from webapp.models.settlement import SettlementVersion
from webapp.services.settlement_service import SettlementService
from webapp.services.retail_settlement_service import RetailSettlementService
from webapp.services.load_query_service import LoadQueryService

logger = logging.getLogger(__name__)

async def event_driven_settlement_job():
    """
    事件驱动结算任务 (间隙补全模式)
    
    逻辑:
    1. 获取各结算版本的最新已完成日期 (settlement_daily / retail_settlement_daily)
    2. 获取各结算版本所需源数据的最新日期 (unified_load_curve / spot_settlement_daily)
    3. 如果源数据日期 > 结算日期，则补齐中间的所有天数
    """
    logger.info("🚀 开始执行事件驱动结算调度 (间隙补全模式)...")
    
    settlement_service = SettlementService()
    retail_service = RetailSettlementService()
    
    # 安全上限：最多同步到昨天
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    # --- 1. 零售侧自动结算 ---
    try:
        source_latest = LoadQueryService.get_latest_data_date()
        result_latest = await retail_service.get_latest_results_date()
        
        if source_latest:
            sync_end = min(source_latest, yesterday)
            # 无结果时最多回溯 7 天，避免全量重算
            if result_latest:
                sync_start_dt = datetime.strptime(result_latest, "%Y-%m-%d") + timedelta(days=1)
            else:
                sync_start_dt = datetime.now() - timedelta(days=7)
            
            sync_start = sync_start_dt.strftime("%Y-%m-%d")
            
            if sync_start <= sync_end:
                logger.info(f"⏰ 零售侧发现数据间隙: {sync_start} → {sync_end}")
                curr_dt = sync_start_dt
                end_dt = datetime.strptime(sync_end, "%Y-%m-%d")
                while curr_dt <= end_dt:
                    d_str = curr_dt.strftime("%Y-%m-%d")
                    try:
                        res = retail_service.calculate_all_customers_daily(d_str, force=False)
                        success = res.get("success", 0)
                        if success > 0:
                            logger.info(f"✅ 零售侧结算完成: {d_str} ({success} 户)")
                    except Exception as e:
                        logger.error(f"❌ 零售侧结算异常 {d_str}: {e}")
                    curr_dt += timedelta(days=1)
            else:
                logger.info("✅ 零售侧结算已是最新，无需补齐")
        else:
            logger.warning("⚠️ 未找到 unified_load_curve 数据，跳过零售侧结算")
    except Exception as e:
        logger.error(f"❌ 零售侧调度逻辑异常: {e}")

    # --- 2. 日前预结算 (PRELIMINARY) ---
    try:
        source_latest = LoadQueryService.get_latest_data_date()
        result_latest = await settlement_service.get_latest_results_date(SettlementVersion.PRELIMINARY)
        
        if source_latest:
            sync_end = min(source_latest, yesterday)
            if result_latest:
                sync_start_dt = datetime.strptime(result_latest, "%Y-%m-%d") + timedelta(days=1)
            else:
                sync_start_dt = datetime.now() - timedelta(days=7)
            
            sync_start = sync_start_dt.strftime("%Y-%m-%d")
            
            if sync_start <= sync_end:
                logger.info(f"⏰ 日前预结算发现数据间隙: {sync_start} → {sync_end}")
                curr_dt = sync_start_dt
                end_dt = datetime.strptime(sync_end, "%Y-%m-%d")
                while curr_dt <= end_dt:
                    d_str = curr_dt.strftime("%Y-%m-%d")
                    try:
                        await settlement_service.calculate_daily_settlement(d_str, version=SettlementVersion.PRELIMINARY, force=False)
                        logger.info(f"✅ 日前预结算完成: {d_str}")
                    except Exception as e:
                        logger.error(f"❌ 日前预结算异常 {d_str}: {e}")
                    curr_dt += timedelta(days=1)
            else:
                logger.info("✅ 日前预结算已是最新，无需补齐")
        else:
            logger.warning("⚠️ 未找到 unified_load_curve 数据，跳过日前预结算")
    except Exception as e:
        logger.error(f"❌ 日前预结算调度逻辑异常: {e}")

    # --- 3. 平台日报结算 (PLATFORM_DAILY, 依赖 spot_settlement_daily) ---
    try:
        source_latest = await settlement_service.get_latest_platform_source_date()
        result_latest = await settlement_service.get_latest_results_date(SettlementVersion.PLATFORM_DAILY)
        
        if source_latest:
            sync_end = source_latest  # 平台日报源数据本身已有 D+2 延迟，直接用源日期
            if result_latest:
                sync_start_dt = datetime.strptime(result_latest, "%Y-%m-%d") + timedelta(days=1)
            else:
                sync_start_dt = datetime.now() - timedelta(days=10)
            
            sync_start = sync_start_dt.strftime("%Y-%m-%d")
            
            if sync_start <= sync_end:
                logger.info(f"⏰ 平台日报发现数据间隙: {sync_start} → {sync_end}")
                curr_dt = sync_start_dt
                end_dt = datetime.strptime(sync_end, "%Y-%m-%d")
                while curr_dt <= end_dt:
                    d_str = curr_dt.strftime("%Y-%m-%d")
                    try:
                        await settlement_service.calculate_daily_settlement(d_str, version=SettlementVersion.PLATFORM_DAILY, force=False)
                        logger.info(f"✅ 平台日报结算完成: {d_str}")
                    except Exception as e:
                        logger.error(f"❌ 平台日报结算异常 {d_str}: {e}")
                    curr_dt += timedelta(days=1)
            else:
                logger.info("✅ 平台日报结算已是最新，无需补齐")
        else:
            logger.warning("⚠️ 未找到 spot_settlement_daily 数据，跳过平台日报结算")
    except Exception as e:
        logger.error(f"❌ 平台日报调度逻辑异常: {e}")

    logger.info("🏁 结算间隙补全调度任务结束")
