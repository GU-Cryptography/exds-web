# 时段特征挖掘 (Timeslot Profiling) - UI设计文档

## 一、组件定位

### 1.1 组件信息

- **组件文件名**: `frontend/src/components/TimeslotProfilingTab.tsx`
- **集成位置**: `frontend/src/pages/MarketPriceAnalysisPage.tsx` (新增第6个标签页)
- **页面标签**: "时段特征挖掘"

### 1.2 设计原则

- ✅ 遵循项目《前端开发规范》
- ✅ 使用 Material-UI v7 Grid 语法 (`size` 属性)
- ✅ 移动端优先的响应式设计
- ✅ 表格为核心组件，支持排序、筛选、分页
- ✅ 所有图表支持全屏功能 (`useChartFullscreen`)
- ✅ 使用颜色编码突出关键信息 (推荐策略、风险等级)

---

## 二、页面整体布局

### 2.1 布局结构

```
┌─────────────────────────────────────────┐
│ 全局筛选器 (Paper)                        │
│ [日期范围] [时段粒度] [最小样本量] [筛选条件]│
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ 核心指标卡片 (Grid - 4列)                  │
│ [高确定性时段数] [平均一致性] [推荐交易] [高风险] │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ A. 时段统计分析表格 (Paper)                 │
│  ┌─────────────────────────────────┐    │
│  │ 数据表格 (支持排序/筛选/分页)       │    │
│  │ - 时段编号                         │    │
│  │ - 平均价格 (RT/DA)                 │    │
│  │ - 价格波动性                       │    │
│  │ - 平均价差                         │    │
│  │ - 价差占比                         │    │
│  │ - 推荐策略                         │    │
│  │ - 置信度/风险等级                   │    │
│  └─────────────────────────────────┘    │
│  [导出Excel] [对比分析]                    │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ B. 时段价差分布可视化 (Paper)               │
│  ┌─────────────────────────────────┐    │
│  │ 箱线图: X轴=时段, Y轴=价差         │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ C. 高确定性时段雷达图 (Paper)               │
│  ┌─────────────────────────────────┐    │
│  │ 雷达图: 展示Top 10高确定性时段     │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────┐
│ D. 时段对比分析 (Dialog - 条件显示)         │
│  ┌─────────────┐  ┌─────────────┐        │
│  │ 时段A详情    │  │ 时段B详情    │        │
│  └─────────────┘  └─────────────┘        │
│  [关键差异高亮]                            │
└─────────────────────────────────────────┘
```

### 2.2 响应式布局

- **移动端 (xs)**: 核心指标卡片2列，表格水平滚动
- **桌面端 (md)**: 核心指标卡片4列，表格全宽展示

---

## 三、全局筛选器设计

### 3.1 筛选器组件

```tsx
<Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
    {/* 日期范围选择器 */}
    <DateRangePicker
        label="分析周期"
        value={dateRange}
        onChange={setDateRange}
        disabled={loading}
        slotProps={{
            textField: {
                sx: { width: { xs: '100%', sm: '250px' } }
            }
        }}
    />

    {/* 快捷日期选择 */}
    <ButtonGroup variant="outlined" size="small">
        <Button onClick={() => setQuickRange(7)} disabled={loading}>近7天</Button>
        <Button onClick={() => setQuickRange(30)} disabled={loading}>近30天</Button>
        <Button onClick={() => setQuickRange(90)} disabled={loading}>近90天</Button>
    </ButtonGroup>

    {/* 时段粒度 */}
    <FormControl sx={{ minWidth: 120 }} size="small">
        <InputLabel>时段粒度</InputLabel>
        <Select value={granularity} onChange={handleGranularityChange} disabled={loading}>
            <MenuItem value={96}>96点 (15分钟)</MenuItem>
            <MenuItem value={48}>48时段 (30分钟)</MenuItem>
            <MenuItem value="tou">尖峰平谷</MenuItem>
        </Select>
    </FormControl>

    {/* 最小样本量 */}
    <TextField
        label="最小样本量"
        type="number"
        value={minSampleSize}
        onChange={(e) => setMinSampleSize(Number(e.target.value))}
        disabled={loading}
        size="small"
        sx={{ width: 100 }}
        inputProps={{ min: 5, max: 90 }}
    />

    {/* 筛选条件 */}
    <FormControl component="fieldset" size="small">
        <FormGroup row>
            <FormControlLabel
                control={<Checkbox checked={filters.highConsistency} onChange={handleFilterChange('highConsistency')} />}
                label="高一致性 (≥70%)"
            />
            <FormControlLabel
                control={<Checkbox checked={filters.lowRisk} onChange={handleFilterChange('lowRisk')} />}
                label="低风险"
            />
            <FormControlLabel
                control={<Checkbox checked={filters.hasStrategy} onChange={handleFilterChange('hasStrategy')} />}
                label="有推荐策略"
            />
        </FormGroup>
    </FormControl>
</Paper>
```

