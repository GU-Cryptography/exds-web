# EXDS-RPA 数据集结构文档

本文档详细描述了 EXDS-RPA 项目中涉及的所有核心数据集（MongoDB 集合）的结构、字段含义及索引配置。

## 1. `daily_release` - 每日预测数据

该集合存储每日发布的日前预测数据，如系统负荷、新能源出力等。

- **数据来源**: `rpa.pipelines.daily_release`
- **更新频率**: 每日

### 1.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `system_load_forecast` | Number | 短期系统负荷预测值 (MW)。 |
| `pv_forecast` | Number | 短期光伏总加预测值 (MW)。 |
| `wind_forecast` | Number | 短期风电总加预测值 (MW)。 |
| `tieline_plan` | Number | 联络线总计划值 (MW)。 |
| `nonmarket_unit_forecast` | Number | 非市场化机组出力预测值 (MW)。 |

### 1.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一性。

---

## 2. `maintenance_plans` - 机组检修计划

该集合存储从每日信息中提取的机组或设备的检修计划。

- **数据来源**: `rpa.pipelines.daily_release`
- **更新频率**: 每日

### 2.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `equipment_name` | String | **[复合主键]** 设备/机组名称。 |
| `start_time` | ISODate | **[复合主键]** 检修计划开始时间。 |
| `end_time` | ISODate | **[复合主键]** 检修计划结束时间。 |
| `equipment_type` | String | 设备类型。 |
| `major_category` | String | 检修主类别。 |
| `minor_category` | String | 检修子类别。 |
| `content` | String | 检修内容描述。 |

### 2.2. 索引

- `(equipment_name: 1, start_time: 1, end_time: 1)`: 唯一复合索引，确保同一设备在同一时间段内的检修计划唯一。

---

## 3. `contracts_detailed_daily` - 中长期日分解合同（明细）

该集合存储按天分解的、精细到具体合同的“市场化”和“绿电”中长期交易数据。

- **数据来源**: `rpa.pipelines.long_term_contracts`
- **更新频率**: 每日

### 3.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `合同名称` | String | **[复合主键]** 合同的唯一名称。 |
| `date` | String | **[复合主键]** 数据所属日期，格式 `YYYY-MM-DD`。 |
| `periods` | Array | 包含分时段数据的数组，每个元素是一个对象。 |
| `periods.period` | Number | 时段序号 (1-48)。 |
| `periods.quantity_mwh` | Number | 该时段的合同电量 (MWh)。 |
| `periods.price_yuan_per_mwh` | Number | 该时段的合同电价 (元/MWh)。 |
| `daily_total_quantity` | Number | 当日总电量 (MWh)。 |
| `daily_avg_price` | Number | 当日加权平均价 (元/MWh)。 |
| `contract_type` | String | 合同类型，如 "市场化", "绿电"。 |
| `contract_period` | String | 合同周期，如 "年度", "月度", "月内"。 |
| `entity` | String | 实体，固定为 "售电公司"。 |
| `合同类型` | String | 原始合同类型。 |
| `交易序列名称` | String | 交易序列的名称。 |
| `售方名称` | String | 合同的售方。 |
| `购方名称` | String | 合同的购方。 |
| `购电类型` | String | 购电类型。 |

### 3.2. 索引

- `(合同名称: 1, date: 1)`: 唯一复合索引，确保每个合同每天的数据唯一。
- `(contract_type: 1, contract_period: 1, date: -1)`: 普通复合索引，用于快速查询特定类型和周期的合同数据。

---

## 4. `contracts_aggregated_daily` - 中长期日分解合同（聚合）

该集合存储按天、按合同类型、按合同周期聚合的中长期交易数据。

- **数据来源**: `rpa.pipelines.long_term_contracts`
- **更新频率**: 每日

### 4.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `entity` | String | **[复合主键]** 实体，如 "全市场", "售电公司"。 |
| `date` | String | **[复合主键]** 数据所属日期，格式 `YYYY-MM-DD`。 |
| `contract_type` | String | **[复合主键]** 合同类型，如 "整体", "市场化", "绿电", "代购电"。 |
| `contract_period` | String | **[复合主键]** 合同周期，如 "整体", "年度", "月度", "月内"。 |
| `periods` | Array | 包含分时段数据的数组，每个元素是一个对象。 |
| `periods.period` | Number | 时段序号 (1-48)。 |
| `periods.quantity_mwh` | Number | 该时段的合同电量 (MWh)。 |
| `periods.price_yuan_per_mwh` | Number | 该时段的合同电价 (元/MWh)。 |
| `daily_total_quantity` | Number | 当日总电量 (MWh)。 |
| `daily_avg_price` | Number | 当日加权平均价 (元/MWh)。 |

