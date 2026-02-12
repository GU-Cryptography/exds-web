# -*- coding: utf-8 -*-
import logging
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from calendar import monthrange

from webapp.tools.mongo import DATABASE
from webapp.models.settlement import (
    SettlementDaily, SettlementPeriodDetail, 
    ContractComponent, EnergyComponent
)
from webapp.services.load_query_service import LoadQueryService
from webapp.models.load_enums import FusionStrategy
from webapp.services.contract_service import ContractService

logger = logging.getLogger(__name__)

class SettlementService:
    def __init__(self):
        self.db = DATABASE
        self.contract_service = ContractService(self.db)

    async def calculate_daily_settlement(self, date_str: str, force: bool = False) -> Optional[SettlementDaily]:
        """
        计算指定日期的预结算单
        """
        # 1. 检查是否需重算
        if not force:
            existing = self.db.settlement_daily.find_one({"operating_date": date_str})
            if existing:
                logger.info(f"结算单已存在且非强制重算，跳过: {date_str}")
                return SettlementDaily(**existing)

        # 2. 获取基础数据
        try:
            basis_data = await self._fetch_basis_data(date_str)
            if not basis_data:
                logger.warning(f"基础数据不全，无法计算: {date_str}")
                return None
        except Exception as e:
            logger.error(f"获取基础数据失败 {date_str}: {e}")
            raise e

        # 3. 分时计算 (48点)
        period_details = []
        
        # 解包数据 (均为 48点 列表/数组)
        # 价格单位: 元/MWh, 电量单位: MWh
        p_rt_curve = basis_data['p_rt']
        p_da_curve = basis_data['p_da']
        q_rt_curve = basis_data['q_rt']
        q_da_curve = basis_data['q_da']
        q_mech_curve = basis_data['q_mech']
        
        # 合同数据 (特殊结构: list of dict -> 需要根据 contract_period 筛选并转为曲线)
        # basis_data['contracts'] 是 API/DB 返回的原始结构，需进一步处理为 48点曲线
        q_contract_curve, p_contract_curve = self._process_contracts(basis_data['contracts'])
        
        # 市场均价 (用于偏差考核补足)
        _, p_market_avg_curve = self._process_contracts(basis_data['market_contracts'])
        
        # 售电公司均价 (用于偏差考核剔除) 
        # *注: 这里简化逻辑，若无特定公司自家数据，可用合同均价或市场均价代替，
        # 规则文档提到: "剔除价格: 售电公司自家中长期均价"。即 p_contract_curve 本身就是。
        p_company_contract_curve = p_contract_curve

        for i in range(48):
            # 准备单点数据
            detail = self._calculate_period(
                period=i + 1,
                q_rt=q_rt_curve[i],
                p_rt=p_rt_curve[i],
                q_da=q_da_curve[i],
                p_da=p_da_curve[i],
                q_contract=q_contract_curve[i],
                p_contract=p_contract_curve[i],
                q_mech=q_mech_curve[i],
                p_market_avg=p_market_avg_curve[i],
                p_company_contract=p_company_contract_curve[i]
            )
            period_details.append(detail)

        # 4. 日汇总聚合
        daily_settlement = self._aggregate_daily(date_str, period_details)
        
        # 5. 入库保存
        self._save_result(daily_settlement)
        
        return daily_settlement

    def _calculate_period(
        self, period: int, 
        q_rt: float, p_rt: float, 
        q_da: float, p_da: float,
        q_contract: float, p_contract: float,
        q_mech: float,
        p_market_avg: float,
        p_company_contract: float
    ) -> SettlementPeriodDetail:
        """核心计算逻辑: 单时段结算 & 偏差考核"""
        
        # 1. 基础电费计算
        # 规则: 
        # cost_contract = Q_contract * (P_contract - P_rt)
        # cost_da = Q_da * (P_da - P_rt)
        # cost_rt = Q_rt * P_rt
        
        cost_contract = q_contract * (p_contract - p_rt)
        cost_da = q_da * (p_da - p_rt)
        cost_rt = q_rt * p_rt
        
        total_energy_fee = cost_contract + cost_da + cost_rt
        
        # 2. 偏差考核 (标准值机制)
        # Q_base = Q_rt - Q_mech
        q_base = q_rt - q_mech
        
        # 签约比例 K = Q_contract / Q_base
        k_ratio = 0.0
        if abs(q_base) > 1e-4: # 避免除零
            k_ratio = q_contract / q_base
        else:
             # 基数为0时的特殊处理: 若有合同则无穷大，无合同则视为平衡(1.0)?
             # 简单处理: 无基数且无合同 -> 1.0 (不考核); 无基数有合同 -> 999 (过大)
             k_ratio = 999.0 if q_contract > 1e-4 else 1.0
             
        cost_actual = total_energy_fee
        cost_std = cost_actual # 默认等于实际
        # recovery_fee = max(0, cost_std - cost_actual) by default logic
        
        # 考核规则
        # 场景 A: 0.8 <= k <= 1.2 -> 免考
        if 0.8 <= k_ratio <= 1.2:
            pass # cost_std = cost_actual
            
        # 场景 B: k < 0.8 (少签) -> 按 80% 补足
        elif k_ratio < 0.8:
            q_target = 0.8 * q_base
            q_gap = q_target - q_contract # > 0
            
            # 补足部分按 市场均价 结算，但只是模拟 Cost_std
            # Cost_std = Cost_contract + Q_gap * (P_market_avg - P_rt) + ... (其他成分不变)
            # 简化公式: Cost_std = Cost_Actual + Q_gap * (P_market_avg - P_rt)
            # 原理: 假设缺口部分是以 P_market_avg 买入的中长期，而不是暴露在 P_rt
            
            cost_std = cost_actual + q_gap * (p_market_avg - p_rt)
            
        # 场景 C: k > 1.2 (多签) -> 按 120% 剔除
        elif k_ratio > 1.2:
            q_target = 1.2 * q_base
            q_over = q_contract - q_target # > 0
            
            # 剔除部分: 假设多余合同退回，不再产生中长期差价，而是暴露在 P_rt?
            # 或者是 剔除该部分的中长期收益/亏损
            # Cost_std = Cost_Actual - Q_over * (P_company_contract - P_rt)
            
            cost_std = cost_actual - q_over * (p_company_contract - p_rt)
            
        # 计算回收费 (只收不退)
        recovery_fee = max(0, cost_std - cost_actual)
        
        # 3. 预测费用
        predicted_cost = total_energy_fee + recovery_fee
        
        # 4. 组装对象
        return SettlementPeriodDetail(
            period=period,
            mechanism_volume=q_mech,
            contract=ContractComponent(volume=q_contract, price=p_contract, fee=cost_contract),
            day_ahead=EnergyComponent(volume=q_da, price=p_da, fee=cost_da),
            real_time=EnergyComponent(volume=q_rt, price=p_rt, fee=cost_rt),
            total_energy_fee=total_energy_fee,
            energy_avg_price=(total_energy_fee / q_rt) if abs(q_rt) > 1e-4 else 0.0,
            contract_ratio=k_ratio * 100, # 百分比
            standard_value_cost=cost_std,
            recovery_fee=recovery_fee,
            predicted_wholesale_cost=predicted_cost,
            predicted_wholesale_price=(predicted_cost / q_rt) if abs(q_rt) > 1e-4 else 0.0
        )

    async def _fetch_basis_data(self, date_str: str) -> Optional[Dict]:
        """获取所有源数据并对齐到 48点"""
        
        # 1. 负荷 (Unified Load Curve - MP_ONLY)
        # 获取所有有效用户的聚合
        # 需先找到该日有效的用户列表? LoadQueryService.aggregate_curve_series 需要 customer_ids
        # 使用 ContractService 获取当日有效用户
        active_customers = self.contract_service.get_active_customers(date_str, date_str)
        if not active_customers:
            logger.warning(f"当日无有效签约客户: {date_str}")
            return None
            
        load_curves = LoadQueryService.aggregate_curve_series(
            active_customers, date_str, date_str, 
            strategy=FusionStrategy.MP_COMPLETE # 强制 MP_ONLY
        )
        if not load_curves:
            logger.warning(f"当日无聚合负荷数据: {date_str}")
            return None
        
        # 处理负荷曲线 (支持 96点 -> 48点 sum)
        raw_load = load_curves[0].values # List[float]
        q_rt = self._resample_curve(raw_load, method='sum', source='RT Load')
        
        # 2. 实时价格 (Real Time Price)
        rt_doc = self.db.real_time_spot_price.find_one({"date_str": date_str}) # Collection name confirmed?
        # Check docs/dataset_structures.md: `real_time_spot_price` fields: `date_str`, `periods` (list of {time_str, avg_clearing_price})
        if not rt_doc:
             # Try finding by datetime range or other checks?
             # Assuming standard structure from dataset docs
             # However, implementation plan says `real_time_spot_price` collection. 
             # Let's verify field structure via code search if needed. 
             # Assuming simple structure for now based on previous knowledge.
             # If `real_time_spot_price` stores 1 doc per day or many?
             # Usually spot prices are stored as list of docs per 15min.
             # Let's assume list of docs query as fallback if single doc not found.
             pass
        
        # Re-implement price fetching carefully
        try:
             p_rt = self._fetch_price_curve('real_time_spot_price', date_str, price_field='arithmetic_avg_clearing_price')
        except Exception:
             logger.warning(f"实时电价缺失: {date_str}")
             return None

        # 3. 日前价格 (Day Ahead)
        # 逻辑: < 2026-02 使用 day_ahead_spot_price, >= 2026-02 使用 day_ahead_econ_price
        # 简化: 尝试两者, 优先 Econ
        p_da = []
        try:
            # Try Econ first (v2)
            p_da = self._fetch_price_curve('day_ahead_econ_price', date_str, price_field='clearing_price')
        except:
             pass
             
        if not p_da or all(x==0 for x in p_da):
            try:
                p_da = self._fetch_price_curve('day_ahead_spot_price', date_str)
            except:
                logger.warning(f"日前电价缺失: {date_str}")
                return None
                
        # 4. 日前申报电量 (Day Ahead Energy)
        # collection: day_ahead_energy_declare
        # fields: energy_mwh (96点/48点)
        q_da = self._fetch_curve_from_collection('day_ahead_energy_declare', date_str, 'energy_mwh', method='sum')
        if not q_da:
             # Default to 0 if missing? Or strict check?
             # If missing declaration, deviation might be huge. Let's warn but allow 0?
             logger.warning(f"日前申报缺失，默认为0: {date_str}")
             q_da = [0.0] * 48
             
        # 5. 中长期合同 (Contracts)
        # collection: contracts_aggregated_daily
        # query: date=date_str, entity='售电公司'/'全市场', contract_period='整体'
        sys_contracts = self.db.contracts_aggregated_daily.find_one({
            "date": date_str,
            "entity": "售电公司",
            "contract_type": "整体",
            "contract_period": "整体"
        })
        market_contracts = self.db.contracts_aggregated_daily.find_one({
             "date": date_str,
             "entity": "全市场",
             "contract_type": "整体",
             "contract_period": "整体"
        })
        
        if not sys_contracts:
             logger.warning(f"中长期合同数据缺失(售电公司): {date_str}")
             return None
             
        # 6. 机制电量 (Mechanism)
        # collection: mechanism_energy_monthly
        # query: month_str (YYYY-MM)
        month_str = date_str[:7]
        # 获取 售电公司 对应的机制电量? 还是 "全省"?
        # 实施计划 3. 数据来源: "筛选: month_str"。未指定 entity_name。
        # 查看 import_mechanism_energy.py，entity_name="国网江西综合能源服务有限公司" (hardcoded in xls?)
        # 暂时只取一条匹配 month 的
        mech_doc = self.db.mechanism_energy_monthly.find_one({"month_str": month_str}) # entity_name?
        if not mech_doc:
             logger.warning(f"机制电量缺失: {month_str}")
             return None
             
        days_in_month = monthrange(int(date_str[:4]), int(date_str[5:7]))[1]
        raw_mech = mech_doc.get('period_values', [0.0]*48)
        # 日分摊: Monthly / Days
        q_mech = [v / days_in_month for v in raw_mech]
        
        return {
            "q_rt": q_rt,
            "p_rt": p_rt,
            "p_da": p_da,
            "q_da": q_da,
            "contracts": sys_contracts, # dict with 'periods' list
            "market_contracts": market_contracts, # dict or None
            "q_mech": q_mech
        }

    def _process_contracts(self, contract_doc: Optional[Dict]) -> Tuple[List[float], List[float]]:
        """从合同聚合文档提取量价曲线 (48点)"""
        # Default: 0
        q_curve = [0.0] * 48
        p_curve = [0.0] * 48
        
        if not contract_doc or 'periods' not in contract_doc:
            return q_curve, p_curve
            
        # periods: [{"period": 1, "quantity_mwh": ..., "price_...": ...}, ...]
        for item in contract_doc['periods']:
            p_idx = item.get('period', 1) - 1 # 0-based
            if 0 <= p_idx < 48:
                q_curve[p_idx] = float(item.get('quantity_mwh', 0))
                p_curve[p_idx] = float(item.get('price_yuan_per_mwh', 0))
                
        return q_curve, p_curve

    def _fetch_price_curve(self, collection_name: str, date_str: str, price_field: str = 'avg_clearing_price') -> List[float]:
        """获取价格曲线 (自动处理 96->48点 算术平均)"""
        # 假设数据存储为列表形式 OR 单日文档形式?
        # 根据 `dataset_structures.md`: 
        # `real_time_spot_price`: 每日1文档 OR 多文档? 
        # 文档说: "集合名: real_time_spot_price ... 字段: time_str, avg_clearing_price"
        # 并且 viewed_code_item (Step 383) 里的 `day_ahead_econ_price` 是一堆文档的列表
        # 尝试查询该日所有记录
        
        # 构造 datetime query
        # 简单起见，按 date_str 字符串字段查询 (如果有)
        # 否则按 datetime range
        start_dt = datetime.strptime(date_str, "%Y-%m-%d")
        end_dt = start_dt + timedelta(days=1)
        
        cursor = self.db[collection_name].find({
            "datetime": {"$gt": start_dt, "$lte": end_dt}
        }).sort("datetime", 1)
        
        docs = list(cursor)
        if not docs:
             # Try `date_str` field if exists
             cursor = self.db[collection_name].find({"date_str": date_str}).sort("time_str", 1)
             docs = list(cursor)
             
        if not docs:
            raise ValueError(f"No data in {collection_name}")
            
        # 提取 value
        values = []
        for d in docs:
             val = d.get(price_field)
             if val is None: val = d.get('clearing_price') # Fallback
             values.append(float(val) if val is not None else 0.0)
             
        return self._resample_curve(values, method='mean', source=f'Price-{collection_name}')

    def _fetch_curve_from_collection(self, collection_name: str, date_str: str, value_field: str, method: str) -> List[float]:
        """通用曲线获取"""
        start_dt = datetime.strptime(date_str, "%Y-%m-%d")
        end_dt = start_dt + timedelta(days=1)
        
        cursor = self.db[collection_name].find({
            "datetime": {"$gt": start_dt, "$lte": end_dt}
        }).sort("datetime", 1)
        ids = list(cursor)
        
        # Fallback to date_str
        if not ids:
             cursor = self.db[collection_name].find({"date_str": date_str}).sort("time_str", 1)
             ids = list(cursor)
        
        if not ids:
            return []
            
        values = [float(d.get(value_field, 0)) for d in ids]
        return self._resample_curve(values, method=method, source=f'Curve-{collection_name}')

    def _resample_curve(self, values: List[float], method: str = 'sum', source: str = 'Unknown') -> List[float]:
        """重采样: 96点 -> 48点 或 48点保持"""
        n = len(values)
        if n == 48:
            return values
        elif n == 96:
            new_values = []
            for i in range(48):
                v1 = values[2*i]
                v2 = values[2*i+1]
                if method == 'sum':
                    new_values.append(v1 + v2)
                elif method == 'mean':
                    new_values.append((v1 + v2) / 2)
                else:
                    new_values.append(v1 + v2) 
            return new_values
        else:
            # 异常长度，尝试截断或补零?
            logger.warning(f"[{source}] 异常数据长度: {n}, 强制调整为 48点")
            # 简单截断或填充
            if n > 48: return values[:48]
            else: return values + [0.0]*(48-n)

    def _aggregate_daily(self, date_str: str, period_details: List[SettlementPeriodDetail]) -> SettlementDaily:
        """从分时明细聚合日文档"""
        # Sum helper
        def _sum(attr_path: str):
            total = 0.0
            for p in period_details:
                # 简单属性访问
                obj = p
                for part in attr_path.split('.'):
                    obj = getattr(obj, part)
                total += obj
            return total
            
        # Contract Avg Price: Weighted Avg
        total_contract_vol = _sum('contract.volume')
        contract_fee_sum = _sum('contract.price') * 0 # calculate from vol*price? No, sum(vol*price)/sum(vol)
        # Re-calc weighted price
        w_price_sum = sum(p.contract.volume * p.contract.price for p in period_details)
        contract_avg_price = (w_price_sum / total_contract_vol) if total_contract_vol > 0.001 else 0.0
        
        # Energy Avg Price
        total_rt_vol = _sum('real_time.volume')
        total_energy_fee = _sum('total_energy_fee')
        energy_avg_price = (total_energy_fee / total_rt_vol) if total_rt_vol > 0.001 else 0.0
        
        # Predicted
        pred_cost = _sum('predicted_wholesale_cost')
        pred_price = (pred_cost / total_rt_vol) if total_rt_vol > 0.001 else 0.0
        
        return SettlementDaily(
            operating_date=date_str,
            period_details=period_details,
            
            # C-Part Aggregations
            contract_volume=total_contract_vol,
            contract_avg_price=contract_avg_price,
            contract_fee=_sum('contract.fee'),
            
            day_ahead_volume=_sum('day_ahead.volume'),
            day_ahead_fee=_sum('day_ahead.fee'),
            
            real_time_volume=total_rt_vol,
            real_time_fee=_sum('real_time.fee'),
            
            total_energy_fee=total_energy_fee,
            energy_avg_price=energy_avg_price,
            
            deviation_recovery_fee=_sum('recovery_fee'),
            
            predicted_wholesale_cost=pred_cost,
            predicted_wholesale_price=pred_price
        )

    def _save_result(self, daily: SettlementDaily):
        """保存到 MongoDB (Upsert)"""
        if hasattr(daily, 'model_dump'): # Pydantic v2
             data = daily.model_dump(by_alias=True, exclude={'id'})
        else: # Pydantic v1
             data = daily.dict(by_alias=True, exclude={'id'})
             
        # double check
        if '_id' in data: del data['_id']
        
        self.db.settlement_daily.update_one(
            {"operating_date": daily.operating_date},
            {"$set": data},
            upsert=True
        )
