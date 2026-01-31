# Thresholds & Constants for Characteristic Analysis

# ----- Long Term -----
TREND_SLOPE_THRESHOLD = 0.001      # 趋势斜率阈值 (归一化后, 0.001 approx 0.1%/day = 36% annual growth)
SEASONALITY_STRENGTH_THRESHOLD = 0.4 # 季节性强度阈值
STABILITY_CV_THRESHOLD = 0.2      # 稳定性-离散系数阈值
ZERO_COUNT_RATIO_THRESHOLD = 0.2  # 停产-零值比例阈值

# ----- Short Term -----
# 班次
SHIFT_LOAD_RATE_THRESHOLD = 0.6   # 连续生产-平均负荷率阈值

# ----- Anomaly -----
ANOMALY_CONFIDENCE_DEFAULT = 0.8
