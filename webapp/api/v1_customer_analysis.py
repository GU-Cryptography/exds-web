from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, Path, HTTPException, status, Body
from pydantic import BaseModel
import pandas as pd
import numpy as np

from webapp.tools.security import User, get_current_active_user
from webapp.services.customer_service import CustomerService
from webapp.services.load_query_service import LoadQueryService, FusionStrategy
from webapp.services.tou_service import get_tou_rule_by_date
from webapp.models.load_models import TouUsage
from webapp.tools.mongo import DATABASE

router = APIRouter()
customer_service = CustomerService(DATABASE)

# Models
# Local models
class HourlyDataPoint(BaseModel):
    time: str
    current: Optional[float]
    last_day: Optional[float]
    benchmark: Optional[float]
    period_type: str = "平段"  # TOU period type (e.g., 尖峰/高峰/平段/低谷/深谷)

class AnalysisStats(BaseModel):
    this_year_contract: float
    contract_yoy: Optional[float] = None
    last_year_total: float
    
    cumulative_usage: float
    cumulative_yoy: Optional[float] = None
    cumulative_tou: TouUsage
    cumulative_pv_ratio: float
    
    this_month_usage: float
    month_yoy: Optional[float] = None
    month_tou: TouUsage
    month_pv_ratio: float
    
    # Latest/Today stats for the general dashboard
    latest_day_total: float
    latest_day_tou: TouUsage
    latest_pv_ratio: float

class SelectedDateStats(BaseModel):
    total: float
    tou_usage: TouUsage
    peak_valley_ratio: float

class DailyViewResponse(BaseModel):
    main_curve: List[HourlyDataPoint]
    selected_date_stats: SelectedDateStats
    stats: AnalysisStats

class HistoryDataPoint(BaseModel):
    date: str  # YYYY-MM-DD or YYYY-MM
    value: float

class AutoTag(BaseModel):
    name: str
    source: str = "AUTO"
    reason: str

class AiDiagnoseResponse(BaseModel):
    auto_tags: List[AutoTag]
    summary: str

class TagOperationRequest(BaseModel):
    name: str
    source: str = "MANUAL" # MANUAL or AUTO
    reason: Optional[str] = None
    expire: Optional[str] = None

# ---- Helper ----

def _get_tou_usage(load_values: List[float], date_str: str) -> TouUsage:
    """
    Calculate TOU usage based on load values and current TOU rules.
    NOTE: This is a simplified implementation. Real implementation should fetch effective TouRule from DB.
    """
    # TODO: Fetch real TOU rules from database based on customer location/voltage etc.
    # For now, using a default mock logic or fetching from a global config if available.
    # As a placeholder, we will assume a simple rule or all flat if no rule found.
    
    # Mock result for now as TouRule fetching logic is not fully exposed in context
    # In production, use `TouRuleService` or similar.
    
    usage = TouUsage()
    # Mock distribution for demo purpose if values exist
    total = sum(v for v in load_values if v is not None)
    if total > 0:
        usage.peak = float(round(total * 0.3, 4))
        usage.flat = float(round(total * 0.4, 4))
        usage.valley = float(round(total * 0.3, 4))
        # tip/deep 0 for simple mock
    return usage

def _get_annual_contract_amount(customer_id: str, year: int) -> float:
    # Logic to fetch from retail_contracts
    start_of_year = datetime(year, 1, 1)
    end_of_year = datetime(year, 12, 31, 23, 59, 59)
    
    pipeline = [
        {
            "$match": {
                "customer_id": customer_id,
                "$or": [
                     {"purchase_start_month": {"$gte": start_of_year, "$lte": end_of_year}},
                     {"purchase_end_month": {"$gte": start_of_year, "$lte": end_of_year}}
                ]
            }
        },
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$purchasing_electricity_quantity"}
            }
        }
    ]
    result = list(DATABASE.retail_contracts.aggregate(pipeline))
    if result:
        # DB stores raw kWh. Convert to MWh (kWh / 1000).
        # This is consistent with archives (kWh / 10000 = Wan kWh) and user request (Wan kWh * 10 = MWh).
        return round(result[0]["total"] / 1000.0, 2)
        # Based on LoadAnalysis logic, usually display in MWh or consistent unit.
        # Let's assume MWh for display or whatever existing logic uses. 
        # Actually customer_service.list used / 10000, creating 'current_year_contract_amount'
        # Let's align with that -> 万kWh? Or MWh?
        # The prompt says "current year's contract electricity". 
        # Standard unit in system seems to be MWh for curves, but contract might be kWh.
        # Let's return the raw value in MWh for consistency with load curves? 
        # Load curves are MWh. 
        # If contract is kWh, / 1000 => MWh.
        
    return 0.0

