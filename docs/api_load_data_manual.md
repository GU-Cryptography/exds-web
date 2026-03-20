# 后端客户负荷数据获取接口使用说明书

本文档旨在为其他模块提供“电力交易辅助决策系统”后端中有关客户负荷数据的 API 接口使用说明。

## 1. 认证说明

所有受保护的接口均需要 JWT 认证。请求头中必须包含：
`Authorization: Bearer {your_token}`

---

## 2. 客户负荷分析接口 (Customer Analysis)

路由前缀: `/api/v1/customer-analysis`
源码参考: `webapp/api/v1_customer_analysis.py`

### 2.1 获取客户日内分析视图
**GET** `/{customer_id}/daily-view`

*   **参数**:
    *   `customer_id` (Path): 客户唯一标识。
    *   `date` (Query): 查询日期，格式 `YYYY-MM-DD`。
*   **返回内容**:
    *   `main_curve`: 48点电量曲线（含当日、昨日对比及各时段类型）。
    *   `selected_date_stats`: 所选日期的总电量、分时占比及峰谷比。
    *   `stats`: 年度累计、月度累计、去年同期对比及同比数据。

### 2.2 获取历史用电趋势
**GET** `/{customer_id}/history`

*   **参数**:
    *   `type` (Query): `daily` (近30天) 或 `monthly` (近13个月)。
    *   `end_date` (Query): 截止日期，格式 `YYYY-MM-DD` 或 `YYYY-MM`。
*   **返回内容**:
    *   日期与对应用电量的列表。

### 2.3 触发智能诊断 (AI Diagnose)
**POST** `/{customer_id}/ai-diagnose`

*   **参数**:
    *   `date` (Query): 分析基准日期。
*   **说明**: 分析该客户最近7天的数据，自动识别生产模式（如日间单班、连续生产、周末双休等），并自动为客户打上算法标签。

---

## 3. 客户负荷看板接口 (Customer Load Overview)

路由前缀: `/api/v1/customer-load-overview`
源码参考: `webapp/api/v1_customer_load_overview.py`

### 3.1 获取看板汇总数据
**GET** `/dashboard`

*   **参数**:
    *   `year`, `month` (Query): 目标年月。
    *   `view_mode` (Query): `monthly` (月度) 或 `ytd` (年初至今)。
    *   `search` (Query, 可选): 客户搜索词。
    *   `sort_field`, `sort_order`: 排序配置。
*   **返回内容**:
    *   涵盖 KPI 指标、贡献图数据、龙虎榜、效率榜及客户列表。

---

## 4. 整体负荷分析接口 (Total Load)

路由前缀: `/api/v1/total-load`
源码参考: `webapp/api/v1_total_load.py`

### 4.1 获取月度电量汇总
**GET** `/monthly`
*   返回所有客户聚合后的月度用电记录（含同比变化、分时分解）。

### 4.2 获取月内日电量分布
**GET** `/daily`
*   返回特定月份内每一天的聚合电量及日期类型标注（工作日/节假日）。

### 4.3 获取聚合日内曲线及对比
**GET** `/curve`
*   返回全量客户聚合后的 48点日曲线，支持与昨日、去年同期、月均值等进行对比。

### 4.4 整体负荷统计
**GET** `/statistics`
*   参数 `scope`: `daily`, `monthly`, `yearly`。
*   返回总电量、时段分布、峰谷比等核心统计数据。

---

## 5. 数据源与融合逻辑

系统数据源主要包括：
1.  **MP 数据 (计量点)**: 通过 RPA 自动采集，精度高，为主要来源。
2.  **Meter 数据 (电表)**: 手工导入或补充。

**融合策略 (Dynamic Fusion)**:
后端 `LoadQueryService` 会根据数据完整性动态选择最优数据源。默认策略为：优先使用 MP 数据，若 MP 数据缺失或覆盖率低于阈值，则自动切换至 Meter 数据。
