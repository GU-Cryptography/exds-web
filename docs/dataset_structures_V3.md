# 项目数据集结构文档 V3

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
| `_id` | `ObjectId` | 客户唯一ID |
| `customer_name` | `String` | 意向客户名称 |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 更新时间 |
| `last_imported_at` | `DateTime` | 最近一次导入时间 |
| `last_aggregated_at` | `DateTime` | 最近一次聚合时间 |
| `coverage_start` | `String` | 数据覆盖起始日期，格式 `YYYY-MM-DD` |
| `coverage_end` | `String` | 数据覆盖结束日期，格式 `YYYY-MM-DD` |
| `coverage_days` | `Number` | 覆盖天数 |
| `missing_days` | `Number` | 缺失天数 |
| `completeness` | `Number` | 完整率，单位 `%` |
| `avg_daily_load` | `Number` | 日均电量，单位 `MWh` |
| `max_daily_load` | `Number` | 最大日电量，单位 `MWh` |
| `min_daily_load` | `Number` | 最小日电量，单位 `MWh` |
| `missing_meter_days` | `Number` | 缺失电表天数 |
| `interpolated_days` | `Number` | 存在插值的天数 |
| `dirty_days` | `Number` | 存在脏数据的天数 |
| `meter_count` | `Number` | 电表数量 |
| `meters` | `Array` | 电表配置列表 |
| `meters[].meter_id` | `String` | 电表号 |
| `meters[].account_id` | `String` | 户号 |
| `meters[].extracted_customer_name` | `String` | 从导入文件中提取的用户名 |
| `meters[].multiplier` | `Number` | 倍率 |
| `meters[].source_filename` | `String` | 来源文件名 |

### 1.3. 索引信息

- `_id_`（默认）
- `customer_name`（唯一索引）
- `updated_at`

### 1.4. 示例

```json
{
  "_id": "67d7d4f5f2d9f91a2f9d0001",
  "customer_name": "华东精密制造厂",
  "created_at": "2026-03-17T14:20:00",
  "updated_at": "2026-03-17T14:36:00",
  "last_imported_at": "2026-03-17T14:36:00",
  "last_aggregated_at": "2026-03-17T14:36:00",
  "coverage_start": "2026-01-01",
  "coverage_end": "2026-03-31",
  "coverage_days": 90,
  "missing_days": 6,
  "completeness": 93.3,
  "avg_daily_load": 32.615,
  "max_daily_load": 41.280,
  "min_daily_load": 18.220,
  "missing_meter_days": 4,
  "interpolated_days": 3,
  "dirty_days": 2,
  "meter_count": 6,
  "meters": [
    {
      "meter_id": "3630001482148066073880",
      "account_id": "91360100XXXX",
      "extracted_customer_name": "华东精密制造厂",
      "multiplier": 100,
      "source_filename": "3630001482148066073880_2026-01.xlsx"
    }
  ]
}
```

---

## 2. `intent_customer_meter_reads_daily` - 意向客户原始电表日数据

该集合存储意向客户模块导入后的原始电表示数，采用**按日宽表**结构。

**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)

### 2.1. 设计说明

- 一条记录表示“某意向客户的某块电表在某一天的原始示数”
- 数据来源于上传的 Excel 文件，经预解析后写入
- 与通用集合 `raw_meter_data` 分开保存，避免污染正式负荷诊断数据源
- 每次对某意向客户重新导入时，默认先删除该客户原有原始记录，再整体重写

### 2.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一ID |
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

### 2.4. 示例

```json
{
  "_id": "67d7d4f5f2d9f91a2f9d0101",
  "customer_id": "67d7d4f5f2d9f91a2f9d0001",
  "customer_name": "华东精密制造厂",
  "meter_id": "3630001482148066073880",
  "account_id": "91360100XXXX",
  "date": "2026-03-15",
  "readings": [12031.2, 12032.1, 12032.9],
  "source_filename": "3630001482148066073880_2026-03.xlsx",
  "multiplier": 100,
  "meta": {
    "customer_name": "华东精密制造厂",
    "account_id": "91360100XXXX"
  },
  "created_at": "2026-03-17T14:36:00",
  "updated_at": "2026-03-17T14:36:00"
}
```

---

## 3. `intent_customer_load_curve_daily` - 意向客户聚合负荷日曲线

该集合存储意向客户的聚合结果，采用**按日宽表**结构。

**服务文件**: [`webapp/services/intent_customer_diagnosis_service.py`](/d:/Gitworks/exds-web/webapp/services/intent_customer_diagnosis_service.py)  
**复用算法来源**: [`webapp/services/load_aggregation_service.py`](/d:/Gitworks/exds-web/webapp/services/load_aggregation_service.py)

### 3.1. 设计说明

- 一条记录表示“某意向客户在某一天的 48 点聚合负荷结果”
- 聚合过程复用了 `LoadAggregationService.calculate_meter_48_points()` 的核心算法：
  - 异常 0 值清洗
  - 缺口识别
  - 连续缺口 `>3` 的历史廓形填充
  - 连续缺口 `<=3` 的线性插值
  - 差分计算
  - 96 转 48
- 当前版本聚合时**默认所有电表直接求和**，未启用 `allocation_ratio`
- 如果某天部分电表缺失，系统仍允许聚合，但会记录 `missing_meters`

### 3.2. 字段说明

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `_id` | `ObjectId` | 数据唯一ID |
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

### 3.4. 示例

```json
{
  "_id": "67d7d4f5f2d9f91a2f9d0201",
  "customer_id": "67d7d4f5f2d9f91a2f9d0001",
  "customer_name": "华东精密制造厂",
  "date": "2026-03-15",
  "values": [0.612, 0.598, 0.574],
  "total": 32.871,
  "meter_count": 6,
  "missing_meters": [],
  "data_quality": {
    "interpolated_points": [5, 6],
    "dirty_points": [18]
  },
  "created_at": "2026-03-17T14:36:00",
  "updated_at": "2026-03-17T14:36:00"
}
```

---

## 4. 与模块相关的现有复用集合

以下集合不是本模块新增，但与当前实现直接相关：

### 4.1. `raw_meter_data`

- 位置：`dataset_structures_v2.md`
- 用途：作为通用负荷诊断模块的原始电表示数数据源
- 关系：意向客户诊断模块当前**不直接写入**该集合，改为写入独立集合 `intent_customer_meter_reads_daily`

### 4.2. `customer_archives`

- 位置：`dataset_structures_v2.md`
- 用途：正式客户档案
- 关系：意向客户诊断模块当前**不直接复用正式客户档案**，改用独立主表 `intent_customer_profiles`

---

## 5. 当前版本边界说明

### 5.1. 已实现

- 意向客户主表保存
- 原始电表日数据保存
- 聚合结果宽表保存
- 文件预解析
- 用户名 / 户号 / 表号提取
- 倍率补录
- 导入前合法性校验
- 导入后自动聚合
- 页面按月、按日读取聚合结果

### 5.2. 当前未实现或未启用

- `intent_customer_import_batches` 独立导入批次表
- 电表 `allocation_ratio` 分摊系数
- 严格“缺一块表则整天禁止聚合”的门禁策略
- 与正式客户档案、正式统一负荷曲线的数据同步

---

## 6. 命名汇总

本模块当前新增的 3 个核心集合如下：

- `intent_customer_profiles`
- `intent_customer_meter_reads_daily`
- `intent_customer_load_curve_daily`
