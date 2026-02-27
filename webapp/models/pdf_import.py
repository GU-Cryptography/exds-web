from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class MeterPointData(BaseModel):
    meter_id: str
    measuring_point: str
    voltage_level: str

class ParsePdfResponse(BaseModel):
    customer_name: Optional[str] = None
    customer_short_name: Optional[str] = None
    period: Optional[str] = None
    package_name: Optional[str] = None
    total_electricity: Optional[float] = None
    attachment2: List[MeterPointData] = []
    location: Optional[str] = None
    is_customer_new: bool = False
    is_package_new: bool = False
    is_contract_duplicate: bool = False
    duplicate_contract_id: Optional[str] = None

class ImportCreateRequest(BaseModel):
    customer_name: str
    customer_short_name: str
    location: Optional[str] = None
    period: str
    package_name: str
    total_electricity: float
    attachment2: List[MeterPointData] = []