### 3.2 筛选器状态管理

```tsx
const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    addDays(new Date(), -30),  // 默认30天前
    addDays(new Date(), -1)    // 默认昨天
]);
const [granularity, setGranularity] = useState<96 | 48 | 'tou'>(48);
const [minSampleSize, setMinSampleSize] = useState(20);
const [filters, setFilters] = useState({
    highConsistency: false,
    lowRisk: false,
    hasStrategy: false
});
const [loading, setLoading] = useState(false);
const [data, setData] = useState<any>(null);

// 自动加载数据
useEffect(() => {
    fetchData(dateRange, granularity, minSampleSize);
}, [dateRange, granularity, minSampleSize]);
```

---

## 四、核心指标卡片设计

### 4.1 卡片数据结构

```tsx
const kpiData = {
    highConsistencyCount: 12,  // 一致性≥70%的时段数
    avgConsistency: 0.64,      // 平均一致性评分
    recommendedCount: 8,       // 有推荐策略的时段数
    highRiskCount: 5           // 高风险时段数
};
```

### 4.2 卡片UI组件

```tsx
<Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
    {/* 卡片1: 高确定性时段数 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="success.main" fontWeight="bold">
                {kpiData.highConsistencyCount}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                高确定性时段
            </Typography>
            <Typography variant="caption" color="text.secondary">
                (一致性≥70%)
            </Typography>
        </Paper>
    </Grid>

    {/* 卡片2: 平均一致性 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary.main" fontWeight="bold">
                {(kpiData.avgConsistency * 100).toFixed(0)}%
            </Typography>
            <Typography variant="body2" color="text.secondary">
                平均一致性
            </Typography>
        </Paper>
    </Grid>

    {/* 卡片3: 推荐交易时段 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="info.main" fontWeight="bold">
                {kpiData.recommendedCount}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                推荐交易时段
            </Typography>
        </Paper>
    </Grid>

    {/* 卡片4: 高风险时段 */}
    <Grid size={{ xs: 6, md: 3 }}>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="error.main" fontWeight="bold">
                {kpiData.highRiskCount}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                高风险时段
            </Typography>
            <Typography variant="caption" color="text.secondary">
                (标准差≥30)
            </Typography>
        </Paper>
    </Grid>
</Grid>
```

---

## 五、模块 A：时段统计分析表格

### 5.1 表格数据结构

```typescript
interface TimeslotStats {
    timeslot: number;                  // 时段编号 (1-48或1-96)
    time_label: string;                // 时间标签 (如 "07:00-07:15")
    avg_price_rt: number;              // 平均价格_RT
    avg_price_da: number;              // 平均价格_DA
    std_price_rt: number;              // 价格标准差_RT
    max_price_rt: number;              // 最高价_RT
    min_price_rt: number;              // 最低价_RT
    avg_spread: number;                // 平均价差
    std_spread: number;                // 价差标准差
    positive_spread_ratio: number;     // 正价差占比 (0-1)
    negative_spread_ratio: number;     // 负价差占比 (0-1)
    max_spread: number;                // 最大正价差
    min_spread: number;                // 最大负价差
    consistency_score: number;         // 一致性评分 (0-1)
    recommended_strategy: string;      // "做多日前" | "做空日前" | "观望"
    confidence: string;                // "高" | "中" | "低"
    risk_level: string;                // "高风险" | "中风险" | "低风险"
    sample_size: number;               // 样本量 (有效天数)
}

const tableData: TimeslotStats[] = [...];
```

### 5.2 表格UI组件

