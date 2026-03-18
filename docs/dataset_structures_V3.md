# 意向客户诊断模块数据集结构（V3）

---

## 1. `intent_customer_profiles` - 意向客户主表

该集合存储意向客户诊断模块中的客户主信息、汇总统计和电表配置。  
**模型文件**: [`webapp/models/intent_customer_diagnosis.py`](/d:/Gitworks/exds-web/webapp/models/intent_customer_diagnosis.py)  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 1.1. 设计说明

- 一条记录对应一个意向客户
- 保存页面顶部和“负荷汇总与完整性信息”面板所需的核心字段
- 同时保存该客户名下电表配置，用于后续导入覆盖、自动聚合和页面展示
- 当前版本未单独设计 `import_batch` 集合，默认一次导入覆盖该客户历史导入数据

### 1.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `customer_name` | `String` | 意向客户名称 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |
| `last_imported_at` | `DateTime` | 最近一次导入时间 |
| `last_aggregated_at` | `DateTime` | 最近一次聚合时间 |
| `coverage_start` | `String` | 数据覆盖起始日期，格式 `YYYY-MM-DD` |
| `coverage_end` | `String` | 数据覆盖结束日期，格式 `YYYY-MM-DD` |
| `coverage_days` | `Number` | 覆盖天数 |
| `missing_days` | `Number` | 缺失天数 |
| `completeness` | `Number` | 完整率 |
| `avg_daily_load` | `Number` | 平均日电量，单位 `MWh` |
| `max_daily_load` | `Number` | 最大日电量，单位 `MWh` |
| `min_daily_load` | `Number` | 最小日电量，单位 `MWh` |
| `missing_meter_days` | `Number` | 存在缺表的天数 |
| `interpolated_days` | `Number` | 存在插值的天数 |
| `dirty_days` | `Number` | 存在脏数据的天数 |
| `meter_count` | `Number` | 电表数量 |
| `meters` | `Array` | 电表配置列表 |
| `meters[].meter_id` | `String` | 电表号 |
| `meters[].account_id` | `String` | 户号 |
| `meters[].extracted_customer_name` | `String` | 从文件中提取的用户名 |
| `meters[].multiplier` | `Number` | 倍率 |
| `meters[].source_filename` | `String` | 来源文件名 |

### 1.3. 索引信息

- `_id_`（默认）
- `customer_name`（唯一索引）
- `updated_at`

---

## 2. `intent_customer_meter_reads_daily` - 意向客户原始电表日数据

该集合存储意向客户模块导入后的原始电表示数，采用按日宽表结构。  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 2.1. 设计说明

- 一条记录表示“某意向客户的某块电表在某一天的原始示数”
- 数据来源于上传的 Excel 文件，经预解析后写入
- 与通用集合 `raw_meter_data` 分开保存，避免污染正式负荷诊断数据源
- 每次对某意向客户重新导入时，默认先删除该客户原有原始记录，再整体重写

### 2.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `meter_id` | `String` | 电表号 |
| `account_id` | `String` | 户号 |
| `date` | `String` | 数据日期，格式 `YYYY-MM-DD` |
| `readings` | `Array[96]` | 当日 96 点原始示数 |
| `source_filename` | `String` | 来源文件名 |
| `multiplier` | `Number` | 导入时确认的倍率 |
| `meta` | `Object` | 冗余元数据 |
| `meta.customer_name` | `String` | 文件中提取的用户名 |
| `meta.account_id` | `String` | 文件中提取的户号 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 2.3. 索引信息

- `_id_`（默认）
- `customer_id`, `meter_id`, `date`（唯一复合索引）
- `customer_id`, `date`

---

## 3. `intent_customer_load_curve_daily` - 意向客户聚合负荷日曲线

该集合存储意向客户聚合后的 48 点负荷结果，采用按日宽表结构。  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)  
**复用算法来源**: [`webapp/services/load_aggregation_service.py`](/d:/Gitworks/exds-web/webapp/services/load_aggregation_service.py)

### 3.1. 设计说明

