# LoadQueryService 接口使用说明书

`LoadQueryService` 是系统中处理负荷曲线查询的核心服务类。它封装了对 `unified_load_curve` 集合的复杂查询逻辑，并支持多种数据融合策略，旨在为 API 层、预测模块和结算模块提供统一的数据访问接口。

## 1. 核心模型与枚举

### 1.1 FusionStrategy (数据融合策略)
系统支持多种融合策略来处理计量点 (MP) 数据与电表 (Meter) 数据的共存情况：
*   `MP_PRIORITY`: 优先使用 MP 数据，若不存在则使用 Meter 数据（默认）。
*   `MP_COMPLETE`: 仅在 MP 数据完全无缺失时使用，否则尝试 Meter。
*   `METER_PRIORITY`: 优先使用 Meter 数据。
*   `MP_ONLY`: 仅使用 MP 数据。
*   `METER_ONLY`: 仅使用 Meter 数据。

### 1.2 数据结构 (schemas)
*   `DailyCurve`: 包含日期、48/96点数组、日总电量及分时细项 (`TouUsage`)。
*   `DailyTotal`: 包含日期、日总电量及分时细项。
*   `MonthlyTotal`: 包含月份、月总电量、有数据天数及分时细项。
*   `TouUsage`: 包含尖、峰、平、谷、深五个时段的电量。

---

## 2. 基础查询接口 (单客户)

### 2.1 获取单日曲线
```python
@staticmethod
def get_daily_curve(customer_id: str, date: str, strategy: FusionStrategy = FusionStrategy.MP_COMPLETE) -> Optional[DailyCurve]
```
获取指定客户在特定日期的负荷曲线。

### 2.2 获取多日曲线序列
```python
@staticmethod
def get_curve_series(customer_id: str, start_date: str, end_date: str, strategy: FusionStrategy = FusionStrategy.MP_COMPLETE, return_df: bool = False) -> Union[List[DailyCurve], pd.DataFrame]
```
获取指定日期范围内的曲线序列。支持返回 `pd.DataFrame` 格式。

### 2.3 获取日/月电量总量
*   `get_daily_totals(...)`: 返回每日电量汇总。
*   `get_monthly_totals(...)`: 返回每月电量汇总。

---

## 3. 聚合查询接口 (多客户叠加)

### 3.1 聚合曲线序列
```python
@staticmethod
def aggregate_curve_series(customer_ids: List[str], start_date: str, end_date: str, strategy: FusionStrategy = FusionStrategy.MP_COMPLETE, return_df: bool = False) -> List[DailyCurve]
```
将多个客户的负荷曲线按日期对应位相加，返回聚合后的曲线。

### 3.2 聚合日/月总量
*   `aggregate_daily_totals(...)`: 多个客户日电量之和。
*   `aggregate_monthly_totals(...)`: 多个客户月电量之和。

---

## 4. 批量查询接口

接口命名格式为 `batch_get_*`，返回字典格式：`Dict[customer_id, List[DataModel]]`。
*   `batch_get_curve_series`
*   `batch_get_daily_totals`
*   `batch_get_monthly_totals`

适用于需要同时处理多个独立客户数据的场景，比循环调用单客户接口效率更高。

---

## 5. 快捷业务接口

### 5.1 获取签约客户聚合负荷
```python
@staticmethod
def get_signed_customers_aggregated_load(month: str, data_type: str = 'daily', strategy: FusionStrategy = FusionStrategy.MP_COMPLETE, return_df: bool = False)
```
自动查找指定月份内所有“执行中”合同对应的客户，并返回其聚合后的负荷数据。`data_type` 可选 `curve`, `daily`, `monthly`。

---

## 6. 使用示例

### 6.1 获取 DataFrame 格式数据进行分析
```python
from webapp.services.load_query_service import LoadQueryService
from webapp.models.load_enums import FusionStrategy

df = LoadQueryService.get_curve_series(
    customer_id="cid_123",
    start_date="2025-01-01",
    end_date="2025-01-31",
    strategy=FusionStrategy.MP_PRIORITY,
    return_df=True
)

# 此时 df 为以日期为索引的 Pandas DataFrame
print(df['total'].mean())
```

### 6.2 聚合多个大客户负荷
```python
vips = ["id_A", "id_B", "id_C"]
agg_curves = LoadQueryService.aggregate_curve_series(vips, "2025-01-20", "2025-01-21")
for curve in agg_curves:
    print(f"日期: {curve.date}, 聚合总电量: {curve.total}")
```