```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">时段统计分析</Typography>

        <Box sx={{ display: 'flex', gap: 1 }}>
            {/* 导出Excel按钮 */}
            <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleExportExcel}
            >
                导出Excel
            </Button>

            {/* 对比分析按钮 (选中2个时段时激活) */}
            <Button
                variant="contained"
                size="small"
                disabled={selectedTimeslots.length !== 2}
                onClick={handleCompare}
            >
                对比分析 ({selectedTimeslots.length}/2)
            </Button>
        </Box>
    </Box>

    <TableContainer sx={{ maxHeight: 600, overflowX: 'auto' }}>
        <Table
            stickyHeader
            sx={{
                '& .MuiTableCell-root': {
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    px: { xs: 0.5, sm: 1 },
                    py: { xs: 0.75, sm: 1 }
                }
            }}
        >
            <TableHead>
                <TableRow>
                    <TableCell padding="checkbox">
                        <Checkbox
                            indeterminate={selectedTimeslots.length > 0 && selectedTimeslots.length < tableData.length}
                            checked={selectedTimeslots.length === tableData.length}
                            onChange={handleSelectAll}
                        />
                    </TableCell>
                    <TableCell>
                        <TableSortLabel
                            active={orderBy === 'timeslot'}
                            direction={order}
                            onClick={() => handleSort('timeslot')}
                        >
                            时段
                        </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                        <TableSortLabel
                            active={orderBy === 'avg_price_rt'}
                            direction={order}
                            onClick={() => handleSort('avg_price_rt')}
                        >
                            平均价格_RT
                        </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                        <TableSortLabel
                            active={orderBy === 'std_price_rt'}
                            direction={order}
                            onClick={() => handleSort('std_price_rt')}
                        >
                            波动性 (σ)
                        </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                        <TableSortLabel
                            active={orderBy === 'avg_spread'}
                            direction={order}
                            onClick={() => handleSort('avg_spread')}
                        >
                            平均价差
                        </TableSortLabel>
                    </TableCell>
                    <TableCell align="right">
                        <TableSortLabel
                            active={orderBy === 'consistency_score'}
                            direction={order}
                            onClick={() => handleSort('consistency_score')}
                        >
                            一致性
                        </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">正价差占比</TableCell>
                    <TableCell align="center">负价差占比</TableCell>
                    <TableCell align="center">推荐策略</TableCell>
                    <TableCell align="center">置信度</TableCell>
                    <TableCell align="center">风险等级</TableCell>
                    <TableCell align="right">样本量</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {visibleData.map((row) => (
                    <TableRow
                        key={row.timeslot}
                        hover
                        onClick={() => handleRowClick(row.timeslot)}
                        selected={selectedTimeslots.includes(row.timeslot)}
                        sx={{
                            cursor: 'pointer',
                            // 高一致性时段背景色
                            bgcolor: row.consistency_score >= 0.8 ? 'success.lighter' : 'transparent'
                        }}
                    >
                        <TableCell padding="checkbox">
                            <Checkbox
                                checked={selectedTimeslots.includes(row.timeslot)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelect(row.timeslot);
                                }}
                            />
                        </TableCell>

                        {/* 时段编号和时间标签 */}
                        <TableCell>
                            <Typography variant="body2" fontWeight="bold">
                                #{row.timeslot}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {row.time_label}
                            </Typography>
                        </TableCell>

                        {/* 平均价格_RT */}
                        <TableCell align="right">
                            {row.avg_price_rt.toFixed(2)}
                        </TableCell>

                        {/* 波动性 (标准差) */}
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                color={row.std_price_rt >= 30 ? 'error.main' : 'text.primary'}
                            >
                                {row.std_price_rt.toFixed(2)}
                            </Typography>
                        </TableCell>

                        {/* 平均价差 (带颜色) */}
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                color={row.avg_spread >= 0 ? 'error.main' : 'success.main'}
                                fontWeight="bold"
                            >
                                {row.avg_spread >= 0 ? '+' : ''}{row.avg_spread.toFixed(2)}
                            </Typography>
                        </TableCell>

                        {/* 一致性评分 (进度条) */}
                        <TableCell align="right">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LinearProgress
                                    variant="determinate"
                                    value={row.consistency_score * 100}
                                    sx={{
                                        flexGrow: 1,
                                        height: 6,
                                        borderRadius: 3,
                                        bgcolor: 'grey.200',
                                        '& .MuiLinearProgress-bar': {
                                            bgcolor: row.consistency_score >= 0.7 ? 'success.main' : 'warning.main'
                                        }
                                    }}
                                />
                                <Typography variant="caption">
                                    {(row.consistency_score * 100).toFixed(0)}%
                                </Typography>
                            </Box>
                        </TableCell>

                        {/* 正价差占比 */}
                        <TableCell align="center">
                            <Typography variant="body2" color="error.main">
                                {(row.positive_spread_ratio * 100).toFixed(0)}%
                            </Typography>
                        </TableCell>

                        {/* 负价差占比 */}
                        <TableCell align="center">
                            <Typography variant="body2" color="success.main">
                                {(row.negative_spread_ratio * 100).toFixed(0)}%
                            </Typography>
                        </TableCell>

                        {/* 推荐策略 (Chip) */}
                        <TableCell align="center">
                            <Chip
                                label={row.recommended_strategy}
                                size="small"
                                color={
                                    row.recommended_strategy === '做多日前' ? 'success' :
                                    row.recommended_strategy === '做空日前' ? 'error' :
                                    'default'
                                }
                                sx={{ fontSize: '0.7rem' }}
                            />
                        </TableCell>

                        {/* 置信度 */}
                        <TableCell align="center">
                            <Chip
                                label={row.confidence}
                                size="small"
                                color={
                                    row.confidence === '高' ? 'success' :
                                    row.confidence === '中' ? 'warning' :
                                    'default'
                                }
                                variant="outlined"
                                sx={{ fontSize: '0.7rem' }}
                            />
                        </TableCell>

                        {/* 风险等级 */}
                        <TableCell align="center">
                            <Chip
                                label={row.risk_level}
                                size="small"
                                color={
                                    row.risk_level === '高风险' ? 'error' :
                                    row.risk_level === '中风险' ? 'warning' :
                                    'success'
                                }
                                variant="outlined"
                                sx={{ fontSize: '0.7rem' }}
                            />
                        </TableCell>

                        {/* 样本量 */}
                        <TableCell align="right">
                            <Typography
                                variant="body2"
                                color={row.sample_size < minSampleSize ? 'warning.main' : 'text.primary'}
                            >
                                {row.sample_size}
                            </Typography>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>

    {/* 分页 */}
    <TablePagination
        component="div"
        count={filteredData.length}
        page={page}
        onPageChange={handleChangePage}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
        labelRowsPerPage="每页行数:"
    />
</Paper>
```

