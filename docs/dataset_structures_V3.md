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

---

## 7. `day_ahead_energy_declare` - 日前申报电量

该集合用于存储日前申报电量时序数据，供交易复盘、结算等模块使用。  
**代码依据**: [`webapp/services/settlement_service.py`](/d:/Gitworks/exds-web/webapp/services/settlement_service.py)、[`webapp/services/trade_review_service.py`](/d:/Gitworks/exds-web/webapp/services/trade_review_service.py)

### 7.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一 ID |
| `date_str` | `String` | 数据日期，格式 `YYYY-MM-DD` |
| `datetime` | `DateTime` | 时间戳，支持按日区间查询（`(date, date+1]`） |
| `time_str` | `String` | 时刻标签（常见为 96 点：`00:15` ... `24:00`） |
| `energy_mwh` | `Number` | 该时刻申报电量，单位 `MWh` |
| `period` | `Number` | 可选字段，时段序号（如 1~48 或 1~96） |

### 7.2. 使用口径（当前实现）

- 复盘与结算的 48 时段口径由原始序列重采样得到。
- 当源数据为 96 点时：按相邻两个点求和聚合为 48 点（电量口径使用 `sum`，非 `mean`）。
- 当源数据为 48 点时：直接使用。
- 查询优先级：优先按 `date_str` 查询；若无结果，回退到 `datetime` 日区间查询。

### 7.3. 相关说明

- 该集合是“日前交易复盘”页面申报电量曲线与红点标注的核心数据源。
- 盈亏计算中使用的申报电量即来自该集合重采样后的 48 时段序列。

---

## 9. 用户权限与认证数据集（1.1）

本章节补充用户权限管理 1.1 相关的数据集合结构，依据当前实现：
- `webapp/scripts/init_auth_data.py`
- `webapp/api/v1_auth.py`
- `webapp/models/auth.py`

### 9.1 `auth_modules` - 模块字典

用途：定义菜单模块、模块编码与路由归属，是 `module:{module_code}:{view/edit}` 的源头。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `module_code` | `String` | 模块唯一编码（唯一索引），如 `customer_profiles` |
| `module_name` | `String` | 模块显示名称 |
| `menu_group` | `String` | 上级菜单分组 |
| `route_paths` | `Array[String]` | 模块关联路由列表 |
| `sort_order` | `Number` | 排序值 |
| `is_active` | `Boolean` | 是否启用 |
| `is_system` | `Boolean` | 是否系统内置 |
| `seed_version` | `String` | 初始化版本标识（当前 `1.1`） |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引：
- `module_code`（唯一）
- `(menu_group, sort_order)`

### 9.2 `auth_permissions` - 权限点字典

用途：存放模块两档权限、例外权限、以及为兼容后端保留的 legacy 动作级权限。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `String` | 权限码（唯一索引），如 `module:customer_profiles:edit` |
| `name` | `String` | 权限名称 |
| `module` | `String` | 逻辑模块（模块码或 `exception`/legacy 域） |
| `module_code` | `String \| null` | 模块权限时为模块码，例外/legacy 可为空 |
| `action` | `String` | 动作（`view/edit/manage/create/...`） |
| `permission_type` | `String` | `module_view/module_edit/exception/legacy_action` |
| `is_exception` | `Boolean` | 是否例外权限 |
| `is_system` | `Boolean` | 是否系统内置 |
| `is_active` | `Boolean` | 是否启用 |
| `description` | `String` | 说明 |
| `seed_version` | `String` | 初始化版本标识 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引：
- `code`（唯一）
- `(module_code, permission_type)`
- `(is_exception, is_active)`

### 9.3 `auth_roles` - 角色定义

用途：定义角色及其权限集合，当前内置 `super_admin/system_admin/business_admin/analyst/viewer`。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `String` | 角色编码（唯一），如 `viewer` |
| `name` | `String` | 角色名称 |
| `description` | `String` | 角色描述 |
| `permissions` | `Array[String]` | 权限码列表（内嵌） |
| `is_system` | `Boolean` | 是否系统内置角色 |
| `is_active` | `Boolean` | 是否启用 |
| `seed_version` | `String` | 初始化版本标识 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引：
- `code`（唯一）
- `is_active`

### 9.4 `users` - 用户与角色绑定（权限相关字段）