### 4.2. 索引

- `(entity: 1, date: 1, contract_type: 1, contract_period: 1)`: 唯一复合索引，确保每个维度组合下的日聚合数据唯一。

---

## 5. `mp_load_curve` - 计量点负荷曲线

该集合存储每个计量点的分时负荷数据。

- **数据来源**: `rpa.pipelines.mp_load_curve`
- **更新频率**: 每日

### 5.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `mp_id` | String | **[复合主键]** 计量点ID。 |
| `datetime` | ISODate | **[复合主键]** 数据点对应的精确日期和时间。 |
| `load_mwh` | Number | 该时段的负荷电量 (MWh)。 |

### 5.2. 索引

- `(mp_id: 1, datetime: 1)`: 唯一复合索引，确保每个计量点在每个时间点的数据唯一。

---

## 6. `price_sgcc` - 国网代理购电价格

该集合存储每月发布的国网代理购电价格详情。

- **数据来源**: `rpa.pipelines.price_sgcc`
- **更新频率**: 每月

### 6.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `_id` | String | **[主键]** 文档唯一ID，格式 `YYYY-MM`。 |
| `source_file` | String | 原始PDF文件名。 |
| `effective_date` | String | 生效日期，格式 `YYYY-MM-DD`。 |
| `purchase_scale_kwh` | Number | 代理工商业购电电量规模 (kWh)。 |
| `purchase_price` | Number | 代理工商业购电价格 (元/kWh)。 |
| `avg_on_grid_price` | Number | 当月平均上网电价 (元/kWh)。 |
| `historical_deviation_discount` | Number | 历史偏差电费折价 (元/kWh)。 |
| `system_op_cost_discount` | Number | 系统运行费用折价 (元/kWh)。 |
| `network_loss_price` | Number | 上网环节线损电价 (元/kWh)。 |
| `full_data` | Object | 包含从PDF解析的完整结构化数据。 |
| `full_data.price_rates` | Array | 详细的电价费率表。 |
| `full_data.price_composition` | Array | 价格构成明细。 |
| `full_data.notes` | String | PDF中的备注信息。 |

### 6.2. 索引

- `(_id: 1)`: 默认的唯一主键索引。

---

## 7. `real_time_spot_price` - 实时现货价格

该集合存储实时的现货市场出清价格和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 7.1. 字段说明

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

### 7.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

---

## 8. `day_ahead_spot_price` - 日前现货价格

该集合存储日前的现货市场出清价格和电量信息，其结构与 `real_time_spot_price` 完全相同。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日
- **字段说明**: 同 `real_time_spot_price`。
- **索引**: 同 `real_time_spot_price`。

---

## 9. `real_time_generation` - 实时发电出力

该集合存储各类机组的实时发电出力和电量信息。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 9.1. 字段说明

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

### 9.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

---

## 10. `real_time_tieline` - 实时联络线总计划

该集合存储实时的联络线总计划数据。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 10.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `total_tieline_plan` | Number | 联络线总计划值 (MW)，精度4位小数。 |

### 10.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

### 10.3. 数据说明

- **数据粒度**: 15分钟，每天96个数据点。
- **数据范围**: 下载到前一天（T-1），与实时现货价格、实时发电出力保持一致。
- **下载路径**: `现货信息 > 省内现货 > 实时出清结果 > 实时联络线总计划_*`
- **文件格式**: Excel文件（.xls），包含序号、日期、时刻点、数值四列。

---

## 11. `spot_settlement_daily` - 现货日结算（汇总）

该集合存储每日的现货结算汇总数据。

- **数据来源**: `rpa.pipelines.spot_settlement`
- **更新频率**: 每日

