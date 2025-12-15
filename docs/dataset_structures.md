# EXDS-RPA 数据集结构文档

本文档详细描述了 EXDS-RPA 项目中涉及的所有核心数据集（MongoDB 集合）的结构、字段含义及索引配置。


## 1. `weekly_forecast` - 周预测数据

该集合统一存储所有类型的周预测数据，通过 `info_name` 字段区分。

- **数据来源**: `rpa.pipelines.weekly_forecast`
- **更新频率**: 每周

### 1.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[复合主键]** 数据点对应的精确日期和时间。 |
| `info_name` | String | **[复合主键]** 信息名称，用于区分数据类型。可能的值包括: "系统负荷预测", "统调风电", "统调水电(含抽蓄)", "统调光伏", "省间联络线容量"。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `value` | Number | 预测值，精度4位小数。 |

### 1.2. 索引

- `(datetime: 1, info_name: 1)`: 唯一复合索引，确保每个时间点每种信息的数据唯一。
- `(date_str: 1)`: 普通索引，用于按日期查询。

## 2. `daily_release` - 每日预测数据（短期预测）

该集合存储每日发布的日前预测数据，如系统负荷、新能源出力等。

- **数据来源**: `rpa.pipelines.daily_release`
- **更新频率**: 每日

### 2.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `system_load_forecast` | Number | 短期系统负荷预测值 (MW)。 |
| `pv_forecast` | Number | 短期光伏总加预测值 (MW)。 |
| `wind_forecast` | Number | 短期风电总加预测值 (MW)。 |
| `tieline_plan` | Number | 联络线总计划值 (MW)。 |
| `nonmarket_unit_forecast` | Number | 非市场化机组出力预测值 (MW)。 |

### 2.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一性。

---


## 3. `real_time_generation` - 实时发电出力

该集合存储各类机组的实时发电出力和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 3.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `total_generation` | Number | 全网总出力 (MW)，精度4位小数。 |
| `total_generation_energy` | Number | 全网总出力电量 (MWh)，精度4位小数。 |
| `thermal_generation` / `_energy` | Number | 火电出力/电量，精度4位小数。 |
| `hydro_generation` / `_energy` | Number | 水电出力/电量，精度4位小数。 |
| `pumped_storage_generation` / `_energy` | Number | 抽蓄出力/电量，精度4位小数。 |
| `wind_generation` / `_energy` | Number | 风电出力/电量，精度4位小数。 |
| `solar_generation` / `_energy` | Number | 光电出力/电量，精度4位小数。 |
| `battery_storage_generation` / `_energy` | Number | 储能出力/电量，精度4位小数。 |
| `non_market_total_generation` | Number | 非市场化机组总出力 (MW)，精度4位小数。 |
| `renewable_total_generation` | Number | 新能源总出力 (MW)，精度4位小数。 |
| `hydro_with_pumped_total_generation` | Number | 水电（含抽蓄）总出力 (MW)，精度4位小数。 |

### 3.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

---
---

## 4. `actual_operation` - 实际运行数据

该集合存储电网的实际运行数据，包括系统负荷、联络线潮流、正负备用等关键运行指标。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 4.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `positive_reserve` | Number | 正负荷备用 (MW)，精度4位小数。 |
| `negative_reserve` | Number | 负负荷备用 (MW)，精度4位小数。 |
| `system_load` | Number | 系统负荷 (MW)，精度4位小数。 |
| `tieline_flow` | Number | 联络线通道潮流 (MW)，精度4位小数。 |


### 4.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

### 4.3. 数据说明

- **数据粒度**: 15分钟，每天96个数据点。
- **数据范围**: 下载到前一天（T-1），与实时现货价格、实时发电出力保持一致。
- **业务意义**:
  - `positive_reserve` 和 `negative_reserve`: 系统正负备用容量，用于应对负荷波动和紧急情况。
  - `system_load`: 电网实际系统负荷，反映全网用电需求。
  - `tieline_flow`: 省间联络线的实际潮流值。


---

## 5. `weather_data` - 天气数据

该集合存储从 Open-Meteo API 获取的历史和预测天气数据，并经过处理以匹配业务需求。

- **数据来源**: `rpa.pipelines.download_weather`
- **更新频率**: 每日（可配置）

