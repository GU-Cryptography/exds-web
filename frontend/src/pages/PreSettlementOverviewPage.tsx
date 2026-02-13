import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box, Grid, Paper, Typography, CircularProgress, Alert, IconButton,
    Select, MenuItem, FormControl, InputLabel, SelectChangeEvent,
    useMediaQuery, Theme, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Card, CardContent, Divider,
    ToggleButtonGroup, ToggleButton
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MonetizationOnOutlinedIcon from '@mui/icons-material/MonetizationOnOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { format, addMonths } from 'date-fns';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useSelectableSeries } from '../hooks/useSelectableSeries';

// ====== 类型定义 ======
interface DailyDetail {
    date: string;
    volume_mwh: number;
    wholesale_cost: number;
    deviation_recovery_fee: number;
    wholesale_avg_price: number;
    retail_revenue: number;
    retail_avg_price: number;
    price_spread: number;
    daily_profit: number;
    cumulative_profit: number;
}

interface Summary {
    customer_count: number;
    settlement_start: string;
    settlement_end: string;
    total_wholesale_cost: number;
    total_retail_revenue: number;
    total_volume_mwh: number;
    total_deviation_recovery_fee: number;
    wholesale_avg_price: number;
    retail_avg_price: number;
    price_spread: number;
    gross_profit: number;
    profit_margin: number;
}

interface OverviewData {
    month: string;
    version: string;
    summary: Summary;
    daily_details: DailyDetail[];
}

// 版本映射
const VERSION_OPTIONS = [
    { value: 'PLATFORM_DAILY', label: '平台日清数据' },
    { value: 'PRELIMINARY', label: '原始数据计算' },
];

// 图表视图模式
type ChartViewMode = 'price' | 'amount';

// 图表系列 key
type PriceSeriesKey = 'wholesale_avg_price' | 'retail_avg_price';
type PriceSpreadSeriesKey = 'price_spread' | 'cumulative_avg_spread';
type AmountSeriesKey = 'wholesale_cost_wan' | 'retail_revenue_wan';
type ProfitSeriesKey = 'daily_profit_wan' | 'cumulative_profit_wan';

// ====== StatCard ======
const StatCard: React.FC<{
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color?: string;
    valueColor?: string;
}> = ({ title, value, subtitle, icon, color = 'primary.main', valueColor }) => (
    <Paper sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', alignItems: 'center', height: '100%' }} elevation={2}>
        <Box sx={{ fontSize: { xs: 30, sm: 40 }, color, mr: { xs: 1, sm: 2 }, display: 'flex', alignItems: 'center' }}>
            {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap>{title}</Typography>
            <Typography
                variant="h6" component="div" fontWeight="bold" noWrap
                sx={{ fontSize: { xs: '1rem', sm: '1.25rem' }, color: valueColor || 'text.primary' }}
            >
                {value}
            </Typography>
            {subtitle && (
                <Typography variant="caption" color="text.secondary" noWrap>{subtitle}</Typography>
            )}
        </Box>
    </Paper>
);

// ====== 工具函数 ======
const formatWanYuan = (val: number): string => `${(val / 10000).toFixed(1)}万`;

const formatYuan = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const profitColor = (val: number): string => val >= 0 ? '#4caf50' : '#f44336';

// ====== 自定义 Tooltip：均价图（含价差） ======
const PriceTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
        <Paper sx={{ p: 1, border: '1px solid #ccc' }}>
            <Typography variant="body2" fontWeight="bold">日期: {label}</Typography>
            <Typography variant="body2" sx={{ color: '#1976d2' }}>
                购电均价: {data.wholesale_avg_price?.toFixed(2)} 元/MWh
            </Typography>
            <Typography variant="body2" sx={{ color: '#4caf50' }}>
                售电均价: {data.retail_avg_price?.toFixed(2)} 元/MWh
            </Typography>
            <Typography variant="body2" sx={{ color: profitColor(data.price_spread), fontWeight: 'bold' }}>
                价差: {data.price_spread > 0 ? '+' : ''}{data.price_spread?.toFixed(2)} 元/MWh
            </Typography>
        </Paper>
    );
};

