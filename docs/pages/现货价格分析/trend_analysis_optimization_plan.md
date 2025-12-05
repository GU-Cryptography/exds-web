# 现货趋势分析页面 - 性能优化方案

## 问题现状
当前 `SpotTrendAnalysisPage` 包含"价格走势"和"时段分析"两个 Tab。
**问题**: 即使日期区间未变更，在 Tab 之间切换时，数据总是重新加载，出现 Loading 状态，且图表会重新绘制。

## 技术原因分析

1.  **组件卸载/重挂载 (Unmount/Remount)**
    *   虽然使用了 `TabPanel`，但如果父组件重新渲染或 `TabPanel` 内部机制导致子组件被卸载（Unmount），组件内部的 `state`（包括 `data`）会被销毁。
    *   再次切回时，组件重新挂载（Remount），触发 `useEffect` 重新发起网络请求。

2.  **数据状态下沉在子组件**
    *   目前数据的获取 (`fetchData`) 和存储 (`data` state) 都在各自的 Tab 子组件内部。
    *   这意味着数据的生命周期与 UI 组件绑定。UI 消失，数据即丢失。

3.  **Recharts 重绘**
    *   `ResponsiveContainer` 在容器从 `display: none` 变为可见时，会检测尺寸变化并触发图表重绘（及动画）。

## 改善方案：状态提升与缓存 (State Lifting & Caching)

核心思路是将**数据的所有权**从"子组件"（Tab页）转移到"父组件"（`SpotTrendAnalysisPage`），使数据生命周期长于 Tab 的显示周期。

### 1. 架构调整

#### 父组件 (`SpotTrendAnalysisPage`) 职责
*   **持有状态**: 维护 `trendData` (价格走势数据) 和 `timeSlotData` (时段分析数据) 两个状态变量。
*   **持有加载状态**: 维护 `trendLoading` 和 `timeSlotLoading`。
*   **管理请求**:
    *   监听 `startDate`, `endDate` 和 `tabIndex` 变化。
    *   **缓存命中逻辑**: 切换 Tab 时，检查对应的数据状态是否为空。如果不为空且日期未变，则**不发起请求**。
    *   **脏数据清理**: 当用户修改日期区间时，清空所有 Tab 的数据缓存（或标记为 dirty），并立即请求当前 Tab 的新数据。

#### 子组件 (`PriceTrendTab`, `TimeSlotAnalysisTab`) 职责
*   **纯展示 (Presentational)**: 移除内部的 `fetchData` `useEffect` 和 `useState`。
*   **接收 Props**: 通过 Props 接收 `data`, `loading`, `error`。
*   **渲染**: 根据传入的 `data` 直接渲染图表和表格。

### 2. 实施步骤

1.  **修改 `SpotTrendAnalysisPage.tsx`**:
    *   引入 API 调用 (`fetchPriceTrend`, `fetchTimeSlotStats`)。
    *   添加 `trendData`, `timeSlotData` 状态。
    *   实现 `useEffect`，根据 `tabIndex` 懒加载数据，并实现缓存判断。

2.  **重构 `PriceTrendTab.tsx`**:
    *   删除 API 调用逻辑。
    *   Props 增加 `data` 字段。

3.  **重构 `TimeSlotAnalysisTab.tsx`**:
    *   删除 API 调用逻辑。
    *   Props 增加 `data` 字段。

### 3. 预期效果
*   **Tab 切换瞬时响应**: 数据已在父组件内存中，切换 Tab 时直接传递给子组件，无 Loading 等待。
*   **请求量减半**: 在不改变日期的情况下，多次来回切换 Tab 不会产生任何网络请求。
