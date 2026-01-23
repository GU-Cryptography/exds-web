
import logging
import sys
import os
from datetime import datetime

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from webapp.services.load_aggregation_service import LoadAggregationService
from webapp.services.diagnosis_service import DiagnosisService
from webapp.tools.mongo import DATABASE

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def debug_aggregation():
    # 1. Find a customer with Raw Meter Data
    print("Searching for a customer with Raw Meter Data...")
    raw_sample = DATABASE['raw_meter_data'].find_one()
    
    if not raw_sample:
        print("No raw meter data found.")
        return

    meter_id = raw_sample['meter_id']
    date = raw_sample['date']
    print(f"Found raw data: Meter={meter_id}, Date={date}")

    # Find which customer owns this meter
    # We need to reverse search the archive
    customer = DATABASE['customer_archives'].find_one({
        "accounts.meters.meter_id": meter_id
    })

    if not customer:
        print(f"CRITICAL: No customer found for meter_id {meter_id}! This explains why it is not aggregated.")
        # Try to find who this meter belongs to from raw data meta if possible
        if 'meta' in raw_sample:
             print(f"Meta says: {raw_sample['meta']}")
        return
    
    customer_id = str(customer['_id'])
    customer_name = customer.get('user_name')
    print(f"Customer Found: {customer_name} ({customer_id})")

    # 2. Try to aggregate for this customer and date
    print(f"\n--- Attempting Aggregation for {date} ---")
    
    # Check Unified Load Curve BEFORE
    before_doc = DATABASE['unified_load_curve'].find_one({"customer_id": customer_id, "date": date})
    print(f"Unified Doc (Before): {before_doc is not None}")
    
    # FORCE UPSERT
    success = LoadAggregationService.upsert_unified_load_curve(customer_id, date)
    print(f"Upsert Success: {success}")
    
    # Check Unified Load Curve AFTER
    after_doc = DATABASE['unified_load_curve'].find_one({"customer_id": customer_id, "date": date})
    print(f"Unified Doc (After): {after_doc is not None}")
    if after_doc:
        m_load = after_doc.get("meter_load")
        print(f"Stored Meter Load: count={m_load.get('meter_count')}, total={m_load.get('total')}")
        
    # 3. Check Diagnosis for this customer
    print(f"\n--- diagnosis check ---")
    diag = DiagnosisService.diagnose_customer(customer_id)
    print(f"Has Unaggregated: {diag['has_unaggregated']}")
    if diag['has_unaggregated']['meter']:
        print("STILL UNAGGREGATED!")

if __name__ == "__main__":
    debug_aggregation()
