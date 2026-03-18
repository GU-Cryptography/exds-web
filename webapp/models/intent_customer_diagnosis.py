from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from webapp.models.customer import BaseMongoModel


class IntentCustomerMeterConfig(BaseModel):
    meter_id: str = Field(..., min_length=1, description="???")
    account_id: str = Field(..., min_length=1, description="??")
    extracted_customer_name: Optional[str] = Field(None, description="?????????")
    multiplier: float = Field(1.0, gt=0, description="??")
    source_filename: Optional[str] = Field(None, description="?????")


class IntentCustomerProfile(BaseMongoModel):
    customer_name: str = Field(..., min_length=1, description="??????")
    created_at: datetime = Field(default_factory=datetime.now, description="????")
    updated_at: datetime = Field(default_factory=datetime.now, description="????")
    last_imported_at: Optional[datetime] = Field(None, description="??????")
    last_aggregated_at: Optional[datetime] = Field(None, description="??????")
    coverage_start: Optional[str] = Field(None, description="??????")
    coverage_end: Optional[str] = Field(None, description="??????")
    coverage_days: int = Field(0, description="????")
    missing_days: int = Field(0, description="????")
    completeness: float = Field(0.0, description="???")
    avg_daily_load: float = Field(0.0, description="????")
    max_daily_load: float = Field(0.0, description="?????")
    min_daily_load: float = Field(0.0, description="?????")
    missing_meter_days: int = Field(0, description="??????")
    interpolated_days: int = Field(0, description="????")
    dirty_days: int = Field(0, description="?????")
    meter_count: int = Field(0, description="????")
    meters: List[IntentCustomerMeterConfig] = Field(default_factory=list, description="????")


class IntentCustomerListItem(BaseModel):
    id: str = Field(..., description="??ID")
    customer_name: str = Field(..., description="????")
    created_at: datetime = Field(..., description="????")
    updated_at: datetime = Field(..., description="????")
    last_imported_at: Optional[datetime] = Field(None, description="??????")
    last_aggregated_at: Optional[datetime] = Field(None, description="??????")
    coverage_start: Optional[str] = Field(None, description="??????")
    coverage_end: Optional[str] = Field(None, description="??????")
    coverage_days: int = Field(0, description="????")
    missing_days: int = Field(0, description="????")
    completeness: float = Field(0.0, description="???")
    avg_daily_load: float = Field(0.0, description="????")
    max_daily_load: float = Field(0.0, description="?????")
    min_daily_load: float = Field(0.0, description="?????")
    missing_meter_days: int = Field(0, description="??????")
    interpolated_days: int = Field(0, description="????")
    dirty_days: int = Field(0, description="?????")
    meter_count: int = Field(0, description="????")


class IntentCustomerListResponse(BaseModel):
    items: List[IntentCustomerListItem] = Field(default_factory=list, description="??????")


class PreviewFileItem(BaseModel):
    filename: str = Field(..., description="???")
    meter_id: str = Field(..., description="???")
    account_id: str = Field(..., description="??")
    extracted_customer_name: Optional[str] = Field(None, description="?????????")
    start_date: str = Field(..., description="????")
    end_date: str = Field(..., description="????")
    record_count: int = Field(..., description="?????")
    default_multiplier: float = Field(1.0, description="????")
    parse_errors: List[str] = Field(default_factory=list, description="????")


class PreviewValidationResult(BaseModel):
    can_import: bool = Field(False, description="??????")
    errors: List[str] = Field(default_factory=list, description="????")
    warnings: List[str] = Field(default_factory=list, description="????")


class PreviewResponse(BaseModel):
    suggested_customer_name: Optional[str] = Field(None, description="??????")
    files: List[PreviewFileItem] = Field(default_factory=list, description="?????")
    validation: PreviewValidationResult = Field(default_factory=PreviewValidationResult, description="????")


class ImportMeterConfig(BaseModel):
    filename: str = Field(..., min_length=1, description="???")
    meter_id: str = Field(..., min_length=1, description="???")
    account_id: str = Field(..., min_length=1, description="??")
    multiplier: float = Field(1.0, gt=0, description="??")


class ImportResult(BaseModel):
    customer: IntentCustomerListItem
    imported_days: int = Field(..., description="???????")
    aggregated_days: int = Field(..., description="????")
    files: int = Field(..., description="????")
    message: str = Field(..., description="????")


class LoadSummaryResponse(BaseModel):
    customer: IntentCustomerListItem
    month_data: List[Dict] = Field(default_factory=list, description="???????")
    intraday_data: List[Dict] = Field(default_factory=list, description="??48????")
    selected_day_total: float = Field(0.0, description="??????")


class DeleteIntentCustomerRequest(BaseModel):
    password: str = Field(..., min_length=1, description="????")


class IntentWholesaleMonthlySummaryRow(BaseModel):
    settlement_month: str = Field(..., description="????")
    total_energy_mwh: float = Field(0.0, description="???(MWh)")
    daily_cost_total: float = Field(0.0, description="??????(?)")
    daily_cost_unit_price: float = Field(0.0, description="??????(?/MWh)")
    surplus_unit_price: float = Field(0.0, description="????????(?/MWh)")
    surplus_cost: float = Field(0.0, description="??????(?)")
    total_cost: float = Field(0.0, description="?????(?)")
    unit_cost_yuan_per_mwh: float = Field(0.0, description="????(?/MWh)")
    unit_cost_yuan_per_kwh: float = Field(0.0, description="????(?/kWh)")
    status: str = Field("success", description="????")
    message: str = Field("", description="????")


