
"""
数据迁移脚本：从旧表 `meter_data` 迁移数据到新表 `raw_meter_data`

用途：
    将指定客户（目前配置为 "国网江西省电力有限公司供电服务管理中心" 等）在 2025 年 1 月 24 日之前的历史负荷数据，
    从旧结构的 `meter_data` 集合迁移到新结构的 `raw_meter_data` 集合中。

主要逻辑：
    1. 根据客户名称查找客户档案，获取其关联的所有电表（`meter_id`）。
    2. 从 `meter_data` 中查询这些电表在指定日期（`limit_date`）之前的数据。
    3. 将数据按天、按电表进行聚合。
    4. 对比新老数据：
        - 如果新表 (`raw_meter_data`) 中不存在，则插入。
        - 如果新表中已存在，则对比读数：
            - 如果读数完全一致，跳过。
            - 如果新表中有缺失值（None）而旧表有值，则填充缺失值（Update）。
            - 如果读数不一致（且非填充情况），记录冲突日志并根据配置决定是否覆盖（当前逻辑为验证模式，严重冲突会终止）。
    5. 执行批量插入或更新操作。

用法：
    直接运行脚本：
    ```bash
    python scripts/migrate_meter_data.py
    ```

注意：
    - 脚本中硬编码了 `customers` 列表和 `limit_date`，使用前需根据实际需求修改。
    - 脚本包含校验逻辑（Verify），特别是针对关键日期的数据一致性检查。
"""

import sys
import os
import logging
from datetime import datetime, timedelta
import pytz
from bson import ObjectId

# Add project root to path
sys.path.append(os.getcwd())

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from webapp.tools.mongo import DATABASE
    CUSTOMER_ARCHIVES = DATABASE['customer_archives']
    RAW_METER_DATA = DATABASE['raw_meter_data']
    METER_DATA_LEGACY = DATABASE['meter_data']
except ImportError as e:
    logger.error(f"Import failed: {e}")
    sys.exit(1)

