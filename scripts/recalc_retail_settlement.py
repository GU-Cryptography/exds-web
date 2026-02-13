import sys
import os
from datetime import datetime

# 将项目根目录添加到 python 路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from webapp.tools.mongo import DATABASE
from webapp.services.retail_settlement_service import RetailSettlementService
import logging

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("recalc_retail")

from datetime import datetime, timedelta

def main():
    start_date = datetime(2026, 2, 12)
    end_date = datetime(2026, 2, 13)
    force = True
    
    service = RetailSettlementService()
    
    current_date = start_date
    total_success = 0
    total_failed = 0
    all_capped_records = []

    logger.info(f"开始执行全月零售结算重算: 范围={start_date.date()} 至 {end_date.date()}, 强制重算={force}")
    
    while current_date <= end_date:
        date_str = current_date.strftime("%Y-%m-%d")
        logger.info(f"[{date_str}] 正在计算...")
        
        try:
            result = service.calculate_all_customers_daily(date_str, force=force)
            total_success += result['success']
            total_failed += result['failed']
            
            if result['failed'] > 0:
                for detail in result['details']:
                    if detail['status'] == 'failed':
                        logger.error(f"  [{date_str}] 客户 {detail['customer_id']} 失败: {detail.get('error')}")
            
            # 记录封顶情况
            capped_docs = DATABASE.retail_settlement_daily.find({
                "date": date_str,
                "is_capped": True
            })
            for doc in capped_docs:
                all_capped_records.append({
                    "date": date_str,
                    "customer": doc['customer_name'],
                    "nominal": doc['nominal_avg_price'],
                    "cap": doc['cap_price']
                })
                
        except Exception as e:
            logger.error(f"  [{date_str}] 执行异常: {e}")
            
        current_date += timedelta(days=1)
        
    logger.info("========================================")
    logger.info(f"全月重算完成!")
    logger.info(f"总计成功次数: {total_success}")
    logger.info(f"总计失败次数: {total_failed}")
    
    if all_capped_records:
        logger.info(f"全月共发现 {len(all_capped_records)} 条触发封顶的记录:")
        # 按日期排序打印
        all_capped_records.sort(key=lambda x: x['date'])
        for rec in all_capped_records:
            logger.info(f"  {rec['date']} | {rec['customer']} | 名义: {rec['nominal']:.4f} | 封顶: {rec['cap']:.4f}")
    else:
        logger.info("全月未发现触发封顶的记录。")

if __name__ == "__main__":
    main()
