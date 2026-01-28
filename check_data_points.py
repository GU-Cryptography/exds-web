
import os
import sys
import logging
import pymongo
from datetime import datetime
import configparser

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def get_db():
    """Connect to MongoDB using config or defaults"""
    # Try to read config
    config_path = os.path.expanduser("~/.exds/config.ini")
    db_uri = "mongodb://localhost:27017/"
    db_name = "exds"
    
    if os.path.exists(config_path):
        try:
            config = configparser.ConfigParser()
            config.read(config_path)
            if 'mongodb' in config:
                if 'uri' in config['mongodb']:
                    db_uri = config['mongodb']['uri']
                if 'database' in config['mongodb']:
                    db_name = config['mongodb']['database']
        except Exception as e:
            logger.warning(f"Failed to read config: {e}")

    logger.info(f"Connecting to {db_uri}, DB: {db_name}")
    client = pymongo.MongoClient(db_uri)
    return client[db_name]

def check_curve_points():
    try:
        db = get_db()
        collection = db['unified_load_curve']
        
        logger.info("Scanning unified_load_curve for point counts...")
        
        # Aggregate to count lengths of 'values' array
        pipeline = [
            {
                "$project": {
                    "date": 1,
                    "customer_id": 1,
                    "point_count": {"$size": {"$ifNull": ["$values", []]}}
                }
            },
            {
                "$group": {
                    "_id": "$point_count",
                    "count": {"$sum": 1},
                    "examples": {"$push": {"date": "$date", "cid": "$customer_id"}}
                }
            }
        ]
        
        results = list(collection.aggregate(pipeline))
        
        print("\n=== Curve Data Point Count Distribution ===")
        for res in results:
            point_count = res['_id']
            doc_count = res['count']
            print(f"Points: {point_count}, Documents: {doc_count}")
            
            # Print first few examples for non-48
            if point_count != 48:
                print(f"  Examples (up to 5):")
                for ex in res['examples'][:5]:
                    print(f"    Date: {ex['date']}, Customer: {ex['cid']}")
        
        print("===========================================\n")
        
    except Exception as e:
        logger.error(f"Error checking data: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_curve_points()
