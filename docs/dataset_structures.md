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
| `contract_type` | String | **[复合主键]** 合同类型，如 "整体", "市场化", "绿电"。 |
| `contract_period` | String | **[复合主键]** 合同周期，如 "整体", "年度", "月度"。 |
| `periods` | Array | 包含分时段数据的数组，结构同 `contracts_detailed_daily`。 |
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

## 10. `spot_settlement_daily` - 现货日结算（汇总）

该集合存储每日的现货结算汇总数据。

- **数据来源**: `rpa.pipelines.spot_settlement`
- **更新频率**: 每日

### 10.1. 字段说明

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

### 10.2. 索引

- `(operating_date: 1)`: 唯一索引，确保每日的汇总数据唯一。

---

## 11. `spot_settlement_period` - 现货分时段结算（明细）

该集合存储分时段（96点）的现货结算明细数据。

- **数据来源**: `rpa.pipelines.spot_settlement`
- **更新频率**: 每日

### 11.1. 字段说明

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

### 11.2. 索引

- `(operating_date: 1, period: 1)`: 唯一复合索引，确保每个运营日每个时段的数据唯一。
- `(datetime: -1)`: 普通索引，用于按时间倒序快速查询。

---

## 12. `weekly_forecast` - 周预测数据

该集合统一存储所有类型的周预测数据，通过 `info_name` 字段区分。

- **数据来源**: `rpa.pipelines.weekly_forecast`
- **更新频率**: 每周

### 12.1. 字段说明

| 字段名 | 数据类型 | 描述 |
| :--- | :--- | :--- |
| `datetime` | ISODate | **[复合主键]** 数据点对应的精确日期和时间。 |
| `info_name` | String | **[复合主键]** 信息名称，用于区分数据类型。可能的值包括: "系统负荷预测", "统调风电", "统调水电(含抽蓄)", "统调光伏", "省间联络线容量"。 |
| `date_str` | String | 日期字符串，格式 `YYYY-MM-DD`。 |
| `time_str` | String | 时间点字符串，格式 `HH:MM`。 |
| `value` | Number | 预测值，精度4位小数。 |

### 12.2. 索引

- `(datetime: 1, info_name: 1)`: 唯一复合索引，确保每个时间点每种信息的数据唯一。
- `(date_str: 1)`: 普通索引，用于按日期查询。

---

# 附录：MongoDB `exds` 数据库集合结构与字段解释

本文档描述了 MongoDB `exds` 数据库中，由RPA管道处理和存储的关键数据集的结构、字段名称及其中文解释。

## 1. 现货价格数据集

这两个数据集拥有完全相同的结构，用于存储现货市场的价格和电量信息。

-   `real_time_spot_price` (实时现货价格)
-   `day_ahead_spot_price` (日前现货价格)

### 1.1. 结构与字段解释

| 字段名称 (Field Name)               | 数据类型 (Data Type) | 中文解释                                                     |
| ----------------------------------- | -------------------- | ------------------------------------------------------------ |
| `_id`                               | ObjectId             | MongoDB 自动生成的唯一文档ID。                               |
| `datetime`                          | ISODate              | 标准的UTC时间戳。此时间戳用于排序、计算和时间窗口划分。对于业务日 `D` 的 `24:00` 时刻，此字段值为 `D+1` 日的 `00:00:00`。 |
| `date_str`                          | String               | 业务日期字符串，格式为 `YYYY-MM-DD`。用于按业务日进行数据检索。对于 `第二天 00:00` 的聚合数据，此字段值仍为“第一天”的日期。 |
| `time_str`                          | String               | 业务时刻字符串，格式为 `HH:MM`。用于按业务时刻进行数据检索。对于 `第二天 00:00` 的聚合数据，此字段值为 `24:00`。 |
| `total_clearing_power`              | Double               | **出清总电量** (单位: MWh)，最多保留4位小数。                 |
| `thermal_clearing_power`            | Double               | **火电出清电量** (单位: MWh)，最多保留4位小数。               |
| `hydro_clearing_power`              | Double               | **水电出清电量** (单位: MWh)，最多保留4位小数。               |
| `wind_clearing_power`               | Double               | **风电出清电量** (单位: MWh)，最多保留4位小数。               |
| `solar_clearing_power`              | Double               | **光伏出清电量** (单位: MWh)，最多保留4位小数。               |
| `pumped_storage_clearing_power`     | Double               | **抽蓄出清电量** (单位: MWh)，最多保留4位小数。               |
| `battery_storage_clearing_power`    | Double               | **储能出清电量** (单位: MWh)，最多保留4位小数。               |
| `avg_clearing_price`                | Double               | **出清均价** (单位: 元/MWh)，最多保留2位小数。                |

