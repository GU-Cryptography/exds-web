# 储能套利分析 (Energy Storage Arbitrage Analysis) - UI设计文档

## 一、组件定位

### 1.1 组件信息

- **组件文件名**: `frontend/src/components/StorageArbitrageTab.tsx`
- **集成位置**: `frontend/src/pages/MarketPriceAnalysisPage.tsx` (新增第7个标签页)
- **页面标签**: "储能套利分析"

### 1.2 设计原则

- ✅ 遵循项目《前端开发规范》
- ✅ 使用 Material-UI v7 Grid 语法
- ✅ 移动端优先的响应式设计
- ✅ 图表为核心，突出充放电时段可视化
- ✅ 支持参数配置和策略对比
- ✅ 所有图表支持全屏功能

---

## 二、页面整体布局

### 2.1 布局结构

```
┌─────────────────────────────────────────┐
│ 全局筛选器 (Paper)                        │
│ [日期范围] [策略模式] [价格类型]           │
│ [储能参数配置] (可折叠)                    │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ 核心指标卡片 (Grid - 4列)                  │
│ [累计收益] [日均收益] [盈利天数] [增量收益率]│
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ A. 单日策略可视化 (Paper)                   │
│  ┌─────────────────────────────────┐    │
│  │ 价格曲线 + 充放电区域标注          │    │
│  │ - 绿色区域: 充电时段              │    │
│  │ - 红色区域: 放电时段              │    │
│  │ - 蓝色虚线: 充放电均价参考线       │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ SOC (电量状态) 曲线                │    │
│  └─────────────────────────────────┘    │
│  [策略详情卡片: 充电/放电时段、价格、收益]   │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ B. 周期收益分析 (Paper)                     │
│  ┌─────────────────────────────────┐    │
│  │ 累计收益曲线图                     │    │
│  │ - 一充一放累计收益 (蓝色)          │    │
│  │ - 两充两放累计收益 (绿色)          │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ 日收益统计表格                     │    │
│  │ - 日期、策略、收益、价差等          │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ C. 充放电时段偏好分析 (Paper)               │
│  ┌─────────────┐  ┌─────────────┐        │
│  │ 充电时段热力图│  │放电时段热力图│       │
│  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ D. 策略对比分析 (Paper - 对比模式显示)      │
│  ┌─────────────────────────────────┐    │
│  │ 策略对比表格                       │    │
│  │ - 累计收益、日均收益、稳定性等      │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ 收益分布箱线图                     │    │
│  └─────────────────────────────────┘    │
│  [策略推荐卡片]                            │
└─────────────────────────────────────────┘
```

### 2.2 响应式布局

- **移动端 (xs)**: 核心指标卡片2×2，图表全宽
- **桌面端 (md)**: 核心指标卡片1×4，并排图表半宽

---

## 三、全局筛选器设计

### 3.1 主筛选器

```tsx
<Paper variant="outlined" sx={{ p: 2 }}>
    <Grid container spacing={2} alignItems="center">
        {/* 第一行：日期和策略选择 */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <DateRangePicker
                label="分析周期"
                value={dateRange}
                onChange={setDateRange}
                disabled={loading}
                slotProps={{
                    textField: {
                        sx: { width: '100%' }
                    }
                }}
            />
        </Grid>

        <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <ButtonGroup variant="outlined" size="small" fullWidth>
                <Button onClick={() => setQuickRange(7)} disabled={loading}>近7天</Button>
                <Button onClick={() => setQuickRange(30)} disabled={loading}>近30天</Button>
            </ButtonGroup>
        </Grid>

        <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <FormControl fullWidth size="small">
                <InputLabel>策略模式</InputLabel>
                <Select value={strategyMode} onChange={handleStrategyModeChange} disabled={loading}>
                    <MenuItem value="one">一充一放</MenuItem>
                    <MenuItem value="two">两充两放</MenuItem>
                    <MenuItem value="compare">对比模式</MenuItem>
                </Select>
            </FormControl>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <FormControl fullWidth size="small">
                <InputLabel>价格类型</InputLabel>
                <Select value={priceType} onChange={handlePriceTypeChange} disabled={loading}>
                    <MenuItem value="rt">实时价格</MenuItem>
                    <MenuItem value="da">日前价格</MenuItem>
                </Select>
            </FormControl>
        </Grid>

        {/* 参数配置按钮 */}
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Button
                variant="outlined"
                fullWidth
                startIcon={<SettingsIcon />}
                onClick={() => setConfigDialogOpen(true)}
            >
                储能参数配置
            </Button>
        </Grid>
    </Grid>
</Paper>
```