- 一条记录表示“某意向客户在某一天的 48 点聚合负荷结果”
- 聚合过程复用了 `LoadAggregationService.calculate_meter_48_points()` 的核心算法
- 当前版本聚合时默认所有电表直接求和，未启用 `allocation_ratio`
- 如果某天部分电表缺失，系统仍允许聚合，但会记录 `missing_meters`

### 3.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `date` | `String` | 数据日期，格式 `YYYY-MM-DD` |
| `values` | `Array[48]` | 聚合后的 48 点电量数组，单位 `MWh` |
| `total` | `Number` | 当日电量合计，单位 `MWh` |
| `meter_count` | `Number` | 实际参与聚合的电表数 |
| `missing_meters` | `Array[String]` | 当天缺失的电表号列表 |
| `data_quality` | `Object` | 数据质量信息 |
| `data_quality.interpolated_points` | `Array[Number]` | 插值点索引（按 48 点口径） |
| `data_quality.dirty_points` | `Array[Number]` | 脏数据点索引（按 48 点口径） |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 3.3. 索引信息

- `_id_`（默认）
- `customer_id`, `date`（唯一复合索引）

---

## 4. 与模块相关的现有复用集合

以下集合不是本模块新增，但与当前实现直接相关：

### 4.1. `raw_meter_data`

- 位置：`dataset_structures_v2.md`
- 用途：通用负荷诊断模块的原始电表示数数据源
- 关系：意向客户诊断模块当前不直接写入该集合，改为写入 `intent_customer_meter_reads_daily`

### 4.2. `customer_archives`

- 位置：`dataset_structures_v2.md`
- 用途：正式客户档案
- 关系：意向客户诊断模块当前不直接复用正式客户档案，改用独立主表 `intent_customer_profiles`

### 4.3. `wholesale_settlement_monthly`

- 用途：正式批发月结结果
- 关系：意向客户批发模拟会读取该集合中的正式批发月结 `settlement_items`，结合意向客户负荷曲线生成批发侧模拟结果

### 4.4. `retail_packages`

- 用途：零售套餐主数据
- 关系：意向客户零售模拟只允许选择状态为 `active` 的零售套餐，并按 `package_id` 读取其定价模型配置

---

## 5. `intent_customer_monthly_wholesale` - 意向客户批发侧月度模拟结算结果

该集合用于保存意向客户在“批发结算模拟”Tab 子页面中的月度批发侧计算结果。  
**模型文件**: [`webapp/models/intent_customer_diagnosis.py`](/d:/Gitworks/exds-web/webapp/models/intent_customer_diagnosis.py)  
**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 5.1. 设计说明

- 一条记录对应“一个意向客户 + 一个结算月份”
- 同一意向客户同一月份只有一条记录
- 唯一键为 `customer_id + settlement_month`
- `_id` 当前格式为 `{customer_id}_{settlement_month}`
- 每次执行“计算批发侧结算”时，按唯一键覆盖原有记录
- 页面打开批发结算模拟 Tab 子页面时，默认读取该集合中已保存的结果并直接展示