### 1.2. 索引 (Indexes)

1.  **唯一索引**: `{ "datetime": 1 }`, `{ "unique": true }`
2.  **复合索引**: `{ "date_str": 1, "time_str": 1 }`

---

## 2. 中长期合同数据集

### 2.1. `contracts_detailed_daily` (每日合同分解明细)

| 字段名称 (Field Name)      | 数据类型 (Data Type) | 中文解释                                                     |
| -------------------------- | -------------------- | ------------------------------------------------------------ |
| `_id`                      | ObjectId             | MongoDB 自动生成的唯一文档ID。                               |
| `date`                     | String               | 业务日期字符串，格式为 `YYYY-MM-DD`。                        |
| `contract_name`            | String               | 合同名称。                                                   |
| `contract_type`            | String               | 合同类型（例如：市场化, 绿电）。由下载时的上下文决定。     |
| `contract_period`          | String               | 合同周期（例如：年度, 月度, 月内）。由下载时的上下文决定。 |
| `trade_sequence_name`      | String               | 交易序列名称。                                               |
| `seller_name`              | String               | 售方名称。                                                   |
| `buyer_name`               | String               | 购方名称。                                                   |
| `purchase_type`            | String               | 购电类型。                                                   |
| `daily_total_quantity`     | Double               | 日合计电量 (MWh)。                                           |
| `daily_avg_price`          | Double               | 日合计均价 (元/MWh)。                                        |
| `entity`                   | String               | 实体（例如：全市场, 售电公司）。                             |
| `periods`                  | Array of Objects     | 分时段数据数组，每个对象包含一个时段的电量和电价。       |
| `periods.period`           | Integer              | 时段序号（例如：1, 2, ..., 48）。                            |
| `periods.quantity_mwh`     | Double               | 该时段的电量 (MWh)。                                         |
| `periods.price_yuan_per_mwh` | Double               | 该时段的电价 (元/MWh)。                                      |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "合同名称": 1, "date": 1 }`, `{ "unique": true }`
2.  **复合查询索引**: `{ "contract_type": 1, "contract_period": 1, "date": -1 }`

### 2.2. `contracts_aggregated_daily` (每日合同聚合统计)

| 字段名称 (Field Name)      | 数据类型 (Data Type) | 中文解释                                                     |
| -------------------------- | -------------------- | ------------------------------------------------------------ |
| `_id`                      | ObjectId             | MongoDB 自动生成的唯一文档ID。                               |
| `date`                     | String               | 业务日期字符串，格式为 `YYYY-MM-DD`。                        |
| `contract_type`            | String               | 合同类型（例如：整体, 市场化, 绿电）。                     |
| `contract_period`          | String               | 合同周期（例如：整体, 年度, 月度）。                        |
| `daily_total_quantity`     | Double               | 日合计电量 (MWh)。                                           |
| `daily_avg_price`          | Double               | 日合计均价 (元/MWh)。                                        |
| `entity`                   | String               | 实体（例如：全市场, 售电公司）。                             |
| `periods`                  | Array of Objects     | 分时段数据数组，每个对象包含一个时段的电量和电价。       |
| `periods.period`           | Integer              | 时段序号（例如：1, 2, ..., 48）。                            |
| `periods.quantity_mwh`     | Double               | 该时段的电量 (MWh)。                                         |
| `periods.price_yuan_per_mwh` | Double               | 该时段的电价 (元/MWh)。                                      |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "entity": 1, "date": 1, "contract_type": 1, "contract_period": 1 }`, `{ "unique": true }`

---

## 3. 每日信息发布数据集

### 3.1. `daily_release` (日前预测摘要)

