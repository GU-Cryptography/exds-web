"""
Excel文件处理工具模块

用于处理交易中心平台下载的标准Excel格式文件
"""

import pandas as pd
import io
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.mongo import DATABASE
from bson import ObjectId


class ExcelImportError(Exception):
    """Excel导入自定义异常"""
    pass


class ExcelReader:
    """Excel文件读取器"""

    REQUIRED_COLUMNS = ['套餐', '购买用户', '购买电量', '购买时间-开始', '购买时间-结束']
    IGNORED_COLUMNS = ['序号', '代理销售费模型', '签章状态']

    def __init__(self):
        self.validation_errors = []

    def read_excel_file(self, file_content: bytes) -> pd.DataFrame:
        """
        读取Excel文件内容

        Args:
            file_content: Excel文件的字节内容

        Returns:
            pd.DataFrame: 解析后的数据框

        Raises:
            ExcelImportError: 文件格式或读取错误时抛出
        """
        try:
            # 使用pandas读取Excel文件
            df = pd.read_excel(io.BytesIO(file_content))
            return df
        except Exception as e:
            raise ExcelImportError(f"无法读取Excel文件：{str(e)}")

    def validate_excel_structure(self, df: pd.DataFrame) -> bool:
        """
        验证Excel文件结构

        Args:
            df: 数据框

        Returns:
            bool: 验证是否通过

        Raises:
            ExcelImportError: 结构验证失败时抛出
        """
        if df.empty:
            raise ExcelImportError("Excel文件中没有数据")

        # 检查必需列是否存在
        missing_columns = [col for col in self.REQUIRED_COLUMNS if col not in df.columns]
        if missing_columns:
            raise ExcelImportError(
                f"Excel文件缺少必需列：{', '.join(missing_columns)}。\n"
                f"必需列：{', '.join(self.REQUIRED_COLUMNS)}"
            )

        return True

    def parse_row_data(self, row: pd.Series, row_number: int) -> Dict[str, Any]:
        """
        解析单行数据

        Args:
            row: 数据框的一行
            row_number: Excel中的行号（从2开始，因为有表头）

        Returns:
            dict: 解析后的数据字典
        """
        return {
            'row_number': row_number,
            '套餐': row.get('套餐', ''),
            '购买用户': row.get('购买用户', ''),
            '购买电量': row.get('购买电量', 0),
            '购买时间-开始': row.get('购买时间-开始', ''),
            '购买时间-结束': row.get('购买时间-结束', ''),
            '序号': row.get('序号', ''),  # 忽略但保留用于错误提示
            '代理销售费模型': row.get('代理销售费模型', ''),  # 忽略但保留
            '签章状态': row.get('签章状态', '')  # 忽略但保留
        }


class DateParser:
    """日期解析器"""

    SUPPORTED_FORMATS = [
        "%Y-%m-%d",  # 2024-01-01
        "%Y-%m",     # 2024-01
        "%Y/%m/%d",  # 2024/01/01
        "%Y/%m",     # 2024/01
        "%Y年%m月",  # 2024年01月
        "%Y年%m月%d日"  # 2024年01月01日
    ]

    @classmethod
    def parse_date_field(cls, date_value, field_name: str, is_end_of_month: bool = False) -> datetime:
        """
        解析日期字段为datetime对象

        Args:
            date_value: 日期值（各种格式）
            field_name: 字段名称，用于错误提示
            is_end_of_month: 是否为结束月份（如果是，设为当月最后一天 23:59:59）

        Returns:
            datetime: 解析后的日期对象

        Raises:
            ValueError: 日期格式不正确时抛出
        """
        if pd.isna(date_value):
            raise ValueError(f"{field_name}不能为空")

        dt_obj = None

        # 如果已经是datetime对象
        if isinstance(date_value, datetime):
            dt_obj = date_value
        # 处理Excel的Timestamp对象
        elif hasattr(date_value, 'date'):
            d = date_value.date()
            if hasattr(d, 'year'):
                 dt_obj = datetime(d.year, d.month, 1)
        
        # 转换为字符串处理
        if not dt_obj:
            date_str = str(date_value).strip()
            # 尝试多种日期格式
            for fmt in cls.SUPPORTED_FORMATS:
                try:
                     parsed = datetime.strptime(date_str, fmt)
                     dt_obj = parsed
                     break
                except ValueError:
                    continue

        if not dt_obj:
             raise ValueError(f"无法解析日期格式：{date_value}，支持的格式：YYYY-MM、YYYY-MM-DD、YYYY/MM、YYYY/MM/DD")

        # 统一处理日期
        if is_end_of_month:
            from calendar import monthrange
            _, last_day = monthrange(dt_obj.year, dt_obj.month)
            return datetime(dt_obj.year, dt_obj.month, last_day, 23, 59, 59)
        else:
            return datetime(dt_obj.year, dt_obj.month, 1)