### 3.2 储能参数配置Dialog

```tsx
<Dialog open={configDialogOpen} onClose={() => setConfigDialogOpen(false)} maxWidth="sm" fullWidth>
    <DialogTitle>储能参数配置</DialogTitle>
    <DialogContent>
        <Grid container spacing={2} sx={{ mt: 1 }}>
            {/* 储能容量 */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="储能容量 (MWh)"
                    type="number"
                    value={config.capacity}
                    onChange={(e) => handleConfigChange('capacity', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 1, max: 1000, step: 1 }}
                />
            </Grid>

            {/* 充电功率 */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="充电功率 (MW)"
                    type="number"
                    value={config.chargePower}
                    onChange={(e) => handleConfigChange('chargePower', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 1, max: 100, step: 1 }}
                />
            </Grid>

            {/* 放电功率 */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="放电功率 (MW)"
                    type="number"
                    value={config.dischargePower}
                    onChange={(e) => handleConfigChange('dischargePower', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 1, max: 100, step: 1 }}
                />
            </Grid>

            {/* 充电效率 */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="充电效率 (%)"
                    type="number"
                    value={config.chargeEfficiency}
                    onChange={(e) => handleConfigChange('chargeEfficiency', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 70, max: 100, step: 0.1 }}
                />
            </Grid>

            {/* 放电效率 */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="放电效率 (%)"
                    type="number"
                    value={config.dischargeEfficiency}
                    onChange={(e) => handleConfigChange('dischargeEfficiency', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 70, max: 100, step: 0.1 }}
                />
            </Grid>

            {/* 综合效率 (自动计算) */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="综合效率 (%)"
                    value={((config.chargeEfficiency / 100) * (config.dischargeEfficiency / 100) * 100).toFixed(2)}
                    fullWidth
                    disabled
                    helperText="自动计算: 充电效率 × 放电效率"
                />
            </Grid>

            {/* 最小SOC */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="最小SOC (%)"
                    type="number"
                    value={config.minSOC}
                    onChange={(e) => handleConfigChange('minSOC', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 0, max: 50, step: 1 }}
                />
            </Grid>

            {/* 最大SOC */}
            <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                    label="最大SOC (%)"
                    type="number"
                    value={config.maxSOC}
                    onChange={(e) => handleConfigChange('maxSOC', Number(e.target.value))}
                    fullWidth
                    inputProps={{ min: 50, max: 100, step: 1 }}
                />
            </Grid>
        </Grid>

        {/* 预设配置 */}
        <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" gutterBottom>
                快速预设:
            </Typography>
            <ButtonGroup size="small" sx={{ mt: 0.5 }}>
                <Button onClick={() => loadPreset('small')}>小型储能 (50MWh)</Button>
                <Button onClick={() => loadPreset('medium')}>中型储能 (100MWh)</Button>
                <Button onClick={() => loadPreset('large')}>大型储能 (200MWh)</Button>
            </ButtonGroup>
        </Box>
    </DialogContent>
    <DialogActions>
        <Button onClick={() => setConfigDialogOpen(false)}>取消</Button>
        <Button variant="contained" onClick={handleSaveConfig}>保存配置</Button>
    </DialogActions>
</Dialog>
```

---

## 四、核心指标卡片设计

### 4.1 卡片数据结构

```typescript
interface SummaryKPI {
    totalProfit: number;        // 累计收益 (元)
    avgDailyProfit: number;     // 日均收益 (元)
    profitableDays: number;     // 盈利天数
    totalDays: number;          // 总天数
    incrementalYield: number;   // 增量收益率 (%) - 仅对比模式
}
```

### 4.2 卡片UI组件