### 5.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 记录主键，格式 `{customer_id}_{settlement_month}` |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `settlement_month` | `String` | 结算月份，格式 `YYYY-MM` |
| `calc_status` | `String` | 计算状态，当前成功时为 `success` |
| `calc_message` | `String` | 结果消息 |
| `summary` | `Object` | 月度汇总结果 |
| `summary.settlement_month` | `String` | 结算月份 |
| `summary.total_energy_mwh` | `Number` | 总电量，单位 `MWh` |
| `summary.daily_cost_total` | `Number` | 每日成本汇总，单位 `元` |
| `summary.daily_cost_unit_price` | `Number` | 每日成本均价，按 `daily_cost_total / total_energy_mwh` 计算，单位 `元/MWh` |
| `summary.surplus_unit_price` | `Number` | 资金余缺分摊单价，单位 `元/MWh` |
| `summary.surplus_cost` | `Number` | 资金余缺分摊金额，单位 `元` |
| `summary.total_cost` | `Number` | 批发总成本，单位 `元` |
| `summary.unit_cost_yuan_per_mwh` | `Number` | 批发单价，单位 `元/MWh` |
| `summary.unit_cost_yuan_per_kwh` | `Number` | 批发单价，单位 `元/kWh` |
| `summary.status` | `String` | 月度结果状态 |
| `summary.message` | `String` | 月度结果消息 |
| `period_details` | `Array[48]` | 48 时段成本明细 |
| `period_details[].period` | `Number` | 时段序号，1~48 |
| `period_details[].time_label` | `String` | 时段标签，如 `00:00-00:30` |
| `period_details[].load_mwh` | `Number` | 该时段月累计电量，单位 `MWh` |
| `period_details[].daily_cost_total` | `Number` | 该时段每日成本汇总，单位 `元` |
| `period_details[].surplus_cost` | `Number` | 该时段资金余缺分摊金额，单位 `元` |
| `period_details[].total_cost` | `Number` | 该时段总成本，单位 `元` |
| `period_details[].period_type` | `String` | 月度时段类型，取值为 `尖峰 / 高峰 / 平段 / 低谷 / 深谷 / period_type_mix` |
| `period_details[].daily_cost_unit_price` | `Number` | 该时段每日成本均价，单位 `元/MWh` |
| `period_details[].final_unit_price` | `Number` | 该时段最终单价，单位 `元/MWh` |
| `daily_details` | `Array` | 每日成本明细 |
| `daily_details[].date` | `String` | 日期，格式 `YYYY-MM-DD` |
| `daily_details[].total_energy_mwh` | `Number` | 当日总电量，单位 `MWh` |
| `daily_details[].daily_cost_total` | `Number` | 当日每日成本汇总，单位 `元` |
| `daily_details[].surplus_cost` | `Number` | 当日资金余缺分摊金额，单位 `元` |
| `daily_details[].total_cost` | `Number` | 当日总成本，单位 `元` |
| `daily_details[].unit_cost_yuan_per_mwh` | `Number` | 当日日均成本单价，单位 `元/MWh` |
| `created_at` | `DateTime` | 首次创建时间 |
| `updated_at` | `DateTime` | 最近更新时间 |

### 5.3. 索引信息

- `_id_`（默认）
- `customer_id`, `settlement_month`（唯一复合索引）
- `customer_id`, `updated_at`

---

## 6. `intent_customer_monthly_retail_simulation` - 意向客户零售侧月度模拟结算结果

