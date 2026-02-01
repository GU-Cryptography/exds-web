import logging
from fastapi import APIRouter, Query, Body, HTTPException

from webapp.tools.mongo import DATABASE
from webapp.services import pricing_model_service
from webapp.services.package_service import PackageService
from webapp.services.pricing_engine import PricingEngine

logger = logging.getLogger(__name__)

router = APIRouter(tags=["v1-pricing-model"])

@router.get("/pricing-models", summary="获取定价模型列表")
def get_pricing_models(
    package_type: str = Query(None, description="套餐类型：time_based/non_time_based"),
    enabled: bool = Query(None, description="是否启用")
):
    try:
        models = pricing_model_service.list_pricing_models(
            package_type=package_type,
            enabled=enabled
        )
        return models
    except Exception as e:
        logger.error(f"Error in get_pricing_models: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取定价模型列表时出错: {str(e)}")


@router.get("/pricing-models/{model_code}", summary="获取定价模型详情")
def get_pricing_model(model_code: str):
    try:
        model = pricing_model_service.get_pricing_model(model_code)

        if not model:
            raise HTTPException(status_code=404, detail=f"未找到模型: {model_code}")

        return model
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_pricing_model: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取定价模型详情时出错: {str(e)}")


@router.post("/pricing-models/{model_code}/validate", summary="验证定价配置")
def validate_pricing_config(model_code: str, data: dict = Body(...)):
    try:
        pricing_config = data.get("pricing_config", {})

        result = pricing_model_service.validate_pricing_config(
            model_code=model_code,
            config=pricing_config
        )

        return result
    except Exception as e:
        logger.error(f"Error in validate_pricing_config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"验证定价配置时出错: {str(e)}")

@router.post("/retail-packages/calculate-price", summary="计算套餐价格")
async def calculate_package_price(data: dict = Body(...)):
    package_id = data.get("package_id")
    date = data.get("date")
    time_period = data.get("time_period")
    volume_mwh = data.get("volume_mwh")

    service = PackageService(DATABASE)
    package = await service.get_package(package_id)
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    if package['pricing_mode'] == 'fixed_linked':
        return PricingEngine.calculate_fixed_linked_price(package, date, time_period, volume_mwh)
    elif package['pricing_mode'] == 'price_spread':
        return PricingEngine.calculate_price_spread_price(package, date, time_period, volume_mwh)
    else:
        raise HTTPException(status_code=400, detail="Invalid pricing mode")
