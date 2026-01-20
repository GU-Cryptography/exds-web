# -*- coding: utf-8 -*-
"""
计量点数据导入服务
提供 Excel 文件解析、格式转换、入库等功能

数据结构 (raw_mp_data):
- mp_id: 计量点ID
- date: 数据日期 (YYYY-MM-DD)
- load_values: 48点电量数组 (MWh)
- total_load: 日电量合计
- meta.customer_name: 电力用户名称
- meta.account_id: 用户号
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
RAW_MP_DATA = DATABASE['raw_mp_data']


class MpDataImportService:
    """计量点数据导入服务"""
    
    @staticmethod
    def parse_excel_file(
        file_content: bytes, 
        filename: str
    ) -> Tuple[List[Dict], List[str]]:
        """
        解析计量点数据 Excel 文件
        
        Excel 格式：
        - 电力用户名称、计量点名称、用户号、计量点ID、读数日期
        - 时段1电量 ~ 时段48电量（或24时段）
        
        Args:
            file_content: Excel 文件二进制内容
            filename: 文件名
        
        Returns:
            (数据记录列表, 错误信息列表)
        """
        errors = []
        records = []
        
        try:
            # 读取 Excel（支持 .xls 和 .xlsx）
            if filename.endswith('.xls'):
                df = pd.read_excel(BytesIO(file_content), engine='xlrd')
            else:
                df = pd.read_excel(BytesIO(file_content))
            
            if df.empty:
                errors.append("文件为空")
                return [], errors
            
            logger.info(f"读取文件: {filename}, 行数: {len(df)}, 列数: {len(df.columns)}")
            
            # 查找关键列
            mp_id_col = None
            date_col = None
            customer_name_col = None
            account_id_col = None
            total_col = None
            
            for col in df.columns:
                col_str = str(col).strip()
                if '计量点ID' in col_str or '计量点编号' in col_str:
                    mp_id_col = col
                elif '读数日期' in col_str or '数据日期' in col_str:
                    date_col = col
                elif '电力用户名称' in col_str or '用户名称' in col_str:
                    customer_name_col = col
                elif '用户号' in col_str or '用户编号' in col_str:
                    account_id_col = col
                elif col_str == '日电量合计':
                    total_col = col
            
            if mp_id_col is None:
                errors.append("未找到计量点ID列")
                return [], errors
            
            if date_col is None:
                errors.append("未找到日期列")
                return [], errors
            
            # 查找时段电量列（支持24时段或48时段）
            time_cols = []
            for col in df.columns:
                col_str = str(col).strip()
                match = re.match(r'时段(\d+)电量', col_str)
                if match:
                    period = int(match.group(1))
                    time_cols.append((col, period))
            
            time_cols.sort(key=lambda x: x[1])
            logger.info(f"识别到 {len(time_cols)} 个时段列")
            
            if not time_cols:
                errors.append("未找到时段电量列")
                return [], errors
            
            # 按行处理
            for idx, row in df.iterrows():
                try:
                    # 获取计量点ID
                    mp_id = row[mp_id_col]
                    if pd.isna(mp_id):
                        continue
                    mp_id = str(int(mp_id)) if isinstance(mp_id, float) else str(mp_id).strip()
                    
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
                            errors.append(f"行{idx+1}: 无效日期格式 {date_val}")
                            continue
                    
                    # 提取电量值
                    load_values = []
                    for col, period in time_cols:
                        val = row[col]
                        if pd.isna(val):
                            load_values.append(0)
                        else:
                            try:
                                load_values.append(float(val))
                            except:
                                load_values.append(0)
                    
                    
                    # 移除24转48点逻辑，保持原始点数
                    # if len(load_values) == 24: ...
                    
                    # 也不强制补齐到48点，允许存储24点数据
                    # while len(load_values) < 48: ...
                    
                    # 仅做最大截断，防止异常列
                    # 假设最大不超过96点
                    if len(load_values) > 96:
                        load_values = load_values[:96]
                    
                    # 计算日总电量
                    total_load = sum(load_values)
                    if total_col and not pd.isna(row[total_col]):
                        total_load = float(row[total_col])
                    
                    # 提取元数据
                    customer_name = None
                    if customer_name_col and not pd.isna(row[customer_name_col]):
                        customer_name = str(row[customer_name_col]).strip()
                    
                    account_id = None
                    if account_id_col and not pd.isna(row[account_id_col]):
                        val = row[account_id_col]
                        account_id = str(int(val)) if isinstance(val, float) else str(val).strip()
                    
                    record = {
                        "mp_id": mp_id,
                        "date": date_str,
                        "load_values": load_values,
                        "total_load": round(total_load, 4),
                        "meta": {
                            "customer_name": customer_name,
                            "account_id": account_id
                        },
                        "updated_at": datetime.utcnow()
                    }
                    records.append(record)
                    
                except Exception as e:
                    errors.append(f"行{idx+1}: 解析失败 - {str(e)}")
                    continue
            
            return records, errors
            
        except Exception as e:
            logger.error(f"解析Excel文件失败: {e}", exc_info=True)
            errors.append(f"解析失败: {str(e)}")
            return [], errors
    
    @staticmethod
    def import_records(records: List[Dict]) -> Dict:
        """
        将记录导入数据库
        
        Args:
            records: 数据记录列表
        
        Returns:
            导入结果
        """
        inserted = 0
        updated = 0
        skipped = 0
        errors = []
        
        for record in records:
            try:
                mp_id = record["mp_id"]
                date = record["date"]
                
                # 检查是否已存在
                existing = RAW_MP_DATA.find_one({
                    "mp_id": mp_id,
                    "date": date
                })
                
                if existing:
                    # 更新
                    RAW_MP_DATA.update_one(
                        {"mp_id": mp_id, "date": date},
                        {"$set": record}
                    )
                    updated += 1
                else:
                    # 新插入
                    RAW_MP_DATA.insert_one(record)
                    inserted += 1
                    
            except Exception as e:
                logger.error(f"导入记录失败: {e}")
                errors.append(f"导入 {record.get('mp_id')}@{record.get('date')} 失败: {str(e)}")
                skipped += 1
        
        return {
            "inserted": inserted,
            "updated": updated,
            "skipped": skipped,
            "errors": errors
        }
    
    @staticmethod
    def import_excel_file(file_content: bytes, filename: str) -> Dict:
        """
        导入 Excel 文件的完整流程
        
        Args:
            file_content: Excel 文件二进制内容
            filename: 文件名
        
        Returns:
            导入结果
        """
        # 解析文件
        records, parse_errors = MpDataImportService.parse_excel_file(
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
        result = MpDataImportService.import_records(records)
        result["parse_errors"] = parse_errors
        result["success"] = True
        result["total_records"] = len(records)
        result["message"] = f"成功导入 {result['inserted']} 条，更新 {result['updated']} 条"
        
        return result


# 便捷函数
import_mp_excel_file = MpDataImportService.import_excel_file
parse_mp_excel_file = MpDataImportService.parse_excel_file
