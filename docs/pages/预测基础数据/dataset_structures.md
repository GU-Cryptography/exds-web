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