```tsx
<Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
    {/* 卡片1: 累计收益 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="success.main" fontWeight="bold">
                {formatCurrency(kpi.totalProfit)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                累计收益
            </Typography>
            <Typography variant="caption" color="text.secondary">
                ({dateRange[0]} ~ {dateRange[1]})
            </Typography>
        </Paper>
    </Grid>

    {/* 卡片2: 日均收益 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary.main" fontWeight="bold">
                {formatCurrency(kpi.avgDailyProfit)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                日均收益
            </Typography>
        </Paper>
    </Grid>

    {/* 卡片3: 盈利天数 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="info.main" fontWeight="bold">
                {kpi.profitableDays} / {kpi.totalDays}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                盈利天数
            </Typography>
            <Typography variant="caption" color="text.secondary">
                ({((kpi.profitableDays / kpi.totalDays) * 100).toFixed(1)}% 概率)
            </Typography>
        </Paper>
    </Grid>

    {/* 卡片4: 增量收益率 (仅对比模式显示) */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            {strategyMode === 'compare' ? (
                <>
                    <Typography
                        variant="h4"
                        color={kpi.incrementalYield >= 0 ? 'success.main' : 'error.main'}
                        fontWeight="bold"
                    >
                        {kpi.incrementalYield >= 0 ? '+' : ''}{kpi.incrementalYield.toFixed(1)}%
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        增量收益率
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        (两充两放 vs 一充一放)
                    </Typography>
                </>
            ) : (
                <>
                    <Typography variant="h4" color="warning.main" fontWeight="bold">
                        {kpi.maxDailyProfit ? formatCurrency(kpi.maxDailyProfit) : '--'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        最大单日收益
                    </Typography>
                </>
            )}
        </Paper>
    </Grid>
</Grid>
```

---

## 五、模块 A：单日策略可视化

### 5.1 日期导航

```tsx
<Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
        <ArrowLeftIcon />
    </IconButton>

    <DatePicker
        label="选择日期"
        value={selectedDate}
        onChange={setSelectedDate}
        disabled={loading}
        slotProps={{
            textField: {
                sx: { width: { xs: '150px', sm: '200px' } }
            }
        }}
    />

    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}>
        <ArrowRightIcon />
    </IconButton>

    <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

    {/* 策略模式快速切换 (仅在非对比模式) */}
    {strategyMode !== 'compare' && (
        <ButtonGroup size="small">
            <Button
                variant={strategyMode === 'one' ? 'contained' : 'outlined'}
                onClick={() => setStrategyMode('one')}
            >
                一充一放
            </Button>
            <Button
                variant={strategyMode === 'two' ? 'contained' : 'outlined'}
                onClick={() => setStrategyMode('two')}
            >
                两充两放
            </Button>
        </ButtonGroup>
    )}
</Paper>
```

### 5.2 卡片一：价格曲线 + 充放电区域

**图表类型**: 折线图 (`LineChart`) + 矩形区域 (`ReferenceArea`)

**数据结构**:
```typescript
interface DailyStrategy {
    date: string;
    prices: number[];  // 96点价格
    chargeSlots: Array<{ start: number; end: number; avgPrice: number; energy: number; cost: number }>;
    dischargeSlots: Array<{ start: number; end: number; avgPrice: number; energy: number; revenue: number }>;
    profit: number;
    priceSpread: number;
}
```