### 11.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `operating_date` | String | **[主键]** 运营日期，格式 `YYYY-MM-DD`。 |
| `contract_volume` | Number | 合同电量。 |
| `contract_avg_price` | Number | 合同均价。 |
| `contract_fee` | Number | 合同费用。 |
| `day_ahead_demand_volume` | Number | 日前申报电量。 |
| `day_ahead_deviation_fee` | Number | 日前偏差费用。 |
| `actual_consumption_volume` | Number | 实际用电量。 |
| `real_time_deviation_fee` | Number | 实时偏差费用。 |
| `deviation_recovery_fee` | Number | 偏差回收费用。 |
| `excess_recovery_fee` | Number | 超额回收费用。 |
| `total_fee` | Number | 总费用。 |
| `settlement_avg_price` | Number | 结算均价。 |

### 11.2. 索引

- `(operating_date: 1)`: 唯一索引，确保每日的汇总数据唯一。

---

## 12. `spot_settlement_period` - 现货分时段结算（明细）

该集合存储分时段（96点）的现货结算明细数据。

- **数据来源**: `rpa.pipelines.spot_settlement`
- **更新频率**: 每日

### 12.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `operating_date` | String | **[复合主键]** 运营日期，格式 `YYYY-MM-DD`。 |
| `period` | Number | **[复合主键]** 时段序号 (1-96)。 |
| `datetime` | ISODate | 该时段对应的精确开始时间。 |
| `contract_volume` | Number | 合同电量。 |
| `contract_avg_price` | Number | 合同均价。 |
| `day_ahead_demand_volume` | Number | 日前申报电量。 |
| `day_ahead_market_avg_price` | Number | 日前市场均价。 |
| `actual_consumption_volume` | Number | 实际用电量。 |
| `real_time_market_avg_price` | Number | 实时市场均价。 |
| `deviation_volume` | Number | 偏差电量。 |
| `...` | ... | 其他各类费用和价格字段。 |

### 12.2. 索引

- `(operating_date: 1, period: 1)`: 唯一复合索引，确保每个运营日每个时段的数据唯一。
- `(datetime: -1)`: 普通索引，用于按时间倒序快速查询。

---

## 13. `weekly_forecast` - 周预测数据

该集合统一存储所有类型的周预测数据，通过 `info_name` 字段区分。

- **数据来源**: `rpa.pipelines.weekly_forecast`
- **更新频率**: 每周

### 13.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[复合主键]** 数据点对应的精确日期和时间。 |
| `info_name` | String | **[复合主键]** 信息名称，用于区分数据类型。可能的值包括: "系统负荷预测", "统调风电", "统调水电(含抽蓄)", "统调光伏", "省间联络线容量"。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `value` | Number | 预测值，精度4位小数。 |

### 13.2. 索引

- `(datetime: 1, info_name: 1)`: 唯一复合索引，确保每个时间点每种信息的数据唯一。
- `(date_str: 1)`: 普通索引，用于按日期查询。

---

## 14. `actual_operation` - 实际运行数据

该集合存储电网的实际运行数据，包括系统负荷、联络线潮流、正负备用等关键运行指标。

- **数据来源**: `rpa.pipelines.spot_price`
- **更新频率**: 每日

### 14.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[主键]** 数据点对应的精确日期和时间。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `positive_reserve` | Number | 正负荷备用 (MW)，精度4位小数。 |
| `negative_reserve` | Number | 负负荷备用 (MW)，精度4位小数。 |
| `system_load` | Number | 系统负荷 (MW)，精度4位小数。 |
| `tieline_flow` | Number | 联络线通道潮流 (MW)，精度4位小数。 |


### 14.2. 索引

- `(datetime: 1)`: 唯一索引，确保每个时间点的数据唯一。
- `(date_str: 1, time_str: 1)`: 普通复合索引，用于按日期和时间点查询。

### 14.3. 数据说明

- **数据粒度**: 15分钟，每天96个数据点。
- **数据范围**: 下载到前一天（T-1），与实时现货价格、实时发电出力保持一致。
- **下载路径**: `电网运行 > 实际负荷`
- **文件格式**: Excel文件（.xls），包含序号、日期、时刻点及各运行指标列。
- **业务意义**:
  - `positive_reserve` 和 `negative_reserve`: 系统正负备用容量，用于应对负荷波动和紧急情况。
  - `system_load`: 电网实际系统负荷，反映全网用电需求。
  - `tieline_flow`: 省间联络线的实际潮流值。


---
