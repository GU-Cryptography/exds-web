"""
客户结算月度电量 API
对应数据集：customer_monthly_energy
"""
import logging
import json
import re
from datetime import datetime, timezone

from bson import json_util
from fastapi import APIRouter, File, UploadFile, Depends, HTTPException

from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["客户结算月度电量"])

COLLECTION = DATABASE['customer_monthly_energy']

def _normalize_mp_no(raw_value) -> str:
    """将 Excel 中的计量点号统一为字符串，避免出现 12345.0 这类展示问题。"""
    if raw_value is None:
        return ''

    text = str(raw_value).strip()
    if not text:
        return ''

    # 处理 Excel 数字转字符串后出现的小数尾巴，例如 123456.0 / 123456.00
    text = re.sub(r'^(\d+)\.0+$', r'\1', text)

    # 兜底：如果仍是数值型字符串且为整数值，转成无小数格式
    try:
        num = float(text)
        if num.is_integer():
            return str(int(num))
    except (TypeError, ValueError):
        pass

    return text

def _parse_excel_with_pandas(content: bytes) -> dict:
    import pandas as pd
    import io
    
    try:
        excel_file = pd.ExcelFile(io.BytesIO(content))
        target_sheet = None
        header_row = None
        
        # 核心字段列表
        required_cols = ['用户号', '本月电量']
        
        # 寻找包含核心字段的 sheet 和 表头行
        for sheet_name in excel_file.sheet_names:
            # 读取该 sheet 的前 20 行来寻找表头
            header_search_df = pd.read_excel(excel_file, sheet_name=sheet_name, header=None, nrows=20)
            if header_search_df.empty:
                continue
                
            for i, row in header_search_df.iterrows():
                row_values = [str(val) for val in row.values if pd.notna(val)]
                row_str = " ".join(row_values)
                # 检查是否包含关键字段
                if all(col in row_str for col in required_cols):
                    target_sheet = sheet_name
                    header_row = i
                    break
            if target_sheet:
                break
                
        if target_sheet is None:
            # 最后的兜底方案
            target_sheet = 'Sheet1' if 'Sheet1' in excel_file.sheet_names else excel_file.sheet_names[-1]
            header_row = 1
            
        df = pd.read_excel(excel_file, sheet_name=target_sheet, header=header_row)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Excel 文件解析失败或结构不兼容: {str(e)}")
        
    if df.empty:
        raise HTTPException(status_code=400, detail="工作表为空")

    # 定义列名映射（根据您提供的 Excel 列名）
    col_map = {
        'customer_no': '用户号',
        'customer_name': '代理零售用户名称',
        'mp_no': '计量点ID',
        'energy_mwh': '本月电量',
        'auth_status': '用户是否\n授权查询',
        'auth_end_date': '授权查询\n截止月份',
        'month_col': '电量月份'
    }
    
    # 动态确定列索引，如果列名不完全匹配（比如有换行符），则使用 fuzzy 匹配或位置兜底
    actual_cols = df.columns.tolist()
    
    def get_col_index(key, default_idx):
        search_target = col_map[key]
        for idx, col in enumerate(actual_cols):
            if search_target in str(col).replace('\n', ''):
                return idx
        return default_idx

    idx_no = get_col_index('customer_no', 3)
    idx_name = get_col_index('customer_name', 1)
    idx_meter = get_col_index('mp_no', 4)
    idx_energy = get_col_index('energy_mwh', 10)
    idx_status = get_col_index('auth_status', 5)
    idx_end_date = get_col_index('auth_end_date', 7)
    idx_month = get_col_index('month_col', 8)
    
    # 清理数据：去除用户号为空的行，以及包含“合计”的行
    df = df.dropna(subset=[df.columns[idx_no]])
    df = df[~df[df.columns[0]].astype(str).str.contains('合计', na=False)]
    
    records = []
    month_set = set()
    
    for _, row in df.iterrows():
        # 提取字段
        c_no = str(row.iloc[idx_no]).strip() if pd.notna(row.iloc[idx_no]) else ''
        c_name = str(row.iloc[idx_name]).strip() if pd.notna(row.iloc[idx_name]) else ''
        mp_no = _normalize_mp_no(row.iloc[idx_meter]) if pd.notna(row.iloc[idx_meter]) else ''
        
        status = str(row.iloc[idx_status]).strip() if pd.notna(row.iloc[idx_status]) else ''
        end_date = str(row.iloc[idx_end_date]).strip() if pd.notna(row.iloc[idx_end_date]) else ''
        
        val = row.iloc[idx_energy]
        energy = float(val) if pd.notna(val) and str(val).strip() != '' else 0.0
        
        # 提取月份
        r_month = str(row.iloc[idx_month]).strip() if pd.notna(row.iloc[idx_month]) else ''
        if r_month:
            month_set.add(r_month)
            
        records.append({
            'customer_no': c_no,
            'customer_name': c_name,
            'mp_no': mp_no,
            'energy_mwh': energy,
            'auth_status': status,
            'auth_end_date': end_date
        })

    if not records:
        raise HTTPException(status_code=400, detail="未提取到有效数据行（请检查 Excel 格式是否正确）")
        
    if not month_set:
        raise HTTPException(status_code=400, detail="未在数据中找到电量月份信息")
        
    extracted_month = sorted(list(month_set))[-1] # 如果有多个月，取最新一个

    return {'records': records, 'month': extracted_month}

@router.get("/customer-energy", summary="获取客户月度电量月份列表")
def list_customer_energy_months():
    try:
        docs = list(COLLECTION.find(
            {'month': {'$exists': True, '$type': 'string'}},
            {'_id': 1, 'month': 1, 'imported_at': 1, 'imported_by': 1}
        ).sort('month', -1))
        return json.loads(json_util.dumps({'months': docs}))
    except Exception as e:
        logger.error(f"list_customer_energy_months error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/customer-energy/{month}", summary="获取指定月份客户电量")
def get_customer_energy(month: str):
    try:
        doc = COLLECTION.find_one({'_id': month})
        if not doc:
            raise HTTPException(status_code=404, detail=f"月份 {month} 的客户电量数据不存在")
        return json.loads(json_util.dumps(doc))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_customer_energy error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/customer-energy/import", summary="导入客户结算月度电量 Excel")
async def import_customer_energy(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="只支持 Excel 文件（.xlsx/.xls）")

    content = await file.read()
    parsed = _parse_excel_with_pandas(content)
    
    month = parsed['month']

    now = datetime.now(timezone.utc)
    doc = {
        '_id': month,
        'month': month,
        'imported_at': now,
        'imported_by': current_user.username,
        'records': parsed['records'],
    }

    COLLECTION.replace_one({'_id': month}, doc, upsert=True)

    logger.info(f"月份 {month} 客户结算月度电量已导入，操作人：{current_user.username}")
    return {
        'status': 'success',
        'month': month,
        'count': len(parsed['records']),
    }

@router.delete("/customer-energy/{month}", summary="删除指定月份客户电量")
def delete_customer_energy(
    month: str,
    current_user: User = Depends(get_current_active_user)
):
    result = COLLECTION.delete_one({'_id': month})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"月份 {month} 的数据不存在")
    return {'status': 'success', 'deleted_month': month}