class DataValidator:
    """数据校验器"""

    def __init__(self, db):
        self.db = db

    def validate_required_fields(self, row_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        校验必填字段

        Args:
            row_data: 行数据字典

        Returns:
            list: 错误列表
        """
        errors = []
        row_number = row_data['row_number']

        # 校验套餐名称
        if not row_data['套餐'] or str(row_data['套餐']).strip() == '':
            errors.append({
                'row': row_number,
                'field': '套餐',
                'value': row_data['套餐'],
                'message': '不能为空',
                'suggestion': '请填写有效的套餐名称'
            })

        # 校验购买用户
        if not row_data['购买用户'] or str(row_data['购买用户']).strip() == '':
            errors.append({
                'row': row_number,
                'field': '购买用户',
                'value': row_data['购买用户'],
                'message': '不能为空',
                'suggestion': '请填写有效的客户名称'
            })

        # 校验购买电量
        try:
            quantity = float(row_data['购买电量'])
            if quantity <= 0:
                errors.append({
                    'row': row_number,
                    'field': '购买电量',
                    'value': row_data['购买电量'],
                    'message': '必须大于0',
                    'suggestion': '请输入大于0的数字'
                })
        except (ValueError, TypeError):
            errors.append({
                'row': row_number,
                'field': '购买电量',
                'value': row_data['购买电量'],
                'message': '格式错误，必须为数字',
                'suggestion': '请输入有效的数字，如：100000'
            })

        # 校验日期字段
        for field_name in ['购买时间-开始', '购买时间-结束']:
            try:
                if not row_data[field_name] or pd.isna(row_data[field_name]):
                    errors.append({
                        'row': row_number,
                        'field': field_name,
                        'value': row_data[field_name],
                        'message': '不能为空',
                        'suggestion': '请填写有效的日期格式（YYYY-MM或YYYY-MM-DD）'
                    })
                else:
                    DateParser.parse_date_field(row_data[field_name], field_name)
            except ValueError as e:
                errors.append({
                    'row': row_number,
                    'field': field_name,
                    'value': row_data[field_name],
                    'message': str(e),
                    'suggestion': '请使用YYYY-MM或YYYY-MM-DD格式，如2024-01或2024-01-01'
                })

        return errors

    def validate_related_data(self, row_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        校验关联数据存在性

        Args:
            row_data: 行数据字典

        Returns:
            list: 错误列表
        """
        errors = []
        row_number = row_data['row_number']

        # 校验客户存在性
        if row_data['购买用户']:
            # MODIFIED: 使用 customer_archives 集合，仅通过 user_name 精确查找
            customer = self.db.customer_archives.find_one({
                "user_name": str(row_data['购买用户']).strip()
            })

            if not customer:
                errors.append({
                    'row': row_number,
                    'field': '购买用户',
                    'value': row_data['购买用户'],
                    'message': '客户不存在',
                    'suggestion': '请检查客户名称是否正确'
                })

        # MODIFIED: 移除套餐存在性校验，因为新逻辑允许自动创建
        # if row_data['套餐']: ... (Removed)

        return errors

    def validate_business_rules(self, row_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        校验业务规则

        Args:
            row_data: 行数据字典

        Returns:
            list: 错误列表
        """
        errors = []
        row_number = row_data['row_number']

        try:
            # 解析日期
            start_date = DateParser.parse_date_field(row_data['购买时间-开始'], '购买时间-开始')
            end_date = DateParser.parse_date_field(row_data['购买时间-结束'], '购买时间-结束')

            # 校验日期逻辑
            if end_date < start_date:
                errors.append({
                    'row': row_number,
                    'field': '购电月份',
                    'value': f"{row_data['购买时间-开始']} ~ {row_data['购买时间-结束']}",
                    'message': '购电结束月份不能早于开始月份',
                    'suggestion': '请确保结束月份大于或等于开始月份'
                })

            # 校验年份一致性（不允许跨年）
            if end_date.year != start_date.year:
                errors.append({
                    'row': row_number,
                    'field': '购电月份',
                    'value': f"{row_data['购买时间-开始']} ~ {row_data['购买时间-结束']}",
                    'message': '合同不允许跨年',
                    'suggestion': f'请确保开始年份({start_date.year})与结束年份({end_date.year})一致'
                })

            # 检查时间跨度是否合理（不超过5年）
            months_diff = (end_date.year - start_date.year) * 12 + (end_date.month - start_date.month)
            if months_diff > 60:
                errors.append({
                    'row': row_number,
                    'field': '购电月份',
                    'value': f"{row_data['购买时间-开始']} ~ {row_data['购买时间-结束']}",
                    'message': '购电时间跨度不能超过5年',
                    'suggestion': '请缩短购电时间跨度'
                })

        except ValueError:
            # 日期解析错误在validate_required_fields中已经处理
            pass

        return errors

    def validate_contract_uniqueness(self, customer_id: str, start_date: datetime,
                                   end_date: datetime, row_number: int) -> List[Dict[str, Any]]:
        """
        校验合同唯一性（同一客户在相同时间段不能有重复合同）

        Args:
            customer_id: 客户ID
            start_date: 开始日期
            end_date: 结束日期
            row_number: 行号

        Returns:
            list: 错误列表
        """
        errors = []

        # 构建查询条件，检查日期重叠
        query = {
            "customer_id": customer_id,
            "$or": [
                {"purchase_start_month": {"$lte": start_date}, "purchase_end_month": {"$gte": start_date}},
                {"purchase_start_month": {"$lte": end_date}, "purchase_end_month": {"$gte": end_date}},
                {"purchase_start_month": {"$gte": start_date}, "purchase_end_month": {"$lte": end_date}},
                {"purchase_start_month": {"$lte": start_date}, "purchase_end_month": {"$gte": end_date}}
            ]
        }

        existing_contract = self.db.retail_contracts.find_one(query)

        if existing_contract:
            contract_name = existing_contract.get('contract_name', '未知合同')
            errors.append({
                'row': row_number,
                'field': '购电时间',
                'value': f"{start_date.strftime('%Y-%m')} ~ {end_date.strftime('%Y-%m')}",
                'message': f"该客户在指定时间段已存在合同（合同号：{contract_name}）",
                'suggestion': '请调整购电时间范围或选择其他客户'
            })

        return errors


class ContractDataTransformer:
    """合同数据转换器"""

    def __init__(self, db):
        self.db = db

    def transform_row_to_contract(self, row_data: Dict[str, Any], operator: str) -> Dict[str, Any]:
        """
        将Excel行数据转换为合同数据格式

        Args:
            row_data: Excel行数据
            operator: 操作人

        Returns:
            dict: 转换后的合同数据

        Raises:
            ValueError: 数据转换失败时抛出
        """
        # 1. 基础字段转换
        contract_data = {}

        contract_data['package_name'] = str(row_data['套餐']).strip()
        contract_data['customer_name'] = str(row_data['购买用户']).strip()
        contract_data['purchasing_electricity_quantity'] = float(row_data['购买电量'])

        # 2. 日期字段转换
        contract_data['purchase_start_month'] = DateParser.parse_date_field(
            row_data['购买时间-开始'], '购买时间-开始'
        )
        contract_data['purchase_end_month'] = DateParser.parse_date_field(
            row_data['购买时间-结束'], '购买时间-结束', is_end_of_month=True
        )

        # 3. 查询关联数据ID
        # 3. 查询关联数据ID
        # MODIFIED: 套餐精确匹配，不存在则自动创建
        package_name = str(row_data['套餐']).strip()
        package = self.db.retail_packages.find_one({
            "package_name": package_name
        })

        if not package:
            # 自动创建新套餐
            now = datetime.utcnow()
            new_package = {
                "package_name": package_name,
                "package_description": f"自动导入创建 - {now.strftime('%Y-%m-%d')}",
                "package_type": "non_time_based", # 默认类型
                "status": "draft",
                "is_green_power": False,
                "pricing_config": {},
                "created_by": operator,
                "created_at": now,
                "updated_by": operator,
                "updated_at": now
            }
            result = self.db.retail_packages.insert_one(new_package)
            contract_data['package_id'] = str(result.inserted_id)
        else:
            contract_data['package_id'] = str(package['_id'])

        # MODIFIED: 客户查询调整为 customer_archives 和 user_name
        customer_name = str(row_data['购买用户']).strip()
        customer = self.db.customer_archives.find_one({
            "user_name": customer_name
        })

        if not customer:
            raise ValueError(f"客户'{customer_name}'不存在")

        contract_data['customer_id'] = str(customer['_id'])

        # 4. 生成合同名称
        contract_data['contract_name'] = self._generate_contract_name(
            contract_data['customer_id'],
            contract_data['purchase_start_month']
        )

        # 5. 添加审计字段
        now = datetime.utcnow()
        contract_data.update({
            'created_by': operator,
            'created_at': now,
            'updated_by': operator,
            'updated_at': now
        })

        return contract_data

    def _generate_contract_name(self, customer_id: str, purchase_start_month: datetime) -> str:
        """
        自动生成合同名称

        Args:
            customer_id: 客户ID
            purchase_start_month: 购电开始月份

        Returns:
            str: 生成的合同名称
        """
        # 获取客户信息
        customer = self.db.customer_archives.find_one({
            "_id": ObjectId(customer_id)
        })

        if not customer:
            short_name = "客户"
        else:
            # 优先使用简称
            short_name = customer.get('short_name')
            if not short_name:
                # 使用客户名称前4个字符
                customer_name = customer.get('user_name', '')
                short_name = customer_name[:4] if customer_name else "客户"

        # 生成年月字符串
        year_month_str = purchase_start_month.strftime("%Y%m")

        return f"{short_name}{year_month_str}"