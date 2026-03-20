import logging
import json
from urllib.parse import quote
from bson import json_util
from fastapi import APIRouter, File, UploadFile, Depends, HTTPException, Response

from webapp.tools.mongo import DATABASE
from webapp.tools.security import get_current_active_user, User
from webapp.services.sgcc_price_service import sgcc_price_service
from webapp.api.dependencies.authz import require_permission

logger = logging.getLogger(__name__)


router = APIRouter(tags=["v1-sgcc-price"])
public_router = APIRouter(tags=["v1-sgcc-price-public"])

PRICE_SGCC_COLLECTION = DATABASE['price_sgcc']

@router.get("/prices/sgcc", summary="获取国网代购电价数据(分页)")
def get_sgcc_prices(page: int = 1, pageSize: int = 10):
    """
    从 price_sgcc 集合中分页获取数据文档, 并额外提供完整的图表数据。
    - **排序**: 按月份ID（_id）降序排列.
    - **分页**: 根据 page 和 pageSize 返回部分数据.
    - **投影**: 排除 `pdf_binary_data` 字段以减少响应体积.
    """
    try:
        # 获取总数
        total = PRICE_SGCC_COLLECTION.count_documents({})

        # 获取表格用的分页数据
        page_cursor = PRICE_SGCC_COLLECTION.find({}, {'pdf_binary_data': 0})
        page_cursor = page_cursor.sort('_id', -1).skip((page - 1) * pageSize).limit(pageSize)
        page_data = list(page_cursor)

        # 获取图表用的全量轻量级数据
        chart_cursor = PRICE_SGCC_COLLECTION.find(
            {},
            {
                '_id': 1, 
                'purchase_price': 1, 
                'avg_on_grid_price': 1, 
                'purchase_scale_kwh': 1
            }
        ).sort('_id', 1) # 图表数据升序
        chart_data = list(chart_cursor)

        response = {
            "total": total,
            "pageData": page_data,
            "chartData": chart_data
        }
        
        return json.loads(json_util.dumps(response))

    except Exception as e:
        logger.error(f"Error in get_sgcc_prices: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取国网代购电价数据时出错: {str(e)}")

@router.post("/prices/sgcc/import", summary="导入国网代购电PDF公告")
async def import_sgcc_price(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    _ctx = Depends(require_permission("module:basic_sgcc_price:edit")),
):
    """
    上传并解析国网代购电PDF公告，解析结果存入数据库。
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="只支持PDF文件上传")
    
    try:
        content = await file.read()
        result = sgcc_price_service.import_pdf(content, file.filename)
        if result['status'] == 'success':
            return result
        else:
            raise HTTPException(status_code=500, detail=result['message'])
    except Exception as e:
        logger.error(f"Error in import_sgcc_price: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@public_router.get("/prices/sgcc/{month}/pdf", summary="获取指定月份的国网代购电价PDF公告")
def get_sgcc_price_pdf(month: str):
    """
    根据月份ID（例如, '2024-01'）获取对应的PDF文件.
    - **查询**: 根据 `_id` 查找单个文档.
    - **返回**: 如果找到PDF，则以流式响应返回；否则返回404错误.
    """
    try:
        document = PRICE_SGCC_COLLECTION.find_one({'_id': month}, {'pdf_binary_data': 1, 'attachment_name': 1})
        if document and 'pdf_binary_data' in document and document['pdf_binary_data']:
            pdf_bytes = bytes(document['pdf_binary_data'])
            logger.debug(f"Found PDF for month {month}. Size: {len(pdf_bytes)} bytes.")
            attachment_name = document.get('attachment_name', f"sgcc_price_{month}.pdf")
            encoded_filename = quote(attachment_name)

            headers = {
                "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"
            }
            return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
        else:
            logger.warning(f"PDF not found or empty for month {month}.")
            raise HTTPException(status_code=404, detail=f"未找到月份 {month} 的PDF文件或文件为空.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_sgcc_price_pdf: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取PDF文件时出错: {str(e)}")
