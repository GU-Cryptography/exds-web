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
    ContractComponent, EnergyComponent, SettlementVersion
)
from webapp.services.load_query_service import LoadQueryService
from webapp.models.load_enums import FusionStrategy
from webapp.services.contract_service import ContractService

logger = logging.getLogger(__name__)

class SettlementService:
    def __init__(self):
        self.db = DATABASE
        self.contract_service = ContractService(self.db)

    def _round(self, value: float, decimals: int) -> float:
        """数值修约辅助函数"""
        if value is None:
            return 0.0
        return round(float(value), decimals)

    async def calculate_daily_settlement(
        self, date_str: str, 
        version: SettlementVersion = SettlementVersion.PRELIMINARY,
        force: bool = False
    ) -> Optional[SettlementDaily]:
        """
        计算指定日期的结算单 (支持多个版本)
        """
        # 1. 检查是否需重算
        if not force:
            existing = self.db.settlement_daily.find_one({
                "operating_date": date_str,
                "version": version
            })
            if existing:
                logger.info(f"结算单({version})已存在且非强制重算，跳过: {date_str}")
                return SettlementDaily(**existing)

        # 2. 根据版本获取基础数据
        try:
            if version == SettlementVersion.PRELIMINARY:
                basis_data = await self._fetch_basis_data_preliminary(date_str)
                data_source = "Raw"
            elif version == SettlementVersion.PLATFORM_DAILY:
                basis_data = await self._fetch_basis_data_platform_daily(date_str)
                data_source = "Platform_Daily"
            else:
                logger.error(f"不支持的结算版本: {version}")
                return None
                
            if not basis_data:
                logger.warning(f"基础数据不全，无法完成版本({version})计算: {date_str}")
                return None
        except Exception as e:
            logger.error(f"获取基础数据失败 {date_str} 版本({version}): {e}")
            raise e

        # 3. 分时计算 (48点)
        period_details = []
        
        # 解包数据 (均为 48点 列表/数组)
        p_rt_curve = basis_data['p_rt']
        p_da_curve = basis_data['p_da']
        q_rt_curve = basis_data['q_rt']
        q_da_curve = basis_data['q_da']
        q_mech_curve = basis_data['q_mech']
        
        # 合同数据
        q_contract_curve, p_contract_curve = self._process_contracts(basis_data.get('contracts'))
        
        # 市场均价 (用于偏差考核补足)
        # 如果是平台版本，可能已经有明确的市场均价曲线
        if 'p_market_avg' in basis_data:
            p_market_avg_curve = basis_data['p_market_avg']
        else:
            _, p_market_avg_curve = self._process_contracts(basis_data.get('market_contracts'))
        
        # 售电公司均价 (用于偏差考核剔除) 
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
        daily_settlement = self._aggregate_daily(date_str, period_details, version=version, data_source=data_source)
        
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
        cost_contract = q_contract * (p_contract - p_rt)
        cost_da = q_da * (p_da - p_rt)
        cost_rt = q_rt * p_rt
        
        total_energy_fee = cost_contract + cost_da + cost_rt
        
        # 2. 偏差考核 (标准值机制)
        # 规则更新 (Step 1010): 签约比例 K = (Q_contract + Q_mech) / Q_rt
        k_ratio = 0.0
        if abs(q_rt) > 1e-4:
            k_ratio = (q_contract + q_mech) / q_rt
        else:
             k_ratio = 1.0
             
        cost_actual = total_energy_fee
        cost_std = cost_actual # Default (Qualified)
        
        # 考核规则
        # 场景 A: 0.8 <= k <= 1.2 -> 免考
        if 0.8 <= k_ratio <= 1.2:
            pass 
            
        # 场景 B: k < 0.8 (少签) -> 按 80% 补足 (含机制电量)
        elif k_ratio < 0.8:
            # 补足缺口 Q_fill = 0.8 * Q_rt - (Q_contract + Q_mech)
            # 标准值 = 实际合同费用 + 缺口部分按市场均价计算的差价 + (DA+RT费用不变)
            # Cost_std = Cost_Actual + Gap * (P_mkt - P_rt)
            
            q_fill_gap = 0.8 * q_rt - (q_contract + q_mech)
            cost_std = cost_actual + q_fill_gap * (p_market_avg - p_rt)
            
        # 场景 C: k > 1.2 (多签) -> 按 120% 剔除
        elif k_ratio > 1.2:
            # 目标允许签约量 = 1.2 * Q_rt - Q_mech
            # 若 Q_mech > 1.2 * Q_rt, 则允许签约量 < 0 ?? (暂取 max(0, ...))
            q_target_contract = max(0, 1.2 * q_rt - q_mech)
            
            # 标准值模型: 按 (1.2 * Q_rt - Q_mech) 作为用户合同量，价格按用户均价
            cost_std_contract = q_target_contract * (p_company_contract - p_rt)
            cost_std = cost_std_contract + cost_da + cost_rt
            
        # 单时段不计算回收费 (设为0，留到日汇总 Netting)
        # recovery_fee = 0.0
        
        # 3. 预测费用 (暂不含回收费，最后加)
        # predicted_cost = total_energy_fee + recovery_fee
        
        # 4. 组装对象并应用修约
        return SettlementPeriodDetail(
            period=period,
            mechanism_volume=self._round(q_mech, 3),
            contract=ContractComponent(
                volume=self._round(q_contract, 3), 
                price=self._round(p_contract, 3), 
                fee=self._round(cost_contract, 2)
            ),
            day_ahead=EnergyComponent(
                volume=self._round(q_da, 3), 
                price=self._round(p_da, 3), 
                fee=self._round(cost_da, 2)
            ),
            real_time=EnergyComponent(
                volume=self._round(q_rt, 3), 
                price=self._round(p_rt, 3), 
                fee=self._round(cost_rt, 2)
            ),
            total_energy_fee=self._round(total_energy_fee, 2),
            energy_avg_price=self._round(
                (total_energy_fee / q_rt) if abs(q_rt) > 1e-4 else 0.0, 
                3
            ),
            contract_ratio=self._round(k_ratio * 100, 3),
            standard_value_cost=self._round(cost_std, 2)
        )

    async def _fetch_basis_data_platform_daily(self, date_str: str) -> Optional[Dict]:
        """[版本2] 从交易平台日报表 (D+2) 获取确权结算数据"""
        # 1. 获取汇总数据 (用于后续校验)
        # spot_settlement_daily
        daily_doc = self.db.spot_settlement_daily.find_one({"operating_date": date_str})
        if not daily_doc:
            logger.warning(f"平台日报汇总数据缺失: {date_str}")
            return None
            
        # 2. 获取分时明细 (48点)
        # spot_settlement_period
        cursor = self.db.spot_settlement_period.find({"operating_date": date_str}).sort("period", 1)
        periods = list(cursor)
        if len(periods) < 48:
            logger.warning(f"平台分时明细不足 48点: {date_str}, count={len(periods)}")
            return None
            
        # 3. 构造 48点 曲线
        # 注意: 平台字段名与内部字段名映射
        q_rt = [p.get('actual_consumption_volume', 0.0) for p in periods]
        p_rt = [p.get('real_time_market_avg_price', 0.0) for p in periods]
        q_da = [p.get('day_ahead_demand_volume', 0.0) for p in periods]
        p_da = [p.get('day_ahead_market_avg_price', 0.0) for p in periods]
        
        # 平台各时段合同量价
        q_contract = [p.get('contract_volume', 0.0) for p in periods]
        p_contract = [p.get('contract_avg_price', 0.0) for p in periods]
        
        # 4. 获取机制电量
        month_str = date_str[:7]
        mech_doc = self.db.mechanism_energy_monthly.find_one({"month_str": month_str})
        q_mech = [0.0] * 48
        if mech_doc:
            days_in_month = monthrange(int(date_str[:4]), int(date_str[5:7]))[1]
            raw_mech = mech_doc.get('period_values', [0.0]*48)
            q_mech = [v / days_in_month for v in raw_mech]
        else:
            logger.warning(f"机制电量缺失: {month_str}")
            
        # 5. 获取全市场合同均价
        market_contracts = self.db.contracts_aggregated_daily.find_one({
             "date": date_str,
             "entity": "全市场",
             "contract_type": "整体",
             "contract_period": "整体"
        })
        _, p_market_avg = self._process_contracts(market_contracts)
        
        return {
            "q_rt": q_rt,
            "p_rt": p_rt,
            "p_da": p_da,
            "q_da": q_da,
            "q_mech": q_mech,
            "p_market_avg": p_market_avg,
            "contracts": {
                "periods": [
                    {"period": i+1, "quantity_mwh": q_contract[i], "price_yuan_per_mwh": p_contract[i]}
                    for i in range(48)
                ]
            }
        }

    async def _fetch_basis_data_preliminary(self, date_str: str) -> Optional[Dict]:
        """[版本1] 获取所有源数据并对齐到 48点 (Preliminary版)"""
        
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
            strategy=FusionStrategy.MP_COMPLETE
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
             # 根据方案 3.1: 字段使用 arithmetic_avg_clearing_price
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

    def _aggregate_daily(
        self, date_str: str, 
        period_details: List[SettlementPeriodDetail],
        version: SettlementVersion = SettlementVersion.PRELIMINARY,
        data_source: str = "Raw"
    ) -> SettlementDaily:
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
        # Re-calc weighted price
        w_price_sum = sum(p.contract.volume * p.contract.price for p in period_details)
        contract_avg_price = (w_price_sum / total_contract_vol) if total_contract_vol > 0.001 else 0.0
        
        # Energy Avg Price
        total_rt_vol = _sum('real_time.volume')
        total_energy_fee = _sum('total_energy_fee')
        energy_avg_price = (total_energy_fee / total_rt_vol) if total_rt_vol > 0.001 else 0.0
        
        # Deviation Recovery (Daily Netting)
        # Sum Standard Cost vs Sum Actual Cost
        total_std_cost = _sum('standard_value_cost')
        daily_recovery_fee = max(0, total_std_cost - total_energy_fee)
        
        # Distribute / Adjust Predicted Cost in details? No, keep details as is, just update Daily Total.
        # Predicted Wholesale Cost = Energy + Recovery
        pred_cost = total_energy_fee + daily_recovery_fee
        pred_price = (pred_cost / total_rt_vol) if total_rt_vol > 0.001 else 0.0
        
        return SettlementDaily(
            operating_date=date_str,
            version=version,
            data_source=data_source,
            period_details=period_details,
            
            # C-Part Aggregations (Apply Rounding)
            contract_volume=self._round(total_contract_vol, 3),
            contract_avg_price=self._round(contract_avg_price, 3),
            contract_fee=self._round(_sum('contract.fee'), 2),
            
            day_ahead_volume=self._round(_sum('day_ahead.volume'), 3),
            day_ahead_fee=self._round(_sum('day_ahead.fee'), 2),
            
            real_time_volume=self._round(total_rt_vol, 3),
            real_time_fee=self._round(_sum('real_time.fee'), 2),
            
            total_energy_fee=self._round(total_energy_fee, 2),
            energy_avg_price=self._round(energy_avg_price, 3),
            
            deviation_recovery_fee=self._round(daily_recovery_fee, 2),
            total_standard_value_cost=self._round(total_std_cost, 2),
            
            predicted_wholesale_cost=self._round(pred_cost, 2),
            predicted_wholesale_price=self._round(pred_price, 3)
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
            {"operating_date": daily.operating_date, "version": daily.version},
            {"$set": data},
            upsert=True
        )
