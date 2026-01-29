# -*- coding: utf-8 -*-
"""
整体负荷分析 API 路由

提供所有签约客户汇总后的负荷数据分析接口。
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Query, Depends, HTTPException

from webapp.tools.security import get_current_active_user
from webapp.services.total_load_service import TotalLoadService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/total-load",
    tags=["total-load"],
)


@router.get("/monthly", summary="获取月度电量汇总")
def get_monthly_consumption(
    start_month: str = Query("2025-01", description="起始月份 YYYY-MM"),
    end_month: str = Query("2026-12", description="结束月份 YYYY-MM")
):
    """
    获取月度电量汇总数据（聚合所有签约客户）
    
    返回:
    - month: 月份
    - consumption: 电量 (kWh)
    - consumption_wan: 电量 (万kWh)
    - is_complete: 是否完整月
    - days_count: 有数据天数
    - yoy_change: 同比变化百分比
    - tou_usage: 时段电量分解
    """
    try:
        service = TotalLoadService()
        data = service.get_monthly_consumption(start_month, end_month)
        return {"data": data}
    except Exception as e:
        logger.error(f"get_monthly_consumption failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daily", summary="获取月内日电量分布")
def get_daily_consumption(
    month: str = Query(..., description="月份 YYYY-MM")
):
    """
    获取月内日电量分布（含日期类型标注）
    
    返回:
    - month: 月份
    - days: 每日数据列表
      - date: 日期
      - consumption: 电量
      - day_type: 日期类型 (workday/weekend/holiday/adjusted_workday)
      - holiday_name: 节假日名称
      - weekday: 星期几 (0=周一)
    - avg_consumption: 日均电量
    - total_consumption: 月度总电量
    """
    try:
        service = TotalLoadService()
        data = service.get_daily_consumption(month)
        return data
    except Exception as e:
        logger.error(f"get_daily_consumption failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/curve", summary="获取日内电量曲线")
def get_intraday_curve(
    date: str = Query(..., description="日期 YYYY-MM-DD"),
    compare_type: str = Query("yesterday", description="对比类型: yesterday/last_week/last_year/workday_avg"),
    compare_dates: Optional[str] = Query(None, description="自定义对比日期，逗号分隔")
):
    """
    获取日内48点电量曲线及对比
    
    对比类型:
    - yesterday: 昨日
    - last_week: 7天前
    - last_year: 去年同期
    - workday_avg: 本月工作日均值
    - custom: 自定义日期（需提供compare_dates）
    
    返回:
    - target: 目标日数据
    - compare: 对比日数据
    - compare_list: 多日对比列表（custom模式）
    """
    try:
        compare_date_list = None
        if compare_dates:
            compare_date_list = [d.strip() for d in compare_dates.split(",")]
            compare_type = "custom"
        
        service = TotalLoadService()
        data = service.get_intraday_curve(
            date, 
            compare_type,
            compare_date_list
        )
        return data
    except Exception as e:
        logger.error(f"get_intraday_curve failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics", summary="获取统计数据")
def get_statistics(
    date: str = Query(..., description="日期 YYYY-MM-DD"),
    scope: str = Query("daily", description="统计范围: daily/monthly/yearly")
):
    """
    获取统计数据（支持当日/当月/年度）
    
    返回:
    - scope: 统计范围
    - total_consumption: 总电量 (kWh)
    - total_consumption_wan: 总电量 (万kWh)
    - period_breakdown: 时段电量分解
    - period_percentage: 时段占比
    - peak_valley_ratio: 峰谷比
    - yoy_change: 同比变化
    """
    try:
        service = TotalLoadService()
        data = service.get_statistics(date, scope)
        return data
    except Exception as e:
        logger.error(f"get_statistics failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/monthly-average", summary="获取月度均值曲线")
def get_monthly_average_curves(
    month: str = Query(..., description="月份 YYYY-MM"),
    compare_type: str = Query("none", description="对比类型: none/last_month/last_year/typical"),
    compare_month: Optional[str] = Query(None, description="自定义对比月份")
):
    """
    获取月度均值曲线（含整体、工作日、周末、节假日）及对比
    """
    try:
        service = TotalLoadService()
        data = service.get_monthly_average_curves(month, compare_type, compare_month)
        return data
    except Exception as e:
        logger.error(f"get_monthly_average_curves failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
