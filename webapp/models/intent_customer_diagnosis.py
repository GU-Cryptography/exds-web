from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from webapp.models.customer import BaseMongoModel


class IntentCustomerMeterConfig(BaseModel):
    meter_id: str = Field(..., min_length=1, description="电表号")
    account_id: str = Field(..., min_length=1, description="户号")
    extracted_customer_name: Optional[str] = Field(None, description="文件中提取的用户名")
    multiplier: float = Field(1.0, gt=0, description="倍率")
    source_filename: Optional[str] = Field(None, description="来源文件名")


class IntentCustomerProfile(BaseMongoModel):
    customer_name: str = Field(..., min_length=1, description="意向客户名称")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")
    updated_at: datetime = Field(default_factory=datetime.now, description="更新时间")
    last_imported_at: Optional[datetime] = Field(None, description="最近导入时间")
    last_aggregated_at: Optional[datetime] = Field(None, description="最近聚合时间")
    coverage_start: Optional[str] = Field(None, description="覆盖开始日期")
    coverage_end: Optional[str] = Field(None, description="覆盖结束日期")
    coverage_days: int = Field(0, description="覆盖天数")
    missing_days: int = Field(0, description="缺失天数")
    completeness: float = Field(0.0, description="完整率")
    avg_daily_load: float = Field(0.0, description="日均电量")
    max_daily_load: float = Field(0.0, description="最大日电量")
    min_daily_load: float = Field(0.0, description="最小日电量")
    missing_meter_days: int = Field(0, description="缺失电表天数")
    interpolated_days: int = Field(0, description="插值天数")
    dirty_days: int = Field(0, description="脏数据天数")
    meter_count: int = Field(0, description="电表数量")
    meters: List[IntentCustomerMeterConfig] = Field(default_factory=list, description="电表配置")


class IntentCustomerListItem(BaseModel):
    id: str = Field(..., description="客户ID")
    customer_name: str = Field(..., description="客户名称")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")
    last_imported_at: Optional[datetime] = Field(None, description="最近导入时间")
    last_aggregated_at: Optional[datetime] = Field(None, description="最近聚合时间")
    coverage_start: Optional[str] = Field(None, description="覆盖开始日期")
    coverage_end: Optional[str] = Field(None, description="覆盖结束日期")
    coverage_days: int = Field(0, description="覆盖天数")
    missing_days: int = Field(0, description="缺失天数")
    completeness: float = Field(0.0, description="完整率")
    avg_daily_load: float = Field(0.0, description="日均电量")
    max_daily_load: float = Field(0.0, description="最大日电量")
    min_daily_load: float = Field(0.0, description="最小日电量")
    missing_meter_days: int = Field(0, description="缺失电表天数")
    interpolated_days: int = Field(0, description="插值天数")
    dirty_days: int = Field(0, description="脏数据天数")
    meter_count: int = Field(0, description="电表数量")


class IntentCustomerListResponse(BaseModel):
    items: List[IntentCustomerListItem] = Field(default_factory=list, description="意向客户列表")


class PreviewFileItem(BaseModel):
    filename: str = Field(..., description="文件名")
    meter_id: str = Field(..., description="电表号")
    account_id: str = Field(..., description="户号")
    extracted_customer_name: Optional[str] = Field(None, description="文件中提取的用户名")
    start_date: str = Field(..., description="开始日期")
    end_date: str = Field(..., description="结束日期")
    record_count: int = Field(..., description="解析出的日记录数")
    default_multiplier: float = Field(1.0, description="默认倍率")
    parse_errors: List[str] = Field(default_factory=list, description="解析错误")


class PreviewValidationResult(BaseModel):
    can_import: bool = Field(False, description="是否允许导入")
    errors: List[str] = Field(default_factory=list, description="阻断错误")
    warnings: List[str] = Field(default_factory=list, description="提示信息")


class PreviewResponse(BaseModel):
    suggested_customer_name: Optional[str] = Field(None, description="建议客户名称")
    files: List[PreviewFileItem] = Field(default_factory=list, description="预解析文件列表")
    validation: PreviewValidationResult = Field(default_factory=PreviewValidationResult, description="校验结果")


class ImportMeterConfig(BaseModel):
    filename: str = Field(..., min_length=1, description="文件名")
    meter_id: str = Field(..., min_length=1, description="电表号")
    account_id: str = Field(..., min_length=1, description="户号")
    multiplier: float = Field(1.0, gt=0, description="倍率")


class ImportResult(BaseModel):
    customer: IntentCustomerListItem
    imported_days: int = Field(..., description="导入日记录数")
    aggregated_days: int = Field(..., description="聚合天数")
    files: int = Field(..., description="文件数")
    message: str = Field(..., description="结果消息")


class LoadSummaryResponse(BaseModel):
    customer: IntentCustomerListItem
    month_data: List[Dict] = Field(default_factory=list, description="月度日电量数据")
    intraday_data: List[Dict] = Field(default_factory=list, description="日内48时段数据")
    selected_day_total: float = Field(0.0, description="当日电量")


class DeleteIntentCustomerRequest(BaseModel):
    password: str = Field(..., min_length=1, description="登录密码")