该集合用于保存意向客户在“零售结算模拟”Tab 子页面中的套餐级零售结算结果。  
**模型文件**: [`webapp/models/intent_customer_diagnosis.py`](/d:/Gitworks/exds-web/webapp/models/intent_customer_diagnosis.py)  
**服务文件**: [`webapp/services/intent_customer_retail_simulation_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_retail_simulation_service.py)

### 6.1. 设计说明

- 一条记录对应“一个意向客户 + 一个结算月份 + 一个零售套餐”
- 同一客户、同一月份、同一套餐只有一条记录
- 唯一键为 `customer_id + settlement_month + package_id`
- `_id` 当前格式为 `{customer_id}_{settlement_month}_{package_id}`
- 套餐来源为 `retail_packages` 中状态为 `active` 的零售套餐
- 发起“增加套餐结算”时，系统会基于当前客户已有的批发模拟月份，批量生成该套餐在所有月份的零售模拟结果
- 页面中“已计算套餐”列表直接从该结果集聚合获取，不再单独维护客户套餐集合
- 删除套餐时，会删除该客户该套餐下所有月份的模拟结果

### 6.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `String` | 记录主键，格式 `{customer_id}_{settlement_month}_{package_id}` |
| `customer_id` | `String` | 关联 `intent_customer_profiles._id` |
| `customer_name` | `String` | 冗余客户名称 |
| `settlement_month` | `String` | 结算月份，格式 `YYYY-MM` |
| `package_id` | `String` | 关联 `retail_packages._id` |
| `package_name` | `String` | 冗余套餐名称 |
| `model_code` | `String` | 套餐定价模型编码 |
| `price_model` | `Object` | 套餐价格模型快照 |
| `price_model.reference_price` | `Object` | 参考价来源与数值快照 |
| `price_model.fixed_prices` | `Object` | 固定价格配置快照 |
| `price_model.linked_config` | `Object` | 联动价格配置快照 |
| `price_model.final_prices` | `Object` | 5 段最终价格，键为 `tip / peak / flat / valley / deep` |
| `price_model.final_prices_48` | `Array[48]` | 规则日模板 48 时段结算价格 |
| `price_model.price_ratio_adjusted` | `Boolean` | 是否进行了 436 号文比例校核调整 |
| `price_model.price_ratio_adjusted_base` | `Boolean` | 比例校核前是否基于基准价调整 |
| `price_model.is_capped` | `Boolean` | 是否触发封顶 |
| `price_model.nominal_avg_price` | `Number` | 名义均价，单位 `元/kWh` |
| `price_model.cap_price` | `Number` | 封顶均价，单位 `元/kWh` |
| `price_model.package_type` | `String` | 套餐类型 |
| `price_model.is_green_power` | `Boolean` | 是否绿电套餐 |
| `pre_stage` | `Object` | 阶段一：48 时段数据结算结果 |
| `pre_stage.energy_mwh` | `Number` | 结算电量，单位 `MWh` |
| `pre_stage.retail_fee` | `Number` | 零售电费，单位 `元` |
| `pre_stage.retail_unit_price` | `Number` | 零售单价，单位 `元/MWh` |
| `pre_stage.wholesale_fee` | `Number` | 批发成本，单位 `元` |
| `pre_stage.wholesale_unit_price` | `Number` | 批发单价，单位 `元/MWh` |
| `pre_stage.gross_profit` | `Number` | 毛利，单位 `元` |
| `pre_stage.price_spread_per_mwh` | `Number` | 批零价差，单位 `元/MWh` |
| `sttl_stage` | `Object` | 阶段二：申报数据结算结果 |
| `sttl_stage.balancing_energy_mwh` | `Number` | 调平电量，单位 `MWh` |
| `sttl_stage.balancing_retail_fee` | `Number` | 调平零售电费，单位 `元` |
| `sttl_stage.balancing_wholesale_fee` | `Number` | 调平批发电费，单位 `元` |
| `sttl_stage.energy_mwh` | `Number` | 调平后结算电量，单位 `MWh` |
| `sttl_stage.retail_fee` | `Number` | 调平后零售电费，单位 `元` |
| `sttl_stage.retail_unit_price` | `Number` | 调平后零售单价，单位 `元/MWh` |
| `sttl_stage.wholesale_fee` | `Number` | 调平后批发成本，单位 `元` |
| `sttl_stage.wholesale_unit_price` | `Number` | 调平后批发单价，单位 `元/MWh` |
| `sttl_stage.gross_profit` | `Number` | 调平后毛利，单位 `元` |
| `sttl_stage.price_spread_per_mwh` | `Number` | 调平后批零价差，单位 `元/MWh` |
| `refund_context` | `Object` | 超额返还上下文 |
| `refund_context.trigger_excess_refund` | `Boolean` | 是否触发超额返还 |
| `refund_context.retail_avg_price_before_refund` | `Number` | 返还前零售均价，单位 `元/MWh` |
| `refund_context.wholesale_avg_price` | `Number` | 批发均价，单位 `元/MWh` |
| `refund_context.excess_profit_threshold_per_mwh` | `Number` | 超额返还阈值，单位 `元/MWh` |
| `refund_context.excess_profit_per_mwh` | `Number` | 超额利润单价，单位 `元/MWh` |
| `refund_context.refund_pool` | `Number` | 本条模拟结果的返还金额，单位 `元` |
| `refund_context.refund_allocated_method` | `String` | 当前返还分配方式，固定为 `single_customer_full_amount` |
| `final_stage` | `Object` | 阶段三：最终结算结果 |
| `final_stage.excess_profit_threshold_per_mwh` | `Number` | 超额返还阈值，单位 `元/MWh` |
| `final_stage.excess_profit_total` | `Number` | 超额利润总额，单位 `元` |
| `final_stage.excess_refund_ratio` | `Number` | 返还比例 |
| `final_stage.excess_refund_pool` | `Number` | 返还池金额，单位 `元` |
| `final_stage.excess_refund_fee` | `Number` | 返还金额，单位 `元` |
| `final_stage.energy_mwh` | `Number` | 最终结算电量，单位 `MWh` |
| `final_stage.retail_fee` | `Number` | 最终零售电费，单位 `元` |
| `final_stage.retail_unit_price` | `Number` | 最终零售单价，单位 `元/MWh` |
| `final_stage.wholesale_fee` | `Number` | 最终批发成本，单位 `元` |
| `final_stage.wholesale_unit_price` | `Number` | 最终批发单价，单位 `元/MWh` |
| `final_stage.gross_profit` | `Number` | 最终毛利，单位 `元` |
| `final_stage.price_spread_per_mwh` | `Number` | 最终批零价差，单位 `元/MWh` |
| `final_stage.gross_margin` | `Number` | 最终毛利率 |
| `period_details` | `Array[48]` | 48 时段零售结算明细 |
| `period_details[].period` | `Number` | 时段序号，1~48 |
| `period_details[].time_label` | `String` | 时段标签，如 `00:00-00:30` |
| `period_details[].period_type` | `String` | 时段类型，取值为 `尖峰 / 高峰 / 平段 / 低谷 / 深谷 / period_type_mix` |
| `period_details[].load_mwh` | `Number` | 时段电量，单位 `MWh` |
| `period_details[].unit_price` | `Number` | 零售结算单价，单位 `元/kWh` |
| `period_details[].fee` | `Number` | 零售结算电费，单位 `元` |
| `period_details[].wholesale_price` | `Number` | 批发单价，单位 `元/MWh` |
| `period_details[].allocated_cost` | `Number` | 批发成本，单位 `元` |
| `period_details[].retail_unit_price` | `Number` | 零售结算单价，单位 `元/MWh` |
| `period_details[].retail_revenue` | `Number` | 零售收入，单位 `元` |
| `period_details[].wholesale_unit_price` | `Number` | 批发单价，单位 `元/MWh` |
| `period_details[].wholesale_cost` | `Number` | 批发成本，单位 `元` |
| `period_details[].gross_profit` | `Number` | 毛利，单位 `元` |
| `period_details[].spread_yuan_per_mwh` | `Number` | 批零价差，单位 `元/MWh` |
| `period_details[].period_type_breakdown` | `Array` | 混合时段的分项拆解 |
| `daily_details` | `Array` | 月度日度结算明细 |
| `daily_details[].date` | `String` | 日期，格式 `YYYY-MM-DD` |
| `daily_details[].total_load_mwh` | `Number` | 当日电量，单位 `MWh` |
| `daily_details[].total_allocated_cost` | `Number` | 当日批发成本，单位 `元` |
| `daily_details[].total_fee` | `Number` | 当日零售电费，单位 `元` |
| `daily_details[].gross_profit` | `Number` | 当日毛利，单位 `元` |
| `daily_details[].avg_price` | `Number` | 当日零售均价，单位 `元/MWh` |
| `daily_details[].retail_avg_price` | `Number` | 当日零售均价，单位 `元/MWh` |
| `daily_details[].wholesale_avg_price` | `Number` | 当日批发均价，单位 `元/MWh` |
| `daily_details[].price_spread_per_mwh` | `Number` | 当日批零价差，单位 `元/MWh` |
| `daily_details[].period_breakdown` | `Object` | 当日峰平谷深谷电量拆分 |
| `pre_energy_mwh` | `Number` | `pre_stage.energy_mwh` 的平铺字段 |
| `pre_retail_fee` | `Number` | `pre_stage.retail_fee` 的平铺字段 |
| `pre_retail_unit_price` | `Number` | `pre_stage.retail_unit_price` 的平铺字段 |
| `pre_wholesale_fee` | `Number` | `pre_stage.wholesale_fee` 的平铺字段 |
| `pre_wholesale_unit_price` | `Number` | `pre_stage.wholesale_unit_price` 的平铺字段 |
| `pre_gross_profit` | `Number` | `pre_stage.gross_profit` 的平铺字段 |
| `pre_price_spread_per_mwh` | `Number` | `pre_stage.price_spread_per_mwh` 的平铺字段 |
| `sttl_balancing_energy_mwh` | `Number` | `sttl_stage.balancing_energy_mwh` 的平铺字段 |
| `sttl_balancing_retail_fee` | `Number` | `sttl_stage.balancing_retail_fee` 的平铺字段 |
| `sttl_balancing_wholesale_fee` | `Number` | `sttl_stage.balancing_wholesale_fee` 的平铺字段 |
| `sttl_energy_mwh` | `Number` | `sttl_stage.energy_mwh` 的平铺字段 |
| `sttl_retail_fee` | `Number` | `sttl_stage.retail_fee` 的平铺字段 |
| `sttl_retail_unit_price` | `Number` | `sttl_stage.retail_unit_price` 的平铺字段 |
| `sttl_wholesale_fee` | `Number` | `sttl_stage.wholesale_fee` 的平铺字段 |
| `sttl_wholesale_unit_price` | `Number` | `sttl_stage.wholesale_unit_price` 的平铺字段 |
| `sttl_gross_profit` | `Number` | `sttl_stage.gross_profit` 的平铺字段 |
| `sttl_price_spread_per_mwh` | `Number` | `sttl_stage.price_spread_per_mwh` 的平铺字段 |
| `final_energy_mwh` | `Number` | `final_stage.energy_mwh` 的平铺字段 |
| `final_retail_fee` | `Number` | `final_stage.retail_fee` 的平铺字段 |
| `final_retail_unit_price` | `Number` | `final_stage.retail_unit_price` 的平铺字段 |
| `final_wholesale_fee` | `Number` | `final_stage.wholesale_fee` 的平铺字段 |
| `final_wholesale_unit_price` | `Number` | `final_stage.wholesale_unit_price` 的平铺字段 |
| `final_gross_profit` | `Number` | `final_stage.gross_profit` 的平铺字段 |
| `final_price_spread_per_mwh` | `Number` | `final_stage.price_spread_per_mwh` 的平铺字段 |
| `final_excess_refund_fee` | `Number` | `final_stage.excess_refund_fee` 的平铺字段 |
| `created_at` | `DateTime` | 首次创建时间 |
| `updated_at` | `DateTime` | 最近更新时间 |

### 6.3. 索引信息

- `_id_`（默认）
- `customer_id`, `settlement_month`, `package_id`（唯一复合索引）
- `customer_id`, `package_id`, `updated_at`

---

## 7. 当前版本边界说明

### 7.1. 已实现

- 意向客户主表保存
- 原始电表日数据保存
- 聚合负荷日曲线保存
- 批发侧月度模拟结果保存
- 零售侧套餐化月度模拟结果保存
- 活跃零售套餐选择、批量计算与删除
- 页面按月、按日、按 48 时段读取和展示模拟结果

### 7.2. 当前未实现或未启用

- `intent_customer_import_batches` 独立导入批次表
- 电表 `allocation_ratio` 分摊系数
- 严格“缺一块表则整天禁止聚合”的门禁策略
- 与正式客户档案、正式统一负荷曲线的数据同步
- 意向客户零售模拟复用正式月结的“全员统一返还单价”口径

---

## 8. 命名汇总

本模块当前新增的 5 个核心集合如下：

- `intent_customer_profiles`
- `intent_customer_meter_reads_daily`
- `intent_customer_load_curve_daily`
- `intent_customer_monthly_wholesale`
- `intent_customer_monthly_retail_simulation`
