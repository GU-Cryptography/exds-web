
import sys
import os
import logging
from datetime import date

# Add project root to path
sys.path.append(os.getcwd())

# Configuration for logging
logging.basicConfig(level=logging.INFO)

from webapp.services.total_load_service import TotalLoadService
from webapp.tools.mongo import DATABASE

def test_intraday_tou():
    service = TotalLoadService()
    today = date.today().isoformat()
    print(f"Testing for date: {today}")
    
    # Mocking customer list if needed, or relying on actual DB
    # If DB is empty, we might not get data, but valid date should trigger TOU lookup
    
    try:
        result = service.get_intraday_curve(target_date=today)
        target = result.get('target')
        
        if not target:
            print("No target data returned.")
            return

        points = target.get('points', [])
        print(f"Returned {len(points)} points.")
        
        tou_counts = {}
        for p in points:
            ptype = p.get('period_type')
            tou_counts[ptype] = tou_counts.get(ptype, 0) + 1
            
        print("Period Type Distribution:")
        print(tou_counts)
        
        # Check specific sample
        if points:
            print("Sample point:", points[0])
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_intraday_tou()
