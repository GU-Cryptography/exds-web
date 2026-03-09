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
        latest_retail_date = await retail_service.get_latest_results_date()
        
        # 解析日期并确定各版本的“下一个待处理日期”
        dates_to_compare = []
        
        # 批发-初步结算
        if latest_prelim_date:
            dates_to_compare.append(datetime.strptime(latest_prelim_date, "%Y-%m-%d") + timedelta(days=1))
        
        # 批发-平台日报
        if latest_platform_date:
            dates_to_compare.append(datetime.strptime(latest_platform_date, "%Y-%m-%d") + timedelta(days=1))
        
        # 零售结算 (包含完成度精密判定)
        if latest_retail_date:
            expected_customers = retail_service.contract_service.get_active_customers(latest_retail_date, latest_retail_date)
            expected_count = len(expected_customers)
            actual_count = await retail_service.get_settled_count(latest_retail_date)
            
            if actual_count < expected_count:
                # 还有漏算的客户，进度停留在此处（重试当日）
                retail_next_dt = datetime.strptime(latest_retail_date, "%Y-%m-%d")
                logger.info(f"🚩 零售结算进度未完成: {latest_retail_date} ({actual_count}/{expected_count})，将重试补齐")
            else:
                # 当日已全量完成，进度向后推一天
                retail_next_dt = datetime.strptime(latest_retail_date, "%Y-%m-%d") + timedelta(days=1)
            
            dates_to_compare.append(retail_next_dt)
        
        if not dates_to_compare:
            # 如果从未结算过，默认补齐最近7天
            start_dt = datetime.strptime(sync_limit, "%Y-%m-%d") - timedelta(days=7)
        else:
            # 补齐起点 = 各版本中最慢的那个“下一个待处理日期”
            start_dt = min(dates_to_compare)
            
        end_dt = datetime.strptime(sync_limit, "%Y-%m-%d")
        
        if start_dt > end_dt:
            # 数据已是最新，仅输出巡检日志
            logger.info(f"⏩ 结算巡检: 数据已是最新 (Start: {start_dt.strftime('%Y-%m-%d')} > End: {sync_limit})")
            return

        # 2. 执行处理循环
        newly_processed_count = 0  # 真正产生了新记录的天数
        skipped_dates = []
        error_count = 0
        
        curr_dt = start_dt
        while curr_dt <= end_dt:
            date_str = curr_dt.strftime("%Y-%m-%d")
            logger.info(f"⏳ 正在检查 {date_str} 结算基础数据...")
            
            try:
                # 检查基础数据完整性
                basis_data = await settlement_service._fetch_basis_data_preliminary(date_str)
                if not basis_data:
                    logger.warning(f"⏩ 跳过 {date_str}: 基础数据缺失")
                    skipped_dates.append(f"{date_str}(数据不全)")
                    curr_dt += timedelta(days=1)
                    continue

                day_has_new_work = False

                # A. 日前预结算
                res_prelim = await settlement_service.calculate_daily_settlement(
                    date_str=date_str, 
                    version=SettlementVersion.PRELIMINARY,
                    force=False
                )
                if res_prelim and res_prelim.is_new_calculation:
                    day_has_new_work = True
                
                # B. 平台日报结算
                res_platform = await settlement_service.calculate_daily_settlement(
                    date_str=date_str, 
                    version=SettlementVersion.PLATFORM_DAILY,
                    force=False
                )
                if res_platform and res_platform.is_new_calculation:
                    day_has_new_work = True

                # C. 零售侧结算 (依赖批发结算结果，所以放在后面)
                res_retail = retail_service.calculate_all_customers_daily(date_str)
                if res_retail.get("new_processed", 0) > 0:
                    day_has_new_work = True
                
                if day_has_new_work:
                    newly_processed_count += 1
                    logger.info(f"✅ {date_str} 结算有新进度更新")
                else:
                    logger.info(f"⏭️ {date_str} 数据均已存在，无新增变动")

            except Exception as ex:
                logger.error(f"❌ {date_str} 结算执行过程中出错: {ex}")
                error_count += 1
                
            curr_dt += timedelta(days=1)
            
        # 3. 结果记录策略：仅在有实际产出或报错时写入数据库任务日志
        if newly_processed_count > 0 or error_count > 0:
            task_id = await TaskLogger.log_task_start(
                service_type="settlement_service",
                task_type="event_driven_settlement",
                task_name="事件驱动结算补齐",
                trigger_type="schedule"
            )

            summary = f"执行完成。有效产出: {newly_processed_count}天"
            if error_count:
                summary += f", 故障: {error_count}天"
            if skipped_dates:
                summary += f", 跳过: {len(skipped_dates)}天"
                
            await TaskLogger.log_task_end(
                task_id, 
                "SUCCESS" if error_count == 0 else "FAILED",
                summary=summary,
                details={
                    "newly_processed_days": newly_processed_count,
                    "error_days": error_count,
                    "skipped_list": skipped_dates[:10],
                    "range": f"{start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}"
                }
            )
        else:
            logger.info("🏁 结算巡检完成: 本轮无新增结算数据，未写入数据库日志。")
        
    except Exception as e:
        logger.error(f"💥 结算调度逻辑发生致命故障: {e}")
        # 尝试记录异常 (如果能获得 task_id 的话，这里因为是延迟创建，可能没有 task_id)
        # 只有在非常严重的逻辑错误时才会到这里

    logger.info("🏁 结算间隙补全调度任务结束")