def migrate_legacy_data():
    # Customer list
    customers = [
        "国网江西省电力有限公司供电服务管理中心"
    ]
    
    target_year = 2025
    tz_sh = pytz.timezone('Asia/Shanghai')
    
    # Filter for 2025 data before 2025-01-24 (to limit overlap)
    limit_date = datetime(2025, 1, 24)
    
    # Special dates to verify carefully
    verify_dates = ["2025-01-21", "2025-01-22", "2025-01-23"]

    from pymongo import InsertOne, ReplaceOne

    for customer_name in customers:
        logger.info(f"==================================================")
        logger.info(f"Processing Customer: {customer_name}")
        logger.info(f"==================================================")
        
        # 1. Get Customer Info
        customer = CUSTOMER_ARCHIVES.find_one({"user_name": customer_name})
        
        if not customer:
            logger.error(f"Customer {customer_name} not found!")
            continue

        customer_id = str(customer["_id"])
        account_id = "" 
        if "accounts" in customer and customer["accounts"]:
            account_id = customer["accounts"][0].get("account_id", "")

        target_meters = set()
        if "accounts" in customer:
            for acc in customer["accounts"]:
                for meter in acc.get("meters", []):
                    if "meter_id" in meter: 
                        target_meters.add(meter["meter_id"])
        
        logger.info(f"Target Customer ID: {customer_id}")
        logger.info(f"Target Meters (Asset Nos): {target_meters}")
        
        if not target_meters:
            logger.warning("No meters found for customer. Skipping.")
            continue

        # 2. Query Legacy Data
        logger.info("Step 2: Querying legacy data...")

        query = {
            "表号": {"$in": list(target_meters)},
            "日期时间": {"$lt": limit_date} 
        }
        
        legacy_cursor = METER_DATA_LEGACY.find(query)
        
        candidates = []
        count = 0
        for doc in legacy_cursor:
            count += 1
            legacy_time = doc.get("日期时间")
            meter_no = doc.get("表号")
            reading = doc.get("示数")
            
            if not legacy_time or reading is None:
                continue
                
            utc_dt = legacy_time.replace(tzinfo=pytz.utc)
            beijing_dt = utc_dt.astimezone(tz_sh)
            date_str = beijing_dt.strftime("%Y-%m-%d")
            
            candidates.append({
                "meter_id": meter_no,
                "date": date_str,
                "reading": float(reading),
                "timestamp": beijing_dt
            })
            
        logger.info(f"Found {len(candidates)} legacy records (scanned {count}).")
        
        grouped_data = {} 
        for item in candidates:
            key = (item["meter_id"], item["date"])
            if key not in grouped_data:
                grouped_data[key] = []
            grouped_data[key].append(item)
            
        # 3. Compare and Prepare Insertion
        logger.info("Step 3: Comparing with existing data...")
        
        to_insert = []
        
        for (meter_id, date_str), items in grouped_data.items():
            items.sort(key=lambda x: x["timestamp"])
            readings = [x["reading"] for x in items]
            
            existing = RAW_METER_DATA.find_one({
                "meter_id": meter_id,
                "date": date_str
            })
            
            doc_meta = {
                "customer_name": customer_name,
                "account_id": account_id,
                "source": "legacy_migration"
            }
                
            if existing:
                existing_readings = existing.get("readings", [])
                match = True
                
                # Compare logic
                if len(readings) != len(existing_readings):
                     match = False
                else:
                    for a, b in zip(readings, existing_readings):
                        if a is None and b is None: continue
                        if b is None and a is not None: continue # Allow overwrite
                        if a is None and b is not None: 
                            match = False
                            break
                        if abs(a - b) >= 0.01:
                            match = False
                            break
                
                if date_str in verify_dates:
                    logger.info(f"--- VERIFYING {date_str} for Meter {meter_id} ---")
                    logger.info(f"  Legacy: {readings[:5]}... ({len(readings)})")
                    logger.info(f"  Target: {existing_readings[:5]}... ({len(existing_readings)})")
                    logger.info(f"  MATCH: {'YES' if match else 'NO'}")
                    if not match:
                        logger.error(f"CRITICAL MISMATCH on {date_str}! Aborting.")
                        return 

                if match:
                    has_updates = False
                    if len(readings) == len(existing_readings):
                        has_updates = any(b is None and a is not None for a, b in zip(readings, existing_readings))
                    
                    if has_updates:
                        logger.info(f"UPDATE NEEDED {meter_id} on {date_str}: Filling gaps.")
                        doc = {
                            "meter_id": meter_id,
                            "date": date_str,
                            "readings": readings,
                            "meta": doc_meta,
                            "updated_at": datetime.utcnow()
                        }
                        to_insert.append({"op": "replace", "filter": {"_id": existing["_id"]}, "doc": doc})
                    else:
                        logger.debug(f"Skipping {meter_id} on {date_str}: Match.")
                else:
                    if date_str not in verify_dates:
                         logger.warning(f"CONFLICT {meter_id} on {date_str}. SKIPPING.")
            else:
                # New data
                doc = {
                    "meter_id": meter_id,
                    "date": date_str,
                    "readings": readings,
                    "meta": doc_meta,
                    "updated_at": datetime.utcnow()
                }
                to_insert.append({"op": "insert", "doc": doc})
        
        # 4. Execute Operations
        if to_insert:
            logger.info(f"Step 4: Preparing {len(to_insert)} operations for {customer_name}...")
            
            ops = []
            for item in to_insert:
                if item["op"] == "insert":
                    ops.append(InsertOne(item["doc"]))
                elif item["op"] == "replace":
                    ops.append(ReplaceOne(item["filter"], item["doc"]))
            
            if ops:
                try:
                    result = RAW_METER_DATA.bulk_write(ops)
                    logger.info(f"  Inserted: {result.inserted_count}, Modified: {result.modified_count}")
                except Exception as e:
                    logger.error(f"  Bulk write failed: {e}")
        else:
            logger.info(f"No changes needed for {customer_name}.")

if __name__ == "__main__":
    migrate_legacy_data()