### 5.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `target_timestamp` | ISODate | **[复合主键]** 数据点对应的精确日期和时间。 |
| `location_id` | String | **[复合主键]** 地点名称，与 `customer` 集合中的 `district` 对应。 |
| `is_forecast` | Boolean | 标记此条记录是预测数据 (`true`) 还是历史数据 (`false`)。 |
| `creation_timestamp` | ISODate | 记录的创建或更新时间戳（UTC）。对于历史数据，此值等于 `target_timestamp`。 |
| `apparent_temperature` | Number | 体感温度 (°C)。 |
| `shortwave_radiation` | Number | 短波辐射 (W/m²)。 |
| `wind_speed_10m` | Number | 10米高空风速 (m/s)。 |
| `relative_humidity_2m` | Number | 2米高相对湿度 (%)。 |
| `precipitation` | Number | 降水量 (mm)。 |
| `cloud_cover` | Number | 云量 (%)。 |
| `wind_speed_100m` | Number | 100米高空风速 (m/s)。 |

### 5.2. 索引

- `(location_id: 1, target_timestamp: 1)`: 唯一复合索引，确保每个地点在每个时间点的数据唯一性。
- `(location_id: 1, is_forecast: 1, target_timestamp: -1)`: 普通复合索引，用于快速查询某个地点的最新历史或预测数据。

---

附录：

## 1. `real_time_spot_price` - 实时现货价格

该集合存储实时的现货市场出清价格和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 1.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `total_clearing_power` | Number | 出清总电量 (MWh)，精度4位小数。 |
| `thermal_clearing_power` | Number | 火电出清电量 (MWh)，精度4位小数。 |
| `hydro_clearing_power` | Number | 水电出清电量 (MWh)，精度4位小数。 |
| `wind_clearing_power` | Number | 风电出清电量 (MWh)，精度4位小数。 |
| `solar_clearing_power` | Number | 光伏出清电量 (MWh)，精度4位小数。 |
| `pumped_storage_clearing_power` | Number | 抽蓄出清电量 (MWh)，精度4位小数。 |
| `battery_storage_clearing_power` | Number | 储能出清电量 (MWh)，精度4位小数。 |
| `avg_clearing_price` | Number | 出清均价 (元/MWh)，精度2位小数。 |

### 1.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

---

## 2. `day_ahead_spot_price` - 日前现货价格

该集合存储日前的现货市场出清价格和电量信息，其结构与 `real_time_spot_price` 完全相同。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日
- **字段说明**: 同 `real_time_spot_price`。
- **索引**: 同 `real_time_spot_price`。

---

## 6. `fuel_futures_data` - 燃料期货数据

该集合存储燃料期货（动力煤、焦煤、原油）的日频价格数据，用于辅助电力成本预测。

- **数据来源**: `pipelines/download_fuel_futures.py`
- **更新频率**: 每日
- **数据粒度**: 日频

### 6.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `date` | ISODate | **[主键]** 数据对应的日期（00:00:00）。 |
| `thermal_coal` | Object | 动力煤 (ZC0) 数据对象。 |
| `thermal_coal.close` | Number | 收盘价。 |
| `thermal_coal.open` | Number | 开盘价。 |
| `thermal_coal.high` | Number | 最高价。 |
| `thermal_coal.low` | Number | 最低价。 |
| `thermal_coal.volume` | Number | 成交量。 |
| `thermal_coal.open_interest` | Number | 持仓量。 |
| `thermal_coal.is_valid` | Boolean | 数据有效性标志 (基于持仓量判定)。 |
| `coking_coal` | Object | 焦煤 (JM0) 数据对象，结构同上。 |
| `crude_oil` | Object | 原油 (SC0) 数据对象，结构同上。 |
| `created_at` | ISODate | 记录创建时间。 |
| `updated_at` | ISODate | 记录更新时间。 |

### 6.2. 索引

- `(date: 1)`: 唯一索引，确保每天只有一条记录。

## 输出数据集合详细说明

## 8. `price_forecast_results` - 价格预测结果

该集合存储日前价格预测模型的输出结果，支持 D-1 和 D-2 两种预测模式。

**业务价值**:
- 为交易决策提供日前价格预测
- 支持历史预测结果回溯和性能评估
- 区分不同预测视野（D-1 近期 vs D-2 远期）

- **数据来源**: 模型预测输出
- **更新频率**: 每个工作日
- **数据粒度**: 15分钟，每个目标日96个数据点
- **预测范围**: 
  - D-1 预测：D 日（次日1天）
  - D-2 预测：D ~ D+9 日（10个目标日，共960个预测点）

### 8.1 字段说明