// ====== 自定义 Tooltip：收益图（含利润） ======
const RevenueTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    const profit = (data.retail_revenue_wan ?? 0) - (data.wholesale_cost_wan ?? 0);
    return (
        <Paper sx={{ p: 1, border: '1px solid #ccc' }}>
            <Typography variant="body2" fontWeight="bold">日期: {label}</Typography>
            <Typography variant="body2" sx={{ color: '#1976d2' }}>
                购电成本: {data.wholesale_cost_wan?.toFixed(2)} 万元
            </Typography>
            <Typography variant="body2" sx={{ color: '#4caf50' }}>
                售电收入: {data.retail_revenue_wan?.toFixed(2)} 万元
            </Typography>
            <Typography variant="body2" sx={{ color: profitColor(profit), fontWeight: 'bold' }}>
                利润: {profit > 0 ? '+' : ''}{profit.toFixed(2)} 万元
            </Typography>
        </Paper>
    );
};

// ====== 主组件 ======
const PreSettlementOverviewPage: React.FC = () => {
    const isTablet = useMediaQuery((t: Theme) => t.breakpoints.down('md'));
    const isMobile = useMediaQuery((t: Theme) => t.breakpoints.down('sm'));

    const [selectedMonth, setSelectedMonth] = useState<Date | null>(new Date());
    const [version, setVersion] = useState<string>('PLATFORM_DAILY');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<OverviewData | null>(null);
    const [chartView, setChartView] = useState<ChartViewMode>('price');

    const leftChartRef = useRef<HTMLDivElement>(null);
    const rightChartRef = useRef<HTMLDivElement>(null);

    const monthStr = selectedMonth ? format(selectedMonth, 'yyyy-MM') : '';

    // 全屏 — 左图
    const {
        isFullscreen: isLeftFs,
        FullscreenEnterButton: LeftFsEnter,
        FullscreenExitButton: LeftFsExit,
        FullscreenTitle: LeftFsTitle,
        NavigationButtons: LeftNavBtns,
    } = useChartFullscreen({
        chartRef: leftChartRef,
        title: chartView === 'price' ? `购电/售电均价走势 (${monthStr})` : `购电成本/售电收入走势 (${monthStr})`,
        onPrevious: () => handleShiftMonth(-1),
        onNext: () => handleShiftMonth(1),
    });

    // 全屏 — 右图
    const {
        isFullscreen: isRightFs,
        FullscreenEnterButton: RightFsEnter,
        FullscreenExitButton: RightFsExit,
        FullscreenTitle: RightFsTitle,
        NavigationButtons: RightNavBtns,
    } = useChartFullscreen({
        chartRef: rightChartRef,
        title: chartView === 'price' ? `日批零价差走势 (${monthStr})` : `日毛利与累计毛利 (${monthStr})`,
        onPrevious: () => handleShiftMonth(-1),
        onNext: () => handleShiftMonth(1),
    });

    // 曲线选择
    const { seriesVisibility: priceVis, handleLegendClick: onPriceLegend } = useSelectableSeries<PriceSeriesKey>({
        wholesale_avg_price: true, retail_avg_price: true,
    });
    const { seriesVisibility: spreadVis, handleLegendClick: onSpreadLegend } = useSelectableSeries<PriceSpreadSeriesKey>({
        price_spread: true, cumulative_avg_spread: true,
    });
    const { seriesVisibility: amountVis, handleLegendClick: onAmountLegend } = useSelectableSeries<AmountSeriesKey>({
        wholesale_cost_wan: true, retail_revenue_wan: true,
    });
    const { seriesVisibility: profitVis, handleLegendClick: onProfitLegend } = useSelectableSeries<ProfitSeriesKey>({
        daily_profit_wan: true, cumulative_profit_wan: true,
    });

    // 数据获取
    const fetchData = useCallback(async () => {
        if (!selectedMonth) return;
        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get('/api/v1/settlement/overview', {
                params: { month: format(selectedMonth, 'yyyy-MM'), version },
            });
            if (res.data.code === 200) {
                setData(res.data.data);
            } else {
                setError(res.data.message || '加载失败');
            }
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '请求失败');
        } finally {
            setLoading(false);
        }
    }, [selectedMonth, version]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleShiftMonth = (offset: number) => {
        if (!selectedMonth) return;
        setSelectedMonth(addMonths(selectedMonth, offset));
    };

    const handleVersionChange = (e: SelectChangeEvent) => { setVersion(e.target.value); };

    // ====== 图表数据 ======
    const chartData = data?.daily_details.map((d, idx, arr) => {
        // 累计均价差 = 截至当日的总利润 / 截至当日的总电量 (近似批零价差均值)
        let cumVolume = 0, cumProfit = 0;
        for (let i = 0; i <= idx; i++) {
            cumVolume += arr[i].volume_mwh;
            cumProfit += arr[i].daily_profit;
        }
        const cumulativeAvgSpread = cumVolume > 0 ? cumProfit / cumVolume : 0;

        return {
            ...d,
            dateLabel: d.date.substring(5),
            daily_profit_wan: d.daily_profit / 10000,
            cumulative_profit_wan: d.cumulative_profit / 10000,
            wholesale_cost_wan: d.wholesale_cost / 10000,
            retail_revenue_wan: d.retail_revenue / 10000,
            cumulative_avg_spread: parseFloat(cumulativeAvgSpread.toFixed(2)),
        };
    }) || [];

    // ====== 渲染：汇总卡片 ======
    const renderSummaryCards = () => {
        if (!data) return null;
        const s = data.summary;
        return (
            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="购电成本" value={`${formatWanYuan(s.total_wholesale_cost)}元`}
                        subtitle={`含偏差回收 ${formatWanYuan(s.total_deviation_recovery_fee)}`}
                        icon={<AccountBalanceWalletOutlinedIcon />} color="#1976d2" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="售电收入" value={`${formatWanYuan(s.total_retail_revenue)}元`}
                        icon={<MonetizationOnOutlinedIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="当月毛利" value={`${formatWanYuan(s.gross_profit)}元`}
                        subtitle={`利润率 ${s.profit_margin}%`}
                        icon={<TrendingUpOutlinedIcon />}
                        color={profitColor(s.gross_profit)} valueColor={profitColor(s.gross_profit)} />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="购电均价" value={`${s.wholesale_avg_price.toFixed(1)}`}
                        subtitle="元/MWh" icon={<PriceChangeOutlinedIcon />} color="#1976d2" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="售电均价" value={`${s.retail_avg_price.toFixed(1)}`}
                        subtitle="元/MWh" icon={<StorefrontOutlinedIcon />} color="#2e7d32" />
                </Grid>
                <Grid size={{ xs: 6, md: 2 }}>
                    <StatCard title="批零价差" value={`${s.price_spread > 0 ? '+' : ''}${s.price_spread.toFixed(1)}`}
                        subtitle="元/MWh" icon={<CompareArrowsOutlinedIcon />}
                        color={profitColor(s.price_spread)} valueColor={profitColor(s.price_spread)} />
                </Grid>
            </Grid>
        );
    };

    // ====== 全屏容器样式 ======
    const chartBoxSx = (isFs: boolean) => ({
        height: { xs: 300, sm: 350 },
        position: 'relative' as const,
        backgroundColor: isFs ? 'background.paper' : 'transparent',
        p: isFs ? 2 : 0,
        ...(isFs && { position: 'fixed' as const, top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
        '& .recharts-wrapper:focus': { outline: 'none' },
    });

    // ====== 渲染：左图 ======
    const renderLeftChart = () => {
        if (chartData.length === 0) return null;

        if (chartView === 'price') {
            // 购电/售电均价走势
            return (
                <Box ref={leftChartRef} sx={chartBoxSx(isLeftFs)}>
                    <LeftFsEnter /><LeftFsExit /><LeftFsTitle /><LeftNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }}
                                label={{ value: '元/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <Tooltip content={<PriceTooltip />} />
                            <Legend onClick={onPriceLegend} />
                            <Line type="monotone" dataKey="wholesale_avg_price" name="购电均价"
                                stroke="#1976d2" strokeWidth={2} dot={{ r: 3 }} hide={!priceVis.wholesale_avg_price} />
                            <Line type="monotone" dataKey="retail_avg_price" name="售电均价"
                                stroke="#4caf50" strokeWidth={2} dot={{ r: 3 }} hide={!priceVis.retail_avg_price} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        } else {
            // 购电成本 vs 售电收入（万元）— 曲线形式
            return (
                <Box ref={leftChartRef} sx={chartBoxSx(isLeftFs)}>
                    <LeftFsEnter /><LeftFsExit /><LeftFsTitle /><LeftNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }}
                                label={{ value: '万元', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <Tooltip content={<RevenueTooltip />} />
                            <Legend onClick={onAmountLegend} />
                            <Line type="monotone" dataKey="wholesale_cost_wan" name="购电成本"
                                stroke="#1976d2" strokeWidth={2} dot={{ r: 3 }} hide={!amountVis.wholesale_cost_wan} />
                            <Line type="monotone" dataKey="retail_revenue_wan" name="售电收入"
                                stroke="#4caf50" strokeWidth={2} dot={{ r: 3 }} hide={!amountVis.retail_revenue_wan} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        }
    };

    // ====== 渲染：右图 ======
    const renderRightChart = () => {
        if (chartData.length === 0) return null;

        if (chartView === 'price') {
            // 日批零价差柱图 + 累计均价差曲线
            return (
                <Box ref={rightChartRef} sx={chartBoxSx(isRightFs)}>
                    <RightFsEnter /><RightFsExit /><RightFsTitle /><RightNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }}
                                label={{ value: '元/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }}
                                label={{ value: '累计均价差', angle: 90, position: 'insideRight', style: { fontSize: 12 } }} />
                            <Tooltip formatter={(value: number, name: string) => [`${value.toFixed(2)} 元/MWh`, name]}
                                labelFormatter={(label: string) => `日期: ${label}`} />
                            <Legend onClick={onSpreadLegend} />
                            <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                            <Bar yAxisId="left" dataKey="price_spread" name="日批零价差" hide={!spreadVis.price_spread}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`s-${index}`} fill={entry.price_spread >= 0 ? '#4caf50' : '#f44336'} />
                                ))}
                            </Bar>
                            <Line yAxisId="right" type="monotone" dataKey="cumulative_avg_spread" name="累计均价差"
                                stroke="#ff9800" strokeWidth={2} dot={{ r: 3 }} hide={!spreadVis.cumulative_avg_spread} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        } else {
            // 日毛利柱图 + 累计毛利曲线（万元）
            return (
                <Box ref={rightChartRef} sx={chartBoxSx(isRightFs)}>
                    <RightFsEnter /><RightFsExit /><RightFsTitle /><RightNavBtns />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12 }}
                                label={{ value: '万元', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }}
                                label={{ value: '累计(万元)', angle: 90, position: 'insideRight', style: { fontSize: 12 } }} />
                            <Tooltip formatter={(value: number, name: string) => [`${value.toFixed(2)} 万元`, name]}
                                labelFormatter={(label: string) => `日期: ${label}`} />
                            <Legend onClick={onProfitLegend} />
                            <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                            <Bar yAxisId="left" dataKey="daily_profit_wan" name="日毛利" hide={!profitVis.daily_profit_wan}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`p-${index}`} fill={entry.daily_profit_wan >= 0 ? '#4caf50' : '#f44336'} />
                                ))}
                            </Bar>
                            <Line yAxisId="right" type="monotone" dataKey="cumulative_profit_wan" name="累计毛利"
                                stroke="#ff9800" strokeWidth={2} dot={{ r: 3 }} hide={!profitVis.cumulative_profit_wan} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Box>
            );
        }
    };

    // ====== 移动端卡片 ======
    const renderMobileCards = () => {
        if (!data) return null;
        const s = data.summary;
        return (
            <Box sx={{ mt: 1 }}>
                {data.daily_details.map((d) => (
                    <Card key={d.date} variant="outlined" sx={{ mb: 1 }}>
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="subtitle2" fontWeight="bold">{d.date.substring(5)}</Typography>
                                <Typography variant="subtitle2" sx={{ color: profitColor(d.daily_profit) }}>
                                    毛利 {formatYuan(d.daily_profit)}
                                </Typography>
                            </Box>
                            <Divider sx={{ my: 0.5 }} />
                            <Grid container spacing={0.5}>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">电量</Typography>
                                    <Typography variant="body2">{d.volume_mwh.toFixed(1)} MWh</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">批零价差</Typography>
                                    <Typography variant="body2" sx={{ color: profitColor(d.price_spread) }}>
                                        {d.price_spread > 0 ? '+' : ''}{d.price_spread.toFixed(2)}
                                    </Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">批发成本</Typography>
                                    <Typography variant="body2">{formatYuan(d.wholesale_cost)}</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">零售收入</Typography>
                                    <Typography variant="body2">{formatYuan(d.retail_revenue)}</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">购电均价</Typography>
                                    <Typography variant="body2">{d.wholesale_avg_price.toFixed(2)}</Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="caption" color="text.secondary">售电均价</Typography>
                                    <Typography variant="body2">{d.retail_avg_price.toFixed(2)}</Typography>
                                </Grid>
                            </Grid>
                        </CardContent>
                    </Card>
                ))}
                <Card variant="outlined" sx={{ mb: 1, backgroundColor: 'action.hover' }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5 }}>月度累计</Typography>
                        <Divider sx={{ my: 0.5 }} />
                        <Grid container spacing={0.5}>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总电量</Typography>
                                <Typography variant="body2">{s.total_volume_mwh.toFixed(1)} MWh</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">毛利</Typography>
                                <Typography variant="body2" sx={{ color: profitColor(s.gross_profit), fontWeight: 'bold' }}>
                                    {formatYuan(s.gross_profit)}
                                </Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总成本</Typography>
                                <Typography variant="body2">{formatYuan(s.total_wholesale_cost)}</Typography>
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <Typography variant="caption" color="text.secondary">总收入</Typography>
                                <Typography variant="body2">{formatYuan(s.total_retail_revenue)}</Typography>
                            </Grid>
                        </Grid>
                    </CardContent>
                </Card>
            </Box>
        );
    };

    // ====== 桌面端表格 ======
    const renderDesktopTable = () => {
        if (!data) return null;
        const s = data.summary;
        return (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, overflowX: 'auto' }}>
                <Table size="small" sx={{
                    '& .MuiTableCell-root': {
                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                        px: { xs: 0.5, sm: 1.5 }, whiteSpace: 'nowrap',
                    },
                }}>
                    <TableHead>
                        <TableRow sx={{ backgroundColor: 'action.hover' }}>
                            <TableCell>日期</TableCell>
                            <TableCell align="right">电量(MWh)</TableCell>
                            <TableCell align="right">批发成本(元)</TableCell>
                            <TableCell align="right">偏差回收(元)</TableCell>
                            <TableCell align="right">购电均价</TableCell>
                            <TableCell align="right">零售收入(元)</TableCell>
                            <TableCell align="right">售电均价</TableCell>
                            <TableCell align="right">价差</TableCell>
                            <TableCell align="right">日毛利(元)</TableCell>
                            <TableCell align="right">累计毛利(元)</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {data.daily_details.map((d) => (
                            <TableRow key={d.date} hover>
                                <TableCell>{d.date.substring(5)}</TableCell>
                                <TableCell align="right">{d.volume_mwh.toFixed(1)}</TableCell>
                                <TableCell align="right">{formatYuan(d.wholesale_cost)}</TableCell>
                                <TableCell align="right">{formatYuan(d.deviation_recovery_fee)}</TableCell>
                                <TableCell align="right">{d.wholesale_avg_price.toFixed(2)}</TableCell>
                                <TableCell align="right">{formatYuan(d.retail_revenue)}</TableCell>
                                <TableCell align="right">{d.retail_avg_price.toFixed(2)}</TableCell>
                                <TableCell align="right" sx={{ color: profitColor(d.price_spread) }}>
                                    {d.price_spread > 0 ? '+' : ''}{d.price_spread.toFixed(2)}
                                </TableCell>
                                <TableCell align="right" sx={{ color: profitColor(d.daily_profit) }}>
                                    {formatYuan(d.daily_profit)}
                                </TableCell>
                                <TableCell align="right">{formatYuan(d.cumulative_profit)}</TableCell>
                            </TableRow>
                        ))}
                        <TableRow sx={{ backgroundColor: 'action.selected', '& .MuiTableCell-root': { fontWeight: 'bold' } }}>
                            <TableCell>月累计</TableCell>
                            <TableCell align="right">{s.total_volume_mwh.toFixed(1)}</TableCell>
                            <TableCell align="right">{formatYuan(s.total_wholesale_cost)}</TableCell>
                            <TableCell align="right">{formatYuan(s.total_deviation_recovery_fee)}</TableCell>
                            <TableCell align="right">{s.wholesale_avg_price.toFixed(2)}</TableCell>
                            <TableCell align="right">{formatYuan(s.total_retail_revenue)}</TableCell>
                            <TableCell align="right">{s.retail_avg_price.toFixed(2)}</TableCell>
                            <TableCell align="right" sx={{ color: profitColor(s.price_spread) }}>
                                {s.price_spread > 0 ? '+' : ''}{s.price_spread.toFixed(2)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: profitColor(s.gross_profit) }}>
                                {formatYuan(s.gross_profit)}
                            </TableCell>
                            <TableCell align="right">{formatYuan(s.gross_profit)}</TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };

    // ====== 主渲染 ======
    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {isTablet && (
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}>
                        结算管理 / 预结算总览
                    </Typography>
                )}

                {/* 控制栏 */}
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftMonth(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <DatePicker
                        label="选择月份"
                        value={selectedMonth}
                        onChange={(date) => setSelectedMonth(date)}
                        views={['year', 'month']}
                        minDate={new Date(2026, 0, 1)}
                        disabled={loading}
                        slotProps={{ textField: { sx: { width: { xs: '150px', sm: '200px' } } } }}
                    />
                    <IconButton onClick={() => handleShiftMonth(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>

                    {/* 版本选择 — 桌面端推到右侧 */}
                    <Box sx={{ flexGrow: 1 }} />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>版本</InputLabel>
                        <Select value={version} label="版本" onChange={handleVersionChange} disabled={loading}>
                            {VERSION_OPTIONS.map(opt => (
                                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Paper>

                {/* 首次加载 */}
                {loading && !data ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
                ) : data ? (
                    <Box sx={{ position: 'relative' }}>
                        {loading && (
                            <Box sx={{
                                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                backgroundColor: 'rgba(255, 255, 255, 0.7)', zIndex: 1000,
                            }}>
                                <CircularProgress />
                            </Box>
                        )}

                        {/* 汇总卡片 */}
                        <Box sx={{ mt: 2 }}>{renderSummaryCards()}</Box>

                        {/* 图表面板 — 一个 Paper 内含切换 + 两图并列 */}
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                                <Typography variant="h6">
                                    {chartView === 'price' ? '价格走势' : '收益走势'}
                                </Typography>
                                <ToggleButtonGroup
                                    value={chartView}
                                    exclusive
                                    onChange={(_, val) => val && setChartView(val)}
                                    size="small"
                                >
                                    <ToggleButton value="price">价格</ToggleButton>
                                    <ToggleButton value="amount">收益</ToggleButton>
                                </ToggleButtonGroup>
                            </Box>
                            <Grid container spacing={{ xs: 1, sm: 2 }}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    {renderLeftChart()}
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    {renderRightChart()}
                                </Grid>
                            </Grid>
                        </Paper>

                        {/* 明细：桌面端无标题直接表格，移动端有标题+卡片 */}
                        {isMobile && <Typography variant="h6" sx={{ mt: 2 }}>日度明细</Typography>}
                        {isMobile ? renderMobileCards() : renderDesktopTable()}
                    </Box>
                ) : null}
            </Box>
        </LocalizationProvider>
    );
};

export default PreSettlementOverviewPage;