def _get_annual_cumulative(customer_id: str, year: int, up_to_date: str) -> float:
    # 1. Determine start date based on contract
    start_of_year = datetime(year, 1, 1)
    end_of_year = datetime(year, 12, 31, 23, 59, 59)
    
    # Find the earliest contract overlapping with this year
    pipeline = [
        {
            "$match": {
                "customer_id": customer_id,
                "$or": [
                     {"purchase_start_month": {"$gte": start_of_year, "$lte": end_of_year}},
                     {"purchase_end_month": {"$gte": start_of_year, "$lte": end_of_year}},
                     {"$and": [
                         {"purchase_start_month": {"$lte": start_of_year}},
                         {"purchase_end_month": {"$gte": end_of_year}}
                     ]}
                ]
            }
        },
        {"$sort": {"purchase_start_month": 1}},
        {"$limit": 1}
    ]
    
    contracts = list(DATABASE.retail_contracts.aggregate(pipeline))
    calc_start_date = f"{year}-01-01" # Default to Jan 1st
    
    if contracts:
        contract = contracts[0]
        c_start = contract.get("purchase_start_month")
        if c_start:
            # If contract starts inside this year, use that date
            # If contract starts before this year, use Jan 1st
            if c_start.year == year:
                calc_start_date = c_start.strftime("%Y-%m-%d")
            # If c_start.year < year, keeps default
            
    # Call LoadQueryService to sum up daily totals
    totals = LoadQueryService.get_daily_totals(customer_id, calc_start_date, up_to_date)
    total = round(sum([t.total for t in totals]), 2) if totals else 0.0
    return total, calc_start_date

def _get_last_year_total(customer_id: str, year: int) -> float:
    """获取客户去年的全年用电量"""
    last_year = year - 1
    start_date = f"{last_year}-01-01"
    end_date = f"{last_year}-12-31"
    
    totals = LoadQueryService.get_daily_totals(customer_id, start_date, end_date)
    return round(sum([t.total for t in totals]), 2) if totals else 0.0

def _get_usage_with_tou(customer_id: str, start_date: str, end_date: str) -> tuple[float, TouUsage]:
    """获取指定区间的总电量和分时细项"""
    totals = LoadQueryService.get_daily_totals(customer_id, start_date, end_date)
    total_val = round(sum([t.total for t in totals]), 2) if totals else 0.0
    
    tou = TouUsage()
    if totals:
        for t in totals:
            if t.tou_usage:
                tou.tip += t.tou_usage.tip
                tou.peak += t.tou_usage.peak
                tou.flat += t.tou_usage.flat
                tou.valley += t.tou_usage.valley
                tou.deep += t.tou_usage.deep
    
    tou.tip = round(tou.tip, 2)
    tou.peak = round(tou.peak, 2)
    tou.flat = round(tou.flat, 2)
    tou.valley = round(tou.valley, 2)
    tou.deep = round(tou.deep, 2)
    
    return total_val, tou

def _this_calc_pv_ratio(tou: TouUsage) -> float:
    numerator = tou.tip + tou.peak
    denominator = tou.valley + tou.deep
    if denominator > 0.0001:
        return round(numerator / denominator, 2)
    return 0.0
    end_date = f"{last_year}-12-31"
    
    totals = LoadQueryService.get_daily_totals(customer_id, start_date, end_date)
    return round(sum([t.total for t in totals]), 2) if totals else 0.0

def _get_this_month_usage(customer_id: str) -> float:
    """获取客户本月（实时的）累计用电量"""
    now = datetime.now()
    start_date = now.strftime("%Y-%m-01")
    end_date = now.strftime("%Y-%m-%d")
    
    totals = LoadQueryService.get_daily_totals(customer_id, start_date, end_date)
    return round(sum([t.total for t in totals]), 2) if totals else 0.0


# ---- Endpoints ----