用途：保存用户账号，同时通过 `roles` 与 `auth_roles` 关联，运行时汇总得到最终权限。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `username` | `String` | 用户名（唯一索引） |
| `hashed_password` | `String` | 加密密码 |
| `display_name` | `String` | 显示名 |
| `email` | `String` | 邮箱 |
| `roles` | `Array[String]` | 角色编码列表 |
| `is_active` | `Boolean` | 是否启用 |
| `must_change_password` | `Boolean` | 是否首次登录强制改密 |
| `password_changed_at` | `String(DateTime ISO)` | 密码最近修改时间 |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |
| `last_active_at` | `String(DateTime ISO)` | 最后活跃时间 |
| `current_session_sid` | `String` | 当前有效会话 SID（单账号互斥登录） |

索引（权限体系直接依赖）：
- `username`（唯一）
- `roles`
- `last_active_at`

### 9.5 `auth_audit_logs` - 权限审计日志

用途：记录认证与授权相关审计事件（来源包括 `/api/v1/token` 登录流程、`/api/v1/auth/*` 用户角色权限管理接口）。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `event` | `String` | 审计事件类型 |
| `operator` | `String` | 操作人用户名 |
| `target` | `String` | 被操作对象（角色码/用户名等） |
| `detail` | `Object` | 事件详情（不同事件字段不同） |
| `created_at` | `String(DateTime ISO)` | 记录时间 |

当前已落地事件（代码已实现）：
- 登录相关：`AUTH_LOGIN_FAILED`、`AUTH_LOGIN_CONFLICT`、`AUTH_SESSION_KICKED`、`AUTH_LOGIN_SUCCESS`
- 个人账号：`SELF_PROFILE_UPDATED`、`SELF_PASSWORD_CHANGED`
- 角色管理：`ROLE_CREATED`、`ROLE_UPDATED`、`ROLE_PERMISSIONS_UPDATED`、`ROLE_DELETED`
- 用户管理：`USER_CREATED`、`USER_ROLES_UPDATED`、`USER_ENABLED`、`USER_DISABLED`、`USER_PASSWORD_RESET`、`USER_DELETED`

`detail` 字段常见结构：
- 登录地理信息：`detail.login_ip`、`detail.login_city`
- 会话信息：`detail.sid`、`detail.active_sid`、`detail.kicked_sid`、`detail.force_login`、`detail.reason`
- 变更前后对比：`detail.before`、`detail.after`
- 其他上下文：例如 `roles`、`used_default_password`、`name` 等

建议索引（当前代码未统一创建，建议补齐）：
- `(created_at)`
- `(operator, created_at)`
- `(event, created_at)`

### 9.6 `auth_sessions` - 登录会话记录

用途：记录用户会话生命周期，用于在线会话、登录历史、登出时间与会话时长查询。

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `username` | `String` | 用户名 |
| `sid` | `String` | 会话ID（JWT内嵌） |
| `status` | `String` | 会话状态：`active/logout/kicked/expired` |
| `login_at` | `String(DateTime ISO)` | 登录时间 |
| `logout_at` | `String(DateTime ISO)` | 登出/失效时间 |
| `duration_seconds` | `Number` | 会话时长（秒） |
| `login_ip` | `String` | 登录 IP |
| `login_city` | `String` | 登录城市（IP2Region 解析） |
| `logout_reason` | `String` | 下线原因（如 `user_logout/force_login/token_expired/idle_timeout`） |
| `expires_at` | `String(DateTime ISO)` | 会话过期时间 |
| `last_seen_at` | `String(DateTime ISO)` | 最近活跃时间（心跳刷新） |
| `created_at` | `String(DateTime ISO)` | 创建时间 |
| `updated_at` | `String(DateTime ISO)` | 更新时间 |

索引（已在代码中创建）：
- `(username, status)`
- `(sid)` 唯一
- `(expires_at)`
- `(login_at)`

### 9.7 关系与读取路径说明

1. 登录后前端调用 `/api/v1/auth/me`，后端按 `users.roles -> auth_roles.permissions` 聚合权限码。  
2. 前端路由、菜单与按钮按权限码做 `view/edit` 前置控制。  
3. 后端写接口使用 `require_permission(...)` 做最终兜底。  
4. 角色权限变更后，用户下次请求 `auth/me` 即可获取最新权限快照。