### 5.3 表格交互逻辑

```tsx
// 排序
const [order, setOrder] = useState<'asc' | 'desc'>('asc');
const [orderBy, setOrderBy] = useState<keyof TimeslotStats>('timeslot');

const handleSort = (property: keyof TimeslotStats) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
};

const sortedData = useMemo(() => {
    return [...tableData].sort((a, b) => {
        if (order === 'asc') {
            return a[orderBy] < b[orderBy] ? -1 : 1;
        } else {
            return a[orderBy] > b[orderBy] ? -1 : 1;
        }
    });
}, [tableData, order, orderBy]);

// 筛选
const filteredData = useMemo(() => {
    return sortedData.filter(row => {
        if (filters.highConsistency && row.consistency_score < 0.7) return false;
        if (filters.lowRisk && row.risk_level !== '低风险') return false;
        if (filters.hasStrategy && row.recommended_strategy === '观望') return false;
        if (row.sample_size < minSampleSize) return false;
        return true;
    });
}, [sortedData, filters, minSampleSize]);

// 分页
const [page, setPage] = useState(0);
const [rowsPerPage, setRowsPerPage] = useState(25);
const visibleData = filteredData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

// 选择
const [selectedTimeslots, setSelectedTimeslots] = useState<number[]>([]);

const handleSelect = (timeslot: number) => {
    setSelectedTimeslots(prev => {
        if (prev.includes(timeslot)) {
            return prev.filter(t => t !== timeslot);
        } else {
            // 最多选择2个用于对比
            if (prev.length >= 2) {
                return [prev[1], timeslot];
            }
            return [...prev, timeslot];
        }
    });
};

// 点击行展开详情
const handleRowClick = (timeslot: number) => {
    setExpandedTimeslot(timeslot);
    setDetailDialogOpen(true);
};
```

---

## 六、模块 B：时段价差分布箱线图

### 6.1 数据结构

```typescript
interface BoxPlotData {
    timeslot: number;
    time_label: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    outliers: number[];
}

const boxPlotData: BoxPlotData[] = [...];
```

### 6.2 UI组件 (使用 Nivo BoxPlot)

