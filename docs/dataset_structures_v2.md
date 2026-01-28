# 项目数据集结构文档

本文档详细描述了 "电力交易辅助决策系统" 项目中主要数据集（MongoDB 集合）的结构、字段含义及索引信息。

## 1. `customer_archives` - 客户档案

该集合存储所有客户的详细档案信息。

**模型文件**: `webapp/models/customer.py`

### 1.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 客户唯一ID |
| `user_name` | `String` | 客户全称 |
| `short_name` | `String` | 客户简称 |
| `location` | `String` | 地理位置信息,关联`weather_location` 集合 `name` 字段 |
| `source` | `String` | 客户来源（自营开发、居间代理A、居间代理B） |
| `manager` | `String` | 客户经理 |
| `accounts`| `Array` | 用电户号列表 |
| `accounts.account_id` | `String` | 用电户号 |
| `accounts.meters` | `Array` | 挂载在该户号下的电表列表 |
| `accounts.meters.meter_id` | `String` | 电表资产号 |
| `accounts.meters.multiplier` | `Number` | 倍率 |
| `accounts.meters.allocation_ratio` | `Number` | 分配系数，范围 0-1.0。**默认为空 (null)**，非空表示该电表已通过 RPA 校验。 |
| `accounts.metering_points` | `Array` | 挂载在该户号下的计量点列表 |
| `accounts.metering_points.mp_no` | `String` | 计量点编号 |
| `accounts.metering_points.mp_name` | `String` | 计量点名称 |
| `tags` | `Array` | 标签集合 |
| `tags.name` | `String` | 标签名/值 (核心字符串，如 "计划停产", "VIP") |
| `tags.source` | `String` | 来源 (AUTO:算法, MANUAL:人工) |
| `tags.expire` | `Date` | 失效时间 (用于临时标签，过期自动忽略) |
| `tags.reason` | `String` | 原因/备注 (解释为什么打这个标，存数值也可以放这里) |





### 1.2. 索引信息

- `_id_` (默认)
- `user_name`
- `short_name`
- `tags.name`
- `tags.expire`

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

**设计原则**: 采用**宽表 (Wide Format) + 双数组**结构，每个客户每天一条记录，计量点数据和电表示度数据分离存储。

### 7.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `customer_id` | `String` | 关联客户ID (来自 `customer_archives._id`) | `"673f9f87069d137d83be63a6"` |
| `customer_name` | `String` | 冗余客户全称 (便于查询展示) | `"江西省xx物资公司"` |
| `date` | `String` | 数据日期 (YYYY-MM-DD) | `"2025-11-11"` |
| `mp_load` | `Object` | 计量点数据（来自 `raw_mp_data`） | 见下表 |
| `meter_load` | `Object` | 电表示度数据（来自 `raw_meter_data`） | 见下表 |
| `deviation` | `Object` | 误差分析数据 | 见下表 |
| `updated_at` | `DateTime` | 最后更新时间 | `ISODate("2025-11-12T10:00:00Z")` |

> **注意**：不再保存 `final_load`、`final_source`、`is_complete` 字段，融合逻辑改为后端 API 动态计算。

#### `mp_load` 子对象结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `values` | `Array[48]` | 48点电量数组 (MWh, **保留4位小数**) |
| `total` | `Number` | 日总电量 (MWh, **保留4位小数**) |
| `mp_count` | `Integer` | 实际参与聚合的计量点数量 |
| `missing_mps` | `Array[String]` | 缺失的计量点编号 |
| `tou_usage` | `Object` | **预计算时段电量** (MWh, 分时电价统计) |
| `tou_usage.tip` | `Number` | 尖峰电量 |
| `tou_usage.peak` | `Number` | 高峰电量 |
| `tou_usage.flat` | `Number` | 平段电量 |
| `tou_usage.valley` | `Number` | 低谷电量 |
| `tou_usage.deep` | `Number` | 深谷电量 |

