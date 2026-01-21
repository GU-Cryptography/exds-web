import fitz  # PyMuPDF
import re
import json
import logging
import traceback
from datetime import datetime
from typing import Dict, List, Optional, Any
from webapp.tools.mongo import DATABASE

logger = logging.getLogger(__name__)

class SgccPriceService:
    @staticmethod
    def _clean_float(value: Any) -> Optional[float]:
        if value is None or not isinstance(value, str):
            return None
        cleaned_value = value.strip().replace(',', '')
        if cleaned_value in ['--', '-', '']:
            return None
        try:
            return float(cleaned_value)
        except (ValueError, TypeError):
            return None

    @classmethod
    def _parse_price_rates_table(cls, page: fitz.Page) -> List[Dict]:
        """解析核心电价表。"""
        rates = []
        tables = list(page.find_tables())
        if not tables:
            return []
        table_data = tables[0].extract()
        current_category = None
        last_agency_price, last_loss_price, last_transmission_price, last_op_cost, last_gov_fund = (None,) * 5
        
        for row in table_data:
            if row and len(row) > 1 and row[1]:
                cleaned_cell = row[1].replace('\n', '')
                if '单一制' in cleaned_cell or '两部制' in cleaned_cell:
                    current_category = cleaned_cell.strip()
            
            if not row or len(row) < 3 or not row[2] or '千伏' not in row[2]:
                continue
            
            if len(row) > 4 and cls._clean_float(row[4]) is not None:
                last_agency_price = cls._clean_float(row[4])
                last_loss_price = cls._clean_float(row[5]) if len(row) > 5 else None
                last_transmission_price = cls._clean_float(row[6]) if len(row) > 6 else None
                last_op_cost = cls._clean_float(row[7]) if len(row) > 7 else None
                last_gov_fund = cls._clean_float(row[8]) if len(row) > 8 else None
            
            rate_entry = {
                "category_type": current_category,
                "voltage_level": row[2] if len(row) > 2 else None,
                "base_price_kwh": cls._clean_float(row[3]) if len(row) > 3 else None,
                "agency_purchase_price": last_agency_price,
                "network_loss_price": last_loss_price,
                "transmission_distribution_price": last_transmission_price,
                "system_op_cost_discount": last_op_cost,
                "government_fund": last_gov_fund,
                "tou_price": {
                    "peak": cls._clean_float(row[9]) if len(row) > 9 else None,
                    "high_peak": cls._clean_float(row[10]) if len(row) > 10 else None,
                    "flat_period": cls._clean_float(row[11]) if len(row) > 11 else None,
                    "valley": cls._clean_float(row[12]) if len(row) > 12 else None,
                    "deep_valley": cls._clean_float(row[13]) if len(row) > 13 else None
                },
                "capacity_price": {
                    "by_demand_kw_month": cls._clean_float(row[14]) if len(row) > 14 else None,
                    "by_transformer_kva_month": cls._clean_float(row[15]) if len(row) > 15 else None
                }
            }
            if rate_entry['voltage_level']:
                rates.append(rate_entry)
        return rates

    @classmethod
    def _parse_composition_table(cls, page: fitz.Page) -> Dict[str, Optional[float]]:
        """解析价格构成表。"""
        tables = list(page.find_tables())
        if not tables:
            return {}
        # 寻找包含“明细”或者特定结构的表，通常是最后一页的第二个表或类似
        # 原代码逻辑是 tables[-1].extract()
        table_data = tables[-1].extract()
        data_map = {
            row[2].replace('\n', '').strip(): row[4] 
            for row in table_data 
            if row and len(row) > 4 and row[2] and row[4] and '明细' not in row[2]
        }
        return {name: cls._clean_float(val) for name, val in data_map.items()}

    @classmethod
    def import_pdf(cls, pdf_bytes: bytes, filename: str) -> Dict[str, Any]:
        """
        从内存字节流解析国网电价PDF并存入数据库。
        """
        logger.info(f"开始导入 SGCC PDF 文件: {filename}")
        
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            
            rates_page = None
            composition_page = None
            for page in doc:
                text = page.get_text()
                if "代理购电工商业用户电价表" in text:
                    rates_page = page
                if "代理购电价格信息表" in text:
                    composition_page = page

            if not rates_page:
                raise ValueError("无法在文档中找到'代理购电工商业用户电价表'")
            if not composition_page:
                raise ValueError("无法在文档中找到'代理购电价格信息表'")

            # 解析年份和月份
            match = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月', rates_page.get_text())
            if not match:
                raise ValueError("无法从文档中解析年月信息")
            year, month = match.groups()
            doc_id = f'{year}-{int(month):02d}'

            composition_map = cls._parse_composition_table(composition_page)
            key_data = {
                'purchase_scale_kwh': composition_map.get('代理工商业购电电量规模') or composition_map.get('工商业代理购电量'),
                'purchase_price': composition_map.get('代理工商业购电价格') or composition_map.get('工商业代理购电价格'),
                'avg_on_grid_price': composition_map.get('其中：当月平均上网电价') or composition_map.get('当月平均上网电价'),
                'historical_deviation_discount': composition_map.get('历史偏差电费折价') or composition_map.get('偏差电费折价'),
                'system_op_cost_discount': composition_map.get('系统运行费用折价') or composition_map.get('系统运行费用折合度电水平'),
                'network_loss_price': composition_map.get('上网环节线损电价') or composition_map.get('代理工商业上网环节线损费用折价')
            }

            full_text_for_notes = '\n'.join([p.get_text() for p in doc.pages()])
            notes_match = re.search(r'(注\s*1[\s\S]*)', full_text_for_notes)
            notes = notes_match.group(1).strip() if notes_match else ""

            full_json_data = {
                "document_title": filename,
                "province": "江西",
                "company": "国网江西省电力有限公司",
                "effective_date": f'{doc_id}-01',
                "price_rates": cls._parse_price_rates_table(rates_page),
                "price_composition": list(composition_map.items()),
                "notes": notes,
            }

            final_document = {
                "_id": doc_id,
                "source_file": filename,
                "effective_date": f'{doc_id}-01',
                **key_data,
                "full_data": full_json_data,
                "pdf_binary_data": pdf_bytes,
                "attachment_name": filename # 确保字段名与前端 interface SGCCPriceData 一致
            }

            collection = DATABASE['price_sgcc']
            result = collection.replace_one({'_id': doc_id}, final_document, upsert=True)

            if result.upserted_id:
                return {'status': 'success', 'message': f'成功新增 {doc_id} 数据', 'id': doc_id}
            else:
                return {'status': 'success', 'message': f'成功更新 {doc_id} 数据', 'id': doc_id}

        except Exception as e:
            error_msg = f"处理文件 {filename} 时出错: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {'status': 'error', 'message': error_msg}

sgcc_price_service = SgccPriceService()