**UI组件**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
    <Typography variant="h6" gutterBottom>
        充放电策略可视化 ({dateStr})
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
            <LineChart data={priceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time_str" interval={11} angle={-45} textAnchor="end" height={60} />
                <YAxis label={{ value: '价格 (元/MWh)', angle: -90 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />

                {/* 充电时段背景 (绿色半透明) */}
                {strategy.chargeSlots.map((slot, idx) => (
                    <ReferenceArea
                        key={`charge-${idx}`}
                        x1={priceData[slot.start].time_str}
                        x2={priceData[slot.end].time_str}
                        fill="#4caf50"
                        fillOpacity={0.2}
                        stroke="#4caf50"
                        strokeWidth={2}
                        label={{
                            value: `充电 ${slot.avgPrice.toFixed(0)}元`,
                            position: 'top'
                        }}
                    />
                ))}

                {/* 放电时段背景 (红色半透明) */}
                {strategy.dischargeSlots.map((slot, idx) => (
                    <ReferenceArea
                        key={`discharge-${idx}`}
                        x1={priceData[slot.start].time_str}
                        x2={priceData[slot.end].time_str}
                        fill="#d32f2f"
                        fillOpacity={0.2}
                        stroke="#d32f2f"
                        strokeWidth={2}
                        label={{
                            value: `放电 ${slot.avgPrice.toFixed(0)}元`,
                            position: 'top'
                        }}
                    />
                ))}

                {/* 价格曲线 */}
                <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#1976d2"
                    strokeWidth={2}
                    dot={false}
                    name="市场价格"
                />

                {/* 充电均价参考线 */}
                <ReferenceLine
                    y={strategy.avgChargePrice}
                    stroke="#4caf50"
                    strokeDasharray="5 5"
                    label={{ value: `充电均价 ${strategy.avgChargePrice.toFixed(0)}`, position: 'right' }}
                />

                {/* 放电均价参考线 */}
                <ReferenceLine
                    y={strategy.avgDischargePrice}
                    stroke="#d32f2f"
                    strokeDasharray="5 5"
                    label={{ value: `放电均价 ${strategy.avgDischargePrice.toFixed(0)}`, position: 'right' }}
                />
            </LineChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

**自定义Tooltip**:
```tsx
const CustomTooltip: React.FC = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;

    const data = payload[0].payload;
    const isChargeSlot = strategy.chargeSlots.some(s => s.start <= data.index && data.index <= s.end);
    const isDischargeSlot = strategy.dischargeSlots.some(s => s.start <= data.index && data.index <= s.end);

    return (
        <Paper sx={{ p: 1, bgcolor: 'rgba(255, 255, 255, 0.95)' }}>
            <Typography variant="caption" fontWeight="bold">{data.time_str}</Typography>
            <Typography variant="body2">价格: {data.price.toFixed(2)} 元/MWh</Typography>
            {isChargeSlot && <Chip label="充电时段" color="success" size="small" />}
            {isDischargeSlot && <Chip label="放电时段" color="error" size="small" />}
        </Paper>
    );
};
```

### 5.3 卡片二：SOC (电量状态) 曲线

**图表类型**: 折线图 (`LineChart`) + 区域填充 (`AreaChart`)

**数据结构**:
```typescript
interface SOCData {
    time_str: string;
    soc: number;  // 0-100%
    status: 'charging' | 'discharging' | 'idle';
}
```

**UI组件**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>SOC (电量状态) 曲线</Typography>

    <Box ref={socChartRef} sx={{ height: { xs: 250, sm: 300 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={socData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time_str" interval={11} angle={-45} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} label={{ value: 'SOC (%)', angle: -90 }} />
                <Tooltip />

                {/* 最小/最大SOC参考线 */}
                <ReferenceLine y={config.minSOC} stroke="#d32f2f" strokeDasharray="3 3" label="最小SOC" />
                <ReferenceLine y={config.maxSOC} stroke="#d32f2f" strokeDasharray="3 3" label="最大SOC" />
                <ReferenceLine y={50} stroke="#666" strokeDasharray="3 3" label="初始SOC" />

                {/* SOC曲线 (根据状态着色) */}
                <Area
                    type="stepAfter"
                    dataKey="soc"
                    stroke="#1976d2"
                    strokeWidth={2}
                    fill="#90caf9"
                    fillOpacity={0.3}
                    name="SOC"
                />
            </AreaChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

### 5.4 卡片三：策略详情卡片

```tsx
<Grid container spacing={2} sx={{ mt: 2 }}>
    {/* 充电详情 */}
    {strategy.chargeSlots.map((slot, idx) => (
        <Grid size={{ xs: 12, md: 6 }} key={`charge-${idx}`}>
            <Paper variant="outlined" sx={{ p: 2, borderLeft: 4, borderColor: 'success.main' }}>
                <Typography variant="subtitle2" color="success.main" gutterBottom>
                    🔋 充电时段 {idx + 1}
                </Typography>
                <Grid container spacing={1}>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">时段</Typography>
                        <Typography variant="body2" fontWeight="bold">
                            {priceData[slot.start].time_str} ~ {priceData[slot.end].time_str}
                        </Typography>
                    </Grid>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">平均价格</Typography>
                        <Typography variant="body2" fontWeight="bold" color="success.main">
                            {slot.avgPrice.toFixed(2)} 元/MWh
                        </Typography>
                    </Grid>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">充电量</Typography>
                        <Typography variant="body2">{slot.energy.toFixed(2)} MWh</Typography>
                    </Grid>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">充电成本</Typography>
                        <Typography variant="body2">{formatCurrency(slot.cost)}</Typography>
                    </Grid>
                </Grid>
            </Paper>
        </Grid>
    ))}

    {/* 放电详情 */}
    {strategy.dischargeSlots.map((slot, idx) => (
        <Grid size={{ xs: 12, md: 6 }} key={`discharge-${idx}`}>
            <Paper variant="outlined" sx={{ p: 2, borderLeft: 4, borderColor: 'error.main' }}>
                <Typography variant="subtitle2" color="error.main" gutterBottom>
                    ⚡ 放电时段 {idx + 1}
                </Typography>
                <Grid container spacing={1}>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">时段</Typography>
                        <Typography variant="body2" fontWeight="bold">
                            {priceData[slot.start].time_str} ~ {priceData[slot.end].time_str}
                        </Typography>
                    </Grid>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">平均价格</Typography>
                        <Typography variant="body2" fontWeight="bold" color="error.main">
                            {slot.avgPrice.toFixed(2)} 元/MWh
                        </Typography>
                    </Grid>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">放电量</Typography>
                        <Typography variant="body2">{slot.energy.toFixed(2)} MWh</Typography>
                    </Grid>
                    <Grid size={6}>
                        <Typography variant="caption" color="text.secondary">放电收入</Typography>
                        <Typography variant="body2">{formatCurrency(slot.revenue)}</Typography>
                    </Grid>
                </Grid>
            </Paper>
        </Grid>
    ))}

    {/* 收益汇总 */}
    <Grid size={12}>
        <Alert severity="success" sx={{ mt: 1 }}>
            <Typography variant="body2" fontWeight="bold">
                当日净收益: {formatCurrency(strategy.profit)} | 价差: {strategy.priceSpread.toFixed(2)} 元/MWh
            </Typography>
        </Alert>
    </Grid>
</Grid>
```

---

## 六、模块 B：周期收益分析

### 6.1 卡片一：累计收益曲线

**图表类型**: 折线图 (`LineChart`)

**数据结构**:
```typescript
interface CumulativeProfit {
    date: string;
    one_cumulative: number;   // 一充一放累计收益
    two_cumulative: number;   // 两充两放累计收益
    incremental: number;      // 增量收益
}
```

**UI组件**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
    <Typography variant="h6" gutterBottom>累计收益曲线</Typography>

    <Box ref={cumulativeChartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis label={{ value: '累计收益 (元)', angle: -90 }} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />

                {strategyMode === 'compare' || strategyMode === 'one' ? (
                    <Line
                        type="monotone"
                        dataKey="one_cumulative"
                        stroke="#1976d2"
                        strokeWidth={2}
                        dot={false}
                        name="一充一放"
                    />
                ) : null}

                {strategyMode === 'compare' || strategyMode === 'two' ? (
                    <Line
                        type="monotone"
                        dataKey="two_cumulative"
                        stroke="#4caf50"
                        strokeWidth={2}
                        dot={false}
                        name="两充两放"
                    />
                ) : null}

                {strategyMode === 'compare' ? (
                    <Line
                        type="monotone"
                        dataKey="incremental"
                        stroke="#ff9800"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="增量收益"
                    />
                ) : null}
            </LineChart>
        </ResponsiveContainer>
    </Box>
</Paper>
```

### 6.2 卡片二：日收益统计表格

**数据结构**:
```typescript
interface DailyProfitRow {
    date: string;
    strategy: string;                 // "一充一放" | "两充两放"
    profit: number;
    chargeAvgPrice: number;
    dischargeAvgPrice: number;
    priceSpread: number;
    chargeEnergy: number;
    dischargeEnergy: number;
    incrementalProfit?: number;       // 仅对比模式
    incrementalYield?: number;        // 仅对比模式 (%)
}
```

**UI组件**:
```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">日收益统计</Typography>

        <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={handleExportExcel}>
            导出Excel
        </Button>
    </Box>

    <TableContainer sx={{ maxHeight: 500, overflowX: 'auto' }}>
        <Table
            stickyHeader
            sx={{
                '& .MuiTableCell-root': {
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    px: { xs: 0.5, sm: 1 },
                }
            }}
        >
            <TableHead>
                <TableRow>
                    <TableCell>日期</TableCell>
                    {strategyMode === 'compare' && <TableCell>策略</TableCell>}
                    <TableCell align="right">收益 (元)</TableCell>
                    <TableCell align="right">充电均价</TableCell>
                    <TableCell align="right">放电均价</TableCell>
                    <TableCell align="right">价差</TableCell>
                    <TableCell align="right">充电量</TableCell>
                    <TableCell align="right">放电量</TableCell>
                    {strategyMode === 'compare' && (
                        <>
                            <TableCell align="right">增量收益</TableCell>
                            <TableCell align="right">增量收益率</TableCell>
                        </>
                    )}
                </TableRow>
            </TableHead>
            <TableBody>
                {tableData.map((row) => (
                    <TableRow key={row.date} hover>
                        <TableCell>{row.date}</TableCell>
                        {strategyMode === 'compare' && (
                            <TableCell>
                                <Chip
                                    label={row.strategy}
                                    size="small"
                                    color={row.strategy === '两充两放' ? 'success' : 'primary'}
                                    sx={{ fontSize: '0.7rem' }}
                                />
                            </TableCell>
                        )}
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                fontWeight="bold"
                                color={row.profit >= 0 ? 'success.main' : 'error.main'}
                            >
                                {formatCurrency(row.profit)}
                            </Typography>
                        </TableCell>
                        <TableCell align="right">{row.chargeAvgPrice.toFixed(2)}</TableCell>
                        <TableCell align="right">{row.dischargeAvgPrice.toFixed(2)}</TableCell>
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                color={row.priceSpread >= 0 ? 'success.main' : 'error.main'}
                            >
                                {row.priceSpread.toFixed(2)}
                            </Typography>
                        </TableCell>
                        <TableCell align="right">{row.chargeEnergy.toFixed(2)}</TableCell>
                        <TableCell align="right">{row.dischargeEnergy.toFixed(2)}</TableCell>
                        {strategyMode === 'compare' && (
                            <>
                                <TableCell align="right">
                                    <Typography
                                        variant="body2"
                                        color={row.incrementalProfit >= 0 ? 'success.main' : 'error.main'}
                                    >
                                        {row.incrementalProfit >= 0 ? '+' : ''}{formatCurrency(row.incrementalProfit)}
                                    </Typography>
                                </TableCell>
                                <TableCell align="right">
                                    <Typography
                                        variant="body2"
                                        color={row.incrementalYield >= 0 ? 'success.main' : 'error.main'}
                                    >
                                        {row.incrementalYield >= 0 ? '+' : ''}{row.incrementalYield.toFixed(1)}%
                                    </Typography>
                                </TableCell>
                            </>
                        )}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>

    <TablePagination
        component="div"
        count={tableData.length}
        page={page}
        onPageChange={handleChangePage}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[10, 20, 30]}
        labelRowsPerPage="每页行数:"
    />
</Paper>
```

---

## 七、模块 C：充放电时段偏好分析

### 7.1 充放电时段热力图

**图表类型**: 热力图 (`HeatMapGrid`)

**数据结构**:
```typescript
// chargeHeatmap[日期索引][时段索引] = 1 (充电) | 0 (非充电)
const chargeHeatmap: number[][] = [...];
const dischargeHeatmap: number[][] = [...];
```

**UI组件**:
```tsx
<Grid container spacing={2}>
    {/* 充电时段热力图 */}
    <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
            <Typography variant="h6" gutterBottom color="success.main">
                🔋 充电时段偏好
            </Typography>

            <Box sx={{ height: { xs: 300, sm: 350 }, overflowX: 'auto' }}>
                <HeatMapGrid
                    data={chargeHeatmap}
                    xLabels={timeLabels}  // ['00:00', '01:00', ...]
                    yLabels={dateLabels}  // ['01-01', '01-02', ...]
                    cellRender={(x, y, value) => (
                        <div style={{ fontSize: '0.7rem' }}>
                            {value > 0 ? '✓' : ''}
                        </div>
                    )}
                    cellStyle={(background, value) => ({
                        background: value > 0 ? '#4caf50' : '#f5f5f5',
                        fontSize: '0.7rem',
                        color: value > 0 ? '#fff' : '#000'
                    })}
                />
            </Box>

            {/* 时段统计 */}
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                高频充电时段 (前3):
                {topChargeSlots.map((slot, idx) => (
                    <Chip key={idx} label={`${slot.time} (${slot.count}次)`} size="small" color="success" sx={{ ml: 0.5 }} />
                ))}
            </Typography>
        </Paper>
    </Grid>

    {/* 放电时段热力图 */}
    <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
            <Typography variant="h6" gutterBottom color="error.main">
                ⚡ 放电时段偏好
            </Typography>

            <Box sx={{ height: { xs: 300, sm: 350 }, overflowX: 'auto' }}>
                <HeatMapGrid
                    data={dischargeHeatmap}
                    xLabels={timeLabels}
                    yLabels={dateLabels}
                    cellRender={(x, y, value) => (
                        <div style={{ fontSize: '0.7rem' }}>
                            {value > 0 ? '✓' : ''}
                        </div>
                    )}
                    cellStyle={(background, value) => ({
                        background: value > 0 ? '#d32f2f' : '#f5f5f5',
                        fontSize: '0.7rem',
                        color: value > 0 ? '#fff' : '#000'
                    })}
                />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                高频放电时段 (前3):
                {topDischargeSlots.map((slot, idx) => (
                    <Chip key={idx} label={`${slot.time} (${slot.count}次)`} size="small" color="error" sx={{ ml: 0.5 }} />
                ))}
            </Typography>
        </Paper>
    </Grid>
</Grid>
```

---

## 八、模块 D：策略对比分析 (仅对比模式显示)

### 8.1 策略对比表格

```tsx
{strategyMode === 'compare' && (
    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
        <Typography variant="h6" gutterBottom>策略对比分析</Typography>

        <TableContainer>
            <Table>
                <TableHead>
                    <TableRow>
                        <TableCell>指标</TableCell>
                        <TableCell align="right">一充一放</TableCell>
                        <TableCell align="right">两充两放</TableCell>
                        <TableCell align="right">差异</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    <TableRow>
                        <TableCell>累计收益</TableCell>
                        <TableCell align="right">{formatCurrency(comparison.one.totalProfit)}</TableCell>
                        <TableCell align="right">{formatCurrency(comparison.two.totalProfit)}</TableCell>
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                fontWeight="bold"
                                color={comparison.diff.totalProfit >= 0 ? 'success.main' : 'error.main'}
                            >
                                {comparison.diff.totalProfit >= 0 ? '+' : ''}{formatCurrency(comparison.diff.totalProfit)}
                                ({comparison.diff.totalProfitPct >= 0 ? '+' : ''}{comparison.diff.totalProfitPct.toFixed(1)}%)
                            </Typography>
                        </TableCell>
                    </TableRow>
                    <TableRow>
                        <TableCell>日均收益</TableCell>
                        <TableCell align="right">{formatCurrency(comparison.one.avgProfit)}</TableCell>
                        <TableCell align="right">{formatCurrency(comparison.two.avgProfit)}</TableCell>
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                color={comparison.diff.avgProfit >= 0 ? 'success.main' : 'error.main'}
                            >
                                {comparison.diff.avgProfit >= 0 ? '+' : ''}{formatCurrency(comparison.diff.avgProfit)}
                            </Typography>
                        </TableCell>
                    </TableRow>
                    {/* 更多指标... */}
                </TableBody>
            </Table>
        </TableContainer>
    </Paper>
)}
```

### 8.2 收益分布箱线图

```tsx
{strategyMode === 'compare' && (
    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
        <Typography variant="h6" gutterBottom>收益分布对比</Typography>

        <Box ref={boxPlotRef} sx={{ height: { xs: 300, sm: 350 }, ... }}>
            <FullscreenEnterButton />
            <FullscreenExitButton />
            <FullscreenTitle />

            <ResponsiveBoxPlot
                data={[
                    { group: '一充一放', ...boxPlotStats.one },
                    { group: '两充两放', ...boxPlotStats.two }
                ]}
                margin={{ top: 60, right: 80, bottom: 60, left: 80 }}
                colors={{ scheme: 'set2' }}
                axisBottom={{ legend: '策略', legendPosition: 'middle', legendOffset: 46 }}
                axisLeft={{ legend: '日收益 (元)', legendPosition: 'middle', legendOffset: -60 }}
            />
        </Box>
    </Paper>
)}
```

### 8.3 策略推荐卡片

```tsx
{strategyMode === 'compare' && (
    <Alert severity={recommendation.severity} sx={{ mt: 2 }}>
        <Typography variant="body2" fontWeight="bold">{recommendation.title}</Typography>
        <Typography variant="body2">{recommendation.reason}</Typography>
        <ul style={{ margin: '8px 0 0 20px', paddingLeft: 0 }}>
            {recommendation.highlights.map((highlight, idx) => (
                <li key={idx}>{highlight}</li>
            ))}
        </ul>
    </Alert>
)}
```

---

## 九、Loading 状态管理

```tsx
{loading && !data ? (
    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="400px" gap={2}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
            正在计算最优充放电策略...
        </Typography>
        <Typography variant="caption" color="text.secondary">
            (周期越长,计算时间越长,约3-10秒)
        </Typography>
    </Box>
) : error ? (
    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
) : data ? (
    <>
        {loading && (
            <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, bgcolor: 'rgba(255, 255, 255, 0.7)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        )}

        {/* 所有模块 */}
    </>
) : null}
```

---

## 十、API 接口定义

**Endpoint**: `GET /api/v1/market-analysis/storage-arbitrage`

**请求参数**:
```typescript
{
    start_date: string;             // "YYYY-MM-DD"
    end_date: string;               // "YYYY-MM-DD"
    strategy_mode: "one" | "two" | "compare";
    price_type: "rt" | "da";
    config: {
        capacity: number;           // MWh
        charge_power: number;       // MW
        discharge_power: number;    // MW
        charge_efficiency: number;  // %
        discharge_efficiency: number;  // %
        min_soc: number;           // %
        max_soc: number;           // %
    }
}
```

**返回数据结构**:
```typescript
{
    summary: {
        total_profit: number;
        avg_daily_profit: number;
        profitable_days: number;
        total_days: number;
        max_daily_profit: number;
        incremental_yield?: number;  // 仅对比模式
    },

    daily_strategies: [
        {
            date: "2025-01-01",
            prices: number[];  // 96点价格
            one_charge_one_discharge?: {...},  // 一充一放策略
            two_charge_two_discharge?: {...},  // 两充两放策略
            soc_data: [...],  // SOC曲线数据
        },
        ...
    ],

    cumulative_profit: [
        {
            date: "2025-01-01",
            one_cumulative: number,
            two_cumulative: number,
            incremental: number
        },
        ...
    ],

    timeslot_preference: {
        charge_heatmap: number[][],
        discharge_heatmap: number[][],
        top_charge_slots: [...],
        top_discharge_slots: [...]
    },

    comparison?: {  // 仅对比模式
        one: {...},
        two: {...},
        diff: {...},
        recommendation: {...}
    }
}
```

---

## 十一、响应式设计检查清单

- [ ] 筛选器使用 `flexWrap: 'wrap'`
- [ ] 核心指标卡片 `size: { xs: 6, md: 3 }`
- [ ] 图表高度 `{ xs: 350, sm: 400 }`
- [ ] 表格字体 `{ xs: '0.75rem', sm: '0.875rem' }`
- [ ] 热力图在移动端优化为24小时粒度
- [ ] 策略详情卡片移动端全宽 `size: { xs: 12, md: 6 }`
- [ ] 所有图表支持全屏

---

## 十二、开发实现顺序

### 第一阶段 (P0)
1. 页面框架和全局筛选器
2. 核心指标卡片
3. 单日一充一放策略计算和可视化
4. 周期收益表格

### 第二阶段 (P1)
5. 单日两充两放策略计算
6. SOC曲线可视化
7. 累计收益曲线
8. 对比模式

### 第三阶段 (P2)
9. 充放电时段热力图
10. 策略推荐引擎
11. 优化和性能调优

---

## 十三、附录：颜色方案

- 充电: `success` (#4caf50 绿色)
- 放电: `error` (#d32f2f 红色)
- 一充一放: `primary` (#1976d2 蓝色)
- 两充两放: `success` (#4caf50 绿色)
- 增量收益: `warning` (#ff9800 橙色)
- 正收益: `success.main`
- 负收益/亏损: `error.main`
