# 意向客户诊断方案 B - 宽表落地设计

## 1. 文档目的

本文档是 [`意向客户诊断模块技术方案`](../客户档案管理/意向客户诊断模块技术方案.md) 的补充细化文档，用于明确以下内容：

- 采用“方案 B”时的数据存储设计
- 一体化导入与聚合弹窗的交互流程
- 原始电表数据与聚合结果均采用宽表时的后端落地方式
- 与现有“负荷数据诊断”导入能力、聚合算法的复用边界
- MVP 实施范围、接口草案、异常处理与验收口径

本文档结论优先级低于项目通用规范；若与通用规范存在冲突，以当前 MVP 落地效率优先，并在文末标明折中点。

---

## 2. 方案结论

### 2.1 最终选型

本方案采用“方案 B”：

- 意向客户主数据：独立保存
- 原始电表数据：宽表保存
- 聚合后的 48 点曲线结果：宽表保存

### 2.2 选型原因

1. 与现有代码最接近，改动最小
2. 现有电表导入逻辑本身就是“按表按日”宽表结构
3. 现有聚合算法输入输出也更接近按日数组
4. MVP 阶段优先完成“导入全部电表文件 -> 补倍率 -> 自动聚合 -> 立即展示”
5. 后续若需要演进为长表，可在聚合结果层平滑迁移

### 2.3 本方案的边界

本方案仅覆盖：

- 顶部公共区
- `客户负荷数据` Tab
- 新增/导入弹窗中的“导入 + 倍率录入 + 聚合”一体化流程

本方案暂不覆盖：

- `负荷覆盖结算月份` Tab
- `零售套餐对比` Tab
- 多租户复杂权限隔离
- 原始数据修复后的批量重算策略优化

---

## 3. 核心设计原则

### 3.1 用户操作上一次完成

用户在新增或导入弹窗中，一次性完成以下动作：

1. 录入或确认意向客户名称
2. 一次性拖入该客户全部电表数据文件
3. 系统自动初步识别户号、电表号、日期范围
4. 用户补录每个电表的倍率
5. 提交后系统自动执行：
   - 保存客户与电表配置
   - 保存原始电表数据
   - 执行聚合
   - 返回导入与聚合摘要

### 3.2 数据存储上分层保存

虽然交互上是“一次完成”，但数据层必须拆分保存：

- 客户主表：用于客户选择、删除、显示最近导入时间
- 原始电表数据表：用于追溯、完整性分析、重算
- 聚合结果表：用于页面展示与后续分析

### 3.3 算法尽量复用现有实现

优先复用现有代码中的以下能力：

- `meter_data_import_service.py` 的 Excel 解析思路
- `load_aggregation_service.py` 的电表清洗、插值、差分、96 转 48 的核心算法

但不直接复用现有“正式客户 + customer_archives + unified_load_curve”的整条链路，避免污染正式客户数据域。

---

## 4. 数据模型设计

## 4.1 总览

本方案新增 3 张核心集合：

1. `intent_customers`
2. `intent_customer_meter_reads_daily`
3. `intent_customer_load_curve_daily`

---

### 4.2 `intent_customers`

用途：

- 存储意向客户最小主数据
- 存储户号、电表、倍率配置
- 提供顶部公共区所需的“最近导入时间”

建议结构：

```json
{
  "_id": "ObjectId",
  "customer_name": "某制造企业",
  "status": "active",
  "accounts": [
    {
      "account_id": "1234567890",
      "meters": [
        {
          "meter_id": "3630001482148066073880",
          "multiplier": 100.0
        }
      ]
    }
  ],
  "created_at": "datetime",
  "updated_at": "datetime",
  "last_imported_at": "datetime",
  "last_aggregated_at": "datetime",
  "created_by": "admin",
  "updated_by": "admin"
}
```

字段说明：

- `customer_name`：意向客户名称，允许在首次导入时手工输入
- `accounts`：最小结构，只保留户号与电表倍率
- `last_imported_at`：顶部公共区直接展示的数据导入时间来源
- `last_aggregated_at`：便于判断最近一次自动聚合是否完成

索引建议：

- `{ customer_name: 1 }`
- `{ updated_at: -1 }`
- `{ last_imported_at: -1 }`

---

### 4.3 `intent_customer_meter_reads_daily`

用途：

- 存储原始电表数据
- 作为完整性分析、断点分析、读数异常分析、重新聚合的依据

宽表结构建议：

