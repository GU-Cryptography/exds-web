import sys
import os
from pymongo import MongoClient

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

try:
    from webapp.tools.mongo import CUSTOMER_ARCHIVES
except Exception as e:
    print(f"Webapp import failed: {e}")
    print("Attempting manual connection using ~/.exds/config.ini...")
    
    import configparser
    config = configparser.ConfigParser()
    config_path = os.path.expanduser('~/.exds/config.ini')
    
    if os.path.exists(config_path):
        config.read(config_path, encoding='utf-8')
        uri = config.get('MONGODB', 'uri', fallback='mongodb://localhost:27017/')
        db_name = config.get('MONGODB', 'database', fallback='exds')
    else:
        uri = 'mongodb://localhost:27017/'
        db_name = 'exds'
        
    print(f"Connecting to {uri} (DB: {db_name})")
    client = MongoClient(uri)
    db = client[db_name]
    CUSTOMER_ARCHIVES = db["customer_archives"]

def init_coefficients():
    print("Starting coefficient initialization...")
    customers = list(CUSTOMER_ARCHIVES.find({}))
    total_updated = 0
    total_meters = 0
    
    for customer in customers:
        updated = False
        accounts = customer.get("accounts", [])
        
        for account in accounts:
            meters = account.get("meters", [])
            for meter in meters:
                total_meters += 1
                if meter.get("allocation_ratio") is None:
                    meter["allocation_ratio"] = 1.0
                    updated = True
        
        if updated:
            CUSTOMER_ARCHIVES.update_one(
                {"_id": customer["_id"]},
                {"$set": {"accounts": accounts}}
            )
            total_updated += 1
            print(f"Updated customer: {customer.get('name', 'Unknown')}")

    print(f"Initialization complete.")
    print(f"Total customers processed: {len(customers)}")
    print(f"Total customers updated: {total_updated}")
    print(f"Total meters checked: {total_meters}")

if __name__ == "__main__":
    init_coefficients()