| 字段名称 (Field Name)         | 数据类型 (Data Type) | 中文解释                     |
| ----------------------------- | -------------------- | ---------------------------- |
| `_id`                         | ObjectId             | MongoDB 自动生成的唯一文档ID。 |
| `datetime`                    | ISODate              | 标准的UTC时间戳。            |
| `system_load_forecast`        | Double               | 短期系统负荷预测。           |
| `pv_forecast`                 | Double               | 短期新能源负荷预测:光伏总加。 |
| `wind_forecast`               | Double               | 短期新能源负荷预测:风电总加。 |
| `tieline_plan`                | Double               | 联络线总计划。               |
| `nonmarket_unit_forecast`     | Double               | 非市场化机组出力预测。       |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "datetime": 1 }`, `{ "unique": true }`

### 3.2. `maintenance_plans` (检修计划)

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释         |
| --------------------- | -------------------- | ---------------- |
| `_id`                 | ObjectId             | MongoDB 自动生成的唯一文档ID。 |
| `equipment_name`      | String               | 设备名称。       |
| `equipment_type`      | String               | 设备类型。       |
| `start_time`          | ISODate              | 开始时间。       |
| `end_time`            | ISODate              | 结束时间。       |
| `major_category`      | String               | 专业分类。       |
| `minor_category`      | String               | 分类。           |
| `content`             | String               | 工作内容。       |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "equipment_name": 1, "start_time": 1, "end_time": 1 }`, `{ "unique": true }`

---

## 4. 计量点负荷曲线数据集

### 4.1. `mp_load_curve`

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释                               |
| --------------------- | -------------------- | -------------------------------------- |
| `_id`                 | ObjectId             | MongoDB 自动生成的唯一文档ID。         |
| `mp_id`               | String               | 计量点ID。                             |
| `datetime`            | ISODate              | 标准的UTC时间戳。                      |
| `load_mwh`            | Double               | 负荷 (MWh)。                           |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "mp_id": 1, "datetime": 1 }`, `{ "unique": true }`

---

## 5. 国网代理购电价格数据集

### 5.1. `price_sgcc`

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释                               |
| --------------------- | -------------------- | -------------------------------------- |
| `_id`                 | String               | 文档ID，格式为 `YYYY-MM`。             |
| `source_file`         | String               | 原始文件名。                           |
| `effective_date`      | String               | 生效日期。                             |
| `purchase_scale_kwh`  | Double               | 代理工商业购电电量规模 (kWh)。         |
| `purchase_price`      | Double               | 代理工商业购电价格。                   |
| `avg_on_grid_price`   | Double               | 当月平均上网电价。                     |
| `historical_deviation_discount` | Double | 历史偏差电费折价。 |
| `system_op_cost_discount` | Double | 系统运行费用折价。 |
| `network_loss_price` | Double | 上网环节线损电价。 |
| `full_data`           | Object               | 包含解析出的完整PDF内容的JSON对象。    |

---

## 6. 现货结算数据集

### 6.1. `spot_settlement_daily` (每日结算汇总)

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释                 |
| --------------------- | -------------------- | ------------------------ |
| `_id` | ObjectId | MongoDB 自动生成的唯一文档ID。 |
| `operating_date`      | String               | 业务日期，格式 `YYYY-MM-DD`。 |
| `contract_volume`     | Double               | 合同电量。               |
| `contract_avg_price` | Double | 合同平均价。 |
| `contract_fee` | Double | 合同费用。 |
| `day_ahead_demand_volume` | Double | 日前需求电量。 |
| `day_ahead_deviation_fee` | Double | 日前偏差费用。 |
| `actual_consumption_volume` | Double | 实际用电量。 |
| `real_time_deviation_fee` | Double | 实时偏差费用。 |
| `deviation_recovery_fee` | Double | 偏差回收费用。 |
| `excess_recovery_fee` | Double | 超额回收费用。 |
| `total_fee`           | Double               | 总费用。                 |
| `settlement_avg_price`| Double               | 结算平均价。             |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "operating_date": 1 }`, `{ "unique": true }`