```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>时段价差分布</Typography>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, position: 'relative', ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveBoxPlot
            data={boxPlotData}
            margin={{ top: 60, right: 80, bottom: 60, left: 80 }}
            minValue={-100}
            maxValue={100}
            subGroupBy="timeslot"
            padding={0.12}
            enableGridX={true}
            axisBottom={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: -45,
                legend: '时段',
                legendPosition: 'middle',
                legendOffset: 46
            }}
            axisLeft={{
                tickSize: 5,
                tickPadding: 5,
                tickRotation: 0,
                legend: '价差 (元/MWh)',
                legendPosition: 'middle',
                legendOffset: -60
            }}
            colors={{ scheme: 'set2' }}
            borderRadius={2}
            borderWidth={2}
            borderColor={{ from: 'color', modifiers: [['darker', 0.3]] }}
            medianWidth={2}
            medianColor={{ from: 'color', modifiers: [['darker', 0.3]] }}
            whiskerWidth={2}
            whiskerColor={{ from: 'color', modifiers: [['darker', 0.3]] }}
            motionConfig="stiff"
            legends={[
                {
                    anchor: 'right',
                    direction: 'column',
                    translateX: 100,
                    itemWidth: 60,
                    itemHeight: 20,
                    symbolSize: 12,
                    symbolShape: 'square'
                }
            ]}
            tooltip={({ id, value, color }) => (
                <Paper sx={{ p: 1 }}>
                    <Typography variant="caption">时段 {id}</Typography>
                    <Typography variant="body2" fontWeight="bold">
                        价差: {value.toFixed(2)} 元/MWh
                    </Typography>
                </Paper>
            )}
        />
    </Box>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        ℹ️ 箱体表示25%-75%分位数，中线为中位数，须线为最小/最大值，点为离群值
    </Typography>
</Paper>
```

### 6.3 备选方案 (Recharts 模拟)

如果不想引入 Nivo，可使用 Recharts 的 `ComposedChart` + `ErrorBar` 模拟：

```tsx
<ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={boxPlotData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time_label" angle={-45} textAnchor="end" height={80} />
        <YAxis label={{ value: '价差 (元/MWh)', angle: -90, position: 'insideLeft' }} />
        <ReferenceLine y={0} stroke="#000" />
        <Tooltip content={<CustomBoxPlotTooltip />} />

        {/* 须线 (min-max) */}
        <ErrorBar dataKey="whisker" width={0} strokeWidth={2} stroke="#666" />

        {/* 箱体 (Q1-Q3) */}
        <Bar dataKey="iqr" stackId="box" fill="#90caf9" />

        {/* 中位线 */}
        <Scatter dataKey="median" fill="#1976d2" shape="line" />

        {/* 离群值 */}
        <Scatter dataKey="outliers" fill="#d32f2f" />
    </ComposedChart>
</ResponsiveContainer>
```

---

## 七、模块 C：高确定性时段雷达图

### 7.1 数据结构

```typescript
interface RadarData {
    timeslot: string;               // "时段15"
    一致性评分: number;              // 0-100
    价差显著性: number;              // 归一化到0-100
    样本充足度: number;              // 归一化到0-100
    低风险性: number;                // 100 - 归一化后的标准差
}

const radarData: RadarData[] = [
    // 仅包含Top 10高确定性时段
];
```

### 7.2 UI组件 (使用 Recharts Radar)

```tsx
<Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
    <Typography variant="h6" gutterBottom>高确定性时段综合评分 (Top 10)</Typography>

    <Box ref={chartRef} sx={{ height: { xs: 350, sm: 400 }, ... }}>
        <FullscreenEnterButton />
        <FullscreenExitButton />
        <FullscreenTitle />

        <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="timeslot" />
                <PolarRadiusAxis angle={90} domain={[0, 100]} />
                <Tooltip />
                <Legend />

                {/* 为每个时段绘制一条雷达线 */}
                {topTimeslots.map((ts, index) => (
                    <Radar
                        key={ts.timeslot}
                        name={`时段${ts.timeslot}`}
                        dataKey={`timeslot_${ts.timeslot}`}
                        stroke={COLORS[index % COLORS.length]}
                        fill={COLORS[index % COLORS.length]}
                        fillOpacity={0.3}
                    />
                ))}
            </RadarChart>
        </ResponsiveContainer>
    </Box>

    {/* 说明文字 */}
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        ℹ️ 四个维度均归一化到0-100分，分数越高表示该时段越适合交易
    </Typography>
</Paper>
```

---