class IntentWholesalePeriodDetail(BaseModel):
    period: int = Field(..., description="????")
    time_label: str = Field(..., description="????")
    load_mwh: float = Field(0.0, description="??(MWh)")
    daily_cost_total: float = Field(0.0, description="??????(?)")
    surplus_cost: float = Field(0.0, description="??????(?)")
    total_cost: float = Field(0.0, description="???(?)")
    period_type: str = Field("平段", description="????")
    daily_cost_unit_price: float = Field(0.0, description="??????(?/MWh)")
    final_unit_price: float = Field(0.0, description="??????(?/MWh)")


class IntentWholesaleDailyDetail(BaseModel):
    date: str = Field(..., description="??")
    total_energy_mwh: float = Field(0.0, description="???(MWh)")
    daily_cost_total: float = Field(0.0, description="??????(?)")
    surplus_cost: float = Field(0.0, description="??????(?)")
    total_cost: float = Field(0.0, description="???(?)")
    unit_cost_yuan_per_mwh: float = Field(0.0, description="????(?/MWh)")


class IntentWholesaleMonthlyDetail(BaseModel):
    settlement_month: str = Field(..., description="????")
    summary: IntentWholesaleMonthlySummaryRow = Field(..., description="????")
    period_details: List[IntentWholesalePeriodDetail] = Field(default_factory=list, description="48????")
    daily_details: List[IntentWholesaleDailyDetail] = Field(default_factory=list, description="????")


class IntentWholesaleSimulationResponse(BaseModel):
    customer: IntentCustomerListItem = Field(..., description="????")
    summary_rows: List[IntentWholesaleMonthlySummaryRow] = Field(default_factory=list, description="?????")
    month_details: List[IntentWholesaleMonthlyDetail] = Field(default_factory=list, description="????")


class IntentRetailPackageOption(BaseModel):
    package_id: str = Field(..., description="??ID")
    package_name: str = Field(..., description="????")
    package_type: Optional[str] = Field(None, description="????")
    model_code: Optional[str] = Field(None, description="????")
    is_green_power: bool = Field(False, description="??????")
    status: Optional[str] = Field(None, description="??")


class IntentRetailPackageOptionsResponse(BaseModel):
    items: List[IntentRetailPackageOption] = Field(default_factory=list, description="??????")


class IntentRetailCalculatedPackageItem(BaseModel):
    package_id: str = Field(..., description="??ID")
    package_name: str = Field(..., description="????")
    model_code: Optional[str] = Field(None, description="????")
    updated_at: Optional[datetime] = Field(None, description="??????")


class IntentRetailCalculatedPackagesResponse(BaseModel):
    items: List[IntentRetailCalculatedPackageItem] = Field(default_factory=list, description="???????")


class IntentDeleteResultResponse(BaseModel):
    deleted_count: int = Field(0, description="?????")
    message: str = Field("", description="????")


class IntentRetailMonthResultRow(BaseModel):
    settlement_month: str = Field(..., description="????")
    total_energy_mwh: float = Field(0.0, description="???(MWh)")
    wholesale_unit_price: float = Field(0.0, description="????(?/MWh)")
    wholesale_amount: float = Field(0.0, description="????(?)")
    retail_unit_price: float = Field(0.0, description="????(?/MWh)")
    retail_amount: float = Field(0.0, description="????(?)")
    monthly_gross_profit: float = Field(0.0, description="???(?)")
    price_spread_per_mwh: float = Field(0.0, description="????(?/MWh)")
    is_capped: bool = Field(False, description="????")


class IntentRetailMonthResultsResponse(BaseModel):
    customer: IntentCustomerListItem = Field(..., description="????")
    package_id: str = Field(..., description="??ID")
    package_name: str = Field(..., description="????")
    rows: List[IntentRetailMonthResultRow] = Field(default_factory=list, description="??????")


class IntentRetailSimulationRequest(BaseModel):
    package_id: str = Field(..., min_length=1, description="??ID")


class IntentRetailSimulationDetailResponse(BaseModel):
    customer_id: str = Field(..., description="??ID")
    customer_name: str = Field(..., description="????")
    settlement_month: str = Field(..., description="????")
    package_id: str = Field(..., description="??ID")
    package_name: str = Field(..., description="????")
    model_code: Optional[str] = Field(None, description="????")
    price_model: Dict = Field(default_factory=dict, description="??????")
    pre_stage: Dict = Field(default_factory=dict, description="?????")
    sttl_stage: Dict = Field(default_factory=dict, description="?????")
    refund_context: Dict = Field(default_factory=dict, description="?????")
    final_stage: Dict = Field(default_factory=dict, description="????")
    period_details: List[Dict] = Field(default_factory=list, description="48????")
    daily_details: List[Dict] = Field(default_factory=list, description="????")
    final_energy_mwh: float = Field(0.0, description="????")
    final_retail_fee: float = Field(0.0, description="??????")
    final_retail_unit_price: float = Field(0.0, description="??????")
    final_wholesale_fee: float = Field(0.0, description="??????")
    final_wholesale_unit_price: float = Field(0.0, description="??????")
    final_gross_profit: float = Field(0.0, description="????")
    final_price_spread_per_mwh: float = Field(0.0, description="??????")
    final_excess_refund_fee: float = Field(0.0, description="??????")
    sttl_balancing_energy_mwh: float = Field(0.0, description="????")
    sttl_balancing_retail_fee: float = Field(0.0, description="??????")
    sttl_balancing_wholesale_fee: float = Field(0.0, description="??????")
