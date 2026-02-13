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


@router.get("/overview", response_model=ResponseModel)
async def get_settlement_overview(
    month: str = Query(..., regex=r"^\d{4}-\d{2}$", description="月份，格式 YYYY-MM"),
    version: SettlementVersion = Query(SettlementVersion.PRELIMINARY, description="结算版本"),
):
    """
    预结算总览：汇总指定月份的批发侧成本、零售侧收入，计算毛利和均价。
    """
    try:
        import calendar
        year, mon = int(month[:4]), int(month[5:7])
        _, last_day = calendar.monthrange(year, mon)
        start_date = f"{month}-01"
        end_date = f"{month}-{last_day:02d}"

        db = service.db

        # ====== 批发侧 ======
        wholesale_cursor = db.settlement_daily.find(
            {"operating_date": {"$gte": start_date, "$lte": end_date}, "version": version.value}
        ).sort("operating_date", 1)

        wholesale_by_date = {}
        for doc in wholesale_cursor:
            d = doc["operating_date"]
            wholesale_by_date[d] = {
                "volume_mwh": doc.get("real_time_volume", 0) or 0,
                "wholesale_cost": doc.get("predicted_wholesale_cost", 0) or 0,
                "deviation_recovery_fee": doc.get("deviation_recovery_fee", 0) or 0,
                "wholesale_avg_price": doc.get("predicted_wholesale_price", 0) or 0,
            }

        # ====== 零售侧（聚合全客户）======
        retail_pipeline = [
            {"$match": {"date": {"$gte": start_date, "$lte": end_date}}},
            {"$group": {
                "_id": "$date",
                "total_fee": {"$sum": "$total_fee"},
                "total_load": {"$sum": "$total_load_mwh"},
                "customer_count": {"$sum": 1},
            }},
            {"$sort": {"_id": 1}},
        ]
        retail_results = list(db.retail_settlement_daily.aggregate(retail_pipeline))
        retail_by_date = {}
        for r in retail_results:
            retail_by_date[r["_id"]] = {
                "retail_revenue": r["total_fee"] or 0,
                "retail_load": r["total_load"] or 0,
                "customer_count": r["customer_count"],
            }

        # ====== 合并日度数据 ======
        all_dates = sorted(set(list(wholesale_by_date.keys()) + list(retail_by_date.keys())))

        daily_details = []
        cumulative_profit = 0
        total_wholesale_cost = 0
        total_retail_revenue = 0
        total_volume = 0
        total_deviation_recovery = 0
        total_retail_load = 0
        max_customer_count = 0

        for d in all_dates:
            w = wholesale_by_date.get(d, {"volume_mwh": 0, "wholesale_cost": 0, "deviation_recovery_fee": 0, "wholesale_avg_price": 0})
            r = retail_by_date.get(d, {"retail_revenue": 0, "retail_load": 0, "customer_count": 0})

            retail_avg_price = round(r["retail_revenue"] / r["retail_load"], 3) if r["retail_load"] > 0 else 0
            price_spread = round(retail_avg_price - w["wholesale_avg_price"], 3)
            daily_profit = round(r["retail_revenue"] - w["wholesale_cost"], 2)
            cumulative_profit = round(cumulative_profit + daily_profit, 2)

            total_wholesale_cost += w["wholesale_cost"]
            total_retail_revenue += r["retail_revenue"]
            total_volume += w["volume_mwh"]
            total_deviation_recovery += w["deviation_recovery_fee"]
            total_retail_load += r["retail_load"]
            max_customer_count = max(max_customer_count, r["customer_count"])

            daily_details.append({
                "date": d,
                "volume_mwh": round(w["volume_mwh"], 3),
                "wholesale_cost": round(w["wholesale_cost"], 2),
                "deviation_recovery_fee": round(w["deviation_recovery_fee"], 2),
                "wholesale_avg_price": round(w["wholesale_avg_price"], 3),
                "retail_revenue": round(r["retail_revenue"], 2),
                "retail_avg_price": retail_avg_price,
                "price_spread": price_spread,
                "daily_profit": daily_profit,
                "cumulative_profit": cumulative_profit,
            })

        # ====== 汇总 ======
        wholesale_avg = round(total_wholesale_cost / total_volume, 3) if total_volume > 0 else 0
        retail_avg = round(total_retail_revenue / total_retail_load, 3) if total_retail_load > 0 else 0
        gross_profit = round(total_retail_revenue - total_wholesale_cost, 2)
        profit_margin = round(gross_profit / total_wholesale_cost * 100, 2) if total_wholesale_cost > 0 else 0

        summary = {
            "customer_count": max_customer_count,
            "settlement_start": all_dates[0] if all_dates else start_date,
            "settlement_end": all_dates[-1] if all_dates else end_date,
            "total_wholesale_cost": round(total_wholesale_cost, 2),
            "total_retail_revenue": round(total_retail_revenue, 2),
            "total_volume_mwh": round(total_volume, 3),
            "total_deviation_recovery_fee": round(total_deviation_recovery, 2),
            "wholesale_avg_price": wholesale_avg,
            "retail_avg_price": retail_avg,
            "price_spread": round(retail_avg - wholesale_avg, 3),
            "gross_profit": gross_profit,
            "profit_margin": profit_margin,
        }

        return ResponseModel(code=200, data={
            "month": month,
            "version": version.value,
            "summary": summary,
            "daily_details": daily_details,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return ResponseModel(code=500, message=str(e), data=None)
