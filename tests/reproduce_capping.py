
import asyncio
import logging
from datetime import datetime
from webapp.tools.mongo import DATABASE
from webapp.services.retail_settlement_service import retail_settlement_service, RetailSettlementService

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    logger.info("开始验证日均价封顶逻辑...")
    
    # 准备测试数据
    customer_id = "TEST_CAPPING_001"
    contract_id = "TEST_CONTRACT_001"
    package_id = "TEST_PACKAGE_001"
    
    # 1. 模拟 Tip Month (7月) - 应该上浮 15%
    # 基准价 0.45416, 封顶 = 0.45416 * 1.15 = 0.522284
    date_tip = "2026-07-15"
    month_tip = "2026-07"
    
    # 2. 模拟 Non-Tip Month (5月) - 应该上浮 10%
    # 基准价 0.4, 封顶 = 0.4 * 1.1 = 0.44
    date_normal = "2026-05-15"
    month_normal = "2026-05"

    try:
        # 清理旧数据
        DATABASE["retail_contracts"].delete_many({"customer_id": customer_id})
        DATABASE["retail_packages"].delete_many({"_id": package_id})
        DATABASE["tou_rules"].delete_many({"type": "base", "months": {"$in": [7, 5]}})
        DATABASE["retail_settlement_daily"].delete_many({"customer_id": customer_id})
        DATABASE["price_sgcc"].delete_many({"_id": {"$in": [month_tip, month_normal]}})
        
        # 兼容性清理 (针对 user_load_data 和 unified_load_curve)
        DATABASE["user_load_data"].delete_many({"user_id": customer_id})
        DATABASE["unified_load_curve"].delete_many({"customer_id": customer_id})

        logger.info("清理旧数据完成")

        # ... (中间 TOU 和 SGCC 插入逻辑保持不变)
        # 插入 TOU 规则
        # 5月: 非尖峰 (全平段)
        DATABASE["tou_rules"].insert_one({
            "type": "base",
            "months": [5],
            "activation_date": datetime(2025, 1, 1),
            "timelines": ["平段"] * 96,
            "coefficients": {"平段": 1.0, "尖峰": 1.8},
        })
        # 7月: 尖峰 (含尖峰时段)
        timelines_tip = ["平段"] * 96
        timelines_tip[40:48] = ["尖峰"] * 8
        DATABASE["tou_rules"].insert_one({
            "type": "base",
            "months": [7],
            "activation_date": datetime(2025, 1, 1),
            "timelines": timelines_tip,
            "coefficients": {"平段": 1.0, "尖峰": 1.8}
        })
        
        # 插入 SGCC 价格
        DATABASE["price_sgcc"].insert_one({"_id": month_tip, "avg_on_grid_price": 0.45416})
        DATABASE["price_sgcc"].insert_one({"_id": month_normal, "avg_on_grid_price": 0.40000})

        # 插入 合同 & 套餐
        DATABASE["retail_contracts"].insert_one({
            "customer_id": customer_id,
            "customer_name": "封顶测试用户",
            "contract_name": "测试合同",
            "purchase_start_month": datetime(2026, 1, 1),
            "purchase_end_month": datetime(2026, 12, 31),
            "package_snapshot": {
                "model_code": "fixed_linked_price_time",
                "pricing_config": {
                    "fixed_price_flat": 0.8,
                    "fixed_price_peak": 0.8,
                    "fixed_price_tip": 0.8,
                    "fixed_price_valley": 0.8,
                    "fixed_price_deep_valley": 0.8,
                    "linked_ratio": 0
                }
            }
        })

        # 插入 统一负荷曲线 (支持 LoadQueryService)
        # 7月15日
        DATABASE["unified_load_curve"].insert_one({
            "customer_id": customer_id,
            "date": date_tip,
            "mp_load": {
                "values": [1.0] * 48,
                "total": 48.0,
                "mp_count": 1
            }
        })
        # 5月15日
        DATABASE["unified_load_curve"].insert_one({
            "customer_id": customer_id,
            "date": date_normal,
            "mp_load": {
                "values": [1.0] * 48,
                "total": 48.0,
                "mp_count": 1
            }
        })

        logger.info("测试数据准备完成")

        # === 测试场景 1: 尖峰月份 (7月) ===
        logger.info(f"开始计算 {date_tip} (尖峰月份)...")
        res_tip = retail_settlement_service.calculate_customer_daily(customer_id, date_tip, force=True)
        
        if res_tip:
            logger.info(f"Result Tip Month: IsCapped={res_tip.get('is_capped')}, Avg={res_tip.get('avg_price')}, Cap={res_tip.get('cap_price')}, Nominal={res_tip.get('nominal_avg_price')}")
            
            expected_cap = 0.45416 * 1.15 # 0.522284
            assert res_tip['is_capped'] == True, "应该触发封顶"
            assert abs(res_tip['cap_price'] - expected_cap) < 1e-4, f"封顶价计算错误: {res_tip['cap_price']} vs {expected_cap}"
            assert abs(res_tip['avg_price'] - expected_cap) < 1e-4, f"最终均价未压降至封顶价"
            logger.info(">>> 尖峰月份测试通过")
        else:
            logger.error("尖峰月份计算返回 None")

        # === 测试场景 2: 非尖峰月份 (5月) ===
        logger.info(f"开始计算 {date_normal} (非尖峰月份)...")
        res_norm = retail_settlement_service.calculate_customer_daily(customer_id, date_normal, force=True)
        
        if res_norm:
            logger.info(f"Result Normal Month: IsCapped={res_norm.get('is_capped')}, Avg={res_norm.get('avg_price')}, Cap={res_norm.get('cap_price')}, Nominal={res_norm.get('nominal_avg_price')}")
            
            expected_cap = 0.40000 * 1.10 # 0.44
            assert res_norm['is_capped'] == True, "应该触发封顶"
            assert abs(res_norm['cap_price'] - expected_cap) < 1e-4, f"封顶价计算错误: {res_norm['cap_price']} vs {expected_cap}"
            assert abs(res_norm['avg_price'] - expected_cap) < 1e-4, f"最终均价未压降至封顶价"
            logger.info(">>> 非尖峰月份测试通过")
        else:
            logger.error("非尖峰月份计算返回 None")
            
        # === 测试场景 3: 未触发封顶 ===
        # 修改 SGCC 价格让封顶价很高 (如 1.0)
        DATABASE["price_sgcc"].update_one(
            {"_id": month_normal},
            {"$set": {"avg_on_grid_price": 1.0}} # Cap = 1.1 > 0.8
        )
        logger.info(f"开始计算 {date_normal} (未超封顶)...")
        res_uncapped = retail_settlement_service.calculate_customer_daily(customer_id, date_normal, force=True)
         
        if res_uncapped:
             logger.info(f"Result Uncapped: IsCapped={res_uncapped.get('is_capped')}, Avg={res_uncapped.get('avg_price')}, Cap={res_uncapped.get('cap_price')}")
             assert res_uncapped['is_capped'] == False, "不应触发封顶"
             assert abs(res_uncapped['avg_price'] - 0.8) < 1e-4, "均价应保持原价"
             logger.info(">>> 未超封顶测试通过")

    except Exception as e:
        logger.error(f"测试过程中出错: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # 清理
        # DATABASE["retail_contracts"].delete_many({"customer_id": customer_id})
        pass

if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(main())
