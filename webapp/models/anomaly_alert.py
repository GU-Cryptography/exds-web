"""
异动告警数据模型
用于追踪客户用电异动历史
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from enum import Enum


class AlertSeverity(str, Enum):
    """告警严重程度"""
    LOW = "low"           # 低：仅作记录
    WARNING = "warning"   # 中：需关注
    CRITICAL = "critical" # 高：需立即处理


class AnomalyAlert(BaseModel):
    """
    异动告警记录
    每次检测到异动时创建一条记录，用于历史追踪
    """
    customer_id: str = Field(..., description="客户ID")
    customer_name: str = Field(..., description="客户名称")
    alert_date: str = Field(..., description="异动发生日期 (YYYY-MM-DD)")
    alert_type: str = Field(..., description="异动类型 (如: 规律异动, 力度异动)")
    severity: AlertSeverity = Field(default=AlertSeverity.WARNING, description="严重程度")
    confidence: float = Field(..., ge=0, le=1, description="置信度 (0-1)")
    reason: str = Field(..., description="触发原因详细说明")
    
    # 关键指标快照
    metrics: Dict[str, Any] = Field(default_factory=dict, description="触发时的关键指标")
    
    # 元数据
    rule_id: str = Field(..., description="触发规则ID")
    created_at: datetime = Field(default_factory=datetime.now)
    
    # 确认机制
    acknowledged: bool = Field(default=False, description="是否已处理")
    acknowledged_by: Optional[str] = Field(default=None, description="处理人")
    acknowledged_at: Optional[datetime] = Field(default=None, description="处理时间")
    notes: Optional[str] = Field(default=None, description="备注")


# 异动类型到严重程度的映射
ALERT_TYPE_SEVERITY_MAP = {
    "形状异动": AlertSeverity.WARNING,
    "重心异动": AlertSeverity.LOW,
    "力度异动": AlertSeverity.WARNING,
    "规律异动": AlertSeverity.WARNING,
    "剧烈异动": AlertSeverity.CRITICAL,
    "日环比突变": AlertSeverity.CRITICAL,
    "用电异动": AlertSeverity.WARNING,  # IsolationForest 兜底
}


def get_severity_for_alert_type(alert_type: str, confidence: float = 0.5) -> AlertSeverity:
    """
    根据异动类型和置信度确定严重程度
    高置信度可能升级严重程度
    """
    base_severity = ALERT_TYPE_SEVERITY_MAP.get(alert_type, AlertSeverity.WARNING)
    
    # 高置信度 (>0.8) 升级一档
    if confidence > 0.8:
        if base_severity == AlertSeverity.LOW:
            return AlertSeverity.WARNING
        elif base_severity == AlertSeverity.WARNING:
            return AlertSeverity.CRITICAL
    
    return base_severity
