# -*- coding: utf-8 -*-
"""
合同PDF文件服务

提供PDF文件的存储、检索和合同记录匹配功能。
PDF文件直接存储在retail_contracts集合的pdf_binary_data字段中（参考price_sgcc实现）。
"""

import re
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from bson import ObjectId, Binary

from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)


class ContractPdfService:
    """合同PDF文件服务"""
    
    def __init__(self, database=None):
        self.db = database if database is not None else DATABASE
        self.contracts_collection = self.db.retail_contracts
    
    def _extract_year_from_description(self, description: str) -> Optional[int]:
        """
        从合同描述中提取年份
        
        例如：
        - "26年零售平台电子合同" -> 2026
        - "2026年零售合同" -> 2026
        - "25年合同" -> 2025
        
        Args:
            description: 合同描述部分
            
        Returns:
            四位数年份，如果无法提取则返回None
        """
        # 匹配两位数年份（如"26年"）
        match = re.search(r'(\d{2})年', description)
        if match:
            two_digit_year = int(match.group(1))
            # 假设20-99是2020-2099，00-19是2000-2019
            if two_digit_year >= 20:
                return 2000 + two_digit_year
            else:
                return 2000 + two_digit_year
        
        # 匹配四位数年份（如"2026年"）
        match = re.search(r'(20\d{2})年?', description)
        if match:
            return int(match.group(1))
        
        return None
    
    def match_pdf_to_contracts(self, filename: str) -> Dict[str, Any]:
        """
        从PDF文件名中提取客户名称和年份，匹配已有合同记录
        
        文件命名规范：客户名称-合同描述.pdf
        例如：富联精密科技（赣州）有限公司-26年零售平台电子合同.pdf
        
        匹配规则：
        1. 根据客户名称模糊匹配
        2. 如果描述中有年份，进一步用年份过滤（与合同开始日期年份匹配）
        3. 匹配单个且无已上传PDF -> 自动导入
        4. 匹配多个 -> 需要用户确认
        5. 匹配单个但已有PDF -> 需要用户确认是否覆盖
        
        Args:
            filename: PDF文件名
            
        Returns:
            匹配结果字典:
            {
                "matches": [...],  # 匹配到的合同列表
                "auto_import": bool,  # 是否可以自动导入
                "reason": str,  # 如果不能自动导入，说明原因
                "target_contract": {...}  # 如果可以自动导入，目标合同信息
            }
        """
        # 移除文件扩展名
        name_without_ext = filename.rsplit('.', 1)[0] if '.' in filename else filename
        
        # 分割客户名称和合同描述（取第一个'-'之前的部分作为客户名称）
        parts = name_without_ext.split('-', 1)
        customer_name = parts[0].strip() if parts else name_without_ext.strip()
        description = parts[1].strip() if len(parts) > 1 else ""
        
        if not customer_name:
            logger.warning(f"无法从文件名中提取客户名称: {filename}")
            return {
                "matches": [],
                "auto_import": False,
                "reason": "无法从文件名中提取客户名称",
                "target_contract": None
            }
        
        # 从描述中提取年份
        year_from_filename = self._extract_year_from_description(description)
        logger.info(f"从文件名 '{filename}' 提取: 客户名称='{customer_name}', 年份={year_from_filename}")
        
        # 模糊匹配合同记录
        query = {
            "customer_name": {"$regex": re.escape(customer_name), "$options": "i"}
        }
        
        contracts = list(self.contracts_collection.find(
            query,
            {
                "_id": 1,
                "contract_name": 1,
                "customer_name": 1,
                "purchase_start_month": 1,
                "purchase_end_month": 1,
                "pdf_filename": 1  # 检查是否已有PDF
            }
        ).sort("created_at", -1))
        
        # 转换为结果列表
        all_matches = []
        for contract in contracts:
            # 获取合同开始年份
            start_month = contract.get("purchase_start_month")
            contract_year = None
            if start_month:
                if isinstance(start_month, datetime):
                    contract_year = start_month.year
                elif isinstance(start_month, str):
                    try:
                        contract_year = int(start_month[:4])
                    except (ValueError, TypeError):
                        pass
            
            all_matches.append({
                "_id": str(contract["_id"]),
                "contract_name": contract.get("contract_name", ""),
                "customer_name": contract.get("customer_name", ""),
                "purchase_start_month": start_month.isoformat() if isinstance(start_month, datetime) else start_month,
                "purchase_end_month": contract.get("purchase_end_month").isoformat() if isinstance(contract.get("purchase_end_month"), datetime) else contract.get("purchase_end_month", ""),
                "has_pdf": bool(contract.get("pdf_filename")),
                "contract_year": contract_year
            })
        
        # 如果有年份信息，进一步过滤
        if year_from_filename and all_matches:
            year_filtered = [m for m in all_matches if m.get("contract_year") == year_from_filename]
            if year_filtered:
                all_matches = year_filtered
                logger.info(f"年份过滤后匹配到 {len(all_matches)} 条合同记录")
        
        logger.info(f"为客户 '{customer_name}' 最终匹配到 {len(all_matches)} 条合同记录")
        
        # 判断是否可以自动导入
        if len(all_matches) == 0:
            return {
                "matches": [],
                "auto_import": False,
                "reason": "未找到匹配的合同记录",
                "target_contract": None
            }
        elif len(all_matches) == 1:
            target = all_matches[0]
            if target["has_pdf"]:
                return {
                    "matches": all_matches,
                    "auto_import": False,
                    "reason": "该合同已上传过原件，需确认是否覆盖",
                    "target_contract": target
                }
            else:
                return {
                    "matches": all_matches,
                    "auto_import": True,
                    "reason": None,
                    "target_contract": target
                }
        else:
            return {
                "matches": all_matches,
                "auto_import": False,
                "reason": f"找到{len(all_matches)}个匹配的合同，需要选择目标合同",
                "target_contract": None
            }
    
    def save_pdf_to_contract(
        self,
        contract_id: str,
        pdf_data: bytes,
        filename: str,
        uploader: str
    ) -> bool:
        """
        保存PDF文件到指定合同记录
        
        Args:
            contract_id: 合同ID
            pdf_data: PDF文件二进制数据
            filename: 原始文件名
            uploader: 上传人用户名
            
        Returns:
            是否保存成功
        """
        try:
            object_id = ObjectId(contract_id)
        except Exception:
            logger.error(f"无效的合同ID: {contract_id}")
            return False
        
        # 检查合同是否存在
        contract = self.contracts_collection.find_one({"_id": object_id})
        if not contract:
            logger.error(f"合同不存在: {contract_id}")
            return False
        
        # 更新合同记录，保存PDF数据
        result = self.contracts_collection.update_one(
            {"_id": object_id},
            {
                "$set": {
                    "pdf_binary_data": Binary(pdf_data),
                    "pdf_filename": filename,
                    "pdf_uploaded_at": datetime.now(),
                    "pdf_uploader": uploader
                }
            }
        )
        
        if result.modified_count > 0:
            logger.info(f"PDF保存成功: 合同={contract_id}, 文件={filename}, 上传人={uploader}")
            return True
        else:
            logger.warning(f"PDF保存失败: 合同={contract_id}")
            return False
    
    def get_contract_pdf(self, contract_id: str) -> Optional[Dict[str, Any]]:
        """
        获取合同的PDF文件
        
        Args:
            contract_id: 合同ID
            
        Returns:
            包含pdf_data和pdf_filename的字典，如果不存在则返回None
        """
        try:
            object_id = ObjectId(contract_id)
        except Exception:
            logger.error(f"无效的合同ID: {contract_id}")
            return None
        
        contract = self.contracts_collection.find_one(
            {"_id": object_id},
            {"pdf_binary_data": 1, "pdf_filename": 1}
        )
        
        if not contract:
            logger.error(f"合同不存在: {contract_id}")
            return None
        
        pdf_data = contract.get("pdf_binary_data")
        if not pdf_data:
            logger.info(f"合同未上传PDF: {contract_id}")
            return None
        
        return {
            "pdf_data": bytes(pdf_data),
            "pdf_filename": contract.get("pdf_filename", f"{contract_id}.pdf")
        }
    
    def has_pdf(self, contract_id: str) -> bool:
        """
        检查合同是否已上传PDF
        
        Args:
            contract_id: 合同ID
            
        Returns:
            是否已有PDF
        """
        try:
            object_id = ObjectId(contract_id)
        except Exception:
            return False
        
        contract = self.contracts_collection.find_one(
            {"_id": object_id},
            {"pdf_filename": 1}
        )
        
        return bool(contract and contract.get("pdf_filename"))
    
    def delete_pdf(self, contract_id: str) -> bool:
        """
        删除合同的PDF文件
        
        Args:
            contract_id: 合同ID
            
        Returns:
            是否删除成功
        """
        try:
            object_id = ObjectId(contract_id)
        except Exception:
            logger.error(f"无效的合同ID: {contract_id}")
            return False
        
        result = self.contracts_collection.update_one(
            {"_id": object_id},
            {
                "$unset": {
                    "pdf_binary_data": "",
                    "pdf_filename": "",
                    "pdf_uploaded_at": "",
                    "pdf_uploader": ""
                }
            }
        )
        
        if result.modified_count > 0:
            logger.info(f"PDF删除成功: 合同={contract_id}")
            return True
        else:
            logger.warning(f"PDF删除失败或不存在: 合同={contract_id}")
            return False
