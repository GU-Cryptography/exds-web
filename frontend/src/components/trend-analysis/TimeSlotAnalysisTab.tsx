import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box, Paper, Typography, Grid,
    CircularProgress, Alert, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TablePagination, TableSortLabel, Chip,
    LinearProgress, Button
} from '@mui/material';
import {
    ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceLine, ErrorBar, Line, Scatter, Customized, ReferenceArea
} from 'recharts';
import { format } from 'date-fns';
import { trendAnalysisApi } from '../../api/trendAnalysis';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import DownloadIcon from '@mui/icons-material/Download';

interface TimeSlotAnalysisTabProps {
    startDate: Date | null;
    endDate: Date | null;
}

interface TimeSlotStats {
    timeslot: number;
    time_label: string;
    avg_price_rt: number;
    avg_price_da: number;
    std_price_rt: number;
    max_price_rt: number;
    min_price_rt: number;
    avg_spread: number;
    std_spread: number;
    positive_spread_ratio: number;
    negative_spread_ratio: number;
    max_spread: number;
    min_spread: number;
    consistency_score: number;
    recommended_strategy: string;
    confidence: string;
    risk_level: string;
    sample_size: number;
    recommendation_index: number;
    signal_strength: number;
}

interface BoxPlotDataPoint {
    timeslot: number;
    time_label: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    outliers: number[];
}

interface TimeSlotKPIs {
    high_consistency_count: number;
    avg_consistency: number;
    recommended_count: number;
    high_risk_count: number;
    top_consistency_timeslots: string[];
    top_risk_timeslots: string[];
}

interface TimeSlotAnalysisData {
    kpis: TimeSlotKPIs;
    timeslot_stats: TimeSlotStats[];
    box_plot_data: BoxPlotDataPoint[];
}