```json
{
  "_id": "ObjectId",
  "customer_id": "ObjectId",
  "customer_name": "某制造企业",
  "account_id": "1234567890",
  "meter_id": "3630001482148066073880",
  "date": "2026-03-17",
  "readings": [96个示数值],
  "multiplier": 100.0,
  "source_file": "3630001482148066073880_2026-03.xlsx",
  "import_batch_id": "uuid",
  "quality_flags": {
    "has_missing": false,
    "has_reverse": false,
    "has_zero_gap": false
  },
  "meta": {
    "excel_customer_name": "某制造企业",
    "excel_account_id": "1234567890"
  },
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

设计说明：

- 一条记录表示“一个电表某一天的原始示数”
- `readings` 固定按 96 点保存
- `multiplier` 冗余保存一份，便于回溯导入时的计算口径
- `source_file` 和 `import_batch_id` 用于追溯
- `quality_flags` 用于快速摘要，不替代完整明细分析

索引建议：

- `{ customer_id: 1, meter_id: 1, date: 1 }` 唯一索引
- `{ customer_id: 1, account_id: 1, date: 1 }`
- `{ import_batch_id: 1 }`

---

### 4.4 `intent_customer_load_curve_daily`

用途：

- 存储聚合后的每日 48 点曲线结果
- 直接供 `客户负荷数据` Tab 展示
- 为后续 Tab2 / Tab3 提供输入基础

宽表结构建议：

```json
{
  "_id": "ObjectId",
  "customer_id": "ObjectId",
  "date": "2026-03-17",
  "values_48": [48个点位值],
  "total_kwh": 12345.67,
  "meter_count_expected": 5,
  "meter_count_actual": 5,
  "missing_meters": [],
  "data_quality": {
    "interpolated_points": [3, 4],
    "dirty_points": [18]
  },
  "import_batch_id": "uuid",
  "aggregation_version": "v1",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

设计说明：

- 一条记录表示“一个客户某一天的 48 点聚合结果”
- `values_48` 直接用于图表和原始结果预览
- `meter_count_expected`、`meter_count_actual`、`missing_meters` 用于完整性分析
- `data_quality` 复用现有算法中的插值点、脏数据点信息

索引建议：

- `{ customer_id: 1, date: 1 }` 唯一索引
- `{ import_batch_id: 1 }`

---

## 5. 一体化导入与聚合弹窗设计

### 5.1 交互目标

用户不再分别执行“导入数据”和“执行聚合”，而是在一个弹窗中完成。

### 5.2 弹窗阶段划分

建议采用 4 步流程：

#### 第一步：客户信息与文件拖拽

- 输入客户名称，或选择已有意向客户
- 拖拽全部电表文件
- 系统校验文件格式，仅允许 Excel 文件

#### 第二步：自动识别与初步分析

系统解析全部文件后，输出识别清单：

- 客户名称
- 户号
- 电表号
- 文件名
- 覆盖日期范围
- 识别状态

并提示以下问题：

- 是否存在未识别的电表号
- 是否存在重复文件
- 是否存在同一电表多份重叠日期文件
- 是否存在客户名不一致
- 是否缺少倍率

#### 第三步：补录倍率并确认导入

用户按电表维度补录倍率：

- 同一电表只需录一次
- 如系统能从已有记录中找到倍率，可自动回填
- 缺倍率时禁止进入下一步

确认区展示：

- 电表总数
- 户号总数
- 预计导入日期范围
- 待导入总天数

#### 第四步：执行导入与自动聚合

提交后后端按顺序执行：

1. 创建或更新意向客户主表
2. 保存原始电表数据
3. 逐日执行聚合，生成 `values_48`
4. 更新客户的 `last_imported_at` 与 `last_aggregated_at`
5. 直接返回导入摘要与聚合摘要

---

## 6. 与现有代码的复用策略

### 6.1 可直接参考的前端能力

参考现有页面：

- `frontend/src/pages/LoadDataDiagnosisPage.tsx`
- `frontend/src/components/load-diagnosis/LoadDataImportDialog.tsx`
- `frontend/src/components/load-diagnosis/LoadDataAggregationDialog.tsx`

可复用思路：

- 拖拽上传区
- 文件列表与状态展示
- 导入中进度提示
- 完成后的摘要反馈

不建议直接照搬的点：

- 现有实现是“导入”和“聚合”两个独立弹窗
- 现有页面面向正式客户的公共原始数据域
- 本场景需要补录倍率，因此必须增加识别确认步骤

### 6.2 可直接参考的后端能力

参考现有后端：

- `webapp/services/meter_data_import_service.py`
- `webapp/services/load_aggregation_service.py`
- `webapp/api/v1_load_diagnosis.py`

建议复用方式：

1. 复用 Excel 解析思路  
   继续识别：
   - 电表号
   - 日期列
   - 用户名称
   - 户号
   - 96 点示数字段

2. 复用聚合核心算法  
   重点复用：
   - `_clean_abnormal_zeros`
   - `_find_gaps`
   - `_linear_interpolate`
   - `_profile_fill`
   - `calculate_meter_48_points`

3. 不直接复用正式客户聚合路径  
   不建议直接调用基于 `customer_archives` 的客户级聚合流程，应改为：
   - 从 `intent_customers` 取电表和倍率配置
   - 从 `intent_customer_meter_reads_daily` 取原始示数
   - 生成 `intent_customer_load_curve_daily`

---

## 7. 聚合计算口径

### 7.1 输入

输入为意向客户某日全部电表的原始示数数据：

- `meter_id`
- `date`
- `readings[96]`
- `multiplier`

### 7.2 处理流程

对每块电表按现有算法处理：

1. 清洗异常 0 值
2. 识别缺口
3. 小缺口线性插值
4. 大缺口优先使用前一日廓形填充
5. 差分得到负荷值
6. 96 点转 48 点
7. 乘倍率
8. 多电表按时段求和

### 7.3 输出

输出为客户级单日 48 点曲线：

- `values_48`
- `total_kwh`
- `meter_count_expected`
- `meter_count_actual`
- `missing_meters`
- `data_quality`

### 7.4 MVP 约束

- 不做复杂跨批次纠偏
- 不做自动倍率推断
- 不做多版本聚合结果并存
- 聚合结果默认覆盖同一客户同一天旧结果

---

## 8. API 草案

### 8.1 客户与导入一体化接口

建议新增：

`POST /api/v1/intent-customers/import-and-aggregate`

请求形式：

- `multipart/form-data`
- 包含：
  - `customer_name`
  - `customer_id`（已有客户时可传）
  - `meter_configs`（JSON 字符串，包含 `account_id`、`meter_id`、`multiplier`）
  - `files[]`

返回示例：

```json
{
  "success": true,
  "customer_id": "ObjectId",
  "import_batch_id": "uuid",
  "import_summary": {
    "file_count": 6,
    "meter_count": 6,
    "inserted_days": 270,
    "updated_days": 0,
    "skipped_days": 0
  },
  "aggregation_summary": {
    "generated_days": 90,
    "failed_days": 0
  },
  "date_range": {
    "start_date": "2026-01-01",
    "end_date": "2026-03-31"
  },
  "warnings": []
}
```

### 8.2 预解析接口

建议新增：

`POST /api/v1/intent-customers/import-preview`

用途：

- 仅解析文件，不入库
- 返回识别结果，供用户补录倍率

返回内容建议包含：

- 识别到的客户名集合
- 户号列表
- 电表列表
- 每个电表的日期范围
- 重复文件提示
- 缺倍率电表列表

### 8.3 负荷数据页接口

建议新增：

1. `GET /api/v1/intent-customers`
2. `GET /api/v1/intent-customers/{customer_id}`
3. `DELETE /api/v1/intent-customers/{customer_id}`
4. `GET /api/v1/intent-customers/{customer_id}/load-data/summary`
5. `GET /api/v1/intent-customers/{customer_id}/load-data/monthly-daily-curves`
6. `GET /api/v1/intent-customers/{customer_id}/load-data/daily-48-curve`

接口职责建议：

- `summary`：返回顶部摘要、负荷汇总信息、完整性分析摘要
- `monthly-daily-curves`：返回某月按日负荷曲线数据
- `daily-48-curve`：返回某日 48 时段负荷曲线数据

---

## 9. 前端页面细化

### 9.1 顶部公共区

保留：

- 客户下拉
- 新增/导入按钮
- 删除按钮
- 数据导入时间

本方案下，“数据导入时间”取值口径：

- 展示 `intent_customers.last_imported_at`

### 9.2 `客户负荷数据` Tab 的 3 个区域

#### 区域 A：汇总信息与完整性面板

- 参考 `CustomerLoadAnalysisPage.tsx` 中“用电特征标签与模式识别”面板的视觉组织方式
- 本页面不放标签功能，改为展示“负荷汇总 + 完整性信息”
- 建议展示内容：
  - 数据范围
  - 覆盖天数
  - 缺失天数
  - 完整率
  - 最近导入时间
  - 最近聚合时间
  - 日均电量
  - 最大日电量
  - 最小日电量

#### 区域 B：按月显示日负荷曲线

- 默认按月查看
- X 轴为当月日期
- Y 轴为每日总负荷
- 支持切换月份
- 支持图表全屏
- 主要用于观察整月日负荷分布与波动情况

#### 区域 C：按日显示 48 时段负荷

- 默认选中某一天
- X 轴为 48 个时段
- Y 轴为该日分时负荷
- 支持日期切换
- 支持图表全屏
- 图表下方可展示：
  - 当日总电量
  - 缺失电表数
  - 插值点数
  - 脏数据点数

说明：

- `客户负荷数据` Tab 主体直接面向聚合后的负荷结果
- 原始电表宽表数据保留在后端用于追溯、重算和完整性分析
- MVP 阶段不在该 Tab 主体展示原始电表明细表格

---

## 10. 异常处理策略

### 10.1 预解析阶段阻断项

以下问题出现时，不允许提交：

- 全部文件都无法识别电表号
- 存在缺倍率电表
- 同一电表同一日期出现冲突且无法判断覆盖策略
- 客户名称为空且用户未手工输入

### 10.2 可放行但需警告的情况

- 文件中的客户名称不完全一致
- 同一户号下电表数量与预期不一致
- 某些电表最后一天数据不完整
- 部分日期聚合时存在插值或脏点

### 10.3 失败回滚建议

本方案建议采用“批次级容错，不做数据库事务回滚”：

- 原始数据写入成功后，即使部分日期聚合失败，也保留原始数据
- 聚合失败的日期记录到批次摘要中
- 用户可后续针对该客户重新聚合

原因：

- MongoDB 多集合大事务在此场景没有必要
- 保留原始数据有利于后续排障和重算

---

## 11. 实施拆分

### 11.1 后端任务

1. 新增意向客户相关模型与 Service
2. 新增预解析接口
3. 新增导入与聚合一体化接口
4. 复用现有聚合核心算法，改造为意向客户数据源
5. 新增负荷数据摘要、月度日负荷接口、日内 48 点接口
6. 新增删除客户接口与密码校验接入

### 11.2 前端任务

1. 新建意向客户诊断页面骨架
2. 新建顶部公共区组件
3. 新建“新增/导入”一体化弹窗
4. 实现文件预解析结果展示
5. 实现倍率录入表格
6. 实现导入执行进度与结果摘要
7. 实现 `客户负荷数据` Tab 的完整性面板、月度日负荷图、日内 48 点图

### 11.3 联调任务

1. 验证单电表客户导入
2. 验证多电表同户号客户导入
3. 验证多户号客户导入
4. 验证缺倍率阻断
5. 验证导入成功后顶部导入时间刷新
6. 验证删除客户后列表和内容区状态正确清空

---

## 12. MVP 验收清单

- [ ] 可创建或选择意向客户
- [ ] 可在一个弹窗中完成全部电表文件上传、倍率补录、导入和聚合
- [ ] 原始电表数据按宽表成功保存
- [ ] 聚合结果按宽表成功保存
- [ ] 顶部摘要正确显示最近数据导入时间
- [ ] 可查看覆盖日期范围、覆盖天数、缺失天数、完整率等完整性信息
- [ ] 可按月查看每日负荷曲线
- [ ] 可按日查看 48 时段负荷曲线
- [ ] 聚合结果图表支持全屏
- [ ] 可正确提示缺失电表、插值点、脏数据点
- [ ] 删除客户时必须输入密码确认
- [ ] 移动端可正常浏览表格和图表

---

## 13. 与通用规范的对齐说明

### 13.1 已对齐部分

- 前端统一使用 `apiClient`
- 图表使用 `useChartFullscreen`
- Loading 采用“首次加载 + 覆盖层刷新”模式
- 后端统一通过 `DATABASE` 访问数据库
- Service 层承担核心业务逻辑
- API 层负责 `HTTPException` 转换

### 13.2 本方案的折中点

项目通用后端规范倾向时序数据使用长表；本方案在 MVP 阶段对以下两类数据采用宽表：

- 原始电表数据
- 聚合 48 点结果

折中原因：

1. 更贴近现有导入结构
2. 更贴近现有聚合算法输入输出
3. 可显著降低本轮改造成本
4. 有利于先完成业务闭环

### 13.3 后续演进预留

若后续需要增强下列能力，可将聚合结果逐步迁移为长表：

- 大范围时序统计分析
- 点位级条件筛选
- 月度大批量聚合分析
- 套餐测算链路统一接入

迁移时建议：

- 原始电表数据仍保留宽表
- 聚合结果新增长表投影集合
- 前端逐步改为消费长表接口
