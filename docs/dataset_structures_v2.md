# 项目数据集结构文档

本文档详细描述了 "电力交易辅助决策系统" 项目中主要数据集（MongoDB 集合）的结构、字段含义及索引信息。

## 1. `customers` - 客户档案

该集合存储所有客户的详细档案信息。

**模型文件**: `webapp/models/customer.py`

### 1.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 客户唯一ID |
| `user_name` | `String` | 客户全称 |
| `short_name` | `String` | 客户简称 |
| `user_type` | `String` | 客户类型 |
| `industry` | `String` | 所属行业 |
| `voltage` | `String` | 电压等级 |
| `region` | `String` | 地区 |
| `district` | `String` | 区县 |
| `address` | `String` | 详细地址 |
| `location` | `Object` | 地理位置信息 |
| `location.type` | `String` | 类型，固定为 "Point" |
| `location.coordinates`| `Array` | 经纬度坐标 [longitude, latitude] |
| `contact_person` | `String` | 联系人 |
| `contact_phone` | `String` | 联系电话 |
| `utility_accounts`| `Array` | 户号列表 |
| `utility_accounts.account_id` | `String` | 户号 |
| `utility_accounts.meters` | `Array` | 挂载在该户号下的电表列表 |
| `utility_accounts.meters.meter_id` | `String` | 电表资产号 |
| `utility_accounts.meters.multiplier` | `Number` | 倍率 |
| `utility_accounts.meters.allocation_ratio` | `Number` | 结算分配系数，范围 0-1.0。**默认为空 (null)**，非空表示该电表已通过 RPA 校验。 |
| `status` | `String` | 客户状态，枚举值: "prospect", "pending", "active", "suspended", "terminated" |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |
| `created_by` | `String` | 创建人 |
| `updated_by` | `String` | 更新人 |

### 1.2. 索引信息

- `_id_` (默认)
- `user_name`
- `short_name`
- `status`
- `status`, `created_at` (复合索引)
- `status`, `user_type`, `created_at` (复合索引)
- `status`, `industry`, `created_at` (复合索引)
- `status`, `region`, `created_at` (复合索引)
- `utility_accounts.account_id` (嵌套文档索引)
- `utility_accounts.metering_points.metering_point_id` (嵌套文档索引)
- `utility_accounts.metering_points.meter.meter_id` (嵌套文档索引)
- `created_at`
- `updated_at`

---

## 2. `retail_contracts` - 零售合同

该集合存储客户与公司签订的零售合同。在v1.py中，集合名称被硬编码为 'retail_contracts'。

**模型文件**: `webapp/models/contract.py`