export const TimeSlotAnalysisTab: React.FC<TimeSlotAnalysisTabProps> = ({ startDate, endDate }) => {
    // 状态管理
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<TimeSlotAnalysisData | null>(null);

    // 表格状态
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [orderBy, setOrderBy] = useState<keyof TimeSlotStats>('recommendation_index');
    const [order, setOrder] = useState<'asc' | 'desc'>('desc');

    // Ref for chart
    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef,
        title: '时段价差分布'
    });

    // 数据加载
    const fetchData = async () => {
        if (!startDate || !endDate) return;

        setLoading(true);
        setError(null);

        try {
            const start = format(startDate, 'yyyy-MM-dd');
            const end = format(endDate, 'yyyy-MM-dd');
            const response = await trendAnalysisApi.fetchTimeSlotStats({ start_date: start, end_date: end });
            setData(response.data);
        } catch (err: any) {
            console.error('Error fetching time slot stats:', err);
            setError(err.response?.data?.detail || '获取数据失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [startDate, endDate]);

    // 表格排序
    const handleSort = (property: keyof TimeSlotStats) => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    const sortedData = useMemo(() => {
        if (!data) return [];
        return [...data.timeslot_stats].sort((a, b) => {
            const aVal = a[orderBy];
            const bVal = b[orderBy];
            if (order === 'asc') {
                return aVal < bVal ? -1 : 1;
            } else {
                return aVal > bVal ? -1 : 1;
            }
        });
    }, [data, order, orderBy]);

    // 分页
    const paginatedData = useMemo(() => {
        return sortedData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
    }, [sortedData, page, rowsPerPage]);

    const handleChangePage = (event: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    // 策略颜色映射
    const getStrategyColor = (strategy: string): "success" | "error" | "default" => {
        if (strategy === '做多日前') return 'success';
        if (strategy === '做空日前') return 'error';
        return 'default';
    };

    const getConfidenceColor = (confidence: string): "success" | "warning" | "default" => {
        if (confidence === '高') return 'success';
        if (confidence === '中') return 'warning';
        return 'default';
    };

    const getRiskColor = (risk: string): "success" | "warning" | "error" => {
        if (risk === '低风险') return 'success';
        if (risk === '中风险') return 'warning';
        return 'error';
    };

    return (
        <Box>
            {/* Content Area */}
            {loading && !data ? (
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            ) : error ? (
                <Alert severity="error">{error}</Alert>
            ) : data ? (
                <Box sx={{ position: 'relative' }}>
                    {/* Loading Overlay */}
                    {loading && (
                        <Box sx={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)', zIndex: 1000
                        }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {/* Summary Panel */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            mb: 2,
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            color: 'white',
                            borderRadius: 2,
                            boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)'
                        }}
                    >
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {/* Row 1: Metrics Overview */}
                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                                <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold', flexShrink: 0 }}>
                                    指标速览
                                </Box>
                                <Box component="span" sx={{ lineHeight: 2 }}>
                                    本周期共发现 <Box component="span" sx={{ fontWeight: 'bold', fontSize: '1.1em', mx: 0.5 }}>{data.kpis.high_consistency_count}</Box> 个高确定性时段，
                                    其中前三时段分别是 <Box component="span" sx={{ fontWeight: 'bold', mx: 0.5 }}>{data.kpis.top_consistency_timeslots.join(', ') || '无'}</Box>，
                                    另外⚠️注意：检测到 <Box component="span" sx={{ fontWeight: 'bold', fontSize: '1.1em', mx: 0.5, color: '#ffeb3b' }}>{data.kpis.high_risk_count}</Box> 个高风险时段，建议谨慎操作。
                                </Box>
                            </Typography>

                            {/* Row 2: Definitions */}
                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
                                <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold', flexShrink: 0 }}>
                                    指标定义
                                </Box>
                                <Box component="span" sx={{ opacity: 0.9, lineHeight: 2 }}>
                                    高确定性：一致性评分 ≥ 70% 且 平均价差绝对值 &gt; 10元；
                                    一致性评分 = max(正价差占比, 负价差占比)；
                                    高风险：价差标准差 ≥ 动态阈值 (Top 20%)。
                                </Box>
                            </Typography>
                        </Box>
                    </Paper>

                    {/* Box Plot Chart */}
                    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2 }}>
                        <Typography variant="h6" gutterBottom>时段价差分布</Typography>
                        <Box ref={chartRef} sx={{
                            height: { xs: 350, sm: 400 },
                            position: 'relative',
                            bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                            p: isFullscreen ? 2 : 0,
                            ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                        }}>
                            <FullscreenEnterButton />
                            <FullscreenExitButton />
                            <FullscreenTitle />
                            <ResponsiveContainer>
                                <ComposedChart data={data.box_plot_data} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis
                                        dataKey="timeslot"
                                        label={{ value: '时段编号', position: 'insideBottom', offset: -5 }}
                                        type="number"
                                        domain={[0, 49]}
                                    />
                                    <YAxis
                                        label={{ value: '价差 (元/MWh)', angle: -90, position: 'insideLeft' }}
                                        domain={[
                                            (dataMin: number) => Math.floor(Math.min(dataMin, ...data.box_plot_data.map(d => d.min)) * 1.1),
                                            (dataMax: number) => Math.ceil(Math.max(dataMax, ...data.box_plot_data.map(d => d.max)) * 1.1)
                                        ]}
                                    />
                                    <Tooltip content={({ active, payload }) => {
                                        if (active && payload && payload.length > 0) {
                                            const data = payload[0].payload as BoxPlotDataPoint;
                                            return (
                                                <Paper sx={{ p: 1 }}>
                                                    <Typography variant="caption" fontWeight="bold">时段 {data.timeslot}</Typography>
                                                    <Typography variant="body2">{data.time_label}</Typography>
                                                    <Typography variant="caption">最大: {data.max.toFixed(2)}</Typography><br />
                                                    <Typography variant="caption">Q3: {data.q3.toFixed(2)}</Typography><br />
                                                    <Typography variant="caption" fontWeight="bold" color="primary">中位数: {data.median.toFixed(2)}</Typography><br />
                                                    <Typography variant="caption">Q1: {data.q1.toFixed(2)}</Typography><br />
                                                    <Typography variant="caption">最小: {data.min.toFixed(2)}</Typography>
                                                </Paper>
                                            );
                                        }
                                        return null;
                                    }} />
                                    <ReferenceLine y={0} stroke="#000" strokeWidth={1.5} />

                                    {/* 隐藏的Bar,用于强制触发图表渲染和坐标轴计算 */}
                                    <Bar dataKey="median" fill="rgba(0,0,0,0)" legendType="none" tooltipType="none" />

                                    {/* 使用 ReferenceArea 和 ReferenceLine 绘制箱线图 */}
                                    {data.box_plot_data.map((entry, index) => {
                                        const { timeslot, min, q1, median, q3, max } = entry;
                                        const color = median >= 0 ? '#f44336' : '#4caf50';
                                        const width = 0.3; // 箱体宽度 (X轴单位)

                                        return (
                                            <React.Fragment key={`boxplot-${index}`}>
                                                {/* 须线 (Min 到 Max) */}
                                                <ReferenceLine
                                                    segment={[{ x: timeslot, y: min }, { x: timeslot, y: max }]}
                                                    stroke="#666"
                                                    strokeWidth={1.5}
                                                />
                                                {/* 须线端点 (Min) */}
                                                <ReferenceLine
                                                    segment={[{ x: timeslot - width / 2, y: min }, { x: timeslot + width / 2, y: min }]}
                                                    stroke="#666"
                                                    strokeWidth={1.5}
                                                />
                                                {/* 须线端点 (Max) */}
                                                <ReferenceLine
                                                    segment={[{ x: timeslot - width / 2, y: max }, { x: timeslot + width / 2, y: max }]}
                                                    stroke="#666"
                                                    strokeWidth={1.5}
                                                />

                                                {/* 箱体 (Q1 到 Q3) */}
                                                <ReferenceArea
                                                    x1={timeslot - width}
                                                    x2={timeslot + width}
                                                    y1={Math.min(q1, q3)}
                                                    y2={Math.max(q1, q3)}
                                                    fill={color}
                                                    fillOpacity={0.6}
                                                    stroke={color}
                                                    strokeWidth={1.5}
                                                />

                                                {/* 中位数线 */}
                                                <ReferenceLine
                                                    segment={[
                                                        { x: timeslot - width, y: median },
                                                        { x: timeslot + width, y: median }
                                                    ]}
                                                    stroke="#000"
                                                    strokeWidth={2}
                                                />
                                            </React.Fragment>
                                        );
                                    })}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            ℹ️ 箱体=25%-75%分位数(红色为正价差,绿色为负价差), 粗黑线=中位数, 须线=最小/最大值
                        </Typography>
                    </Paper>

                    {/* Data Table */}
                    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6">时段统计分析</Typography>
                            <Button variant="outlined" size="small" startIcon={<DownloadIcon />}>
                                导出Excel
                            </Button>
                        </Box>
                        <TableContainer sx={{ maxHeight: 600 }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
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
                                                active={orderBy === 'recommendation_index'}
                                                direction={order}
                                                onClick={() => handleSort('recommendation_index')}
                                            >
                                                推荐指数
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
                                                波动性(σ)
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
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {paginatedData.map((row) => (
                                        <TableRow key={row.timeslot} hover>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight="bold">
                                                    #{row.timeslot}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {row.time_label}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                                                    <Box display="flex" gap={0.5} alignItems="flex-end">
                                                        {[1, 2, 3, 4, 5].map((i) => (
                                                            <Box
                                                                key={i}
                                                                sx={{
                                                                    width: 4,
                                                                    height: 8 + (i * 2),
                                                                    bgcolor: i <= row.signal_strength ? 'primary.main' : 'grey.300',
                                                                    borderRadius: 0.5
                                                                }}
                                                            />
                                                        ))}
                                                    </Box>
                                                    <Typography variant="body2" fontWeight="bold">
                                                        {row.recommendation_index}
                                                    </Typography>
                                                </Box>
                                            </TableCell>
                                            <TableCell align="right">{row.avg_price_rt.toFixed(2)}</TableCell>
                                            <TableCell align="right">
                                                <Typography
                                                    variant="body2"
                                                    color={row.std_price_rt >= 30 ? 'error.main' : 'text.primary'}
                                                >
                                                    {row.std_price_rt.toFixed(2)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography
                                                    variant="body2"
                                                    color={row.avg_spread >= 0 ? 'error.main' : 'success.main'}
                                                    fontWeight="bold"
                                                >
                                                    {row.avg_spread >= 0 ? '+' : ''}{row.avg_spread.toFixed(2)}
                                                </Typography>
                                            </TableCell>
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
                                            <TableCell align="center">
                                                <Typography variant="body2" color="error.main">
                                                    {(row.positive_spread_ratio * 100).toFixed(0)}%
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center">
                                                <Typography variant="body2" color="success.main">
                                                    {(row.negative_spread_ratio * 100).toFixed(0)}%
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip
                                                    label={row.recommended_strategy}
                                                    size="small"
                                                    color={getStrategyColor(row.recommended_strategy)}
                                                    sx={{ fontSize: '0.7rem' }}
                                                />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip
                                                    label={row.confidence}
                                                    size="small"
                                                    color={getConfidenceColor(row.confidence)}
                                                    variant="outlined"
                                                    sx={{ fontSize: '0.7rem' }}
                                                />
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip
                                                    label={row.risk_level}
                                                    size="small"
                                                    color={getRiskColor(row.risk_level)}
                                                    variant="outlined"
                                                    sx={{ fontSize: '0.7rem' }}
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <TablePagination
                            component="div"
                            count={sortedData.length}
                            page={page}
                            onPageChange={handleChangePage}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={handleChangeRowsPerPage}
                            rowsPerPageOptions={[10, 25, 50]}
                            labelRowsPerPage="每页行数:"
                        />
                    </Paper>
                </Box >
            ) : null}
        </Box >
    );
};
