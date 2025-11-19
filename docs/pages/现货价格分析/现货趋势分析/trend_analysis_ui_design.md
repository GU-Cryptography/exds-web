# 现货趋势分析 (Spot Market Trend Analysis) - UI设计文档

## 一、页面定位

### 1.1 页面信息

- **页面文件名**: `frontend/src/pages/SpotTrendAnalysisPage.tsx`
- **路由路径**: `/market-analysis/spot-trend-analysis`
- **菜单位置**: 现货价格分析 → 现货趋势分析（独立子菜单）
- **页面标题**: "现货趋势分析"

### 1.2 菜单结构调整

```
现货价格分析 (Market Price Analysis)
├── 现货价格总览 (Spot Price Overview)          [原：现货价格分析]
│   └── /market-analysis/spot-price-overview
└── 现货趋势分析 (Spot Trend Analysis)          [新增]
    └── /market-analysis/spot-trend-analysis
```

**说明**：
- "现货价格总览"：聚焦单日价格分析（市场价格总览、日前现货分析、实时现货复盘、价差归因分析）
- "现货趋势分析"：聚焦长期趋势分析（7-90天周期）

### 1.3 设计原则

- ✅ 遵循项目《前端开发规范》
- ✅ 参考 `MarketPriceAnalysisPage` 的 Tab 式导航布局
- ✅ 使用 Material-UI v7 Grid 语法 (`size` 属性)
- ✅ 移动端优先的响应式设计
- ✅ 所有图表支持全屏功能 (`useChartFullscreen`)
- ✅ 区分首次加载和数据刷新的 Loading 状态

---

## 二、页面整体架构

### 2.1 Tab 导航结构

页面采用 **Tab 式导航**，将6个需求模块分为6个独立的 Tab：

```
┌─────────────────────────────────────────────────────────────┐
│ 现货趋势分析                                                   │
├─────────────────────────────────────────────────────────────┤
│ [价格趋势] [储能套利] [价格异常] [星期特性] [多因子相关性] [波动性分析] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    当前激活的 Tab 内容                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Tab 列表**：
1. **价格趋势分析** (Price Trend) - 对应需求1
2. **储能套利分析** (Storage Arbitrage) - 对应需求5
3. **价格异常与极值** (Price Anomaly) - 对应需求6
4. **星期特性分析** (Weekday Characteristics) - 对应需求2
5. **多因子相关性** (Multi-factor Correlation) - 对应需求3
6. **波动性分析** (Volatility Analysis) - 对应需求4

**优先级排序说明**：
- P0 优先级（价格趋势、储能套利、价格异常）放在前面
- P1/P2 优先级放在后面

### 2.2 页面主框架代码

```tsx
import React, { useState } from 'react';
import { Box, Container, Typography, Tabs, Tab, Paper } from '@mui/material';
import { PriceTrendTab } from '../components/trend-analysis/PriceTrendTab';
import { StorageArbitrageTab } from '../components/trend-analysis/StorageArbitrageTab';
import { PriceAnomalyTab } from '../components/trend-analysis/PriceAnomalyTab';
import { WeekdayCharacteristicsTab } from '../components/trend-analysis/WeekdayCharacteristicsTab';
import { MultiFactorCorrelationTab } from '../components/trend-analysis/MultiFactorCorrelationTab';
import { VolatilityAnalysisTab } from '../components/trend-analysis/VolatilityAnalysisTab';