## 八、模块 D：时段对比分析 (Dialog)

### 8.1 Dialog 触发条件

- 用户在表格中勾选2个时段
- 点击"对比分析"按钮

### 8.2 UI组件

```tsx
<Dialog
    open={compareDialogOpen}
    onClose={() => setCompareDialogOpen(false)}
    maxWidth="md"
    fullWidth
    fullScreen={isMobile}
>
    <DialogTitle>
        时段对比分析
        <IconButton
            onClick={() => setCompareDialogOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
        >
            <CloseIcon />
        </IconButton>
    </DialogTitle>

    <DialogContent>
        <Grid container spacing={2}>
            {/* 时段A */}
            <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>
                        时段 #{timeslotA.timeslot}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        {timeslotA.time_label}
                    </Typography>

                    <Divider sx={{ my: 2 }} />

                    <Grid container spacing={1}>
                        <Grid size={12}>
                            <ComparisonRow
                                label="平均价格_RT"
                                valueA={timeslotA.avg_price_rt}
                                valueB={timeslotB.avg_price_rt}
                                unit="元/MWh"
                            />
                        </Grid>
                        <Grid size={12}>
                            <ComparisonRow
                                label="价格波动性"
                                valueA={timeslotA.std_price_rt}
                                valueB={timeslotB.std_price_rt}
                                unit="元"
                                highlightLower
                            />
                        </Grid>
                        <Grid size={12}>
                            <ComparisonRow
                                label="平均价差"
                                valueA={timeslotA.avg_spread}
                                valueB={timeslotB.avg_spread}
                                unit="元/MWh"
                                colorCode
                            />
                        </Grid>
                        <Grid size={12}>
                            <ComparisonRow
                                label="一致性评分"
                                valueA={timeslotA.consistency_score * 100}
                                valueB={timeslotB.consistency_score * 100}
                                unit="%"
                                highlightHigher
                            />
                        </Grid>
                        <Grid size={12}>
                            <ComparisonRow
                                label="推荐策略"
                                valueA={timeslotA.recommended_strategy}
                                valueB={timeslotB.recommended_strategy}
                                isText
                                highlightDiff
                            />
                        </Grid>
                        <Grid size={12}>
                            <ComparisonRow
                                label="风险等级"
                                valueA={timeslotA.risk_level}
                                valueB={timeslotB.risk_level}
                                isText
                                highlightDiff
                            />
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>

            {/* 时段B */}
            <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>
                        时段 #{timeslotB.timeslot}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        {timeslotB.time_label}
                    </Typography>

                    {/* 同样的对比行 */}
                </Paper>
            </Grid>

            {/* 差异总结 */}
            <Grid size={12}>
                <Alert severity="info" sx={{ mt: 2 }}>
                    <Typography variant="body2" fontWeight="bold">关键差异</Typography>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                        <li>时段{timeslotA.timeslot}价格波动性更低 (σ={timeslotA.std_price_rt.toFixed(2)})</li>
                        <li>时段{timeslotB.timeslot}推荐"做空日前"，一致性更高 ({(timeslotB.consistency_score * 100).toFixed(0)}%)</li>
                        <li>两个时段风险等级相同，均为"{timeslotA.risk_level}"</li>
                    </ul>
                </Alert>
            </Grid>
        </Grid>
    </DialogContent>

    <DialogActions>
        <Button onClick={() => setCompareDialogOpen(false)}>关闭</Button>
    </DialogActions>
</Dialog>
```

### 8.3 对比行组件