### 2.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 合同唯一ID |
| `contract_name` | `String` | 合同名称 |
| `package_name` | `String` | 关联的套餐名称 |
| `package_id` | `String` | 关联的套餐ID |
| `customer_name` | `String` | 关联的客户名称 |
| `customer_id` | `String` | 关联的客户ID |
| `purchasing_electricity_quantity` | `Number` | 购买电量 (kWh) |
| `purchase_start_month` | `DateTime` | 购电开始月份 |
| `purchase_end_month` | `DateTime` | 购电结束月份 |
| `package_snapshot` | `Object` | 套餐内容快照，用于存档 |
| `package_snapshot.package_type` | `String` | 套餐类型 |
| `package_snapshot.model_code` | `String` | 定价模型代码 |
| `package_snapshot.is_green_power`| `Boolean` | 是否绿电 |
| `package_snapshot.pricing_config`| `Object` | 定价配置详情 |
| `created_by` | `String` | 创建人 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_by` | `String` | 更新人 |
| `updated_at` | `DateTime` | 更新时间 |

### 2.2. 索引信息

- `_id_` (默认)
- `package_name`
- `customer_name`
- `purchase_start_month`
- `purchase_end_month`
- `package_id`
- `customer_id`
- `package_name`, `purchase_start_month` (复合索引)
- `customer_name`, `purchase_start_month` (复合索引)
- `created_at`
- `updated_at`
- `contract_name`
- `contract_name`, `purchase_start_month` (复合索引)
- `customer_id`, `purchase_start_month`, `purchase_end_month` (复合索引)

---

## 3. `retail_packages` - 零售套餐

该集合定义了可供客户选择的各类零售套餐。

**模型文件**: `webapp/models/retail_package.py`

### 3.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 套餐唯一ID |
| `package_name` | `String` | 套餐名称 |
| `package_description` | `String` | 套餐描述 |
| `package_type` | `String` | 套餐类型: "time_based" (分时) / "non_time_based" (不分时) |
| `model_code` | `String` | 关联的定价模型代码 |
| `pricing_config` | `Object` | 统一的定价配置字典，结构随 `model_code` 变化 |
| `is_green_power` | `Boolean` | 是否为绿电套餐 |
| `status` | `String` | 套餐状态: "draft", "active", "archived" |
| `validation` | `Object` | 价格比例校验结果 |
| `validation.price_ratio_compliant` | `Boolean`| 是否符合463号文比例 |
| `validation.actual_ratios` | `Object` | 实际比例 |
| `validation.expected_ratios` | `Object` | 标准比例 |
| `validation.warnings` | `Array` | 警告信息 |
| `created_by` | `String` | 创建人 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |
| `updated_by` | `String` | 更新人 |
| `activated_at` | `DateTime` | 生效时间 |
| `archived_at` | `DateTime` | 归档时间 |

### 3.2. 索引信息

- `_id_` (默认)

---

## 4. `pricing_models` - 定价模型

该集合定义了零售套餐的计算逻辑和核心参数。

**模型文件**: `webapp/models/pricing_model.py`

### 4.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 模型唯一ID |
| `model_code` | `String` | 模型唯一标识，格式: `{pricing_mode}_{floating_type}_{package_type}` |
| `display_name` | `String` | 模型显示名称 |
| `package_type` | `String` | 套餐类型: "time_based" (分时) / "non_time_based" (不分时) |
| `pricing_mode` | `String` | 定价模式，例如: "fixed_linked", "price_spread_simple" 等 |
| `floating_type` | `String` | 浮动类型: "fee" (费用) / "price" (价格) |
| `formula` | `String` | 计算公式 (HTML格式) |
| `description` | `String` | 套餐说明 (HTML格式) |
| `enabled` | `Boolean` | 是否启用 |
| `sort_order` | `Number` | 排序顺序 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |

### 4.2. 索引信息

- `_id_` (默认)
- `model_code` (唯一索引)
- `package_type`, `enabled` (复合索引)
- `sort_order`

---

## 5. `raw_meter_data` - 原始电表示度数据 (手工导入)

该集合存储手工导入的原始电表示数，采用**按日宽表**结构。

### 5.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一ID |
| `meter_id` | `String` | 电表资产号 (Meter ID) |
| `date` | `String` | 数据日期 (YYYY-MM-DD) |
| `readings` | `Array` | 当日示数数组 (Number) |
| `meta` | `Object` | 冗余元数据 (来自导入文件) |
| `meta.customer_name` | `String` | 用户名称 |
| `meta.account_id` | `String` | 用户编号 (户号) |
| `updated_at` | `DateTime` | 最后更新时间 |

### 5.2. 索引信息

- `_id_` (默认)
- `meter_id`, `date` (唯一复合索引)

---

## 6. `raw_mp_data` - 原始计量点负荷数据 (RPA导入)

该集合存储通过RPA自动采集的原始负荷数据，采用**按日宽表**结构。

### 6.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一ID |
| `mp_id` | `String` | 计量点ID (Metering Point ID) |
| `date` | `String` | 数据日期 (YYYY-MM-DD) |
| `load_values` | `Array` | 当日负荷数组 (Number，单位: MWh) |
| `total_load` | `Number` | 日电量合计 (校验用) |
| `meta` | `Object` | 冗余元数据 (来自RPA源) |
| `meta.customer_name` | `String` | 电力用户名称 |
| `meta.account_id` | `String` | 用户号 |
| `updated_at` | `DateTime` | 最后更新时间 |

### 6.2. 索引信息

- `_id_` (默认)
- `mp_id`, `date` (唯一复合索引)

---

## 7. `unified_load_curve` - 统一负荷曲线

该集合存储聚合后的用户级负荷数据，是系统内唯一的权威负荷曲线源。

**设计原则**: 采用**长表 (Long Format)** 结构，每个时间点为一条独立记录。

### 7.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `customer_id` | `String` | 关联客户ID (来自 `customers._id`) | `"673f9f87069d137d83be63a6"` |
| `customer_name` | `String` | 冗余客户全称 (便于查询展示) | `"江西省xx物资公司"` |
| `datetime` | `DateTime` | 数据时间点 (本地时间，24:00 存储为次日 00:00:00) | `ISODate("2025-11-11T00:00:00Z")` |
| `load_value` | `Number` | 时段用电量，单位: **MWh** | `0.8505` |
| `source` | `String` | 数据来源: `"rpa"` (权威结算) / `"manual"` (手工导入转换) | `"rpa"` |
| `updated_at` | `DateTime` | 最后更新时间 | `ISODate("2025-11-12T10:00:00Z")` |

### 7.2. 索引信息

- `_id_` (默认)
- `customer_id`, `datetime` (唯一复合索引，确保单一权威源)
- `datetime` (时序查询优化)
- `customer_name` (检索优化)
- `source` (统计分析优化)

---

## 8. `temporary_load_curve` - 临时负荷曲线 (开发分析用)

该集合存储**未签约客户**的手工导入负荷数据。此数据仅用于潜在客户开发阶段的用电分析，不参与正式结算或生产预测。

**设计原则**: 结构与 `unified_load_curve` 完全一致，便于后续客户签约时迁移数据。

### 8.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `customer_id` | `String` | 关联客户ID (来自 `customers._id`) | `"673f9f87069d137d83be63a6"` |
| `customer_name` | `String` | 冗余客户全称 (便于查询展示) | `"江西省xx物资公司"` |
| `datetime` | `DateTime` | 数据时间点 (本地时间，24:00 存储为次日 00:00:00) | `ISODate("2025-11-11T00:00:00Z")` |
| `load_value` | `Number` | 时段用电量，单位: **MWh** | `0.8505` |
| `source` | `String` | 固定为 `"manual"` | `"manual"` |
| `updated_at` | `DateTime` | 最后更新时间 | `ISODate("2025-11-12T10:00:00Z")` |

### 8.2. 索引信息

- `_id_` (默认)
- `customer_id`, `datetime` (唯一复合索引)
- `datetime` (时序查询优化)
- `customer_name` (检索优化)