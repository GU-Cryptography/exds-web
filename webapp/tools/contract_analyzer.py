# -*- coding: utf-8 -*-
import fitz
import re
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class ContractAnalyzer:
    """电力零售合同PDF分析工具"""
    
    def __init__(self):
        pass

    def analyze(self, pdf_content: bytes) -> Dict[str, Any]:
        """分析PDF二进制内容并提取信息"""
        try:
            doc = fitz.open(stream=pdf_content, filetype="pdf")
            full_text = ""
            pages_text = []
            for page in doc:
                text = page.get_text()
                pages_text.append(text)
                full_text += text + "\n"
            
            customer_name = self._extract_customer_name(full_text)
            short_name = self.generate_short_name(customer_name) if customer_name else None
            
            result = {
                "customer_name": customer_name,
                "customer_short_name": short_name,
                "period": self._extract_period(full_text),
                "package_name": self._extract_package_name(full_text),
                "total_electricity": self._extract_total_electricity(full_text),
                "attachment2": self._extract_attachment2(pages_text)
            }
            
            doc.close()
            return result
        except Exception as e:
            logger.exception("分析合同PDF失败")
            raise ValueError(f"分析失败: {str(e)}")

    def _extract_customer_name(self, text: str) -> Optional[str]:
        """提取甲方名称"""
        # 匹配 甲方（授权方）： 或 甲方： 允许匹配括号
        match = re.search(r"甲方（授权方）：\s*([^\n\s]+)", text)
        if not match:
            match = re.search(r"甲方：\s*([^\n\s]+)", text)
        
        if match:
            name = match.group(1).strip()
            # 移除结尾的逗号或句号等标点（如果存在）
            name = re.sub(r"[，。；]$", "", name)
            return name
        return None

    def _extract_period(self, text: str) -> Optional[str]:
        """提取套餐起止月份"""
        match = re.search(r"1\.1\s*购买套餐起止月份：\s*([^\n]+)", text)
        return match.group(1).strip() if match else None

    def _extract_package_name(self, text: str) -> Optional[str]:
        """提取套餐名称"""
        match = re.search(r"1\.2\s*套餐名称：\s*([^\n]+)", text)
        return match.group(1).strip() if match else None

    def _extract_total_electricity(self, text: str) -> Optional[float]:
        """提取代理总电量"""
        # 匹配 代理总电量：10000000.000000千瓦时
        match = re.search(r"代理总电量：\s*(\d+(?:\.\d+)?)\s*千瓦时", text)
        if match:
            return float(match.group(1))
        return None

    def _extract_attachment2(self, pages_text: List[str]) -> List[Dict[str, str]]:
        """提取附件2信息"""
        attachment2_data = []
        full_text = "\n".join(pages_text)
        
        if "附件2 户号计量点电压等级" in full_text:
            parts = full_text.split("附件2 户号计量点电压等级")
            if len(parts) > 1:
                part = parts[1]
                if "（三）签 署 页" in part:
                    part = part.split("（三）签 署 页")[0]
                
                # 模式: 13位数字 \s* \n \s* 9位数字 \s* \n \s* 交流10kV
                entries = re.findall(r"(\d{10,})\s*\n\s*(\d{8,10})\s*\n\s*([^\n]*kV)", part)
                for entry in entries:
                    attachment2_data.append({
                        "meter_id": entry[0].strip(),
                        "measuring_point": entry[1].strip(),
                        "voltage_level": entry[2].strip()
                    })
        
        return attachment2_data

    @staticmethod
    def generate_short_name(full_name: str) -> str:
        """
        根据特定规则生成客户简称: 地名(去后缀) + 核心名称的前两个字
        规则：地名为前2或3个字（如景德镇），核心为地名后（或地名移除后）的前两个字
        """
        if not full_name:
            return ""

        # 1. 定义地名列表（无后缀）
        regions = [
            '景德镇', '南昌', '九江', '赣州', '吉安', '宜春', '抚州', '上饶', 
            '萍乡', '新余', '鹰潭', '上高', '丰城', '峡江', '新干', '高安', 
            '井冈山', '宜丰', '青云谱', '江西'
        ]
        
        # 2. 预处理：移除干扰前缀
        name = re.sub(r"^(?:国网|.*?集团)", "", full_name)
        
        # 3. 查找地名
        found_region = None
        for r in sorted(regions, key=len, reverse=True):
            if r in name:
                found_region = r
                break
        
        if found_region:
            # 移除地名及其行政后缀（省、市、县、区）以及可能的括号
            pattern = re.escape(found_region) + r"[省市区县]?"
            # 同时处理带括号的情况，如 (赣州) 或 （赣州）
            name_clean = re.sub(r"[\(（]" + pattern + r"[\)）]", "", name)
            name_clean = re.sub(pattern, "", name_clean)
            
            # 移除开头的特殊字符和后缀
            name_clean = re.sub(r"^[省市区县]", "", name_clean)
            name_clean = re.sub(r"(?:股份有限公司|有限责任公司|有限公司|股份公司|分公司|公司)$", "", name_clean)
            
            # 提取核心前两个字
            core_prefix = name_clean[:2]
            return found_region + core_prefix

        # 4. 如果没匹配到已知地名，回退到取前4个字
        core_name = re.sub(r"(?:股份有限公司|有限责任公司|有限公司|股份公司|分公司|公司)$", "", name)
        return core_name[:4]
