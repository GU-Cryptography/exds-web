from enum import Enum

class FusionStrategy(str, Enum):
    MP_PRIORITY = "mp_priority"      # 计量点优先
    METER_PRIORITY = "meter_priority"  # 电表优先
    MP_ONLY = "mp_only"              # 仅计量点
    METER_ONLY = "meter_only"        # 仅电表
    MP_COMPLETE = "mp_complete"      # MP完整优先（否则回退电表）