@router.get("/{customer_id}/daily-view", response_model=DailyViewResponse, summary="Get daily load analysis view")
async def get_daily_view(
    customer_id: str = Path(..., description="Customer ID"),
    date: str = Query(..., description="Date (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_active_user)
):
    # 1. Fetch Load Curves
    current_curve = LoadQueryService.get_daily_curve(customer_id, date)
    
    target_date_obj = datetime.strptime(date, "%Y-%m-%d")
    yesterday_str = (target_date_obj - timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday_curve = LoadQueryService.get_daily_curve(customer_id, yesterday_str)
    
    # Get TOU rules for this date
    tou_rules = get_tou_rule_by_date(target_date_obj)
    
    points = []
    # 48 points: 00:30, 01:00, ..., 24:00
    times = []
    for h in range(24):
        times.append(f"{h:02d}:30")
        times.append(f"{(h+1):02d}:00")
    
    current_values = current_curve.values if current_curve else [None] * 48
    last_day_values = yesterday_curve.values if yesterday_curve else [None] * 48
    
    for i, t in enumerate(times):
        period_type = tou_rules.get(t, "平段")
        points.append(HourlyDataPoint(
            time=t,
            current=current_values[i] if i < len(current_values) else None,
            last_day=last_day_values[i] if i < len(last_day_values) else None,
            benchmark=None,
            period_type=period_type
        ))
        
    # Selection-Dependent Stats
    selected_total = current_curve.total if current_curve else 0.0
    selected_tou = current_curve.tou_usage if current_curve and current_curve.tou_usage else TouUsage()
    selected_pv_ratio = _this_calc_pv_ratio(selected_tou)
    
    # Global/Latest Stats (Real-time today)
    real_today = datetime.now()
    real_today_str = real_today.strftime("%Y-%m-%d")
    current_year = real_today.year
    
    # Fetch Latest Day (Real today)
    latest_curve = LoadQueryService.get_daily_curve(customer_id, real_today_str)
    latest_day_total = latest_curve.total if latest_curve else 0.0
    latest_day_tou = latest_curve.tou_usage if latest_curve and latest_curve.tou_usage else TouUsage()
    latest_pv_ratio = _this_calc_pv_ratio(latest_day_tou)
    
    # 1. 本年签约量与去年总量
    this_year_contract = _get_annual_contract_amount(customer_id, current_year)
    last_year_total = _get_last_year_total(customer_id, current_year)
    
    # 2. 累计用电量与当月用电量 (Real-time context)
    cumulative_usage, this_year_start_date = _get_annual_cumulative(customer_id, current_year, real_today_str)
    this_month_usage, month_tou = _get_usage_with_tou(customer_id, real_today.strftime("%Y-%m-01"), real_today_str)
    
    # Cumulative TOU from start to today
    _, cumulative_tou = _get_usage_with_tou(customer_id, this_year_start_date, real_today_str)
    
    # 同期（去年）对比
    last_year_today_str = (real_today - timedelta(days=365)).strftime("%Y-%m-%d")
    try:
        this_year_start_dt = datetime.strptime(this_year_start_date, "%Y-%m-%d")
        last_year_start_str = f"{current_year - 1}-{this_year_start_dt.month:02d}-{this_year_start_dt.day:02d}"
        totals_last = LoadQueryService.get_daily_totals(customer_id, last_year_start_str, last_year_today_str)
        cumulative_usage_last = round(sum([t.total for t in totals_last]), 2) if totals_last else 0.0
    except:
        cumulative_usage_last = 0.0
    
    # 上年同月
    last_year_month_start = (real_today - timedelta(days=365)).strftime("%Y-%m-01")
    totals_month_last = LoadQueryService.get_daily_totals(customer_id, last_year_month_start, last_year_today_str)
    this_month_usage_last = round(sum([t.total for t in totals_month_last]), 2) if totals_month_last else 0.0
    
    # 计算同比增长率
    def calc_yoy(current: float, previous: float) -> Optional[float]:
        return round((current - previous) / previous * 100, 1) if previous > 0 else None

    contract_yoy = calc_yoy(this_year_contract, last_year_total)
    cumulative_yoy = calc_yoy(cumulative_usage, cumulative_usage_last)
    month_yoy = calc_yoy(this_month_usage, this_month_usage_last)
    
    return DailyViewResponse(
        main_curve=points,
        selected_date_stats=SelectedDateStats(
            total=selected_total,
            tou_usage=selected_tou,
            peak_valley_ratio=selected_pv_ratio
        ),
        stats=AnalysisStats(
            this_year_contract=this_year_contract,
            contract_yoy=contract_yoy,
            last_year_total=last_year_total,
            cumulative_usage=cumulative_usage,
            cumulative_yoy=cumulative_yoy,
            cumulative_tou=cumulative_tou,
            cumulative_pv_ratio=_this_calc_pv_ratio(cumulative_tou),
            this_month_usage=this_month_usage,
            month_yoy=month_yoy,
            month_tou=month_tou,
            month_pv_ratio=_this_calc_pv_ratio(month_tou),
            latest_day_total=latest_day_total,
            latest_day_tou=latest_day_tou,
            latest_pv_ratio=latest_pv_ratio
        )
    )

@router.get("/{customer_id}/history", response_model=List[HistoryDataPoint], summary="Get historical usage trend")
async def get_history_trend(
    customer_id: str = Path(..., description="Customer ID"),
    type: str = Query(..., regex="^(daily|monthly)$"),
    end_date: str = Query(..., description="End Date (YYYY-MM-DD or YYYY-MM)"),
    current_user: User = Depends(get_current_active_user)
):
    results = []
    
    if type == 'daily':
        # Last 30 days
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        start_dt = end_dt - timedelta(days=29)
        start_str = start_dt.strftime("%Y-%m-%d")
        
        totals = LoadQueryService.get_daily_totals(customer_id, start_str, end_date)
        # Fill missing dates with 0? Or just return what we have. Frontend handles gaps.
        # Better to ensure all dates are present
        
        data_map = {t.date: t.total for t in totals}
        curr = start_dt
        while curr <= end_dt:
            d_str = curr.strftime("%Y-%m-%d")
            results.append(HistoryDataPoint(date=d_str, value=data_map.get(d_str, 0.0)))
            curr += timedelta(days=1)
            
    elif type == 'monthly':
        # Last 12 months
        # end_date could be YYYY-MM-DD, take YYYY-MM
        if len(end_date) == 10:
             end_dt = datetime.strptime(end_date[:7], "%Y-%m")
        else:
             end_dt = datetime.strptime(end_date, "%Y-%m")
             
        # Logic to get last 13 months including current (to show same month last year)
        start_dt = end_dt # Start calculating back
        months_needed = 13
        
        # We need a range query. LoadQueryService.get_monthly_totals needs start_month, end_month strings
        # Calc start month
        # Simplest way: iterate 13 times back
        
        query_months = []
        curr = end_dt
        for _ in range(13):
            query_months.append(curr.strftime("%Y-%m"))
            # Prev month
            first = curr.replace(day=1)
            prev = first - timedelta(days=1)
            curr = prev.replace(day=1)
            
        query_months.reverse() # Oldest first
        start_month_str = query_months[0]
        end_month_str = query_months[-1]
        
        monthly_data = LoadQueryService.get_monthly_totals(customer_id, start_month_str, end_month_str)
        data_map = {m.month: m.total for m in monthly_data}
        
        for m_str in query_months:
             results.append(HistoryDataPoint(date=m_str, value=data_map.get(m_str, 0.0)))

    return results

@router.post("/{customer_id}/ai-diagnose", response_model=AiDiagnoseResponse, summary="Trigger AI diagnosis")
async def trigger_ai_diagnose(
    customer_id: str = Path(..., description="Customer ID"),
    date: str = Query(..., description="Analysis Date"),
    current_user: User = Depends(get_current_active_user)
):
    # Fetch recent load data (last 7 days to analyze weekly pattern and volatility)
    analysis_date = datetime.strptime(date, "%Y-%m-%d")
    start_date = (analysis_date - timedelta(days=7)).strftime("%Y-%m-%d")
    
    daily_curves = []
    # Fetch data day by day or optimize if service supports range. 
    # For simplicity, fetch 7 days.
    # Note: LoadQueryService.get_daily_curve fetches one day.
    # We might want to add range fetching to service later, but calling loop is fine for <10.
    
    curr = analysis_date - timedelta(days=7)
    days_data = [] # List of (date_obj, total_load, peak_load, min_load, values)
    
    while curr <= analysis_date:
        d_str = curr.strftime("%Y-%m-%d")
        curve = LoadQueryService.get_daily_curve(customer_id, d_str)
        if curve and curve.values:
            valid_vals = [v for v in curve.values if v is not None]
            if valid_vals:
                days_data.append({
                    "date": curr,
                    "is_weekend": curr.weekday() >= 5,
                    "total": curve.total,
                    "peak": max(valid_vals),
                    "min": min(valid_vals),
                    "values": valid_vals
                })
        curr += timedelta(days=1)
    
    auto_tags = []
    summary_parts = []
    
    if not days_data:
        return AiDiagnoseResponse(auto_tags=[], summary="数据不足，无法进行智能诊断。")

    # 1. Analyze Work Shift (Day Shift vs Continuous)
    # Check ratio of night load (00:00-08:00) vs day load
    # Assuming 48 points, 00:00-08:00 is first 16 points.
    latest_day = days_data[-1]
    if len(latest_day["values"]) == 48:
        night_load = sum(latest_day["values"][:16])
        day_load = sum(latest_day["values"][16:32]) # 08:00-16:00
        
        if day_load > 0:
            night_ratio = night_load / day_load
            if night_ratio < 0.2:
                auto_tags.append(AutoTag(name="日间单班", reason="夜间负荷显著低于日间(<20%)"))
                summary_parts.append("该客户呈现明显的日间单班制特征，夜间基本无生产负荷。")
            elif night_ratio > 0.8:
                auto_tags.append(AutoTag(name="连续生产", reason="夜间负荷与日间接近(>80%)"))
                summary_parts.append("该客户呈现连续生产特征，昼夜负荷差异较小。")
    
    # 2. Analyze Weekend Pattern
    weekend_loads = [d["total"] for d in days_data if d["is_weekend"]]
    weekday_loads = [d["total"] for d in days_data if not d["is_weekend"]]
    
    if weekend_loads and weekday_loads:
        avg_weekend = sum(weekend_loads) / len(weekend_loads)
        avg_weekday = sum(weekday_loads) / len(weekday_loads)
        
        if avg_weekday > 0:
            ratio = avg_weekend / avg_weekday
            if ratio < 0.4:
                auto_tags.append(AutoTag(name="周末双休", reason="周末负荷下降显著(<40%)"))
                summary_parts.append("周末负荷显著下降，符合双休规律。")
            elif ratio < 0.8:
                auto_tags.append(AutoTag(name="周末单休", reason="周末负荷有所下降(40%-80%)"))
                summary_parts.append("周末负荷有一定程度下降，可能为单休或部分停产。")

    # 3. Analyze Volatility (Peak/Valley)
    pv_ratios = [d["peak"] / d["min"] if d["min"] > 0 else 10.0 for d in days_data]
    avg_pv = sum(pv_ratios) / len(pv_ratios)
    
    if avg_pv < 1.5:
        auto_tags.append(AutoTag(name="负荷平稳", reason="平均峰谷差率小于1.5"))
        summary_parts.append("近期负荷曲线整体平稳，峰谷波动较小。")
    elif avg_pv > 3.0:
        auto_tags.append(AutoTag(name="波动较大", reason="平均峰谷差率大于3.0"))
        summary_parts.append("近期负荷波动较大，峰谷差显著，建议关注调节潜力。")

    # Persist tags to customer profile
    # Get current tags to avoid duplicates or update reasons?
    # Spec says "Triggers... returns auto-generated tags". 
    # Usually we save them immediately or let user confirm.
    # The requirement says "return auto-generated tags", frontend has "AI Diagnose" button.
    # We should probably SAVE them too as they are "Auto Tags".
    
    for tag in auto_tags:
        # Check if exists? customer_service.add_tag handles check logic mostly by adding set
        # But we need to use a distinct source "AUTO"
        customer_service.add_tag(customer_id, tag.dict(), "System AI")

    if not summary_parts:
        summary_parts.append("负荷特征不典型，建议积累更多数据后分析。")

    return AiDiagnoseResponse(
        auto_tags=auto_tags,
        summary=" ".join(summary_parts)
    )

@router.post("/{customer_id}/tags", summary="Add custom tag")
async def add_customer_tag(
    customer_id: str = Path(...),
    tag: TagOperationRequest = Body(...),
    current_user: User = Depends(get_current_active_user)
):
    return customer_service.add_tag(customer_id, tag.dict(), current_user.username)

@router.delete("/{customer_id}/tags/{tag_name}", summary="Remove tag")
async def remove_customer_tag(
    customer_id: str = Path(...),
    tag_name: str = Path(...),
    current_user: User = Depends(get_current_active_user)
):
    return customer_service.remove_tag(customer_id, tag_name, current_user.username)

