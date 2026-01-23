from webapp.tools.mongo import DATABASE
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

RAW_METER_DATA = DATABASE['raw_meter_data']

def check_data():
    # Find a document with readings
    doc = RAW_METER_DATA.find_one({"readings": {"$exists": True, "$not": {"$size": 0}}})
    
    if doc:
        readings = doc.get("readings", [])
        meter_id = doc.get("meter_id")
        date = doc.get("date")
        logger.info(f"Found Meter: {meter_id}, Date: {date}")
        logger.info(f"Readings Length: {len(readings)}")
        logger.info(f"First 5 readings: {readings[:5]}")
        logger.info(f"Last 5 readings: {readings[-5:]}")
    else:
        logger.info("No raw meter data found.")

if __name__ == "__main__":
    check_data()
