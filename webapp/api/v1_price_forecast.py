"""
价格预测 API 路由

提供日前价格预测结果的 RESTful API 接口。
"""
from fastapi import APIRouter, Query, HTTPException, status
from typing import List, Dict, Any, Optional
from webapp.tools.mongo import DATABASE
from webapp.services.price_forecast_service import PriceForecastService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/price-forecast", tags=["Price Forecast"])

# 初始化服务
_service: Optional[PriceForecastService] = None


def get_service() -> PriceForecastService:
    """获取或创建服务实例"""
    global _service
    if _service is None:
        _service = PriceForecastService(DATABASE)
    return _service


@router.get(
    "/versions",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取预测版本列表",
    description="""
    获取指定目标日期的所有预测版本。

    返回按创建时间降序排列的版本列表，包含：
    - forecast_id: 预测批次ID
    - forecast_type: 预测类型
    - model_version: 模型版本
    - model_type: 模型类型
    - created_at: 创建时间
    """
)
async def get_versions(
    target_date: str = Query(..., description="目标日期, 格式 YYYY-MM-DD"),
    forecast_type: str = Query("d1_price", description="预测类型: d1_price")
) -> List[Dict[str, Any]]:
    """获取预测版本列表"""
    try:
        service = get_service()
        result = service.get_versions(target_date, forecast_type)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取预测版本列表失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/data",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取图表数据",
    description="""
    获取指定预测版本的图表数据，包含预测曲线和实际曲线。

    返回96个时间点的数据，每个点包含：
    - time: 时间标签 (00:15 ~ 24:00)
    - predicted_price: 预测价格
    - actual_price: 实际价格 (可能为 null)
    - confidence_80_lower: 80%置信区间下界
    - confidence_80_upper: 80%置信区间上界
    """
)
async def get_chart_data(
    forecast_id: str = Query(..., description="预测批次ID"),
    target_date: str = Query(..., description="目标日期, 格式 YYYY-MM-DD")
) -> List[Dict[str, Any]]:
    """获取图表数据"""
    try:
        service = get_service()
        result = service.get_chart_data(forecast_id, target_date)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取图表数据失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )


@router.get(
    "/accuracy",
    response_model=Optional[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="获取准确度评估",
    description="""
    获取指定预测版本的准确度评估数据。

    返回包含以下指标的评估结果：
    - wmape_accuracy: WMAPE准确率
    - mae: 平均绝对误差
    - rmse: 均方根误差
    - r2: R²决定系数
    - direction_accuracy: 方向准确率
    - period_accuracy: 分时段准确率
    - stats: 当日统计信息
    - rate_90_pass: 是否达90%准确率
    - rate_85_pass: 是否达85%准确率

    如果暂无评估数据，返回 null。
    """
)
async def get_accuracy(
    forecast_id: str = Query(..., description="预测批次ID")
) -> Optional[Dict[str, Any]]:
    """获取准确度评估"""
    try:
        service = get_service()
        result = service.get_accuracy(forecast_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"获取准确度评估失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="服务器内部错误"
        )
