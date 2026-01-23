import logging
import sys
import os

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bson import ObjectId
from webapp.services.diagnosis_service import DiagnosisService
from webapp.tools.mongo import DATABASE

RAW_METER_DATA = DATABASE['raw_meter_data']

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def debug_diagnosis():
    # 3. Check Customer Archives for meter mapping
    print("\n--- Customer Archives Inspection ---")
    customer = DiagnosisService.get_signed_customers()[0] # get one signed
    full_customer = DATABASE['customer_archives'].find_one({"_id": ObjectId(customer['customer_id'])})
    if not full_customer:
          full_customer = DATABASE['customer_archives'].find_one({"_id": customer['customer_id']})
    
    if full_customer:
        print(f"Customer: {full_customer.get('user_name')}")
        for acc in full_customer.get('accounts', []):
             print(f"Account: {acc.get('account_id')}")
             print(f"Meters: {acc.get('meters')}")
             print(f"MPs: {acc.get('metering_points')}")

    # 2. Diagnose the first customer to see logs
    # Or find a specific customer if known issues exist
    target_customer = customers[0]
    print(f"Diagnosing customer: {target_customer['customer_name']} ({target_customer['customer_id']})")
    
    result = DiagnosisService.diagnose_customer(target_customer['customer_id'])
    
    print("\nDiagnosis Result:")
    print(f"Has Unaggregated MP: {result['has_unaggregated']['mp']}")
    print(f"Has Unaggregated Meter: {result['has_unaggregated']['meter']}")
    # print(result)

if __name__ == "__main__":
    debug_diagnosis()
