import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
import statistics
from collections import defaultdict

from pymongo.database import Database
from pymongo import ASCENDING
from webapp.services.tou_service import get_tou_rule_by_date

# 导入模型 (虽然 Service 层主要返回 Dict，但类型提示可以使用)
# from webapp.models.trend_analysis import ... 

logger = logging.getLogger(__name__)

class TrendAnalysisService:
    """
    现货趋势分析服务层
    
    职责：
    - 提供价格趋势、星期特性、波动性、套利机会、异常分析等业务逻辑
    - 封装数据库聚合查询
    """

    def __init__(self, db: Database) -> None:
        """
        初始化服务
        
        Args:
            db: MongoDB 数据库实例
        """
        self.db = db
        self.da_collection = self.db['day_ahead_spot_price']
        self.rt_collection = self.db['real_time_spot_price']
        self.tou_collection = self.db['tou_rules']
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        """确保数据库索引存在"""
        try:
            # 确保 datetime 索引存在，用于范围查询
            for col in [self.da_collection, self.rt_collection]:
                indexes = [
                    ([('datetime', 1)], {'name': 'idx_datetime'}),
                    ([('date_str', 1)], {'name': 'idx_date_str'}), # 辅助字段
                ]
                
                # 获取现有索引信息
                existing_indexes = list(col.list_indexes())
                existing_names = {idx.get('name') for idx in existing_indexes}
                # 将 SON 对象转换为 tuple 以便比较: (('datetime', 1),)
                existing_keys = {tuple(idx.get('key').items()) for idx in existing_indexes}

                for keys, options in indexes:
                    key_tuple = tuple(keys)
                    
                    # 1. 如果键已经存在索引（无论名字叫什么），则跳过，避免 IndexOptionsConflict
                    if key_tuple in existing_keys:
                        continue
                        
                    # 2. 如果名字不存在，则尝试创建
                    if options['name'] not in existing_names:
                        try:
                            col.create_index(keys, **options)
                            logger.info(f"创建索引: {options['name']} on {col.name}")
                        except Exception as e:
                            logger.warning(f"创建索引 {options['name']} 失败: {str(e)}")
        except Exception as e:
            logger.warning(f"创建索引时出错: {str(e)}")

    # ========== 核心业务方法 ==========

    def get_price_trend(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        需求1：价格趋势分析
        
        Args:
            start_date: 开始日期 (包含)
            end_date: 结束日期 (不包含，通常是查询范围的后一天)
            
        Returns:
            Dict 包含 daily_trends 和 period_trends
        """
        # 1. 获取基础数据
        query = {"datetime": {"$gte": start_date, "$lt": end_date}}
        da_docs = list(self.da_collection.find(query))
        rt_docs = list(self.rt_collection.find(query))
        
        # 2. 获取分时电价规则 (简化处理：假设规则在查询期内不变，取 start_date 的规则)
        tou_rules = self._get_tou_rules(start_date)
        
        # 3. 聚合计算
        daily_stats = defaultdict(lambda: {
            "da_vol": 0, "da_cost": 0, "da_prices": [],
            "rt_vol": 0, "rt_cost": 0, "rt_prices": []
        })
        
        period_stats = defaultdict(lambda: defaultdict(lambda: {
            "vol": 0, "cost": 0
        })) # date -> period_type -> {vol, cost}

        # 处理日前数据
        for doc in da_docs:
            date_str = doc.get('date_str')
            if not date_str: continue
            
            price = doc.get('avg_clearing_price')
            vol = doc.get('total_clearing_power', 0)
            time_str = doc.get('time_str')
            
            if price is not None:
                daily_stats[date_str]["da_vol"] += vol
                daily_stats[date_str]["da_cost"] += price * vol
                daily_stats[date_str]["da_prices"].append(price)
                
                # 分时段统计 (仅统计VWAP，所以需要 cost 和 vol)
                # 注意：这里简化了，实际上应该区分 DA 和 RT 的分时段趋势，需求文档主要关注"分时段价格趋势"，通常指 RT
                # 但需求 1.3 说"展示每个时段的日均VWAP趋势"，未明确指明 DA 还是 RT。
                # 根据上下文 "识别特定时段的成本变化"，通常指 RT。这里我们计算 RT 的分时段。
        
        # 处理实时数据
        for doc in rt_docs:
            date_str = doc.get('date_str')
            if not date_str: continue
            
            price = doc.get('avg_clearing_price')
            vol = doc.get('total_clearing_power', 0)
            time_str = doc.get('time_str')
            
            if price is not None:
                daily_stats[date_str]["rt_vol"] += vol
                daily_stats[date_str]["rt_cost"] += price * vol
                daily_stats[date_str]["rt_prices"].append(price)
                
                # 分时段统计 (RT)
                period_type = tou_rules.get(time_str, "平段")
                period_stats[date_str][period_type]["vol"] += vol
                period_stats[date_str][period_type]["cost"] += price * vol

        # 4. 格式化输出
        daily_trends = []
        sorted_dates = sorted(daily_stats.keys())
        
        for date_str in sorted_dates:
            stat = daily_stats[date_str]
            
            vwap_da = stat["da_cost"] / stat["da_vol"] if stat["da_vol"] > 0 else None
            vwap_rt = stat["rt_cost"] / stat["rt_vol"] if stat["rt_vol"] > 0 else None
            twap_da = statistics.mean(stat["da_prices"]) if stat["da_prices"] else None
            twap_rt = statistics.mean(stat["rt_prices"]) if stat["rt_prices"] else None
            
            daily_trends.append({
                "date": date_str,
                "vwap_da": round(vwap_da, 2) if vwap_da is not None else None,
                "vwap_rt": round(vwap_rt, 2) if vwap_rt is not None else None,
                "vwap_spread": round(vwap_rt - vwap_da, 2) if (vwap_rt is not None and vwap_da is not None) else None,
                "twap_da": round(twap_da, 2) if twap_da is not None else None,
                "twap_rt": round(twap_rt, 2) if twap_rt is not None else None,
                "twap_spread": round(twap_rt - twap_da, 2) if (twap_rt is not None and twap_da is not None) else None,
            })
            
        period_trends_output = defaultdict(list)
        for date_str in sorted_dates:
            p_stat = period_stats[date_str]
            for p_type, val in p_stat.items():
                vwap = val["cost"] / val["vol"] if val["vol"] > 0 else None
                period_trends_output[p_type].append({
                    "date": date_str,
                    "period_type": p_type,
                    "vwap": round(vwap, 2) if vwap is not None else None
                })
                
        return {
            "daily_trends": daily_trends,
            "period_trends": period_trends_output
        }

    def get_weekday_analysis(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        需求2：星期特性分析
        """
        query = {"datetime": {"$gte": start_date, "$lt": end_date}}
        rt_docs = list(self.rt_collection.find(query))
        
        # 按星期分组收集日均VWAP
        weekday_data = defaultdict(lambda: {
            "daily_vwaps": [], # 存储每一天的 VWAP
            "temp_daily": defaultdict(lambda: {"cost": 0, "vol": 0}) # 临时存储当天的累加
        })
        
        # 1. 遍历数据，累加每天的 cost 和 vol
        for doc in rt_docs:
            dt = doc.get('datetime')
            if not dt: continue
            
            # 修正：数据库存储的是 naive datetime，直接使用
            # 星期几：0=Mon, 6=Sun
            weekday = dt.weekday() 
            date_str = doc.get('date_str')
            
            price = doc.get('avg_clearing_price')
            vol = doc.get('total_clearing_power', 0)
            
            if price is not None:
                weekday_data[weekday]["temp_daily"][date_str]["cost"] += price * vol
                weekday_data[weekday]["temp_daily"][date_str]["vol"] += vol
                
        # 2. 计算每天的 VWAP 并存入列表
        weekday_stats_list = []
        weekdays_map = {0: "周一", 1: "周二", 2: "周三", 3: "周四", 4: "周五", 5: "周六", 6: "周日"}
        
        for wd in range(7):
            data = weekday_data[wd]
            vwaps = []
            for date_str, val in data["temp_daily"].items():
                if val["vol"] > 0:
                    vwaps.append(val["cost"] / val["vol"])
            
            if not vwaps:
                stats = {"min": 0, "q1": 0, "median": 0, "q3": 0, "max": 0}
                outliers = []
            else:
                vwaps.sort()
                q1 = statistics.quantiles(vwaps, n=4)[0] if len(vwaps) >= 2 else vwaps[0]
                median = statistics.median(vwaps)
                q3 = statistics.quantiles(vwaps, n=4)[2] if len(vwaps) >= 2 else vwaps[-1]
                iqr = q3 - q1
                lower_bound = q1 - 1.5 * iqr
                upper_bound = q3 + 1.5 * iqr
                
                # 过滤离群值用于箱线图绘制（通常箱线图本身包含离群值点，这里简单处理）
                valid_values = [v for v in vwaps if lower_bound <= v <= upper_bound]
                outliers = [v for v in vwaps if v < lower_bound or v > upper_bound]
                
                stats = {
                    "min": min(valid_values) if valid_values else min(vwaps),
                    "q1": q1,
                    "median": median,
                    "q3": q3,
                    "max": max(valid_values) if valid_values else max(vwaps)
                }
            
            weekday_stats_list.append({
                "weekday": wd,
                "weekday_name": weekdays_map[wd],
                "stats": stats,
                "outliers": outliers
            })
            
        return {"distribution": weekday_stats_list, "heatmap_data": []}

    def get_volatility_analysis(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        需求3：波动性分析
        """
        query = {"datetime": {"$gte": start_date, "$lt": end_date}}
        rt_docs = list(self.rt_collection.find(query).sort("datetime", 1))
        
        # 按天分组
        daily_data = defaultdict(list)
        for doc in rt_docs:
            date_str = doc.get('date_str')
            if date_str:
                daily_data[date_str].append(doc)
                
        result = []
        for date_str, docs in daily_data.items():
            prices = [d.get('avg_clearing_price') for d in docs if d.get('avg_clearing_price') is not None]
            
            if not prices or len(prices) < 2:
                continue
                
            # 1. CV (变异系数)
            mean_price = statistics.mean(prices)
            std_price = statistics.stdev(prices)
            cv = std_price / mean_price if mean_price != 0 else 0
            
            # 2. 最大爬坡
            max_ramp = 0
            for i in range(1, len(prices)):
                ramp = abs(prices[i] - prices[i-1])
                if ramp > max_ramp:
                    max_ramp = ramp
                    
            result.append({
                "date": date_str,
                "cv_rt": round(cv, 4),
                "max_ramp": round(max_ramp, 2),
                "spread_std": 0 # 暂未计算价差标准差，需关联 DA 数据
            })
            
        return {"daily_volatility": sorted(result, key=lambda x: x['date'])}

    def get_arbitrage_analysis(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        需求4：储能套利机会分析
        """
        query = {"datetime": {"$gte": start_date, "$lt": end_date}}
        rt_docs = list(self.rt_collection.find(query).sort("datetime", 1))
        
        daily_data = defaultdict(list)
        for doc in rt_docs:
            date_str = doc.get('date_str')
            if date_str:
                daily_data[date_str].append(doc)
                
        daily_arbitrage = []
        total_max_spread = 0
        
        for date_str, docs in daily_data.items():
            # 提取价格和时间
            points = []
            for doc in docs:
                price = doc.get('avg_clearing_price')
                time_str = doc.get('time_str')
                if price is not None and time_str:
                    points.append({"price": price, "time": time_str})
            
            if not points: continue
            
            # 算法：寻找最大价差 (先买后卖)
            # O(N) 算法：维护当前最低价
            min_price = float('inf')
            min_price_time = ""
            max_spread = float('-inf')
            best_buy_time = ""
            best_sell_time = ""
            best_buy_price = 0
            best_sell_price = 0
            
            # 简单起见，这里使用 O(N^2) 或者简单的双指针，由于 N=96 很小，O(N^2) 也无所谓
            # 但为了性能，使用 O(N)
            # 记录当前遇到的最低价及其时间
            curr_min_price = points[0]["price"]
            curr_min_time = points[0]["time"]
            
            for i in range(1, len(points)):
                sell_price = points[i]["price"]
                sell_time = points[i]["time"]
                
                # 计算如果现在卖出的价差
                spread = sell_price - curr_min_price
                
                if spread > max_spread:
                    max_spread = spread
                    best_buy_price = curr_min_price
                    best_buy_time = curr_min_time
                    best_sell_price = sell_price
                    best_sell_time = sell_time
                
                # 更新最低价
                if points[i]["price"] < curr_min_price:
                    curr_min_price = points[i]["price"]
                    curr_min_time = points[i]["time"]
            
            if max_spread == float('-inf'):
                max_spread = 0
                
            # 判断时段 (简单判断：买入时间在12:00前为上午)
            period_type = "上午" if best_buy_time < "12:00" else "下午"
            
            daily_arbitrage.append({
                "date": date_str,
                "max_spread": round(max_spread, 2),
                "best_strategy": f"{best_buy_time}买入 -> {best_sell_time}卖出",
                "buy_price": best_buy_price,
                "buy_time": best_buy_time,
                "sell_price": best_sell_price,
                "sell_time": best_sell_time,
                "period_type": period_type
            })
            total_max_spread += max_spread

        avg_max_spread = total_max_spread / len(daily_arbitrage) if daily_arbitrage else 0
        
        return {
            "daily_arbitrage": sorted(daily_arbitrage, key=lambda x: x['date']),
            "summary": {
                "avg_max_spread": round(avg_max_spread, 2),
                "days_count": len(daily_arbitrage)
            }
        }

    def get_anomaly_analysis(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        需求5：价格异常与极值分析
        """
        query = {"datetime": {"$gte": start_date, "$lt": end_date}}
        rt_docs = list(self.rt_collection.find(query).sort("datetime", 1))
        
        # 统计变量
        neg_price_count = 0
        neg_price_days = set()
        zero_price_count = 0
        zero_price_days = set()
        high_price_count = 0 # > 1000
        high_price_days = set()
        
        daily_extremums = []
        
        # 按天分组
        daily_data = defaultdict(list)
        for doc in rt_docs:
            date_str = doc.get('date_str')
            if date_str:
                daily_data[date_str].append(doc)
        
        for date_str, docs in daily_data.items():
            prices = []
            times = []
            for doc in docs:
                p = doc.get('avg_clearing_price')
                t = doc.get('time_str')
                if p is not None:
                    prices.append(p)
                    times.append(t)
                    
                    # 异常统计
                    if p < 0:
                        neg_price_count += 1
                        neg_price_days.add(date_str)
                    elif p == 0:
                        zero_price_count += 1
                        zero_price_days.add(date_str)
                    elif p > 1000:
                        high_price_count += 1
                        high_price_days.add(date_str)
            
            if not prices: continue
            
            max_p = max(prices)
            min_p = min(prices)
            max_t = times[prices.index(max_p)]
            min_t = times[prices.index(min_p)]
            
            daily_extremums.append({
                "date": date_str,
                "max_price": max_p,
                "max_time": max_t,
                "min_price": min_p,
                "min_time": min_t,
                "range_value": max_p - min_p
            })
            
        events = {
            "negative_price": {
                "event_type": "negative_price",
                "count": neg_price_count,
                "days": len(neg_price_days)
            },
            "zero_price": {
                "event_type": "zero_price",
                "count": zero_price_count,
                "days": len(zero_price_days)
            },
            "high_price": {
                "event_type": "high_price",
                "count": high_price_count,
                "days": len(high_price_days)
            }
        }
        
        return {
            "events": events,
            "daily_extremums": sorted(daily_extremums, key=lambda x: x['date']),
            "risk_timeslots": [] # 暂未实现热力图统计
        }

    # ========== 私有辅助方法 ==========

    def _get_tou_rules(self, query_date: datetime) -> Dict[str, str]:

        """获取分时电价规则 (Base + Patch 模式) - 代理至公共服务"""

        return get_tou_rule_by_date(query_date, collection=self.tou_collection)

    def _format_time_point(self, point: Dict[str, Any], query_date: datetime) -> Dict[str, Any]:
        """
        格式化时间点 (处理 24:00)
        """
        ts = point.get("datetime")
        if not isinstance(ts, datetime):
            return point
            
        next_day = query_date.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        time_label = "24:00" if (ts.hour == 0 and ts.minute == 0 and ts.date() == next_day.date()) else ts.strftime("%H:%M")
        
        return {
            "time": time_label,
            "value": point.get("value"),
            "timestamp": ts.isoformat()
        }