| 字段名 | 数据类型 | 描述 | 示例 |
| :--- | :--- | :--- | :--- |
| `forecast_id` | String | **[复合主键]** 预测批次唯一标识 | "20250117_0920" |
| `forecast_type` | String | **[复合主键]** 预测类型：`d1_price` 或 `d2_price` | "d1_price" |
| `forecast_date` | ISODate | **[复合主键]** 预测执行日期 | 2025-01-17 00:00 |
| `target_date` | ISODate | **[复合主键]** 目标日期 | 2025-01-18 00:00 |
| `datetime` | ISODate | **[复合主键]** 具体时间点（业务日96点） | 2025-01-18 00:15 |
| `predicted_price` | Number | 预测价格 (元/MWh)，精度2位小数 | 350.25 |
| `confidence_80_lower` | Number | 80%置信区间下界 (元/MWh) | 320.50 |
| `confidence_80_upper` | Number | 80%置信区间上界 (元/MWh) | 380.00 |
| `confidence_90_lower` | Number | 90%置信区间下界 (元/MWh) | 310.00 |
| `confidence_90_upper` | Number | 90%置信区间上界 (元/MWh) | 390.50 |
| `model_type` | String | 模型标识 | "d1_price_model" 或 "d2_near_term" |
| `model_version` | String | 模型版本 | "v1.0.3" |
| `created_at` | ISODate | 记录创建时间（UTC） | 2025-01-17 09:25 |

### 8.2 预测类型定义

| forecast_type | 说明 | 执行时间 | 预测范围 |
| :--- | :--- | :--- | :--- |
| `d1_price` | D-1 日前价格预测 | D-1 日 09:20 | D 日（次日） |
| `d2_price` | D-2 日前价格预测 | D-2 日 09:20 | D ~ D+9 日（10天） |

### 8.3 索引配置

```javascript
// 复合唯一索引（包含 forecast_type）
db.price_forecast_results.createIndex({
    "forecast_id": 1,
    "forecast_type": 1,
    "target_date": 1,
    "datetime": 1
}, { unique: true })

// 按类型和日期查询
db.price_forecast_results.createIndex({ "forecast_type": 1, "target_date": 1, "datetime": 1 })
db.price_forecast_results.createIndex({ "forecast_date": 1, "target_date": 1 })
```

### 8.4 数据示例

**D-1 预测**:
```json
{
    "forecast_id": "20250117_0920",
    "forecast_type": "d1_price",
    "forecast_date": ISODate("2025-01-17T00:00:00Z"),
    "target_date": ISODate("2025-01-18T00:00:00Z"),
    "datetime": ISODate("2025-01-18T00:15:00Z"),
    "predicted_price": 350.25,
    "confidence_80_lower": 320.50,
    "confidence_80_upper": 380.00,
    "confidence_90_lower": 310.00,
    "confidence_90_upper": 390.50,
    "model_type": "d1_price_model",
    "model_version": "v1.0.0",
    "created_at": ISODate("2025-01-17T09:25:30Z")
}
```

**D-2 预测**:
```json
{
    "forecast_id": "20250117_0920",
    "forecast_type": "d2_price",
    "forecast_date": ISODate("2025-01-17T00:00:00Z"),
    "target_date": ISODate("2025-01-19T00:00:00Z"),
    "datetime": ISODate("2025-01-19T00:15:00Z"),
    "predicted_price": 365.50,
    "confidence_80_lower": 330.00,
    "confidence_80_upper": 400.00,
    "confidence_90_lower": 315.00,
    "confidence_90_upper": 415.00,
    "model_type": "d2_near_term",
    "model_version": "v2.0.0",
    "created_at": ISODate("2025-01-17T09:25:30Z")
}
```

## 9. `forecast_accuracy_daily` - 预测准确度日报

该集合存储各类预测模型的**日级别准确度评估结果**，支持多种预测类型和客户维度。

**业务价值**:
- 持续监控各类预测模型性能
- 支持多客户负荷预测准确度追踪
- 识别模型退化趋势
- 分析影响准确度的因素（负价格、极端天气等）

- **数据来源**: 定时任务自动计算
- **更新频率**: 每日（T+1 回测）
- **数据粒度**: 日级别（每个预测类型+客户每天 1 条记录）

### 9.1 字段说明

