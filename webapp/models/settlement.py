from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Any, Union
from datetime import datetime
from enum import Enum
from bson import ObjectId

class PyObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler):
        from pydantic_core import core_schema
        return core_schema.union_schema([
            core_schema.is_instance_schema(ObjectId),
            core_schema.no_info_plain_validator_function(cls.validate),
        ], serialization=core_schema.plain_serializer_function_ser_schema(
            lambda x: str(x)
        ))

    @classmethod
    def validate(cls, v):
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str):
            if not ObjectId.is_valid(v):
                raise ValueError("Invalid ObjectId")
            return ObjectId(v)
        raise ValueError("Invalid ObjectId")

class BaseMongoModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True
    )

    id: PyObjectId = Field(default_factory=PyObjectId, alias="_id")

# --- 定位版本枚举 ---

class SettlementVersion(str, Enum):
    """
    结算版本枚举
    """
    PRELIMINARY = "PRELIMINARY"           # 版本1: 基于系统原始数据的初步预结算
    PLATFORM_DAILY = "PLATFORM_DAILY"     # 版本2: 基于平台发布的日结数据计算 (确权)
    PLATFORM_MONTHLY = "PLATFORM_MONTHLY" # 版本3: 基于平台月度统计参数计算 (终清)

# --- 组件模型 ---

class ContractComponent(BaseModel):
    """中长期合同组件"""
    volume: float = Field(..., description="合同电量 (MWh)")
    price: float = Field(..., description="合同价格 (元/MWh)")
    fee: float = Field(..., description="中长期差价费 (元)")
    avg_price: Optional[float] = Field(None, description="合同均价 (仅在汇总层使用)")

class EnergyComponent(BaseModel):
    """通用电能量组件 (日前/实时)"""
    volume: float = Field(..., description="电量 (MWh)")
    price: float = Field(..., description="价格 (元/MWh)")
    fee: float = Field(..., description="费用 (元)")

# --- 分时明细模型 ---

class SettlementPeriodDetail(BaseModel):
    """
    分时结算明细 (48点)
    对应 Implementation Plan Tbale B
    """
    period: int = Field(..., description="时段号 (1-48)")
    
    # 基础数据
    mechanism_volume: float = Field(0.0, description="机制电量 (MWh)")
    
    # 各市场成分
    contract: ContractComponent = Field(..., description="中长期分量")
    day_ahead: EnergyComponent = Field(..., description="日前分量")
    real_time: EnergyComponent = Field(..., description="实时分量")
    
    # 汇总
    total_energy_fee: float = Field(..., description="电能量电费合计")
    energy_avg_price: float = Field(..., description="结算均价")
    
    # 偏差考核
    contract_ratio: float = Field(..., description="签约比例 (%)")
    standard_value_cost: float = Field(..., description="标准值费用 (模拟)")
    # 偏差考核
    contract_ratio: float = Field(..., description="签约比例 (%)")
    standard_value_cost: float = Field(..., description="标准值费用 (模拟)")


# --- 日结算主模型 ---

class SettlementDaily(BaseMongoModel):
    """
    每日预结算单
    对应 Implementation Plan Table A & C
    """
    # A. 基础信息
    operating_date: str = Field(..., description="结算日期 YYYY-MM-DD")
    version: Union[SettlementVersion, int] = Field(SettlementVersion.PRELIMINARY, description="计算版本")
    data_source: Optional[str] = Field("Raw", description="数据来源说明")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    
    # C. 日汇总数据 (由 Period Details 聚合)
    # 中长期
    contract_volume: float = Field(..., description="中长期合同电量")
    contract_avg_price: float = Field(..., description="中长期合同均价")
    contract_fee: float = Field(..., description="中长期差价电费")
    
    # 日前
    day_ahead_volume: float = Field(..., description="日前出清电量")
    day_ahead_fee: float = Field(..., description="日前差价电费")
    
    # 实时
    real_time_volume: float = Field(..., description="实际用电量")
    real_time_fee: float = Field(..., description="实时全电量电费")
    
    # 汇总
    total_energy_fee: float = Field(..., description="电能量电费合计")
    energy_avg_price: float = Field(..., description="结算均价")
    
    # 考核
    deviation_recovery_fee: float = Field(..., description="偏差回收费用 (累加)")
    total_standard_value_cost: float = Field(..., description="标准值模拟费用合计 (用于Max计算)")
    
    # 预测 (新增字段)
    predicted_wholesale_cost: float = Field(..., description="预测批发总费用 (Total + Recovery)")
    predicted_wholesale_price: float = Field(..., description="预测批发均价 (Predicted / Total_RT_Vol)")
    
    # --- 分时明细 ---
    period_details: List[SettlementPeriodDetail] = Field(..., description="48点明细")

    class Config:
        collection_name = "settlement_daily"