```tsx
interface ComparisonRowProps {
    label: string;
    valueA: number | string;
    valueB: number | string;
    unit?: string;
    isText?: boolean;
    colorCode?: boolean;        // 正负价差颜色编码
    highlightHigher?: boolean;  // 高亮较大值
    highlightLower?: boolean;   // 高亮较小值
    highlightDiff?: boolean;    // 高亮不同值
}

const ComparisonRow: React.FC<ComparisonRowProps> = ({
    label, valueA, valueB, unit, isText, colorCode, highlightHigher, highlightLower, highlightDiff
}) => {
    const isDiff = valueA !== valueB;
    const isAHigher = typeof valueA === 'number' && typeof valueB === 'number' && valueA > valueB;

    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Typography
                    variant="body2"
                    fontWeight="bold"
                    color={
                        colorCode && typeof valueA === 'number' ? (valueA >= 0 ? 'error.main' : 'success.main') :
                        highlightHigher && isAHigher ? 'success.main' :
                        highlightLower && !isAHigher ? 'success.main' :
                        highlightDiff && isDiff ? 'warning.main' :
                        'text.primary'
                    }
                >
                    {isText ? valueA : `${valueA.toFixed(2)}${unit || ''}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">vs</Typography>
                <Typography
                    variant="body2"
                    fontWeight="bold"
                    color={
                        colorCode && typeof valueB === 'number' ? (valueB >= 0 ? 'error.main' : 'success.main') :
                        highlightHigher && !isAHigher ? 'success.main' :
                        highlightLower && isAHigher ? 'success.main' :
                        highlightDiff && isDiff ? 'warning.main' :
                        'text.primary'
                    }
                >
                    {isText ? valueB : `${valueB.toFixed(2)}${unit || ''}`}
                </Typography>
            </Box>
        </Box>
    );
};
```

---

## 九、Loading 状态管理

**关键原则**: 大数据量表格加载时显示全局Loading + 进度提示

### 9.1 首次加载

```tsx
{loading && !data ? (
    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="400px" gap={2}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
            正在分析 {granularity === 96 ? '96个时段' : granularity === 48 ? '48个时段' : '4个时段'}...
        </Typography>
        <Typography variant="caption" color="text.secondary">
            (约需 3-8 秒)
        </Typography>
    </Box>
) : error ? (
    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
) : data ? (
    <>
        {/* 数据刷新时的覆盖层 */}
        {loading && (
            <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, bgcolor: 'rgba(255, 255, 255, 0.7)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        )}

        {/* 核心指标卡片 */}
        {/* 表格 */}
        {/* 图表 */}
    </>
) : null}
```

---

## 十、响应式设计检查清单

- [ ] 筛选器使用 `flexWrap: 'wrap'`
- [ ] 核心指标卡片 `size: { xs: 6, md: 3 }`
- [ ] 表格字体 `{ xs: '0.75rem', sm: '0.875rem' }`
- [ ] 表格内边距 `{ xs: 0.5, sm: 1 }`
- [ ] 表格水平滚动 (`overflowX: 'auto'`)
- [ ] 对比Dialog在移动端全屏 (`fullScreen={isMobile}`)
- [ ] 所有图表支持全屏
- [ ] 导出Excel按钮在移动端缩小或隐藏

---

## 十一、开发实现顺序

### 第一阶段 (P0)
1. 页面框架和全局筛选器
2. 核心指标卡片
3. 时段统计分析表格 (基础列)
4. 排序和分页功能

### 第二阶段 (P1)
5. 推荐策略和风险评级逻辑
6. 表格高级筛选 (高一致性/低风险)
7. 时段价差分布箱线图

### 第三阶段 (P2)
8. 高确定性时段雷达图
9. 时段对比分析Dialog
10. 导出Excel功能

---

## 十二、技术栈与依赖

### 必需库
- `@mui/material` v7
- `@mui/x-date-pickers`
- `recharts`
- `date-fns`

### 可选库
- `@nivo/boxplot`: 箱线图实现
- `xlsx`: Excel导出功能

---

## 十三、API 接口定义

**Endpoint**: `GET /api/v1/market-analysis/timeslot-profiling`

**请求参数**:
```typescript
{
    start_date: string;         // "YYYY-MM-DD"
    end_date: string;           // "YYYY-MM-DD"
    granularity: 96 | 48 | "tou";
}
```

**返回数据结构**:
```typescript
{
    summary: {
        high_consistency_count: number;
        avg_consistency: number;
        recommended_count: number;
        high_risk_count: number;
    },

    timeslot_stats: TimeslotStats[],  // 如前面定义

    boxplot_data: BoxPlotData[],      // 如前面定义

    radar_data: RadarData[]           // Top 10高确定性时段
}
```

---

## 十四、附录：颜色方案

### 推荐策略
- 做多日前: `success` (#4caf50)
- 做空日前: `error` (#d32f2f)
- 观望: `default` (灰色)

### 置信度
- 高: `success` (#4caf50)
- 中: `warning` (#ff9800)
- 低: `default` (灰色)

### 风险等级
- 低风险: `success` (#4caf50)
- 中风险: `warning` (#ff9800)
- 高风险: `error` (#d32f2f)

### 价差
- 正价差: `error.main` (#d32f2f)
- 负价差: `success.main` (#388e3c)