| 字段名 | 数据类型 | 描述 | 用途 |
| :--- | :--- | :--- | :--- |
| `target_date` | ISODate | **[复合主键]** 预测目标日期 | 时间索引 |
| `forecast_type` | String | **[复合主键]** 预测类型（见下表） | 区分预测类型 |
| `forecast_id` | String | **[复合主键]** 预测批次唯一标识 | 支持多批次评估 |
| `customer_id` | String | **[复合主键]** 客户ID（负荷预测用，其他类型填 "system"） | 客户维度 |
| `forecast_date` | ISODate | 预测执行日期 | 追溯预测时间 |
| `model_type` | String | 模型标识（如 d1_price_model, d2_price_model） | 模型区分 |
| `model_version` | String | 模型版本号 | 版本追踪 |
| `wmape_accuracy` | Number | WMAPE 准确率 (0-100%) | **主评估指标** |
| `mape` | Number | MAPE (%) | 百分比误差 |
| `mae` | Number | 平均绝对误差 | 误差分析 |
| `rmse` | Number | 均方根误差 | 误差分析 |
| `r2` | Number | 决定系数 R² | 拟合度 |
| `direction_accuracy` | Number | 方向准确率 (0-100%) | 涨跌/增减判断 |
| `period_accuracy` | Object | 分时段准确率（从 tou_rules 动态获取） | 分时段分析 |
| `stats` | Object | 当日统计信息 | 数据特征 |
| ├─ `min_value` | Number | 最低值 | |
| ├─ `max_value` | Number | 最高值 | |
| ├─ `mean_value` | Number | 平均值 | |
| ├─ `sum_value` | Number | 总值（负荷预测用） | |
| └─ `has_negative` | Boolean | 是否含负值 | 异常标识 |
| `rate_90_pass` | Boolean | 是否达 90% 准确率 | 达标标识 |
| `rate_85_pass` | Boolean | 是否达 85% 准确率 | 达标标识 |
| `calculated_at` | ISODate | 计算时间 | 数据管理 |
| `notes` | String | 备注（可选） | 特殊说明 |

### 9.2 预测类型定义

| forecast_type | 说明 | 单位 | 数据粒度 |
| :--- | :--- | :--- | :--- |
| `d1_price` | D-1 日前价格预测 | CNY/MWh | 96点/天 |
| `d2_price` | D-2 日前价格预测 | CNY/MWh | 96点/天 |
| `d2_shadow_wind` | D-2 风电影子预测 | MW | 96点/天 |
| `d2_shadow_pv` | D-2 光伏影子预测 | MW | 96点/天 |
| `d2_shadow_tieline` | D-2 联络线影子预测 | MW | 96点/天 |
| `d2_shadow_nonmarket` | D-2 非市场化机组影子预测 | MW | 96点/天 |
| `load_forecast` | 负荷预测（客户级） | MWh | 48点/天 |

### 9.3 索引配置

```javascript
// 复合唯一索引（包含 forecast_id，支持多批次准确度评估）
db.forecast_accuracy_daily.createIndex({ 
    "target_date": 1, 
    "forecast_type": 1,
    "forecast_id": 1,
    "customer_id": 1 
}, { unique: true })

// 按类型和日期查询
db.forecast_accuracy_daily.createIndex({ "forecast_type": 1, "target_date": -1 })

// 按 forecast_id 查询
db.forecast_accuracy_daily.createIndex({ "forecast_id": 1 })

// 按客户查询（负荷预测用）
db.forecast_accuracy_daily.createIndex({ "customer_id": 1, "target_date": -1 })
```

### 9.4 数据示例

**D-1 价格预测**:
```json
{
    "target_date": ISODate("2025-12-10T00:00:00Z"),
    "forecast_type": "d1_price",
    "forecast_id": "D1_20251209_092015",
    "customer_id": "system",
    "forecast_date": ISODate("2025-12-09T00:00:00Z"),
    "model_type": "d1_price_model",
    "model_version": "v1.0.0",
    "wmape_accuracy": 88.29,
    "mae": 50.5,
    "rmse": 68.2,
    "r2": 0.85,
    "direction_accuracy": 75.8,
    "period_accuracy": {
        "高峰": 86.5,
        "平段": 82.3,
        "低谷": 91.2
    },
    "stats": {
        "min_value": 120.5,
        "max_value": 580.0,
        "mean_value": 385.2,
        "has_negative": false
    },
    "rate_90_pass": false,
    "rate_85_pass": true,
    "calculated_at": ISODate("2025-12-11T09:25:00Z")
}
```

**负荷预测（某客户）**:
```json
{
    "target_date": ISODate("2025-12-10T00:00:00Z"),
    "forecast_type": "load_forecast",
    "customer_id": "customer_001",
    "forecast_date": ISODate("2025-12-08T00:00:00Z"),
    "model_type": "load_model",
    "model_version": "v2.1.0",
    "wmape_accuracy": 92.5,
    "mape": 7.5,
    "mae": 12.3,
    "stats": {
        "min_value": 50.0,
        "max_value": 250.0,
        "mean_value": 150.5,
        "sum_value": 7224.0
    },
    "rate_90_pass": true,
    "rate_85_pass": true,
    "calculated_at": ISODate("2025-12-11T09:30:00Z")
}
```

---




