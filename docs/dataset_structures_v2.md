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
| `utility_accounts.metering_points` | `Array` | 计量点列表 |
| `utility_accounts.metering_points.metering_point_id` | `String` | 计量点ID |
| `utility_accounts.metering_points.allocation_percentage` | `Number` | 分摊比例(%) |
| `utility_accounts.metering_points.meter` | `Object` | 电表信息 |
| `utility_accounts.metering_points.meter.meter_id` | `String` | 电表资产号 |
| `utility_accounts.metering_points.meter.multiplier` | `Number` | 倍率 |
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
