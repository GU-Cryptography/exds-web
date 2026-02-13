from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Any
from pydantic import BaseModel
from datetime import datetime

from webapp.services.settlement_service import SettlementService
from webapp.models.settlement import SettlementDaily, SettlementVersion

router = APIRouter(prefix="/settlement", tags=["Settlement"])

service = SettlementService()

class CalculationRequest(BaseModel):
    date: str
    version: SettlementVersion = SettlementVersion.PRELIMINARY
    force: bool = False

class ResponseModel(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None

@router.post("/calculate", response_model=ResponseModel)
async def calculate_daily_settlement(req: CalculationRequest):
    """
    触发指定日期的预结算计算
    """
    try:
        # 校验日期格式
        datetime.strptime(req.date, "%Y-%m-%d")
        
        result = await service.calculate_daily_settlement(req.date, version=req.version, force=req.force)
        
        if not result:
            return ResponseModel(code=400, message="Calculation failed or data missing", data=None)
            
        return ResponseModel(code=200, message="Calculation completed", data=result)
        
    except ValueError as ve:
        return ResponseModel(code=400, message=f"Invalid date format: {ve}", data=None)
    except Exception as e:
        return ResponseModel(code=500, message=f"Internal Error: {str(e)}", data=None)

@router.get("/daily", response_model=ResponseModel)
async def get_daily_settlement(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    version: Optional[SettlementVersion] = None,
    include_details: bool = False
):
    """
    获取指定日期范围的日结算数据
    """
    try:
        # 查询数据库
        query = {
            "operating_date": {"$gte": start_date, "$lte": end_date}
        }
        if version:
            query["version"] = version
        
        cursor = service.db.settlement_daily.find(query).sort("operating_date", 1)
        
        results = []
        for doc in cursor:
            # 转换为 Pydantic 模型
            daily = SettlementDaily(**doc)
            
            # 如果不需要明细，则清空 period_details (为了减少网络传输)
            # 注意: Pydantic .dict(exclude={...}) 可能更好，但这里我们直接操作对象或字典
            if not include_details:
                # 重新构造不带明细的字典? 或者让前端处理?
                # 为了性能，后端处理。
                # 由于 SettlementDaily 字段较多，手动构造比较繁琐。
                # 简单做法: 设置为空列表 (但类型检查可能报错 if definition is List[...])
                # 或者使用 exclude
                pass
            
            results.append(daily)

        # 序列化处理
        # 如果 include_details=False, 我们在由 Pydantic 转 dict 时排除
        data_list = []
        for r in results:
            if not include_details:
                if hasattr(r, 'model_dump'): # Pydantic v2
                    d = r.model_dump(exclude={'period_details'})
                else: # Pydantic v1
                    d = r.dict(exclude={'period_details'})
            else:
                if hasattr(r, 'model_dump'):
                    d = r.model_dump()
                else:
                    d = r.dict()
            data_list.append(d)

        return ResponseModel(code=200, data=data_list)

    except Exception as e:
        return ResponseModel(code=500, message=str(e), data=[])