export const SpotTrendAnalysisPage: React.FC = () => {
    const [currentTab, setCurrentTab] = useState(0);

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setCurrentTab(newValue);
    };

    return (
        <Container maxWidth={false} sx={{ py: 3 }}>
            {/* 页面标题 */}
            <Typography variant="h4" gutterBottom>
                现货趋势分析
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
                分析7-90天周期内的价格趋势、周期性规律和市场特征
            </Typography>

            {/* Tab 导航 */}
            <Paper variant="outlined" sx={{ mt: 2 }}>
                <Tabs
                    value={currentTab}
                    onChange={handleTabChange}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        borderBottom: 1,
                        borderColor: 'divider',
                        '& .MuiTab-root': {
                            minWidth: { xs: 'auto', sm: 120 },
                            fontSize: { xs: '0.8rem', sm: '0.9rem' }
                        }
                    }}
                >
                    <Tab label="价格趋势" />
                    <Tab label="储能套利" />
                    <Tab label="价格异常" />
                    <Tab label="星期特性" />
                    <Tab label="多因子相关性" />
                    <Tab label="波动性分析" />
                </Tabs>

                {/* Tab 内容区域 */}
                <Box sx={{ p: { xs: 1, sm: 2 } }}>
                    {currentTab === 0 && <PriceTrendTab />}
                    {currentTab === 1 && <StorageArbitrageTab />}
                    {currentTab === 2 && <PriceAnomalyTab />}
                    {currentTab === 3 && <WeekdayCharacteristicsTab />}
                    {currentTab === 4 && <MultiFactorCorrelationTab />}
                    {currentTab === 5 && <VolatilityAnalysisTab />}
                </Box>
            </Paper>
        </Container>
    );
};
```

**关键设计要点**：
- ✅ 外层容器使用 `Container maxWidth={false}`，与 MarketPriceAnalysisPage 一致
- ✅ Tab 导航支持横向滚动 (`variant="scrollable"`)，移动端友好
- ✅ Tab 内容区域有响应式内边距 `p: { xs: 1, sm: 2 }`
- ✅ 每个 Tab 对应一个独立的组件，便于代码组织和维护

### 2.3 响应式布局

- **移动端 (xs)**: Tab 字体 0.8rem，自动宽度
- **桌面端 (sm+)**: Tab 字体 0.9rem，最小宽度 120px

---

## 三、Tab 组件结构

每个 Tab 组件都遵循相同的结构模式：

```tsx
export const XxxTab: React.FC = () => {
    const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([...]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);

    // 数据加载
    useEffect(() => {
        fetchData();
    }, [dateRange]);

    return (
        <Box>
            {/* 全局筛选器 */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                {/* 日期范围选择器、快捷按钮、其他筛选器 */}
            </Paper>

            {/* 首次加载 */}
            {loading && !data ? (
                <Box display="flex" justifyContent="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            ) : error ? (
                <Alert severity="error">{error}</Alert>
            ) : data ? (
                <Box sx={{ position: 'relative' }}>
                    {/* 数据刷新覆盖层 */}
                    {loading && (
                        <Box sx={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            zIndex: 1000
                        }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {/* 各个图表和卡片组件 */}
                    <Grid container spacing={{ xs: 1, sm: 2 }}>
                        {/* ... */}
                    </Grid>
                </Box>
            ) : null}
        </Box>
    );
};
```

---

## 四、Tab 1：价格趋势分析 (PriceTrendTab)

### 4.1 全局筛选器

```tsx
<Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
    {/* 日期范围选择器 */}
    <DateRangePicker
        label="日期范围"
        value={dateRange}
        onChange={setDateRange}
        slotProps={{
            textField: {
                sx: { width: { xs: '100%', sm: '250px' } }
            }
        }}
    />

    {/* 快捷日期选择 */}
    <ButtonGroup variant="outlined" size="small">
        <Button onClick={() => setQuickRange(7)}>近7天</Button>
        <Button onClick={() => setQuickRange(30)}>近30天</Button>
        <Button onClick={() => setQuickRange(90)}>近90天</Button>
    </ButtonGroup>

    {/* 聚合粒度 */}
    <FormControl sx={{ minWidth: 120 }}>
        <InputLabel>聚合粒度</InputLabel>
        <Select value={granularity} onChange={handleGranularityChange}>
            <MenuItem value="day">日</MenuItem>
            <MenuItem value="week">周</MenuItem>
        </Select>
    </FormControl>

    {/* 对比基准 */}
    <FormControl sx={{ minWidth: 150 }}>
        <InputLabel>对比基准</InputLabel>
        <Select value={baseline} onChange={handleBaselineChange}>
            <MenuItem value="rt">实时价格</MenuItem>
            <MenuItem value="da">日前价格</MenuItem>
            <MenuItem value="spread">价差</MenuItem>
        </Select>
    </FormControl>
</Paper>
```

### 4.2 图表布局

```tsx
<Grid container spacing={{ xs: 1, sm: 2 }}>
    {/* 卡片1: 日均价格趋势 */}
    <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
            <Typography variant="h6" gutterBottom>日均价格趋势</Typography>
            {/* 曲线选择器 */}
            <SeriesSelector />
            {/* 图表 */}
            <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />
                <ResponsiveContainer>
                    <LineChart data={priceData}>
                        {/* ... */}
                    </LineChart>
                </ResponsiveContainer>
            </Box>
        </Paper>
    </Grid>

    {/* 卡片2: 日均价差趋势 */}
    <Grid size={{ xs: 12, md: 6 }}>
        {/* 类似结构 */}
    </Grid>

    {/* 卡片3: 分时段价格趋势 */}
    <Grid size={{ xs: 12 }}>
        {/* 全宽图表 */}
    </Grid>
</Grid>
```

**完整设计参考**：见下文"第五章至第十章"

---

## 五、Tab 2：储能套利分析 (StorageArbitrageTab)

### 5.1 全局筛选器（简化版）

```tsx
<Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
    {/* 日期范围选择器 */}
    <DateRangePicker
        label="日期范围"
        value={dateRange}
        onChange={setDateRange}
        slotProps={{
            textField: {
                sx: { width: { xs: '100%', sm: '250px' } }
            }
        }}
    />

    {/* 快捷日期选择 */}
    <ButtonGroup variant="outlined" size="small">
        <Button onClick={() => setQuickRange(7)}>近7天</Button>
        <Button onClick={() => setQuickRange(30)}>近30天</Button>
        <Button onClick={() => setQuickRange(90)}>近90天</Button>
    </ButtonGroup>

    {/* 价格类型 */}
    <FormControl sx={{ minWidth: 120 }}>
        <InputLabel>价格类型</InputLabel>
        <Select value={priceType} onChange={handlePriceTypeChange}>
            <MenuItem value="rt">实时价格</MenuItem>
            <MenuItem value="da">日前价格</MenuItem>
        </Select>
    </FormControl>
</Paper>
```

### 5.2 图表布局

**储能套利分析 Tab 包含以下卡片**：
1. 上午/下午价差趋势曲线（全宽）
2. 价差统计卡片（3个KPI卡片）
3. 价差分布箱线图（半宽）
4. 策略建议卡片（全宽）

**完整设计参考**：见下文"模块 E：储能套利机会分析"（第十四章）

---

## 六、Tab 3：价格异常与极值 (PriceAnomalyTab)

### 6.1 图表布局

**价格异常与极值 Tab 包含以下卡片**：
1. 极值趋势曲线（全宽）
2. 极值时段分布图（两个饼图，各半宽）
3. 特殊价格事件统计卡片（5个KPI卡片横排）
4. 异常价格时段热力图（全宽）

**完整设计参考**：见下文"模块 F：价格异常与极值分析"（第十五章）

---

## 七、Tab 4：星期特性分析 (WeekdayCharacteristicsTab)

### 7.1 图表布局

**星期特性分析 Tab 包含以下卡片**：
1. 周内价格箱线图（半宽）
2. 星期×时段热力图（半宽）

**完整设计参考**：见下文"模块 B：星期特性分析"（第五章原文）

---

## 八、Tab 5：多因子相关性 (MultiFactorCorrelationTab)

### 8.1 图表布局

**多因子相关性 Tab 包含以下卡片**：
1. 相关系数时序曲线（全宽）
2. 相关性统计表格（全宽）

**完整设计参考**：见下文"模块 C：多因子相关性分析"（第六章原文）

---

## 九、Tab 6：波动性分析 (VolatilityAnalysisTab)

### 9.1 图表布局

**波动性分析 Tab 包含以下卡片**：
1. 日内波动率（CV）曲线（半宽）
2. 最大价格爬坡曲线（半宽）

**完整设计参考**：见下文"模块 D：波动性分析"（第七章原文）

---

## 十、详细设计章节索引

以下章节保留原有的详细 UI 设计规范，供开发时参考：

- **第十一章**: 模块 A - 价格趋势分析详细设计（原第四章）
- **第十二章**: 模块 B - 星期特性分析详细设计（原第五章）
- **第十三章**: 模块 C - 多因子相关性分析详细设计（原第六章）
- **第十四章**: 模块 D - 波动性分析详细设计（原第七章）
- **第十五章**: 模块 E - 储能套利机会分析详细设计（原第十四章）
- **第十六章**: 模块 F - 价格异常与极值分析详细设计（原第十五章）
- **第十七章**: Loading 状态管理规范（原第八章）
- **第十八章**: 响应式设计检查清单（原第九章）
- **第十九章**: 开发实现顺序（原第十六章）
- **第二十章**: API 接口定义（原第十二章）
- **第二十一章**: 附录：图表配色方案（原第十三章）

---

## 十一、模块 A：价格趋势分析详细设计

### 11.1 卡片一：日均价格趋势

**图表类型**: 折线图 (`LineChart`)，双Y轴

```tsx
<Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
    {/* 日期范围选择器 */}
    <DateRangePicker
        label="日期范围"
        value={dateRange}
        onChange={setDateRange}
        slotProps={{
            textField: {
                sx: { width: { xs: '100%', sm: '250px' } }
            }
        }}
    />

    {/* 快捷日期选择 */}
    <ButtonGroup variant="outlined" size="small">
        <Button onClick={() => setQuickRange(7)}>近7天</Button>
        <Button onClick={() => setQuickRange(30)}>近30天</Button>
        <Button onClick={() => setQuickRange(90)}>近90天</Button>
    </ButtonGroup>

    {/* 聚合粒度 */}
    <FormControl sx={{ minWidth: 120 }}>
        <InputLabel>聚合粒度</InputLabel>
        <Select value={granularity} onChange={handleGranularityChange}>
            <MenuItem value="day">日</MenuItem>
            <MenuItem value="week">周</MenuItem>
        </Select>
    </FormControl>

    {/* 对比基准 */}
    <FormControl sx={{ minWidth: 150 }}>
        <InputLabel>对比基准</InputLabel>
        <Select value={baseline} onChange={handleBaselineChange}>
            <MenuItem value="rt">实时价格</MenuItem>
            <MenuItem value="da">日前价格</MenuItem>
            <MenuItem value="spread">价差</MenuItem>
        </Select>
    </FormControl>
</Paper>
```

### 3.2 筛选器状态管理

```tsx
const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    addDays(new Date(), -30),  // 默认30天前
    addDays(new Date(), -1)    // 默认昨天
]);
const [granularity, setGranularity] = useState<'day' | 'week'>('day');
const [baseline, setBaseline] = useState<'rt' | 'da' | 'spread'>('rt');
const [loading, setLoading] = useState(false);
const [data, setData] = useState<any>(null);

// 自动加载数据
useEffect(() => {
    fetchData(dateRange, granularity, baseline);
}, [dateRange, granularity, baseline]);
```

---

## 四、模块 A：价格趋势分析

### 4.1 卡片一：日均价格趋势

**图表类型**: 折线图 (`LineChart`)，双Y轴

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据系列**:
- VWAP_RT (实时加权均价) - 实线
- VWAP_DA (日前加权均价) - 虚线
- TWAP_RT (实时算术均价) - 实线 (可选)
- TWAP_DA (日前算术均价) - 虚线 (可选)

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>日均价格趋势</Typography>

    {/* 曲线选择器 */}
    <SeriesSelector />

    <Box
        ref={chartRef}
        sx={{
            height: { xs: 350, sm: 400 },
            position: 'relative',
            backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
            ...(isFullscreen && { /* 全屏样式 */ })
        }}
    >
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" label={{ value: '价格 (元/MWh)', angle: -90 }} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" dataKey="vwap_rt" name="VWAP (实时)" stroke="#1976d2" />
                <Line yAxisId="left" dataKey="vwap_da" name="VWAP (日前)" stroke="#1976d2" strokeDasharray="5 5" />
                {/* 其他曲线 */}
            </LineChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

**关键特性**:
- ✅ 使用 `useSelectableSeries` 支持曲线动态显示/隐藏
- ✅ 默认只显示 VWAP_RT 和 VWAP_DA
- ✅ X轴显示日期 (格式: MM-DD 或 YYYY-MM-DD)
- ✅ Tooltip 显示精确数值

---

### 4.2 卡片二：日均价差趋势

**图表类型**: 柱状图 (`BarChart`)，零轴上下

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据系列**:
- VWAP价差 (VWAP_RT - VWAP_DA)
- TWAP价差 (TWAP_RT - TWAP_DA) (可选)

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>日均价差趋势</Typography>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spreadData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis label={{ value: '价差 (元/MWh)', angle: -90 }} />
                <ReferenceLine y={0} stroke="#000" />
                <Tooltip />
                <Legend />
                <Bar dataKey="vwap_spread" name="VWAP价差">
                    {spreadData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.vwap_spread >= 0 ? '#d32f2f' : '#388e3c'} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

**关键特性**:
- ✅ 正价差显示为红色 (亏损)
- ✅ 负价差显示为绿色 (盈利)
- ✅ 零轴参考线

---

### 4.3 卡片三：分时段价格趋势

**图表类型**: 折线图 (`LineChart`)，多曲线

**布局位置**: `Grid size={{ xs: 12 }}`

**数据系列**:
- 尖峰时段日均VWAP
- 峰时段日均VWAP
- 平时段日均VWAP
- 谷时段日均VWAP

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>分时段价格趋势 (尖峰平谷)</Typography>

    <SeriesSelector />  {/* 支持选择显示哪些时段 */}

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={periodData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis label={{ value: '价格 (元/MWh)', angle: -90 }} />
                <Tooltip />
                <Legend />
                <Line dataKey="peak_vwap" name="尖峰" stroke="#d32f2f" strokeWidth={2} />
                <Line dataKey="on_peak_vwap" name="峰" stroke="#ff9800" strokeWidth={2} />
                <Line dataKey="shoulder_vwap" name="平" stroke="#2196f3" strokeWidth={2} />
                <Line dataKey="off_peak_vwap" name="谷" stroke="#4caf50" strokeWidth={2} />
            </LineChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

**关键特性**:
- ✅ 使用分时电价规则的颜色编码
- ✅ 支持曲线选择 (只看尖峰和谷)

---

## 五、模块 B：星期特性分析

### 5.1 卡片一：周内价格箱线图

**图表类型**: 箱线图 (`Recharts` 无原生支持，使用自定义形状或 `ComposedChart` 模拟)

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据结构**:
```typescript
weekdayStats = [
    { weekday: '周一', min: 120, q1: 150, median: 180, q3: 210, max: 250, outliers: [280] },
    { weekday: '周二', min: 130, q1: 160, median: 190, q3: 220, max: 260, outliers: [] },
    ...
]
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>周内价格分布</Typography>

    {/* 指标选择 */}
    <FormControl size="small" sx={{ minWidth: 150, mb: 1 }}>
        <InputLabel>指标</InputLabel>
        <Select value={metric} onChange={handleMetricChange}>
            <MenuItem value="vwap_rt">VWAP (实时)</MenuItem>
            <MenuItem value="vwap_spread">VWAP价差</MenuItem>
            <MenuItem value="twap_rt">TWAP (实时)</MenuItem>
        </Select>
    </FormControl>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            {/* 使用 ComposedChart 模拟箱线图 */}
            <ComposedChart data={weekdayStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="weekday" />
                <YAxis label={{ value: '价格 (元/MWh)', angle: -90 }} />
                <Tooltip content={<CustomBoxPlotTooltip />} />

                {/* 箱体 (Q1-Q3) */}
                <Bar dataKey="q3" stackId="box" fill="transparent" />
                <Bar dataKey="iqr" stackId="box" fill="#90caf9" />

                {/* 中位线 */}
                <Scatter dataKey="median" fill="#1976d2" shape="line" />

                {/* 须线和离群值 */}
                <ErrorBar dataKey="whiskers" stroke="#000" />
                <Scatter dataKey="outliers" fill="#d32f2f" />
            </ComposedChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

**关键特性**:
- ✅ 可切换显示 VWAP、TWAP 或价差
- ✅ 离群值用红点标注
- ✅ Tooltip 显示五数概括

**实现建议**:
- 如 Recharts 实现复杂，考虑使用 **Nivo** 的 `ResponsiveBoxPlot` 组件
- 或使用简化版: 仅显示均值和标准差误差线

---

### 5.2 卡片二：星期×时段热力图

**图表类型**: 热力图 (`Recharts` 无原生支持，使用 `react-heatmap-grid` 或自定义)

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据结构**:
```typescript
heatmapData = [
    // 每行代表一个星期，每列代表一个时段 (24小时或96点)
    [120, 130, 140, ...],  // 周一
    [125, 135, 145, ...],  // 周二
    ...
]
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>星期×时段热力图</Typography>

    {/* 时段粒度选择 */}
    <FormControl size="small" sx={{ minWidth: 120, mb: 1 }}>
        <Select value={timeGranularity} onChange={handleTimeGranularityChange}>
            <MenuItem value={24}>24小时</MenuItem>
            <MenuItem value={96}>96点</MenuItem>
        </Select>
    </FormControl>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <HeatMapGrid
            data={heatmapData}
            xLabels={timeLabels}  // ['00:00', '01:00', ...]
            yLabels={['周一', '周二', '周三', '周四', '周五', '周六', '周日']}
            cellRender={(x, y, value) => (
                <div title={`${yLabels[y]} ${xLabels[x]}: ${value.toFixed(2)} 元/MWh`}>
                    {value.toFixed(0)}
                </div>
            )}
            cellStyle={(background, value, min, max) => ({
                background: getColorForValue(value, min, max),
                fontSize: '.8rem',
                color: value > (max + min) / 2 ? '#fff' : '#000'
            })}
        />
    </Box>
</Paper>
```

**颜色映射**:
- 低价: 绿色 (#4caf50)
- 中价: 黄色 (#ffeb3b)
- 高价: 红色 (#d32f2f)

**关键特性**:
- ✅ 支持24小时或96点粒度切换
- ✅ Hover 显示精确数值
- ✅ 移动端优化: 24小时粒度

**实现建议**:
- 使用 `react-heatmap-grid` 库
- 或使用 Material-UI `Table` + 背景色自定义

---

## 六、模块 C：多因子相关性分析

### 6.1 卡片一：相关系数时序曲线

**图表类型**: 折线图 (`LineChart`)，双Y轴

**布局位置**: `Grid size={{ xs: 12 }}`

**数据系列**:
- 价格-负荷相关系数
- 价格-火电相关系数
- 价格-新能源相关系数
- 价格-温度相关系数

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>多因子相关性时序</Typography>

    <SeriesSelector />  {/* 选择显示哪些相关系数 */}

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={correlationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[-1, 1]} label={{ value: '相关系数', angle: -90 }} />
                <ReferenceLine y={0} stroke="#000" />
                <Tooltip />
                <Legend />
                <Line dataKey="corr_load" name="负荷" stroke="#1976d2" />
                <Line dataKey="corr_thermal" name="火电" stroke="#d32f2f" />
                <Line dataKey="corr_renewable" name="新能源" stroke="#4caf50" />
                <Line dataKey="corr_temperature" name="温度" stroke="#ff9800" />
            </LineChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

**关键特性**:
- ✅ Y轴固定为 [-1, 1] (相关系数范围)
- ✅ 零轴参考线
- ✅ 默认显示负荷和新能源相关性

---

### 6.2 卡片二：相关性统计表格

**组件类型**: Material-UI `Table`

**布局位置**: `Grid size={{ xs: 12 }}`

**数据结构**:
```typescript
correlationStats = [
    { factor: '总负荷', avg_corr: 0.65, min_corr: 0.45, max_corr: 0.85, std_corr: 0.12 },
    { factor: '火电出力', avg_corr: 0.72, min_corr: 0.55, max_corr: 0.90, std_corr: 0.10 },
    { factor: '新能源出力', avg_corr: -0.48, min_corr: -0.70, max_corr: -0.20, std_corr: 0.15 },
    { factor: '温度', avg_corr: 0.35, min_corr: -0.10, max_corr: 0.65, std_corr: 0.20 }
]
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>相关性统计</Typography>

    <TableContainer>
        <Table
            sx={{
                '& .MuiTableCell-root': {
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    px: { xs: 0.5, sm: 2 },
                }
            }}
        >
            <TableHead>
                <TableRow>
                    <TableCell>因子</TableCell>
                    <TableCell align="right">平均相关系数</TableCell>
                    <TableCell align="right">最小值</TableCell>
                    <TableCell align="right">最大值</TableCell>
                    <TableCell align="right">标准差</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {correlationStats.map((row) => (
                    <TableRow key={row.factor}>
                        <TableCell>{row.factor}</TableCell>
                        <TableCell align="right" sx={{ color: row.avg_corr >= 0 ? 'success.main' : 'error.main' }}>
                            {row.avg_corr.toFixed(2)}
                        </TableCell>
                        <TableCell align="right">{row.min_corr.toFixed(2)}</TableCell>
                        <TableCell align="right">{row.max_corr.toFixed(2)}</TableCell>
                        <TableCell align="right">{row.std_corr.toFixed(2)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>
</Paper>
```

**关键特性**:
- ✅ 正相关显示为绿色，负相关显示为红色
- ✅ 响应式字体和内边距

---

## 七、模块 D：波动性分析

### 7.1 卡片一：日内波动率

**图表类型**: 折线图 (`LineChart`) + 柱状图 (`BarChart`)

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据系列**:
- 变异系数 (CV) = std / mean

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>日内波动率 (CV)</Typography>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={volatilityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis label={{ value: '变异系数 (CV)', angle: -90 }} />
                <Tooltip />
                <Area dataKey="cv" name="波动率" stroke="#ff9800" fill="#ffe0b2" />
            </AreaChart>
        </ResponsiveContainer>
    </Box>

    {/* 波动性统计 */}
    <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2">平均CV: <strong>{avgCV.toFixed(3)}</strong></Typography>
        <Typography variant="body2">最大CV: <strong>{maxCV.toFixed(3)}</strong> (发生于 {maxCVDate})</Typography>
    </Box>
</Paper>
```

---

### 7.2 卡片二：最大价格爬坡

**图表类型**: 柱状图 (`BarChart`)

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据系列**:
- 每天的最大价格变化 (元/MWh)

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>最大价格爬坡</Typography>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rampData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis label={{ value: '价格变化 (元/MWh)', angle: -90 }} />
                <Tooltip />
                <Bar dataKey="max_ramp" name="最大爬坡" fill="#d32f2f" />
            </BarChart>
        </ResponsiveContainer>
    </Box>

    {/* 风险提示 */}
    <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="error">
            ⚠️ 爬坡超过100元/MWh的日期: {highRampDates.join(', ')}
        </Typography>
    </Box>
</Paper>
```

---

## 八、Loading 状态管理

**关键原则**: 避免在数据加载时卸载包含全屏功能的组件

### 8.1 首次加载

```tsx
{loading && !data ? (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
    </Box>
) : error ? (
    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
) : data ? (
    <Box sx={{ position: 'relative' }}>
        {/* 数据刷新时的覆盖层 */}
        {loading && (
            <Box
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    zIndex: 1000
                }}
            >
                <CircularProgress />
            </Box>
        )}

        {/* 所有图表组件 */}
    </Box>
) : null}
```

### 8.2 筛选器禁用

```tsx
<DateRangePicker
    disabled={loading}
    ...
/>

<ButtonGroup>
    <Button onClick={() => setQuickRange(7)} disabled={loading}>近7天</Button>
</ButtonGroup>
```

---

## 九、响应式设计检查清单

- [ ] 筛选器使用 `flexWrap: 'wrap'`，移动端自动换行
- [ ] 图表高度 `{ xs: 350, sm: 400 }`
- [ ] Grid 间距 `spacing={{ xs: 1, sm: 2 }}`
- [ ] Paper 内边距 `p: { xs: 1, sm: 2 }`
- [ ] 表格字体 `fontSize: { xs: '0.75rem', sm: '0.875rem' }`
- [ ] 表格内边距 `px: { xs: 0.5, sm: 2 }`
- [ ] 所有图表支持全屏 (`useChartFullscreen`)
- [ ] 热力图在移动端切换为24小时粒度

---

## 十、开发实现顺序

### 第一阶段 (P0)
1. 页面框架和全局筛选器
2. 模块 A - 价格趋势分析 (卡片1、2)
3. 模块 B - 周内价格箱线图

### 第二阶段 (P1)
4. 模块 A - 分时段价格趋势
5. 模块 C - 相关性分析 (负荷、火电、新能源)
6. 模块 D - 波动性分析

### 第三阶段 (P2)
7. 模块 B - 星期×时段热力图
8. 模块 C - 温度相关性
9. 优化和性能调优

---

## 十一、技术栈与依赖

### 必需库
- `@mui/material` v7
- `@mui/x-date-pickers` (DateRangePicker)
- `recharts`
- `date-fns`

### 可选库 (建议安装)
- `react-heatmap-grid`: 热力图实现
- `@nivo/boxplot`: 箱线图实现 (如 Recharts 不足)

### 自定义 Hooks
- `useChartFullscreen`
- `useSelectableSeries`

---

## 十二、API 接口定义

**Endpoint**: `GET /api/v1/market-analysis/trend-analysis`

**请求参数**:
```typescript
{
    start_date: string;      // "YYYY-MM-DD"
    end_date: string;        // "YYYY-MM-DD"
    granularity?: string;    // "day" | "week"
}
```

**返回数据结构**:
```typescript
{
    // 价格趋势数据 (按日或按周)
    price_trend: [
        {
            date: "2025-01-01",
            vwap_rt: 180.5,
            vwap_da: 175.2,
            twap_rt: 182.3,
            twap_da: 177.1,
            vwap_spread: 5.3,
            twap_spread: 5.2
        },
        ...
    ],

    // 分时段价格趋势
    period_trend: [
        {
            date: "2025-01-01",
            peak_vwap: 250.0,      // 尖峰
            on_peak_vwap: 200.0,   // 峰
            shoulder_vwap: 150.0,  // 平
            off_peak_vwap: 100.0   // 谷
        },
        ...
    ],

    // 周内统计 (箱线图数据)
    weekday_stats: [
        {
            weekday: 0,  // 0=周一, 6=周日
            weekday_name: "周一",
            min: 120.0,
            q1: 150.0,
            median: 180.0,
            q3: 210.0,
            max: 250.0,
            outliers: [280.0, 290.0]
        },
        ...
    ],

    // 热力图数据
    heatmap_data: {
        weekdays: ["周一", "周二", ...],
        time_labels: ["00:00", "01:00", ...],  // 24小时或96点
        values: [
            [120, 130, 140, ...],  // 周一的24/96个值
            [125, 135, 145, ...],  // 周二
            ...
        ]
    },

    // 相关性数据
    correlation_trend: [
        {
            date: "2025-01-01",
            corr_load: 0.65,
            corr_thermal: 0.72,
            corr_renewable: -0.48,
            corr_temperature: 0.35
        },
        ...
    ],

    // 相关性统计
    correlation_stats: [
        {
            factor: "总负荷",
            avg_corr: 0.65,
            min_corr: 0.45,
            max_corr: 0.85,
            std_corr: 0.12
        },
        ...
    ],

    // 波动性数据
    volatility_data: [
        {
            date: "2025-01-01",
            cv: 0.25,              // 变异系数
            max_ramp: 85.0         // 最大价格爬坡
        },
        ...
    ],

    // 储能套利机会数据 ⭐ 新增
    arbitrage_opportunity: [
        {
            date: "2025-01-01",
            am_min_price: 120.5,           // 上午最低价
            am_min_time: "03:15",          // 上午最低价时点
            am_max_price: 250.0,           // 上午最高价
            am_max_time: "10:00",          // 上午最高价时点
            am_spread: 129.5,              // 上午价差
            pm_min_price: 150.0,           // 下午最低价
            pm_min_time: "13:30",          // 下午最低价时点
            pm_max_price: 280.0,           // 下午最高价
            pm_max_time: "19:00",          // 下午最高价时点
            pm_spread: 130.0,              // 下午价差
            all_min_price: 120.5,          // 全天最低价
            all_min_time: "03:15",         // 全天最低价时点
            all_max_price: 300.0,          // 全天最高价
            all_max_time: "20:00",         // 全天最高价时点
            max_spread: 179.5,             // 全天最大价差 (满足先低后高约束)
            optimal_period: "pm"           // 最优时段 ("am" | "pm")
        },
        ...
    ],

    // 套利机会统计 ⭐ 新增
    arbitrage_stats: {
        am_avg_spread: 95.5,               // 上午平均价差
        pm_avg_spread: 105.2,              // 下午平均价差
        avg_max_spread: 100.3,             // 全天平均最大价差
        am_advantage_days: 12,             // 上午价差优势天数
        pm_advantage_days: 18,             // 下午价差优势天数
        spread_std: 25.3,                  // 价差标准差
        max_single_day_spread: 180.0,      // 最大单日价差
        min_single_day_spread: 45.0        // 最小单日价差
    }
}
```

---

## 十三、附录：图表配色方案

### 价格曲线
- VWAP_RT: `#1976d2` (蓝色)
- VWAP_DA: `#1976d2` (蓝色虚线)
- TWAP_RT: `#2196f3` (浅蓝色)
- TWAP_DA: `#2196f3` (浅蓝色虚线)

### 时段曲线
- 尖峰: `#d32f2f` (红色)
- 峰: `#ff9800` (橙色)
- 平: `#2196f3` (蓝色)
- 谷: `#4caf50` (绿色)

### 相关性曲线
- 负荷: `#1976d2` (蓝色)
- 火电: `#d32f2f` (红色)
- 新能源: `#4caf50` (绿色)
- 温度: `#ff9800` (橙色)

### 价差
- 正价差 (亏损): `#d32f2f` (红色)
- 负价差 (盈利): `#388e3c` (绿色)

### 储能套利 ⭐ 新增
- 上午价差: `#2196f3` (蓝色)
- 下午价差: `#ff9800` (橙色)
- 全天最大价差: `#4caf50` (绿色)

---

## 十四、模块 E：储能套利机会分析 ⭐ 新增

### 14.1 卡片一：上午/下午价差趋势曲线

**图表类型**: 折线图 (`LineChart`)，双Y轴

**布局位置**: `Grid size={{ xs: 12 }}`

**数据系列**:
- 上午价差 (蓝色实线)
- 下午价差 (橙色实线)
- 全天最大价差 (绿色粗线)

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>
        储能套利机会分析 - 日价差趋势
    </Typography>

    <Box
        ref={chartRef}
        sx={{
            height: { xs: 350, sm: 400 },
            position: 'relative',
            backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
            ...(isFullscreen && { /* 全屏样式 */ })
        }}
    >
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={arbitrageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis label={{ value: '价差 (元/MWh)', angle: -90 }} />
                <Tooltip content={<CustomArbitrageTooltip />} />
                <Legend />

                {/* 上午价差 */}
                <Line
                    type="monotone"
                    dataKey="am_spread"
                    stroke="#2196f3"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="上午价差 (00:00-11:30)"
                />

                {/* 下午价差 */}
                <Line
                    type="monotone"
                    dataKey="pm_spread"
                    stroke="#ff9800"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="下午价差 (11:30-23:30)"
                />

                {/* 全天最大价差 */}
                <Line
                    type="monotone"
                    dataKey="max_spread"
                    stroke="#4caf50"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="全天最大价差"
                />
            </LineChart>
        </ResponsiveContainer>
    </Box>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        ℹ️ 价差 = 时段内最高价 - 时段内最低价 (约束: 最低价时点必须在最高价时点之前)
    </Typography>
</Paper>
```

**自定义Tooltip**:
```tsx
const CustomArbitrageTooltip: React.FC = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;

    const data = payload[0].payload;

    return (
        <Paper sx={{ p: 1.5, bgcolor: 'rgba(255, 255, 255, 0.95)' }}>
            <Typography variant="caption" fontWeight="bold" gutterBottom>
                {data.date}
            </Typography>

            <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="primary.main">
                    🌅 上午价差: {data.am_spread.toFixed(2)} 元/MWh
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                    低价: {data.am_min_price.toFixed(2)} 元 @ {data.am_min_time}
                </Typography>
                <br />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                    高价: {data.am_max_price.toFixed(2)} 元 @ {data.am_max_time}
                </Typography>
            </Box>

            <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="warning.main">
                    🌇 下午价差: {data.pm_spread.toFixed(2)} 元/MWh
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                    低价: {data.pm_min_price.toFixed(2)} 元 @ {data.pm_min_time}
                </Typography>
                <br />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                    高价: {data.pm_max_price.toFixed(2)} 元 @ {data.pm_max_time}
                </Typography>
            </Box>

            <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" fontWeight="bold" color="success.main">
                    最优时段: {data.optimal_period === 'am' ? '上午 🌅' : '下午 🌇'}
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                    全天最大价差: {data.max_spread.toFixed(2)} 元/MWh
                </Typography>
            </Box>
        </Paper>
    );
};
```

**关键特性**:
- ✅ 三条曲线清晰对比上午/下午/全天的价差趋势
- ✅ Tooltip 展示详细的低价/高价时点信息
- ✅ 识别哪个时段套利机会更好

---

### 14.2 卡片二：价差统计卡片 (3个KPI)

**布局位置**: `Grid size={{ xs: 12, md: 4 }}` (三列布局)

**UI组件结构**:
```tsx
<Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
    {/* 卡片1: 上午平均价差 */}
    <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary.main" fontWeight="bold">
                {arbitrageStats.am_avg_spread.toFixed(1)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                上午平均价差 (元/MWh)
            </Typography>
            <Typography variant="caption" color="text.secondary">
                (00:00-11:30 凌晨充→上午放)
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
                <Box>
                    <Typography variant="caption" color="text.secondary">优势天数</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {arbitrageStats.am_advantage_days}
                    </Typography>
                </Box>
                <Box>
                    <Typography variant="caption" color="text.secondary">优势概率</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {((arbitrageStats.am_advantage_days / totalDays) * 100).toFixed(0)}%
                    </Typography>
                </Box>
            </Box>
        </Paper>
    </Grid>

    {/* 卡片2: 下午平均价差 */}
    <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="warning.main" fontWeight="bold">
                {arbitrageStats.pm_avg_spread.toFixed(1)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                下午平均价差 (元/MWh)
            </Typography>
            <Typography variant="caption" color="text.secondary">
                (11:30-23:30 中午充→晚上放)
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
                <Box>
                    <Typography variant="caption" color="text.secondary">优势天数</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {arbitrageStats.pm_advantage_days}
                    </Typography>
                </Box>
                <Box>
                    <Typography variant="caption" color="text.secondary">优势概率</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {((arbitrageStats.pm_advantage_days / totalDays) * 100).toFixed(0)}%
                    </Typography>
                </Box>
            </Box>
        </Paper>
    </Grid>

    {/* 卡片3: 全天平均最大价差 */}
    <Grid size={{ xs: 12, md: 4 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="success.main" fontWeight="bold">
                {arbitrageStats.avg_max_spread.toFixed(1)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                全天平均最大价差 (元/MWh)
            </Typography>
            <Typography variant="caption" color="text.secondary">
                (取上午/下午较大值)
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-around', mt: 1 }}>
                <Box>
                    <Typography variant="caption" color="text.secondary">最大值</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {arbitrageStats.max_single_day_spread.toFixed(0)}
                    </Typography>
                </Box>
                <Box>
                    <Typography variant="caption" color="text.secondary">标准差</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        {arbitrageStats.spread_std.toFixed(1)}
                    </Typography>
                </Box>
            </Box>
        </Paper>
    </Grid>
</Grid>
```

**关键特性**:
- ✅ 清晰展示上午/下午/全天三个维度的套利空间
- ✅ 优势天数和概率帮助用户判断哪个时段更稳定
- ✅ 标准差反映套利机会的稳定性

---

### 14.3 卡片三：价差分布箱线图

**图表类型**: 箱线图 (`Recharts ComposedChart` 模拟或 `Nivo BoxPlot`)

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据结构**:
```typescript
const boxPlotData = [
    {
        category: '上午价差',
        min: 45,
        q1: 80,
        median: 95,
        q3: 110,
        max: 150,
        outliers: [30, 180]
    },
    {
        category: '下午价差',
        min: 50,
        q1: 90,
        median: 105,
        q3: 120,
        max: 165,
        outliers: [25, 190]
    }
];
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>价差分布对比</Typography>

    <Box ref={boxPlotRef} sx={{ height: { xs: 300, sm: 350 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        {/* 使用 Nivo BoxPlot */}
        <ResponsiveBoxPlot
            data={boxPlotData}
            margin={{ top: 60, right: 80, bottom: 60, left: 80 }}
            colors={{ scheme: 'set2' }}
            borderRadius={2}
            axisBottom={{
                legend: '时段',
                legendPosition: 'middle',
                legendOffset: 46
            }}
            axisLeft={{
                legend: '价差 (元/MWh)',
                legendPosition: 'middle',
                legendOffset: -60
            }}
            tooltip={({ id, value, color }) => (
                <Paper sx={{ p: 1 }}>
                    <Typography variant="caption">{id}</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        价差: {value.toFixed(2)} 元/MWh
                    </Typography>
                </Paper>
            )}
        />
    </Box>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        ℹ️ 箱体高度反映价差稳定性，离群值表示极端情况
    </Typography>
</Paper>
```

**业务价值**:
- 对比上午和下午价差的分布形态
- 识别哪个时段更稳定 (箱体更窄)
- 发现极端套利机会日期 (离群值)

---

### 14.4 策略建议卡片

**布局位置**: `Grid size={{ xs: 12 }}`

**UI组件结构**:
```tsx
<Alert
    severity={arbitrageStats.pm_avg_spread > arbitrageStats.am_avg_spread ? 'warning' : 'info'}
    sx={{ mt: 2 }}
>
    <Typography variant="body2" fontWeight="bold">
        储能套利策略建议
    </Typography>

    {arbitrageStats.pm_avg_spread > arbitrageStats.am_avg_spread ? (
        <ul style={{ margin: '8px 0 0 20px', paddingLeft: 0 }}>
            <li>
                <strong>下午时段套利空间更大</strong>：
                下午平均价差为 {arbitrageStats.pm_avg_spread.toFixed(1)} 元/MWh，
                上午为 {arbitrageStats.am_avg_spread.toFixed(1)} 元/MWh
            </li>
            <li>
                <strong>建议策略</strong>：
                优先考虑"中午低价充电 (12:00-14:00) → 晚高峰放电 (18:00-21:00)"
            </li>
            <li>
                <strong>优势天数</strong>：
                近{totalDays}天中，有{arbitrageStats.pm_advantage_days}天
                ({((arbitrageStats.pm_advantage_days / totalDays) * 100).toFixed(0)}%)
                下午价差更优
            </li>
        </ul>
    ) : (
        <ul style={{ margin: '8px 0 0 20px', paddingLeft: 0 }}>
            <li>
                <strong>上午时段套利空间更大</strong>：
                上午平均价差为 {arbitrageStats.am_avg_spread.toFixed(1)} 元/MWh，
                下午为 {arbitrageStats.pm_avg_spread.toFixed(1)} 元/MWh
            </li>
            <li>
                <strong>建议策略</strong>：
                优先考虑"凌晨低价充电 (00:00-04:00) → 上午高价放电 (08:00-12:00)"
            </li>
            <li>
                <strong>优势天数</strong>：
                近{totalDays}天中，有{arbitrageStats.am_advantage_days}天
                ({((arbitrageStats.am_advantage_days / totalDays) * 100).toFixed(0)}%)
                上午价差更优
            </li>
        </ul>
    )}

    <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
            ⚠️ 注意：以上分析基于历史价格，实际收益需考虑储能效率、容量约束和交易成本
        </Typography>
    </Box>
</Alert>
```

**关键特性**:
- ✅ 自动判断上午还是下午套利机会更好
- ✅ 给出具体的充放电时段建议
- ✅ 提供风险提示

---

## 十五、模块 F：价格异常与极值分析 ⭐ 新增

### 15.1 卡片一：极值趋势曲线

**图表类型**: 折线图 (`LineChart`)，多曲线

**布局位置**: `Grid size={{ xs: 12 }}`

**数据系列**:
- 日最高价 (红色实线)
- 日最低价 (蓝色实线)
- 日极差 (橙色虚线)

**数据结构**:
```typescript
interface ExtremeValueData {
    date: string;
    max_price: number;
    max_price_time: string;
    max_price_period: string;  // "尖峰" | "峰" | "平" | "谷"
    min_price: number;
    min_price_time: string;
    min_price_period: string;
    price_range: number;  // 极差 = max_price - min_price
    range_ratio: number;  // 极差率 = price_range / avg_price * 100
}
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>
        极值价格趋势分析
    </Typography>

    <Box
        ref={chartRef}
        sx={{
            height: { xs: 350, sm: 400 },
            position: 'relative',
            backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
            ...(isFullscreen && { /* 全屏样式 */ })
        }}
    >
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={extremeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" label={{ value: '价格 (元/MWh)', angle: -90 }} />
                <YAxis yAxisId="right" orientation="right" label={{ value: '极差 (元/MWh)', angle: 90 }} />
                <Tooltip content={<CustomExtremeTooltip />} />
                <Legend />

                {/* 最高价曲线 */}
                <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="max_price"
                    stroke="#d32f2f"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="日最高价"
                />

                {/* 最低价曲线 */}
                <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="min_price"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="日最低价"
                />

                {/* 极差曲线 */}
                <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="price_range"
                    stroke="#ff9800"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 3 }}
                    name="日极差"
                />
            </LineChart>
        </ResponsiveContainer>
    </Box>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        ℹ️ 极差 = 最高价 - 最低价，反映市场波动幅度
    </Typography>
</Paper>
```

**自定义Tooltip**:
```tsx
const CustomExtremeTooltip: React.FC = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;

    const data = payload[0].payload;

    return (
        <Paper sx={{ p: 1.5, bgcolor: 'rgba(255, 255, 255, 0.95)' }}>
            <Typography variant="caption" fontWeight="bold" gutterBottom>
                {data.date}
            </Typography>

            <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="error.main">
                    🔴 最高价: {data.max_price.toFixed(2)} 元/MWh
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                    时点: {data.max_price_time} ({data.max_price_period})
                </Typography>
            </Box>

            <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="primary.main">
                    🔵 最低价: {data.min_price.toFixed(2)} 元/MWh
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                    时点: {data.min_price_time} ({data.min_price_period})
                </Typography>
            </Box>

            <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="warning.main">
                    极差: {data.price_range.toFixed(2)} 元/MWh
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    极差率: {data.range_ratio.toFixed(1)}%
                </Typography>
            </Box>
        </Paper>
    );
};
```

**关键特性**:
- ✅ 双Y轴：左侧价格，右侧极差
- ✅ Tooltip 显示极值发生的时点和所属时段
- ✅ 极差率反映波动相对强度

---

### 15.2 卡片二：极值时段分布图

**图表类型**: 饼图 (`PieChart`) 或柱状图 (`BarChart`)

**布局位置**: `Grid size={{ xs: 12, md: 6 }}`

**数据结构**:
```typescript
interface PeriodDistribution {
    period: string;  // "尖峰" | "峰" | "平" | "谷"
    max_count: number;  // 最高价出现次数
    min_count: number;  // 最低价出现次数
    max_ratio: number;  // 最高价占比 (%)
    min_ratio: number;  // 最低价占比 (%)
}
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>
        极值时段分布统计
    </Typography>

    <Grid container spacing={2}>
        {/* 最高价时段分布 */}
        <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2" color="error.main" gutterBottom>
                🔴 最高价时段分布
            </Typography>
            <Box ref={maxPieRef} sx={{ height: { xs: 250, sm: 300 }, ... }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={maxPriceDistribution}
                            dataKey="max_count"
                            nameKey="period"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            label={(entry) => `${entry.period} (${entry.max_ratio.toFixed(0)}%)`}
                        >
                            {maxPriceDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={PERIOD_COLORS[entry.period]} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(value, name) => [`${value}次`, name]} />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </Box>

            {/* 统计摘要 */}
            <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                    主要时段: {topMaxPeriod.period} ({topMaxPeriod.max_ratio.toFixed(0)}%)
                </Typography>
            </Box>
        </Grid>

        {/* 最低价时段分布 */}
        <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2" color="primary.main" gutterBottom>
                🔵 最低价时段分布
            </Typography>
            <Box ref={minPieRef} sx={{ height: { xs: 250, sm: 300 }, ... }}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={minPriceDistribution}
                            dataKey="min_count"
                            nameKey="period"
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            label={(entry) => `${entry.period} (${entry.min_ratio.toFixed(0)}%)`}
                        >
                            {minPriceDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={PERIOD_COLORS[entry.period]} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(value, name) => [`${value}次`, name]} />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </Box>

            {/* 统计摘要 */}
            <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                    主要时段: {topMinPeriod.period} ({topMinPeriod.min_ratio.toFixed(0)}%)
                </Typography>
            </Box>
        </Grid>
    </Grid>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        ℹ️ 统计周期内，极值价格最常出现的时段类型
    </Typography>
</Paper>
```

**颜色映射**:
```typescript
const PERIOD_COLORS = {
    '尖峰': '#d32f2f',
    '峰': '#ff9800',
    '平': '#2196f3',
    '谷': '#4caf50'
};
```

**关键特性**:
- ✅ 并排对比最高价和最低价的时段分布
- ✅ 使用分时电价规则的标准颜色
- ✅ 显示主要时段占比

---

### 15.3 卡片三：特殊价格事件统计卡片

**布局位置**: `Grid size={{ xs: 12 }}` (5个卡片横排)

**数据结构**:
```typescript
interface SpecialEvent {
    negative_price: {
        count: number;
        days: number;
        min_price: number;
        min_price_date_time: string;
        avg_negative_price: number;
    };
    zero_price: {
        count: number;
        days: number;
    };
    ultra_low_price: {
        count: number;
        days: number;
        avg_ultra_low_price: number;
    };
    high_price: {
        count: number;
        days: number;
        max_price: number;
        max_price_date_time: string;
        avg_high_price: number;
    };
    extreme_price: {
        count: number;
        days: number;
        max_extreme_price: number;
    };
}
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>
        特殊价格事件统计
    </Typography>

    <Grid container spacing={{ xs: 1, sm: 2 }}>
        {/* 卡片1: 负电价 */}
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    textAlign: 'center',
                    borderLeft: 4,
                    borderColor: 'warning.main'
                }}
            >
                <Typography variant="h3" color="warning.main" fontWeight="bold">
                    {specialEvents.negative_price.count}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    负电价时点
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        出现天数: {specialEvents.negative_price.days}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        最低价: {specialEvents.negative_price.min_price.toFixed(2)} 元
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                        @ {specialEvents.negative_price.min_price_date_time}
                    </Typography>
                </Box>
            </Paper>
        </Grid>

        {/* 卡片2: 零电价 */}
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    textAlign: 'center',
                    borderLeft: 4,
                    borderColor: 'info.main'
                }}
            >
                <Typography variant="h3" color="info.main" fontWeight="bold">
                    {specialEvents.zero_price.count}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    零电价时点
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        出现天数: {specialEvents.zero_price.days}
                    </Typography>
                    <Typography variant="caption" color="success.main">
                        ✅ 免费购电机会
                    </Typography>
                </Box>
            </Paper>
        </Grid>

        {/* 卡片3: 超低价 */}
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    textAlign: 'center',
                    borderLeft: 4,
                    borderColor: 'success.main'
                }}
            >
                <Typography variant="h3" color="success.main" fontWeight="bold">
                    {specialEvents.ultra_low_price.count}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    超低价时点 (0-50元)
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        出现天数: {specialEvents.ultra_low_price.days}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        平均: {specialEvents.ultra_low_price.avg_ultra_low_price.toFixed(2)} 元
                    </Typography>
                </Box>
            </Paper>
        </Grid>

        {/* 卡片4: 超高价 */}
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    textAlign: 'center',
                    borderLeft: 4,
                    borderColor: 'error.main'
                }}
            >
                <Typography variant="h3" color="error.main" fontWeight="bold">
                    {specialEvents.high_price.count}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    超高价时点 (>1000元)
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        出现天数: {specialEvents.high_price.days}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        最高价: {specialEvents.high_price.max_price.toFixed(2)} 元
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                        @ {specialEvents.high_price.max_price_date_time}
                    </Typography>
                </Box>
            </Paper>
        </Grid>

        {/* 卡片5: 极端高价 */}
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
            <Paper
                variant="outlined"
                sx={{
                    p: 2,
                    textAlign: 'center',
                    borderLeft: 4,
                    borderColor: '#9c27b0'  // 紫色
                }}
            >
                <Typography variant="h3" sx={{ color: '#9c27b0' }} fontWeight="bold">
                    {specialEvents.extreme_price.count}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    极端高价时点 (>2000元)
                </Typography>
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        出现天数: {specialEvents.extreme_price.days}
                    </Typography>
                    <Typography variant="caption" color="error.main">
                        🔴 严重风险
                    </Typography>
                </Box>
            </Paper>
        </Grid>
    </Grid>

    {/* 风险提示 */}
    <Alert severity="warning" sx={{ mt: 2 }}>
        <Typography variant="body2" fontWeight="bold">
            风险提示
        </Typography>
        <ul style={{ margin: '8px 0 0 20px', paddingLeft: 0 }}>
            <li>负电价/零电价：储能充电机会，降低成本</li>
            <li>超高价 (>1000元)：高成本风险，建议减少负荷或提前锁定价格</li>
            <li>极端高价 (>2000元)：严重风险，需紧急应对</li>
        </ul>
    </Alert>
</Paper>
```

**关键特性**:
- ✅ 5个事件类型并排展示
- ✅ 使用边框颜色区分风险等级
- ✅ 显示关键指标（出现次数、天数、极值）
- ✅ 提供业务含义和风险提示

---

### 15.4 卡片四：异常价格时段热力图

**图表类型**: 热力图 (`HeatMapGrid`)

**布局位置**: `Grid size={{ xs: 12 }}`

**数据结构**:
```typescript
// heatmapData[时段索引][事件类型索引] = 出现次数
const heatmapData: number[][] = [
    [5, 8, 12, 0, 0],  // 00:00 时段: 负电价5次, 零电价8次, 超低价12次, 超高价0次, 极端高价0次
    [0, 0, 2, 3, 0],   // 01:00 时段
    // ... 96个时段
];

const eventTypes = ['负电价', '零电价', '超低价', '超高价', '极端高价'];
const timeLabels = ['00:00', '00:15', '00:30', ...];  // 96点或24小时
```

**UI组件结构**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>
        异常价格时段分布热力图
    </Typography>

    {/* 时段粒度选择 */}
    <FormControl size="small" sx={{ minWidth: 120, mb: 1 }}>
        <Select value={timeGranularity} onChange={handleTimeGranularityChange}>
            <MenuItem value={24}>24小时</MenuItem>
            <MenuItem value={96}>96点</MenuItem>
        </Select>
    </FormControl>

    <Box sx={{ height: { xs: 300, sm: 400 }, overflowX: 'auto' }}>
        <HeatMapGrid
            data={heatmapData}
            xLabels={timeLabels}
            yLabels={eventTypes}
            cellRender={(x, y, value) => (
                <div style={{ fontSize: '0.7rem' }}>
                    {value > 0 ? value : ''}
                </div>
            )}
            cellStyle={(background, value, min, max) => ({
                background: getColorForValue(value, min, max),
                fontSize: '0.7rem',
                color: value > (max + min) / 2 ? '#fff' : '#000',
                border: '1px solid #ddd'
            })}
        />
    </Box>

    {/* 高风险时段列表 */}
    <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
            高风险时段 (超高价+极端高价 ≥ 5次)
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {highRiskSlots.map((slot, idx) => (
                <Chip
                    key={idx}
                    label={`${slot.time} (${slot.count}次)`}
                    color="error"
                    size="small"
                />
            ))}
        </Box>
    </Box>

    {/* 低价机会时段列表 */}
    <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
            低价机会时段 (负电价+零电价+超低价 ≥ 10次)
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {lowPriceSlots.map((slot, idx) => (
                <Chip
                    key={idx}
                    label={`${slot.time} (${slot.count}次)`}
                    color="success"
                    size="small"
                />
            ))}
        </Box>
    </Box>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        ℹ️ 颜色越深表示该时段该类型事件出现频率越高，有助于识别规律性风险时段
    </Typography>
</Paper>
```

**颜色映射函数**:
```typescript
const getColorForValue = (value: number, min: number, max: number): string => {
    if (value === 0) return '#f5f5f5';  // 灰色（无事件）

    const normalized = (value - min) / (max - min);

    if (normalized < 0.33) return '#fff9c4';  // 浅黄色（低频）
    if (normalized < 0.67) return '#ffb74d';  // 橙色（中频）
    return '#f44336';  // 红色（高频）
};
```

**关键特性**:
- ✅ 支持24小时或96点粒度切换
- ✅ 颜色深度表示事件频率
- ✅ 自动识别高风险时段和低价机会时段
- ✅ 移动端优化：24小时粒度

---

### 15.5 极值分析配色方案

**添加到第十三章附录：图表配色方案**

```markdown
### 极值分析 ⭐ 新增
- 最高价: `#d32f2f` (红色)
- 最低价: `#1976d2` (蓝色)
- 极差: `#ff9800` (橙色)
- 负电价: `#ff9800` (橙色 - 中等风险)
- 零电价: `#2196f3` (蓝色 - 机会)
- 超低价: `#4caf50` (绿色 - 机会)
- 超高价: `#d32f2f` (红色 - 高风险)
- 极端高价: `#9c27b0` (紫色 - 严重风险)
```

---

## 十六、开发实现顺序 (更新)

### 第一阶段 (P0)
1. 页面框架和全局筛选器
2. 模块 A - 价格趋势分析 (卡片1、2)
3. **模块 E - 储能套利机会分析** ⭐ **新增P0**
4. **模块 F - 价格异常与极值分析** ⭐ **新增P0**
5. 模块 B - 周内价格箱线图

### 第二阶段 (P1)
6. 模块 A - 分时段价格趋势
7. 模块 C - 相关性分析 (负荷、火电、新能源)
8. 模块 D - 波动性分析

### 第三阶段 (P2)
9. 模块 B - 星期×时段热力图
10. 模块 C - 温度相关性
11. 优化和性能调优
