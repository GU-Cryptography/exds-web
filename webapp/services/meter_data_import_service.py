# -*- coding: utf-8 -*-
"""
电表数据导入服务
提供 Excel 文件解析、格式转换、入库等功能

业务逻辑：
1. 身份识别：从文件名提取电表号，校验与文件内容一致
2. 格式兼容：支持96点/1440点格式，提取15分钟数据
3. 无条件入库：格式正确即落库，不校验档案
4. 增量去重：基于 (meter_id, date) 去重
"""

import logging
import re
import os
from datetime import datetime
from typing import List, Dict, Tuple, Optional
import pandas as pd
from io import BytesIO

from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

# 集合定义
RAW_METER_DATA = DATABASE['raw_meter_data']


class MeterDataImportService:
    """电表数据导入服务"""
    
    # 时间列格式：仅取15分钟倍数
    VALID_MINUTES = {0, 15, 30, 45}
    
    @staticmethod
    def extract_meter_id_from_filename(filename: str) -> Optional[str]:
        """
        从文件名提取电表号
        
        文件名格式示例：3630001482148066073880_2025-01.xlsx
        """
        # 尝试匹配文件名开头的数字序列
        match = re.match(r'^(\d{15,25})', os.path.basename(filename))
        if match:
            return match.group(1)
        return None
    
    @staticmethod
    def parse_excel_file(
        file_content: bytes, 
        filename: str
    ) -> Tuple[List[Dict], List[str]]:
        """
        解析 Excel 文件内容
        
        Args:
            file_content: Excel 文件二进制内容
            filename: 文件名（用于提取电表号）
        
        Returns:
            (数据记录列表, 错误信息列表)
            
        数据记录格式：
            {
                "meter_id": str,
                "date": str,  # YYYY-MM-DD
                "readings": [96个示数值],
                "meta": {...}
            }
        """
        errors = []
        records = []
        
        try:
            # 从文件名提取电表号
            meter_id_from_filename = MeterDataImportService.extract_meter_id_from_filename(filename)
            if not meter_id_from_filename:
                errors.append(f"无法从文件名提取电表号: {filename}")
                return [], errors
            
            # 读取 Excel
            df = pd.read_excel(BytesIO(file_content))
            
            if df.empty:
                errors.append("文件为空")
                return [], errors
            
            # 查找电表号列
            meter_col = None
            for col in df.columns:
                col_str = str(col).strip()
                if '电能表资产号' in col_str or '资产号' in col_str or 'meter' in col_str.lower():
                    meter_col = col
                    break
            
            if meter_col is None:
                # 尝试第一列
                meter_col = df.columns[0]
                logger.warning(f"未找到电表号列，使用第一列: {meter_col}")
            
            # 查找日期列
            date_col = None
            for col in df.columns:
                col_str = str(col).strip()
                if '数据日期' in col_str or '日期' in col_str or 'date' in col_str.lower():
                    date_col = col
                    break
            
            if date_col is None:
                errors.append("未找到日期列")
                return [], errors
            
            # 查找用户名称列
            customer_name_col = None
            for col in df.columns:
                col_str = str(col).strip()
                if '用户名称' in col_str or '客户名称' in col_str:
                    customer_name_col = col
                    break
            
            # 查找用户编号列（户号）
            account_id_col = None
            for col in df.columns:
                col_str = str(col).strip()
                if '用户编号' in col_str or '户号' in col_str:
                    account_id_col = col
                    break
            
            # 识别数据列（时间点示数）
            time_cols = []
            for col in df.columns:
                col_str = str(col).strip()
                # 匹配时间格式 HH:MM 或仅数字
                time_match = re.match(r'^(\d{1,2}):?(\d{2})$', col_str)
                if time_match:
                    hour = int(time_match.group(1))
                    minute = int(time_match.group(2))
                    if minute in MeterDataImportService.VALID_MINUTES:
                        time_cols.append((col, hour, minute))
            
            # 也支持类似 "0:15", "0:30" 这样的列名
            if not time_cols:
                for col in df.columns:
                    col_str = str(col).strip()
                    try:
                        # 尝试解析为时间
                        if ':' in col_str:
                            parts = col_str.split(':')
                            if len(parts) == 2:
                                hour = int(parts[0])
                                minute = int(parts[1])
                                if 0 <= hour <= 24 and minute in MeterDataImportService.VALID_MINUTES:
                                    time_cols.append((col, hour, minute))
                    except:
                        continue
            
            if not time_cols:
                errors.append(f"未找到有效的时间列（需要15分钟间隔）")
                return [], errors
            
            # 按时间排序
            time_cols.sort(key=lambda x: (x[1], x[2]))
            
            logger.info(f"识别到 {len(time_cols)} 个时间列")
            
            # 按日期分组处理
            for _, row in df.iterrows():
                # 获取电表号
                meter_id = str(row[meter_col]).strip()
                
                # 验证电表号一致性
                if meter_id != meter_id_from_filename:
                    # 可能是截断显示，检查是否包含
                    if meter_id_from_filename not in meter_id and meter_id not in meter_id_from_filename:
                        logger.warning(f"电表号不一致: 文件名={meter_id_from_filename}, 内容={meter_id}")
                        # 使用文件名中的电表号
                        meter_id = meter_id_from_filename
                
                # 获取日期
                date_val = row[date_col]
                if pd.isna(date_val):
                    continue
                
                if isinstance(date_val, datetime):
                    date_str = date_val.strftime("%Y-%m-%d")
                else:
                    try:
                        date_obj = pd.to_datetime(date_val)
                        date_str = date_obj.strftime("%Y-%m-%d")
                    except:
                        errors.append(f"无效日期格式: {date_val}")
                        continue
                
                # 提取示数值
                readings = []
                for col, hour, minute in time_cols:
                    val = row[col]
                    if pd.isna(val):
                        readings.append(None)
                    else:
                        try:
                            readings.append(float(val))
                        except:
                            readings.append(None)
                
                # 补齐到96点（如果不足）
                while len(readings) < 96:
                    readings.append(None)
                readings = readings[:96]
                
                # 提取元数据
                customer_name = None
                if customer_name_col and not pd.isna(row[customer_name_col]):
                    customer_name = str(row[customer_name_col]).strip()
                
                account_id = None
                if account_id_col and not pd.isna(row[account_id_col]):
                    account_id = str(row[account_id_col]).strip()
                
                record = {
                    "meter_id": meter_id,
                    "date": date_str,
                    "readings": readings,
                    "meta": {
                        "customer_name": customer_name,
                        "account_id": account_id,
                    },
                    "updated_at": datetime.utcnow()
                }
                records.append(record)
            
            # 过滤：如果 Excel 文件中某电表的最后一天数据不完整（含有 None），则放弃该行
            if records:
                # 1. 找出每个电表的最大日期
                meter_max_dates = {}
                for r in records:
                    mid = r["meter_id"]
                    d = r["date"]
                    if mid not in meter_max_dates or d > meter_max_dates[mid]:
                        meter_max_dates[mid] = d
                
                # 2. 过滤
                filtered_records = []
                skipped_count = 0
                for r in records:
                    mid = r["meter_id"]
                    is_last_day = (r["date"] == meter_max_dates.get(mid))
                    
                    if is_last_day:
                        # 检查是否有 None
                        if any(v is None for v in r["readings"]):
                            logger.warning(f"跳过不完整的最后一天数据: meter={mid}, date={r['date']}")
                            skipped_count += 1
                            continue
                    
                    filtered_records.append(r)
                
                if skipped_count > 0:
                    logger.info(f"已过滤 {skipped_count} 条不完整的末尾数据")
                records = filtered_records

            return records, errors
            
        except Exception as e:
            logger.error(f"解析Excel文件失败: {e}", exc_info=True)
            errors.append(f"解析失败: {str(e)}")
            return [], errors
    
    @staticmethod
    def import_records(records: List[Dict], overwrite: bool = False) -> Dict:
        """
        将记录导入数据库（支持覆盖模式）
        
        Args:
            records: 数据记录列表
            overwrite: 是否覆盖已存在记录
        
        Returns:
            {
                "inserted": 新插入数量,
                "updated": 更新数量,
                "skipped": 跳过数量,
                "errors": 错误列表
            }
        """
        if not records:
            return {"inserted": 0, "updated": 0, "skipped": 0, "errors": []}
        
        errors = []
        inserted = 0
        updated = 0
        skipped = 0
        
        try:
            from pymongo import ReplaceOne, InsertOne
            
            # 1. 如果是覆盖模式，使用 ReplaceOne (upsert=True)
            if overwrite:
                operations = []
                for r in records:
                    op = ReplaceOne(
                        {"meter_id": r["meter_id"], "date": r["date"]},
                        r,
                        upsert=True
                    )
                    operations.append(op)
                
                if operations:
                    try:
                        bulk_result = RAW_METER_DATA.bulk_write(operations, ordered=False)
                        # inserted_count returns only actual inserts, upserts are in upserted_count or matched_count
                        # logically: inserted + modified + upserted
                        inserted = bulk_result.inserted_count + bulk_result.upserted_count
                        updated = bulk_result.modified_count
                        # In overwrite mode, matched but not modified counts as updated for our purpose? 
                        # Or maybe just say "processed".
                        # Let's simplify: inserted = new, updated = existing overwritten
                        # Actually calculating exact 'updated' vs 'no-change' is hard with bulk_write if data is identical.
                        # But user cares that it IS there.
                        # Let's count total requests - inserted = updated (roughly)
                        total_ops = len(operations)
                        updated = total_ops - inserted
                    except Exception as e:
                        logger.error(f"Bulk write error: {e}")
                        errors.append(str(e))
                
            else:
                # 2. 如果非覆盖模式，保持原有逻辑（跳过已存在）
                # 构建所有记录的 (meter_id, date) 键
                record_keys = [(r["meter_id"], r["date"]) for r in records]
                
                # 批量查询已存在的记录
                or_conditions = [
                    {"meter_id": meter_id, "date": date}
                    for meter_id, date in record_keys
                ]
                
                existing_keys = set()
                if or_conditions:
                    batch_size = 500
                    for i in range(0, len(or_conditions), batch_size):
                        batch_conditions = or_conditions[i:i + batch_size]
                        for doc in RAW_METER_DATA.find(
                            {"$or": batch_conditions},
                            {"meter_id": 1, "date": 1}
                        ):
                            existing_keys.add((doc["meter_id"], doc["date"]))
                
                # 过滤出需要新插入的记录
                new_records = []
                for record in records:
                    key = (record["meter_id"], record["date"])
                    if key not in existing_keys:
                        new_records.append(record)
                
                skipped = len(records) - len(new_records)
                
                # 批量插入新记录
                if new_records:
                    try:
                        result = RAW_METER_DATA.insert_many(new_records, ordered=False)
                        inserted = len(result.inserted_ids)
                    except Exception as e:
                        logger.warning(f"批量插入部分失败: {e}")
                        errors.append(f"批量插入异常: {str(e)}")
                        if hasattr(e, 'details') and 'nInserted' in e.details:
                            inserted = e.details['nInserted']
            
            logger.info(f"电表数据导入完成: 模式={'覆盖' if overwrite else '跳过'}, 插入/更新 {inserted+updated}, 跳过 {skipped}")
            
            return {
                "inserted": inserted,
                "updated": updated,
                "skipped": skipped,
                "errors": errors
            }
            
        except Exception as e:
            logger.error(f"导入记录失败: {e}", exc_info=True)
            errors.append(f"导入异常: {str(e)}")
            return {
                "inserted": 0,
                "updated": 0,
                "skipped": 0,
                "errors": errors
            }
    
    @staticmethod
    def import_excel_file(file_content: bytes, filename: str, overwrite: bool = False) -> Dict:
        """
        导入 Excel 文件的完整流程
        
        Args:
            file_content: Excel 文件二进制内容
            filename: 文件名
            overwrite: 是否覆盖
        
        Returns:
            导入结果
        """
        # 解析文件
        records, parse_errors = MeterDataImportService.parse_excel_file(
            file_content, filename
        )
        
        if not records:
            return {
                "success": False,
                "message": "未解析到有效数据",
                "parse_errors": parse_errors,
                "inserted": 0,
                "updated": 0,
                "skipped": 0
            }
        
        # 导入记录
        result = MeterDataImportService.import_records(records, overwrite)
        result["parse_errors"] = parse_errors
        result["success"] = True
        result["total_records"] = len(records)
        
        msg_parts = []
        if result['inserted'] > 0: msg_parts.append(f"新增 {result['inserted']} 条")
        if result['updated'] > 0: msg_parts.append(f"更新 {result['updated']} 条")
        if result['skipped'] > 0: msg_parts.append(f"跳过 {result['skipped']} 条")
        
        result["message"] = "，".join(msg_parts) if msg_parts else "未导入任何数据"
        
        return result


# 便捷函数
import_excel_file = MeterDataImportService.import_excel_file
parse_excel_file = MeterDataImportService.parse_excel_file
