"""
机制电量分配 API
对应数据集：mechanism_energy_monthly
"""
import logging
import json
from datetime import datetime, timezone

from bson import json_util
from fastapi import APIRouter, File, UploadFile, Depends, HTTPException

from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["机制电量分配"])

COLLECTION = DATABASE['mechanism_energy_monthly']

def _parse_excel(content: bytes) -> dict:
    import openpyxl
    import io
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Excel 文件解析失败: {str(e)}")

    sheet = wb.active
    records = []
    month_str = None

    # 第一行需要包含 '机组类型', '机组名称', '所属售电公司', '计划电量', '计划电价', '调整系数'
    header = [cell.value for cell in sheet[1]]
    if not header or not any(header):
        raise HTTPException(status_code=400, detail="工作表为空")

    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not any(v is not None for v in row):
            continue
            
        unit_type = str(row[0]).strip() if row[0] is not None else ''
        unit_name = str(row[1]).strip() if row[1] is not None else ''
        retailer_name = str(row[2]).strip() if row[2] is not None else ''
        planned_energy = float(row[3]) if row[3] is not None else None
        planned_price = float(row[4]) if row[4] is not None else None
        adjustment_factor = float(row[5]) if row[5] is not None else None

        records.append({
            'unit_type': unit_type,
            'unit_name': unit_name,
            'retailer_name': retailer_name,
            'planned_energy': planned_energy,
            'planned_price': planned_price,
            'adjustment_factor': adjustment_factor
        })

    # 从第一行的 A1 左边或通过文件名来推断月份？
    # 既然在前端上传时已提取，但后端这里需要从文件名或内容提取？
    # 原有的 parse_excel 是从第一列读取的，但机制电量Excel是否包含月份列？
    # 重新看 user_request：没有提及月份列。通常手动录入的话可能有。
    # 我们暂且将解析移到 router 方法中，如果通过文件名解析月份或表头。
    return {'records': records}

@router.get("/mechanism-energy", summary="获取机制电量全量列表")
def list_mechanism_energy_months():
    try:
        # 机制电量可能包含 month_str 为主的旧数据
        docs = list(COLLECTION.find(
            {'month_str': {'$exists': True}},
            {'_id': 1, 'month_str': 1, 'updated_at': 1, 'period_values': 1}
        ).sort('month_str', 1))
        
        # 格式化返回值，确前端能拿到 month 和数据
        results = []
        for doc in docs:
            results.append({
                '_id': str(doc['_id']),
                'month': doc['month_str'],
                'imported_at': doc.get('updated_at', None),
                'period_values': doc.get('period_values', [])
            })
        return json.loads(json_util.dumps({'months': results}))
    except Exception as e:
        logger.error(f"list_mechanism_energy_months error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/mechanism-energy/{month}", summary="获取指定月份机制电量")
def get_mechanism_energy(month: str):
    try:
        doc = COLLECTION.find_one({'month_str': month})
        if not doc:
            raise HTTPException(status_code=404, detail=f"月份 {month} 的机制电量数据不存在")
        # 为前端显示包一层 records，便于将48点组装成表格展示
        period_values = doc.get("period_values", [])
        records = [{"period": i + 1, "value": v} for i, v in enumerate(period_values)]
        
        return json.loads(json_util.dumps({
            "month": doc.get("month_str"),
            "entity_name": doc.get("entity_name"),
            "records": records
        }))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_mechanism_energy error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/mechanism-energy/import", summary="导入机制电量明细 Excel")
async def import_mechanism_energy(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user)
):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="只支持 Excel 文件（.xlsx/.xls）")

    content = await file.read()
    import pandas as pd
    import io
    
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Excel解析失败: {str(e)}")
        
    required_cols = ['名称', '日期']
    if not all(col in df.columns for col in required_cols):
        raise HTTPException(status_code=400, detail="Excel必须包含 '名称' 和 '日期' 列")
        
    value_cols = df.columns[3:]
    if len(value_cols) != 48:
        raise HTTPException(status_code=400, detail=f"Excel应包含48个时段列，当前检测到 {len(value_cols)} 列")
        
    imported_months = []
    now = datetime.now(timezone.utc)
    
    for _, row in df.iterrows():
        entity_name = str(row['名称']).strip()
        month_raw = str(row['日期']).strip()
        
        import re
        match = re.search(r'(\d{4}-\d{2})', month_raw)
        if not match:
            continue
        month_str = match.group(1)
        
        # 提取 48 点数据
        try:
            period_values = [float(row[col]) for col in value_cols]
        except Exception as e:
            continue
            
        doc = {
            'entity_name': entity_name,
            'month_str': month_str,
            'period_values': period_values,
            'updated_at': now
        }
        
        COLLECTION.replace_one({'month_str': month_str}, doc, upsert=True)
        imported_months.append(month_str)

    if not imported_months:
        raise HTTPException(status_code=400, detail="未能从文件中读取到有效的带月份的机制电量数据")

    logger.info(f"成功导入机制电量(月份数: {len(imported_months)})，操作人：{current_user.username}")
    
    return {
        'status': 'success',
        'month': imported_months[-1], # 临时返回最后一个月份用于选中
        'count': len(imported_months),
        'imported_months': imported_months
    }

@router.delete("/mechanism-energy/{month}", summary="删除指定月份机制电量")
def delete_mechanism_energy(
    month: str,
    current_user: User = Depends(get_current_active_user)
):
    result = COLLECTION.delete_one({'month_str': month})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"月份 {month} 的数据不存在")
    return {'status': 'success', 'deleted_month': month}