#### `meter_load` 子对象结构

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `values` | `Array[48]` | 48点电量数组 (MWh, **保留4位小数**) |
| `total` | `Number` | 日总电量 (MWh, **保留4位小数**) |
| `meter_count` | `Integer` | 实际参与聚合的电表数量 |
| `missing_meters` | `Array[String]` | 缺失的电表资产编号 |
| `tou_usage` | `Object` | **预计算时段电量** (MWh, 分时电价统计) |
| `tou_usage.tip` | `Number` | 尖峰电量 |
| `tou_usage.peak` | `Number` | 高峰电量 |
| `tou_usage.flat` | `Number` | 平段电量 |
| `tou_usage.valley` | `Number` | 低谷电量 |
| `tou_usage.deep` | `Number` | 深谷电量 |
| `data_quality` | `Object` | 数据质量标记（可选） |
| `data_quality.interpolated_points` | `Array[Number]` | 被插值的时段索引 (0-47) |
| `data_quality.dirty_points` | `Array[Number]` | 脏数据时段索引（无法处理） |

#### `deviation` 误差分析字段

当 `mp_load` 和 `meter_load` 同时存在时，计算并存储误差信息：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `daily_error` | `Number` | 日电量误差 = (mp_total - meter_total) / meter_total |
| `daily_error_abs` | `Number` | 日电量绝对误差 (MWh) |
| `is_warning` | `Boolean` | 误差是否超过阈值 (默认5%) |


### 7.2. 动态融合规则

融合逻辑由后端 API 根据参数动态计算，不在数据库中存储：

```
GET /api/v1/load-data/curve/{customer_id}?priority=mp&threshold=0.95

if priority == "mp":  # 计量点优先（默认）
    if mp_load.coverage >= threshold:
        return mp_load.values
    elif meter_load exists:
        return meter_load.values
    else:
        return mp_load.values
else:  # priority == "meter"，电表优先
    if meter_load.coverage >= threshold:
        return meter_load.values
    elif mp_load exists:
        return mp_load.values
    else:
        return meter_load.values
```

> **补录替换**：当 `raw_mp_data` 有新数据写入时，自动触发 `mp_load` 重新聚合，下次查询自动使用最新数据。

### 7.3. 索引信息

- `_id_` (默认)
- `customer_id`, `date` (唯一复合索引)
- `date` (时序查询优化)
- `customer_name` (检索优化)

---

## 8. `temporary_load_curve` - 临时负荷曲线 (开发分析用)

该集合存储**未签约客户**的手工导入负荷数据。此数据仅用于潜在客户开发阶段的用电分析，不参与正式结算或生产预测。

**设计原则**: 结构与 `unified_load_curve` 保持一致（宽表），便于后续客户签约时迁移数据。

### 8.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `customer_id` | `String` | 关联客户ID (来自 `customer_archives._id`) | `"673f9f87069d137d83be63a6"` |
| `customer_name` | `String` | 冗余客户全称 (便于查询展示) | `"江西省xx物资公司"` |
| `date` | `String` | 数据日期 (YYYY-MM-DD) | `"2025-11-11"` |
| `manual_load` | `Object` | 手工数据（结构同 unified_load_curve） | 见 7.1 |
| `final_load` | `Array[48]` | 最终曲线 (MWh) | `[0.85, 0.92, ...]` |
| `final_source` | `String` | 固定为 `"manual"` | `"manual"` |
| `is_complete` | `Boolean` | 数据完整性标记 | `true` |
| `updated_at` | `DateTime` | 最后更新时间 | `ISODate("2025-11-12T10:00:00Z")` |

### 8.2. 索引信息

- `_id_` (默认)
- `customer_id`, `date` (唯一复合索引)
- `date` (时序查询优化)
- `customer_name` (检索优化)
- `is_complete` (快速筛选)

---

## 9. `customer_tags` - 客户标签定义

该集合用于统一管理客户标签，定义标签的分类、来源和判定规则。

**模型文件**: `webapp/models/customer_tag.py`

### 9.1. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID |
| `name` | `String` | 标签名称 (唯一主键，如 "计划停产") |
| `category` | `String` | 业务分类 (如 "风险", "生产") |
| `source_type` | `String` | 来源类型 (AUTO:仅算法, MANUAL:仅人工, HYBRID:混合) |
| `description` | `String` | 含义/判定规则描述 (用于鼠标悬停提示) |
| `is_active` | `Boolean` | 是否启用 (下架旧标签用) |

### 9.3. 预设标签枚举

以下是系统初始支持的标签库，实际使用中可动态通过管理后台增删。

