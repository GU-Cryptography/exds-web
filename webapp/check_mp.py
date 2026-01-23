from webapp.tools.mongo import DATABASE
import sys

# Add project root to path
# sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

RAW_MP_DATA = DATABASE['raw_mp_data']
sample = RAW_MP_DATA.find_one()
print(sample)
