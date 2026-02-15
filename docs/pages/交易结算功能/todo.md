# 重构 SettlementService 数据获取函数

## 问题描述

`settlement_service.py` 的 420-500 行包含三个"数据获取/转换"辅助函数，职责不属于结算服务本身：

| # | 函数 | 职责 | 重构决策 |
|---|------|------|---------|
| 1 | `_fetch_price_curve` | 从现货价格集合获取 48 点价格曲线 | **删除** → 改调 `spot_price_service` |
| 2 | `_fetch_curve_from_collection` | 从任意集合获取 48 点曲线（仅 1 处调用） | **保留**在 `SettlementService` 中 |
| 3 | `_resample_curve` | 96→48 点重采样 | **提取**到 `webapp/utils/curve_utils.py` |

## 与 `retail_settlement_service.py` 的重复分析

**存在逻辑重复**（非函数名重复）：

`RetailSettlementService` 有自己的 `_map_spot_price_to_48` 方法获取 48 点实时价格，与 `SettlementService._fetch_price_curve` 做同一件事。重构后两者统一调用 `spot_price_service`，消除重复。

---

## Proposed Changes

### Step 1: 扩展 `spot_price_service.py`

#### [MODIFY] [spot_price_service.py](file:///d:/Gitworks/exds-web/webapp/services/spot_price_service.py)

**1.1 扩展 `data_type` 类型**

```diff
- data_type: Literal["day_ahead", "real_time"] = "day_ahead",
+ data_type: Literal["day_ahead", "real_time", "day_ahead_econ"] = "day_ahead",
```

**1.2 新增集合映射与字段映射**

当前 `get_spot_prices` 对所有类型统一使用 `avg_clearing_price`，但三个集合的字段不同：

| `data_type` | 集合名 | 价格字段 | 说明 |
|---|---|---|---|
| `day_ahead` | `day_ahead_spot_price` | `avg_clearing_price` | 不变 |
| `real_time` | `real_time_spot_price` | `arithmetic_avg_clearing_price` | ⚠️ 当前错误地用 `avg_clearing_price` |
| `day_ahead_econ` | `day_ahead_econ_price` | `clearing_price` | 新增 |

> [!IMPORTANT]
> `real_time_spot_price` 集合中结算应使用 `arithmetic_avg_clearing_price`（算术均价），而非当前的 `avg_clearing_price`（加权均价）。需要在映射中区分。

`day_ahead_econ_price` 集合字段结构（已确认）：

| 字段名 | 类型 | 描述 |
|--------|------|------|
| `datetime` | ISODate | 数据点时间 |
| `date_str` | String | 日期 `YYYY-MM-DD` |
| `time_str` | String | 时间 `HH:MM` |
| `clearing_power` | Number | 出清电量 (MWh) |
| `clearing_price` | Number | 经济出清价格 (元/MWh) |

**1.3 实现思路**

在函数开头建立映射表：

```python
TYPE_CONFIG = {
    "day_ahead":      {"collection": "day_ahead_spot_price",  "price_field": "avg_clearing_price",              "volume_field": "total_clearing_power"},
    "real_time":      {"collection": "real_time_spot_price",  "price_field": "arithmetic_avg_clearing_price",   "volume_field": "total_clearing_power"},
    "day_ahead_econ": {"collection": "day_ahead_econ_price",  "price_field": "clearing_price",                  "volume_field": "clearing_power"},
}
```

将 `_to_48_points` 等内部函数从硬编码 `avg_clearing_price` 改为接受 `price_field` 参数。

**1.4 新增便捷函数 `get_spot_price_values`**

```python
def get_spot_price_values(
    db: Database, date_str: str, 
    data_type: Literal["day_ahead", "real_time", "day_ahead_econ"] = "day_ahead",
    resolution: Resolution = 48
) -> List[float]:
    """获取纯数值价格列表，供结算服务直接使用"""
    curve_data = get_spot_prices(db, date_str, data_type, resolution, include_volume=False)
    return [p.price for p in curve_data.points]
```

---

### Step 2: 提取 `_resample_curve` 为通用工具

#### [NEW] [curve_utils.py](file:///d:/Gitworks/exds-web/webapp/utils/curve_utils.py)

```python
def resample_curve(values: List[float], method: str = 'sum', source: str = 'Unknown') -> List[float]:
    """96→48 点重采样，或异常长度强制调整为 48 点"""
    ...
```

从 `SettlementService._resample_curve` 原样提取，改为模块级函数。

---

### Step 3: 重构 `settlement_service.py` 的调用方

#### [MODIFY] [settlement_service.py](file:///d:/Gitworks/exds-web/webapp/services/settlement_service.py)

- **删除** `_fetch_price_curve`（L420-455）
- **删除** `_resample_curve`（L478-500）
- **保留** `_fetch_curve_from_collection`（L457-476），其内部的 `_resample_curve` 调用改为 `from webapp.utils.curve_utils import resample_curve`
- `_fetch_basis_data_preliminary` 中的改动：

```diff
- p_rt = self._fetch_price_curve('real_time_spot_price', date_str, price_field='arithmetic_avg_clearing_price')
+ p_rt = get_spot_price_values(self.db, date_str, "real_time")

- p_da = self._fetch_price_curve('day_ahead_econ_price', date_str, price_field='clearing_price')
+ p_da = get_spot_price_values(self.db, date_str, "day_ahead_econ")
# fallback:
- p_da = self._fetch_price_curve('day_ahead_spot_price', date_str)
+ p_da = get_spot_price_values(self.db, date_str, "day_ahead")
```

- L303 处负荷重采样改为：
```diff
- q_rt = self._resample_curve(raw_load, method='sum', source='RT Load')
+ q_rt = resample_curve(raw_load, method='sum', source='RT Load')
```

---

### Step 4: 统一 `retail_settlement_service.py` 的价格获取

#### [MODIFY] [retail_settlement_service.py](file:///d:/Gitworks/exds-web/webapp/services/retail_settlement_service.py)

- 删除 `_map_spot_price_to_48` 方法
- 改为调用 `get_spot_price_values(self.db, date_str, "real_time")`
- 消除与 `spot_price_service` 的逻辑重复

---

## 执行顺序与风险

| 步骤 | 依赖 | 风险 |
|------|------|------|
| Step 1: 扩展 `spot_price_service` | 无 | 低 — 纯新增，不影响已有调用 |
| Step 2: 提取 `curve_utils` | 无 | 低 — 纯提取 |
| Step 3: 重构 `settlement_service` | Step 1 + 2 | 中 — 需验证价格曲线数值一致 |
| Step 4: 统一 `retail_settlement_service` | Step 1 | 中 — 需对比 `_map_spot_price_to_48` 与 `_to_48_points` 的聚合逻辑 |

## Verification Plan

### 自动验证
- 后端启动无报错
- 对比重构前后同一日期的结算计算结果（价格曲线 & 最终电费），确保数值一致
- `npm run build --prefix frontend` 无编译错误（前端未变动，预期无影响）
