import logging
from datetime import datetime, timedelta
from webapp.models.settlement import SettlementVersion

logger = logging.getLogger(__name__)

async def event_driven_settlement_job():
    """
    定时触发预结算计算任务
    
    策略:
    1. 每30分钟运行一次
    2.初步预结算 (PRELIMINARY): 尝试计算 D-1, D-2
    3.平台日报结算 (PLATFORM_DAILY): 尝试计算 D-3, D-4 (通常 D+2 发布)
    """
    logger.info("⏰ 开始分版本预结算调度任务...")
    service = SettlementService()
    
    today = datetime.now()
    
    # 任务配置 [版本, 目标天数列表]
    configs = [
        (SettlementVersion.PRELIMINARY, [1, 2]),
        (SettlementVersion.PLATFORM_DAILY, [3, 4, 5]) 
    ]
    
    for version, days in configs:
        for d in days:
            date_str = (today - timedelta(days=d)).strftime("%Y-%m-%d")
            try:
                # force=False: 如果版本已存在则跳过
                result = await service.calculate_daily_settlement(date_str, version=version, force=False)
                if result:
                    logger.info(f"✅ [调度] {version} 结算计算成功: {date_str}")
            except Exception as e:
                logger.error(f"❌ [调度] {version} 结算计算异常 {date_str}: {e}")

    logger.info("🏁 预结算调度任务结束")

    logger.info("🏁 预结算调度任务结束")