| 业务分类 | 标签名称 | 来源类型 | 说明 |
| :--- | :--- | :--- | :--- |
| **用电特性** | `基荷稳定型` | AUTO | 负荷曲线平稳，波动小 |
| | `负荷波动` | AUTO | 用电负荷忽高忽低，波动率大 |
| | `全年无休` | AUTO | 节假日及周末保持正常用电 |
| | `周末双休` | AUTO | 周末负荷明显下降 |
| | `周末单休` | AUTO | 只有周六或周日负荷极低 |
| | `日间单班` | AUTO | 仅有白班生产，夜间负荷极低 |
| | `全天生产` | AUTO | 24小时连续生产，负荷率高 |
| | `午间填谷型` | AUTO | 午间用电量大，适合消纳光伏 |
| | `避峰生产` | AUTO | 主动避开高峰电价时段用电 |
| | `夏季气温敏感` | AUTO | 夏季负荷与气温强相关 (空调负荷大) |
| | `冬季气温敏感` | AUTO | 冬季负荷与气温强相关 (取暖负荷大) |
| **资源设施** | `具备光伏` | MANUAL | 厂区内安装了光伏发电设施 |
| | `疑似光伏` | AUTO | 算法检测出明显的“鸭子曲线”特征 |
| | `具备储能` | MANUAL | 厂区内配置了储能设备 |
| | `自备电厂` | MANUAL | 拥有自备燃煤/燃气发电机组 |
| **经营风险** | `产能下滑` | HYBRID | 用电量同比/环比持续显著下降 |
| | `关停风险` | HYBRID | 长期极低负荷或零负荷运行 |

| **生产状态** | `正常生产` | HYBRID | 系统默认状态，用电行为符合基线或人工确认正常 |
| | `节假日生产` | AUTO | 节假日负荷不降反升，或保持高位 |
| | `停产检修` | HYBRID | 负荷显著低于平时，或客户申报检修 |
| | `计划停产` | MANUAL | 客户提前告知的计划性停产 |
| | `季节性生产` | AUTO | 算法识别出明显的季节性用电特征 |
| | `产能爬坡` | HYBRID | 用电量呈持续上升趋势 |
| | `产能扩张期` | MANUAL | 企业正在扩建或新增产线，用电量预期增长 |
| | `订单爆满` | MANUAL | 企业反馈订单充足，预计保持满负荷生产 |
| **客户管理** | `VIP客户` | MANUAL | 战略大客户，享受高优先级服务 |
| | `关系户` | MANUAL | 需特殊维护的重要关系客户 |
| | `沉默客户` | MANUAL | 长期无互动反馈，需要激活 |
| | `纠纷敏感` | MANUAL | 曾发生过服务纠纷或投诉 |
| | `价格敏感` | MANUAL | 对电价波动极其敏感，容易流失 |
| | `信用优质` | MANUAL | 历史缴费记录良好，无违约 |
| | `欠费高危` | MANUAL | 近期有逾期或缴费延迟记录 |


### 9.2. 索引信息

- `_id_` (默认)
- `name` (唯一索引)
- `category`
- `is_active`

---

## 10. `typical_curves` - 典型曲线数据集

该集合存储交易平台发布的市场化典型曲线和工商业典型曲线，用于负荷预测、交易模拟及偏差考核分析。

### 10.1. 字段说明

| 字段名 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | 唯一ID | `ObjectId("...")` |
| `year` | `Integer` | 适用年份 | `2025` |
| `month` | `Integer` | 适用月份 (0表示不特定月份的假日曲线) | `9` |
| `curve_type` | `String` | 曲线类型: `market` (市场化), `business_general` (工商业), `business_all` (全体工商业) | `"market"` |
| `name` | `String` | 曲线完整名称 (来自Excel原始数据) | `"2025年9月市场化典型曲线"` |
| `holiday` | `String` | 节假日名称 (如包含则填入，否则为 `null`) | `"国庆节"` |
| `points` | `Array[48]` | 48点标幺值/数值数组 (30分钟间隔) | `[2.09, 2.12, ...]` |

### 10.2. 索引信息

- `_id_` (默认)
- `year`, `month`, `curve_type`, `name` (唯一复合索引)