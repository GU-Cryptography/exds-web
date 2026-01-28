# -*- coding: utf-8 -*-
"""
整体负荷分析服务

提供所有签约客户汇总后的负荷数据分析功能，包括：
- 月度电量汇总（含同比）
- 日电量分布（含日期类型标注）
- 日内电量曲线（含时段分解）
- 工作日均值曲线
"""

import logging
from datetime import date, datetime, timedelta
from typing import List, Dict, Optional, Any
from calendar import monthrange

from webapp.tools.mongo import DATABASE
from webapp.services.load_query_service import LoadQueryService
from webapp.services.holiday_service import get_holiday_service
from webapp.services.contract_service import ContractService
from webapp.models.load_enums import FusionStrategy
from webapp.services.tou_service import get_tou_rule_by_date

logger = logging.getLogger(__name__)

contract_service = ContractService(DATABASE)


class TotalLoadService:
    """整体负荷分析服务"""
    
    def __init__(self):
        """初始化服务，获取当前签约客户列表"""
        today = date.today()
        current_year = today.year
        current_month = today.month
        
        # 定义为: 合同覆盖当前月
        curr_month_start = f"{current_year}-{current_month:02d}-01"
        _, days_in_month = monthrange(current_year, current_month)
        curr_month_end = f"{current_year}-{current_month:02d}-{days_in_month:02d}"
            
        self._signed_customer_ids = contract_service.get_active_customers(curr_month_start, curr_month_end)
        
    def _get_comparison_date_range(self, year: int, month: int) -> tuple:
        """
        计算同期对比的日期范围 (MTD逻辑)
        
        如果目标年月是当前年月，则返回 [月初, 今天]
        否则返回 [月初, 月末]
        """
        today = date.today()
        _, days_in_month = monthrange(year, month)
        start_date = f"{year}-{month:02d}-01"
        
        if year == today.year and month == today.month:
            # 当前月：截断到今天
            end_date = today.isoformat()
        else:
            # 历史月或未来月
            end_date = f"{year}-{month:02d}-{days_in_month:02d}"
            
        return start_date, end_date

    def _get_monthly_total(self, year: int, month: int, mtd: bool = False) -> float:
        """
        获取指定月份的签约客户总电量 (基于当前签约客户)
        
        Args:
            mtd: 是否强制使用 MTD 逻辑
        """
        today = date.today()
        
        # 1. 确定日期范围
        if mtd:
            # 强制 MTD：计算去年同期的截止日
            try:
                cap_date = date(year, today.month, today.day)
                _, days_in_target_month = monthrange(year, month)
                target_end_day = min(cap_date.day, days_in_target_month)
                end_date = f"{year}-{month:02d}-{target_end_day:02d}"
            except ValueError:
                # 处理闰年 2.29
                end_date = f"{year}-{month:02d}-28"
            start_date = f"{year}-{month:02d}-01"
        else:
            # 正常逻辑
            start_date, end_date = self._get_comparison_date_range(year, month)
        
        # 2. 使用初始化时获取的客户列表 (self._signed_customer_ids)
        if not self._signed_customer_ids:
            return 0.0
            
        # 3. 聚合电量
        daily_data = LoadQueryService.aggregate_daily_totals(
            self._signed_customer_ids, start_date, end_date, FusionStrategy.MP_PRIORITY
        )
        
        return sum(d.total for d in daily_data)

    def get_monthly_consumption(
        self,
        start_month: str = "2025-01",
        end_month: str = "2026-12"
    ) -> List[Dict]:
        """
        获取月度电量汇总（聚合所有当前签约客户）
        """
        try:
            if not self._signed_customer_ids:
                return []
            
            today = date.today()
            current_year = today.year
            current_month = today.month
            
            # 2. 确定查询时间范围 (虽然入参有 start/end，但这里其实主要逻辑是 last year + current year)
            # 用户逻辑：一次性拉取 [去年1月 ~ 当前月] 的数据。
            query_start_month = f"{current_year - 1}-01"
            query_end_month = f"{current_year}-{current_month:02d}"
            
            # 3. 批量聚合查询
            monthly_totals = LoadQueryService.aggregate_monthly_totals(
                self._signed_customer_ids, query_start_month, query_end_month, FusionStrategy.MP_PRIORITY
            )
            
            # 转为字典映射
            data_map = {m.month: m for m in monthly_totals}
            
            results = []
            
            # 生成月份序列
            start_scan_date = date(current_year - 1, 1, 1)
            # 结束日期: 到当前月
            end_scan_date = date(current_year, current_month, monthrange(current_year, current_month)[1])
            
            # 迭代日期 (按月)
            curr = start_scan_date
            while curr <= end_scan_date:
                m_str = f"{curr.year}-{curr.month:02d}"
                
                # 获取数据
                mt = data_map.get(m_str)
                val = mt.total if mt else 0.0
                
                # 计算同比 (使用当前签约客户的去年数据)
                yoy_change = None
                if curr.year == current_year:
                    ly_str = f"{curr.year-1}-{curr.month:02d}"
                    ly_mt = data_map.get(ly_str)
                    if ly_mt and ly_mt.total > 0:
                        yoy_change = round((val - ly_mt.total) / ly_mt.total * 100, 1)
                
                tou_usage = {"tip": 0, "peak": 0, "flat": 0, "valley": 0, "deep": 0}
                if mt and mt.tou_usage:
                    # 将 Pydantic 对象转为 dict
                    t = mt.tou_usage
                    tou_usage = {
                        "tip": t.tip,
                        "peak": t.peak,
                        "flat": t.flat,
                        "valley": t.valley,
                        "deep": t.deep
                    }

                days_count = mt.days_count if mt else 0
                is_complete = not (curr.year == today.year and curr.month == today.month)
                
                results.append({
                    "month": m_str,
                    "consumption": round(val, 2),
                    "consumption_wan": round(val / 10000, 4),
                    "is_complete": is_complete,
                    "days_count": days_count,
                    "yoy_change": yoy_change,
                    "tou_usage": tou_usage
                })
                
                # 下个月
                if curr.month == 12:
                    curr = date(curr.year + 1, 1, 1)
                else:
                    curr = date(curr.year, curr.month + 1, 1)
            
            return results
            
        except Exception as e:
            logger.error(f"get_monthly_consumption failed: {e}", exc_info=True)
            return []

    def get_daily_consumption(self, month: str) -> List[Dict]:
        """
        获取月内日电量分布（基于当前签约客户）
        """
        try:
            # 1. 解析目标月份
            target_year, target_mon = map(int, month.split("-"))
            _, days_in_month = monthrange(target_year, target_mon)
            
            start_date = f"{month}-01"
            end_date = f"{month}-{days_in_month:02d}"
            
            # 2. 使用当前签约客户
            if self._signed_customer_ids:
                daily_data = LoadQueryService.aggregate_daily_totals(
                    self._signed_customer_ids, start_date, end_date, FusionStrategy.MP_PRIORITY
                )
            else:
                daily_data = []
            
            daily_map = {d.date: d for d in daily_data}
            
            # 统计汇总
            total_consumption = sum(d.total for d in daily_data)
            avg_consumption = total_consumption / len(daily_data) if daily_data else 0
            
            # 4. 构建结果（补全每一天）
            holiday_service = get_holiday_service()
            results = []
            
            today = date.today()
            
            for day in range(1, days_in_month + 1):
                date_str = f"{month}-{day:02d}"
                d = date(target_year, target_mon, day)
                
                day_info = holiday_service.get_day_info(d)
                
                consumption = 0.0
                tou_usage = None
                
                # 只显示到今天的数据 (如果是当前月)
                is_future = (d > today)
                
                if not is_future:
                    if date_str in daily_map:
                        item = daily_map[date_str]
                        consumption = round(item.total, 2)
                        
                        # 提取 TOU
                        if item.tou_usage:
                            t = item.tou_usage
                            t_dict = t.dict() if hasattr(t, 'dict') else (t if isinstance(t, dict) else t.__dict__)
                            tou_usage = {
                                "tip": t_dict.get("tip", 0),
                                "peak": t_dict.get("peak", 0),
                                "flat": t_dict.get("flat", 0),
                                "valley": t_dict.get("valley", 0),
                                "deep": t_dict.get("deep", 0)
                            }
                        else:
                            tou_usage = {"tip": 0, "peak": 0, "flat": consumption, "valley": 0, "deep": 0}
                    else:
                        consumption = 0.0
                        tou_usage = {"tip": 0, "peak": 0, "flat": 0, "valley": 0, "deep": 0}
                else:
                     consumption = None # 未来时间显示 None
                     tou_usage = None
                
                results.append({
                    "date": date_str,
                    "consumption": consumption,
                    "day_type": day_info["day_type"],
                    "holiday_name": day_info["holiday_name"],
                    "weekday": day_info["weekday"],
                    "tou_usage": tou_usage
                })
            
            return {
                "month": month,
                "days": results,
                "avg_consumption": round(avg_consumption, 2),
                "total_consumption": round(total_consumption, 2)
            }
            
        except Exception as e:
            logger.error(f"get_daily_consumption failed: {e}", exc_info=True)
            return {"month": month, "days": [], "avg_consumption": 0, "total_consumption": 0}

    def get_intraday_curve(
        self,
        target_date: str,
        compare_type: str = "yesterday",
        compare_dates: List[str] = None
    ) -> Dict:
        """获取日内电量曲线及对比"""
        try:
            target = date.fromisoformat(target_date)
            target_month = target_date[:7]
            
            # 使用 self._signed_customer_ids (统一基于当前签约客户)
            
            target_curves = LoadQueryService.aggregate_curve_series(
                self._signed_customer_ids, target_date, target_date, FusionStrategy.MP_PRIORITY
            )
            
            target_data = None
            if target_curves:
                curve = target_curves[0]
                target_data = self._format_curve_data(curve, target_date)
            
            compare_data = None
            compare_list = None
            
            if compare_type == "yesterday":
                compare_date = (target - timedelta(days=1)).isoformat()
                compare_data = self._get_single_curve(compare_date)
            
            elif compare_type == "last_week":
                compare_date = (target - timedelta(days=7)).isoformat()
                compare_data = self._get_single_curve(compare_date)
            
            elif compare_type == "last_year":
                compare_date = f"{target.year-1}-{target.month:02d}-{target.day:02d}"
                # 使用当前签约客户去查去年数据
                compare_data = self._get_single_curve(compare_date)
            
            elif compare_type == "workday_avg":
                compare_data = self._get_workday_avg_curve(target_month)
            
            elif compare_type == "custom" and compare_dates:
                compare_list = []
                for cdate in compare_dates[:7]:
                    cdata = self._get_single_curve(cdate)
                    if cdata:
                        compare_list.append(cdata)
            
            return {
                "target": target_data,
                "compare": compare_data,
                "compare_list": compare_list,
                "compare_type": compare_type
            }
            
        except Exception as e:
            logger.error(f"get_intraday_curve failed: {e}", exc_info=True)
            return {"target": None, "compare": None, "compare_list": None, "compare_type": compare_type}

    def _get_single_curve(self, date_str: str) -> Optional[Dict]:
        """获取单日聚合曲线"""
        try:
            curves = LoadQueryService.aggregate_curve_series(
                self._signed_customer_ids, date_str, date_str, FusionStrategy.MP_PRIORITY
            )
            if curves:
                return self._format_curve_data(curves[0], date_str)
            return None
        except:
            return None



    def _format_curve_data(self, curve, date_str: str) -> Dict:
        """格式化曲线数据 (支持 48点/96点)"""
        points = []
        values = curve.values if curve.values else []
        n_points = len(values)
        
        # 获取当日的分时规则
        try:
            # 统一转为 datetime 对象调用 (v1_customer_analysis 使用的是 datetime)
            if isinstance(date_str, str):
                d_obj = datetime.strptime(date_str, "%Y-%m-%d")
            else:
                d_obj = datetime.combine(date_str, datetime.min.time())
                
            tou_map = get_tou_rule_by_date(d_obj)
        except Exception as e:
            logger.error(f"Failed to load TOU rule: {e}")
            tou_map = {}

        # 默认为 48点 (30分钟间隔)
        interval_minutes = 30
        start_minutes = 30 # 00:30 开始
        
        if n_points == 96:
            interval_minutes = 15
            start_minutes = 15 # 00:15 开始
        elif n_points == 0:
            # 无数据，生成空模版 (48点)
            n_points = 48
            values = [0] * 48
            
        for i in range(n_points):
            val = values[i] if i < len(values) else 0
            
            # 计算当前点的总分钟数 (从 00:00 开始)
            # 48点: i=0 -> 30min (00:30); i=47 -> 1440min (24:00)
            # 96点: i=0 -> 15min (00:15); i=95 -> 1440min (24:00)
            current_minutes = start_minutes + i * interval_minutes
            
            hour = current_minutes // 60
            minute = current_minutes % 60
            
            # 构造时间字符串
            if current_minutes >= 1440: # 24:00
                time_str = "24:00"
                # 24:00 取 23:45 规则 (或前一刻规则)
                # get_tou_rule_by_date 返回的 key 通常是 00:00 ~ 23:45
                period_key = "23:45"
            else:
                time_str = f"{hour:02d}:{minute:02d}"
                period_key = time_str
            
            # 查找时段类型
            if period_key in tou_map:
                period_type = tou_map[period_key]
            else:
                # 尝试稍微前推 (例如 24:00 -> 23:45 已处理，这里兜底)
                period_type = "平段"
            
            points.append({
                "time": time_str,
                "consumption": round(val, 2) if val is not None else 0,
                "period_type": period_type
            })
        
        period_breakdown = {}
        if curve.tou_usage:
            tou = curve.tou_usage
            if isinstance(tou, dict):
                period_breakdown = {
                    "尖峰": round(tou.get("tip", 0), 2),
                    "高峰": round(tou.get("peak", 0), 2),
                    "平段": round(tou.get("flat", 0), 2),
                    "低谷": round(tou.get("valley", 0), 2),
                    "深谷": round(tou.get("deep", 0), 2)
                }
        
        return {
            "date": date_str,
            "points": points,
            "total": round(curve.total, 2) if curve.total else 0,
            "period_breakdown": period_breakdown
        }

    def _get_workday_avg_curve(self, month: str) -> Optional[Dict]:
        """获取月度工作日均值曲线"""
        try:
            year, mon = map(int, month.split("-"))
            _, days_in_month = monthrange(year, mon)
            
            holiday_service = get_holiday_service()
            workdays = []
            for day in range(1, days_in_month + 1):
                d = date(year, mon, day)
                if d > date.today():
                    break
                if holiday_service.is_workday(d):
                    workdays.append(d.isoformat())
            
            if not workdays:
                return None
            
            curves = LoadQueryService.aggregate_curve_series(
                self._signed_customer_ids, workdays[0], workdays[-1], FusionStrategy.MP_PRIORITY
            )
            workday_curves = [c for c in curves if c.date in workdays]
            
            if not workday_curves:
                return None
            
            n = len(workday_curves)
            avg_values = []
            if workday_curves:
                value_len = len(workday_curves[0].values) if workday_curves[0].values else 48
                for i in range(value_len):
                    total = sum(c.values[i] if c.values and i < len(c.values) else 0 for c in workday_curves)
                    avg_values.append(round(total / n, 2))
            
            avg_total = sum(avg_values) if avg_values else 0
            
            avg_tou = {"tip": 0, "peak": 0, "flat": 0, "valley": 0, "deep": 0}
            for c in workday_curves:
                if c.tou_usage:
                    tou = c.tou_usage if isinstance(c.tou_usage, dict) else {}
                    for k in avg_tou:
                        avg_tou[k] += tou.get(k, 0)
            avg_tou = {k: round(v / n, 2) for k, v in avg_tou.items()}
            
            points = []
            for i, val in enumerate(avg_values):
                hour = (i + 1) // 2
                minute = 30 if (i + 1) % 2 == 1 else 0
                time_str = f"{hour:02d}:{minute:02d}" if hour < 24 else "24:00"
                points.append({
                    "time": time_str,
                    "consumption": val,
                    "period_type": "平段"
                })
            
            return {
                "date": f"{month} 工作日均值",
                "points": points,
                "total": round(avg_total, 2),
                "period_breakdown": {
                    "尖峰": avg_tou["tip"],
                    "高峰": avg_tou["peak"],
                    "平段": avg_tou["flat"],
                    "低谷": avg_tou["valley"],
                    "深谷": avg_tou["deep"]
                },
                "is_average": True,
                "workday_count": n
            }
        except Exception as e:
            logger.error(f"_get_workday_avg_curve failed: {e}", exc_info=True)
            return None

    def get_statistics(
        self,
        target_date: str,
        scope: str = "daily"
    ) -> Dict:
        """获取统计数据"""
        try:
            target = date.fromisoformat(target_date)
            year, mon = target.year, target.month
            
            # 使用 self._signed_customer_ids
            
            data = None
            yoy_change = None
            
            if scope == "daily":
                curves = LoadQueryService.aggregate_curve_series(
                    self._signed_customer_ids, target_date, target_date, FusionStrategy.MP_PRIORITY
                )
                if curves:
                    data = curves[0]
                    # 日同比 (vs 去年同日, 使用当前签约客户!)
                    ly_date = date(year - 1, mon, target.day).isoformat()
                    ly_curves = LoadQueryService.aggregate_curve_series(
                        self._signed_customer_ids, ly_date, ly_date, FusionStrategy.MP_PRIORITY
                    )
                    if ly_curves and ly_curves[0].total > 0:
                         yoy_change = round((data.total - ly_curves[0].total) / ly_curves[0].total * 100, 1)
            
            elif scope == "monthly":
                month_str = target_date[:7]
                monthly = LoadQueryService.aggregate_monthly_totals(
                    self._signed_customer_ids, month_str, month_str, FusionStrategy.MP_PRIORITY
                )
                if monthly:
                    data = monthly[0]
                    # 月同比 (使用 MTD 逻辑, 使用当前签约客户)
                    is_current = (year == date.today().year and mon == date.today().month)
                    current_val = self._get_monthly_total(year, mon, mtd=False)
                    last_year_val = self._get_monthly_total(year - 1, mon, mtd=is_current)
                    if last_year_val > 0:
                        yoy_change = round((current_val - last_year_val) / last_year_val * 100, 1)
            
            elif scope == "yearly":
                # 年累计
                is_current_year = (year == date.today().year)
                
                # 计算今年累计 (YTD)
                current_total = 0.0
                tou_agg = {"tip": 0, "peak": 0, "flat": 0, "valley": 0, "deep": 0}
                
                end_m = date.today().month if is_current_year else 12
                
                for m in range(1, end_m + 1):
                    val = self._get_monthly_total(year, m, mtd=False)
                    current_total += val
                    
                    # 累加 TOU (近似值，查一次 aggregate_monthly)
                    m_data = LoadQueryService.aggregate_monthly_totals(
                        self._signed_customer_ids, 
                        f"{year}-{m:02d}", 
                        f"{year}-{m:02d}", 
                        FusionStrategy.MP_PRIORITY
                    )
                    if m_data and m_data[0].tou_usage:
                        t = m_data[0].tou_usage
                        t_dict = t.dict() if hasattr(t, 'dict') else (t if isinstance(t, dict) else t.__dict__)
                        for k in tou_agg:
                             tou_agg[k] += t_dict.get(k, 0)

                # 构造返回对象
                class YearlyObj: pass
                data = YearlyObj()
                data.total = current_total
                data.tou_usage = tou_agg
                
                # 计算去年同期 YTD (使用当前签约客户)
                last_year_total = 0.0
                for m in range(1, end_m + 1):
                    force_mtd = (is_current_year and m == end_m)
                    val = self._get_monthly_total(year - 1, m, mtd=force_mtd)
                    last_year_total += val
                
                if last_year_total > 0:
                    yoy_change = round((current_total - last_year_total) / last_year_total * 100, 1)

            if not data:
                return self._empty_stats(scope)
            
            result = self._calc_stats(data, scope, target)
            result["yoy_change"] = yoy_change
            return result
            
        except Exception as e:
            logger.error(f"get_statistics failed: {e}", exc_info=True)
            return self._empty_stats(scope)

    def _empty_stats(self, scope: str) -> Dict:
        """返回空统计数据"""
        return {
            "scope": scope,
            "total_consumption": 0,
            "total_consumption_wan": 0,
            "period_breakdown": {"尖峰": 0, "高峰": 0, "平段": 0, "低谷": 0, "深谷": 0},
            "period_percentage": {"尖峰": 0, "高峰": 0, "平段": 0, "低谷": 0, "深谷": 0},
            "peak_valley_ratio": None,
            "yoy_change": None
        }

    def _calc_stats(self, data, scope: str, target_date: date) -> Dict:
        """计算统计指标"""
        # 1. 总电量
        total = data.total
        
        # 2. TOU 分解
        tou = data.tou_usage
        if hasattr(tou, 'dict'):
            tou = tou.dict()
        elif not isinstance(tou, dict):
            tou = tou.__dict__ if hasattr(tou, '__dict__') else {}

        breakdown = {
            "尖峰": round(tou.get("tip", 0), 2),
            "高峰": round(tou.get("peak", 0), 2),
            "平段": round(tou.get("flat", 0), 2),
            "低谷": round(tou.get("valley", 0), 2),
            "深谷": round(tou.get("deep", 0), 2)
        }
        
        # 3. 占比
        percentages = {}
        for k, v in breakdown.items():
            percentages[k] = round(v / total * 100, 1) if total > 0 else 0
            
        # 4. 峰谷比 (尖峰+高峰) / (低谷+深谷)
        peak_sum = breakdown["尖峰"] + breakdown["高峰"]
        valley_sum = breakdown["低谷"] + breakdown["深谷"]
        pv_ratio = round(peak_sum / valley_sum, 2) if valley_sum > 0 else None
        
        return {
            "scope": scope,
            "total_consumption": round(total, 2),
            "total_consumption_wan": round(total / 10000, 2),
            "period_breakdown": breakdown,
            "period_percentage": percentages,
            "peak_valley_ratio": pv_ratio,
            "yoy_change": None # 外层计算
        }
