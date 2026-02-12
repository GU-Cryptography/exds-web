import logging
from datetime import datetime, timedelta
from webapp.services.settlement_service import SettlementService

logger = logging.getLogger(__name__)

async def event_driven_settlement_job():
    """
    定时触发预结算计算任务
    
    策略:
    1. 每30分钟运行一次
    2. 尝试计算 D-1 (正常情况)
    3. 尝试计算 D-2 (兜底, 防止D-1数据延迟)
    """
    logger.info("⏰ 开始预结算调度任务...")
    service = SettlementService()
    
    today = datetime.now()
    
    # 目标日期列表: [D-1, D-2]
    # 优先计算较早的日期? 或者无所谓? 
    # 计算 D-2
    target_dates = [
        (today - timedelta(days=2)).strftime("%Y-%m-%d"),
        (today - timedelta(days=1)).strftime("%Y-%m-%d")
    ]
    
    for date_str in target_dates:
        try:
            # force=False: 如果已计算则跳过
            result = await service.calculate_daily_settlement(date_str, force=False)
            if result:
                logger.info(f"✅ [调度] 预结算计算成功: {date_str}")
        except Exception as e:
            logger.error(f"❌ [调度] 预结算计算异常 {date_str}: {e}")

    logger.info("🏁 预结算调度任务结束")