### 6.2. `spot_settlement_period` (分时结算明细)

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释                 |
| --------------------- | -------------------- | ------------------------ |
| `_id` | ObjectId | MongoDB 自动生成的唯一文档ID。 |
| `operating_date`      | String               | 业务日期，格式 `YYYY-MM-DD`。 |
| `period`              | Integer              | 时段 (1-96)。            |
| `datetime`            | ISODate              | 标准的UTC时间戳。        |
| `contract_volume` | Double | 合同电量。 |
| `contract_avg_price` | Double | 合同平均价。 |
| `contract_fee` | Double | 合同费用。 |
| `day_ahead_demand_volume` | Double | 日前需求电量。 |
| `day_ahead_market_avg_price` | Double | 日前市场均价。 |
| `day_ahead_deviation_fee` | Double | 日前偏差费用。 |
| `actual_consumption_volume` | Double | 实际用电量。 |
| `real_time_market_avg_price` | Double | 实时市场均价。 |
| `real_time_deviation_fee` | Double | 实时偏差费用。 |
| `deviation_volume` | Double | 偏差电量。 |
| `deviation_rate` | Double | 偏差率。 |
| `deviation_recovery_volume` | Double | 偏差回收电量。 |
| `deviation_assessment_price` | Double | 偏差考核价。 |
| `deviation_recovery_fee` | Double | 偏差回收费用。 |
| `total_energy_fee`    | Double               | 总电能费用。             |
| `energy_settlement_avg_price` | Double | 电能结算均价。 |

#### 索引 (Indexes)

1.  **唯一索引**: `{ "operating_date": 1, "period": 1 }`, `{ "unique": true }`
2.  **查询索引**: `{ "datetime": -1 }`

---

## 7. 用户与计量体系数据集

这一组数据集共同构成了用户、电表、计量点的关系和原始数据。

### 7.1. `user_profiles` (用户档案)

此数据集存储了电力用户的基本档案信息。

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释 |
| :--- | :--- | :--- |
| `_id` | ObjectId | MongoDB 自动生成的唯一文档ID。 |
| `user_name` | String | **用户全称**。 |
| `short_name` | String | **用户简称**。 |
| `industry` | String | 所属**行业**。 |
| `voltage` | String | **电压等级**。 |
| `region` | String | 所在**地区/市**。 |
| `district` | String | 所在**区/县**。 |
| `address` | String | 详细**地址**。 |
| `location` | Object | **地理坐标**，采用 GeoJSON Point 格式。 |
| `location.type` | String | 坐标类型，固定为 "Point"。 |
| `location.coordinates` | Array | 坐标数组 `[经度, 纬度]`。 |

#### 索引 (Indexes)

1.  **默认唯一索引**: `{ "_id": 1 }`
2.  **单字段索引**: `{ "user_name": 1 }` (用于快速按用户全称查询)

### 7.2. `meters` (电表)

此数据集存储了物理电表的基本信息。

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释 |
| :--- | :--- | :--- |
| `_id` | String | **电表资产号**，作为此文档的唯一标识符。 |
| `user_name` | String | 此电表所属的**用户全称**。 |
| `account_id` | String | **户号**，电力公司分配给用户的唯一编号。 |
| `multiplier` | Number | **倍率**，用于将电表读数转换为实际用电量的乘数。 |

#### 索引 (Indexes)

1.  **默认唯一索引**: `{ "_id": 1 }`

### 7.3. `measure_point` (计量点)

此数据集定义了物理的或逻辑的电能计量点，并将其与用户关联。

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释 |
| :--- | :--- | :--- |
| `_id` | String | **计量点ID**，作为此文档的唯一标识符。 |
| `user_name` | String | 此计量点所属的**用户全称**。 |
| `account_id` | String | **户号**。 |
| `meter_id` | String | **电表资产号**，关联到 `meters` 集合。 |
| `allocation_percentage` | Number | **分摊比例 (%)**。表示此计量点的读数在多大程度上归属于该用户。 |

#### 索引 (Indexes)

1.  **默认唯一索引**: `{ "_id": 1 }`
2.  **单字段索引**: `{ "user_name": 1 }` (用于快速查找特定用户下的所有计量点)

### 7.4. `meter_data` (电表数据)

此数据集存储了来自物理电表的原始时间序列读数。

| 字段名称 (Field Name) | 数据类型 (Data Type) | 中文解释 |
| :--- | :--- | :--- |
| `_id` | ObjectId | MongoDB 自动生成的唯一文档ID。 |
| `日期时间` | ISODate | **数据时间戳**，表示该条读数记录的时间点。 |
| `表号` | String | **电表资产号**，与 `meters` 集合的 `_id` 对应。 |
| `示数` | Number | 电表在该时间点的**累计读数**。 |
| `用电量` | Number | **该时段的用电量**，通常是当前示数与上一个时间点示数的差值。 |

#### 索引 (Indexes)

1.  **默认唯一索引**: `{ "_id": 1 }`
2.  **复合索引**: `{ "表号": 1, "日期时间": 1 }` (核心索引，用于快速查询特定电表的时间序列数据)