import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Box, Grid, Paper, Typography, CircularProgress, Alert, IconButton,
    useMediaQuery, Theme, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Card, CardContent, Divider,
    ToggleButtonGroup, ToggleButton, Button, Link, alpha
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import BoltIcon from '@mui/icons-material/Bolt';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MonetizationOnOutlinedIcon from '@mui/icons-material/MonetizationOnOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import { format, addYears } from 'date-fns';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell, ReferenceLine
} from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useSelectableSeries } from '../hooks/useSelectableSeries';
import { useNavigate } from 'react-router-dom';
import { useTabContext } from '../contexts/TabContext';
import MonthlySettlementAnalysisPage from './MonthlySettlementAnalysisPage';

// ====== 类型定义 ======
interface MonthlyDataRow {
    month: string;
    customer_count: number | null;
    total_energy_mwh: number | null;
    wholesale_total_cost: number | null;
    retail_total_fee: number | null; // 最终阶段收入
    gross_profit: number | null;
    wholesale_avg_price: number | null;
    retail_avg_price: number | null; // 最终阶段均价
    price_spread: number | null;
    excess_refund_fee: number | null;
    cumulative_profit: number | null;
}

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
    value: string | number;
    subValue?: string;
    extraValue?: string;
    icon: React.ReactElement;
    color: string;
}> = ({ title, value, subValue, extraValue, icon, color }) => (
    <Paper
        variant="outlined"
        sx={{
            p: 1.5,
            height: '100%',
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            position: 'relative',
            border: '1px solid',
            borderColor: alpha(color, 0.2),
            background: `linear-gradient(135deg, ${alpha(color, 0.02)} 0%, ${alpha(color, 0.05)} 100%)`,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: `0 8px 24px ${alpha(color, 0.12)}`,
                borderColor: alpha(color, 0.4)
            }
        }}
    >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Box sx={{ color, p: 0.8, borderRadius: '10px', bgcolor: alpha(color, 0.1), mr: 1, display: 'flex' }}>
                {React.cloneElement(icon as React.ReactElement<any>, { sx: { fontSize: 20 } })}
            </Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.5 }}>
                {title}
            </Typography>
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', lineHeight: 1.2 }}>
            {value}
        </Typography>

        {subValue && (
            <Typography variant="caption" sx={{ mt: 0.5, fontWeight: 500, color: 'text.secondary' }}>
                {subValue}
            </Typography>
        )}

        {extraValue && (
            <Typography
                variant="caption"
                sx={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
                    fontWeight: 800,
                    color: color,
                    bgcolor: alpha(color, 0.1),
                    px: 0.8,
                    py: 0.2,
                    borderRadius: 1
                }}
            >
                {extraValue}
            </Typography>
        )}
    </Paper>
);

// ====== 工具函数 ======
const formatWanYuan = (val: number): string => `${(val / 10000).toFixed(2)}万`;
const formatYuan = (val: number | null): string => val !== null ? val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
const formatNumber = (val: number | null, digits = 2): string => val !== null ? val.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '-';
const profitColor = (val: number | null): string => {
    if (val === null) return 'text.primary';
    return val >= 0 ? '#4caf50' : '#f44336';
};

// Tooltip 格式化函数
const calculateAxisDomain = (values: Array<number | null | undefined>): [number, number] | undefined => {
    const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (numericValues.length === 0) {
        return undefined;
    }

    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);

    if (min === max) {
        const padding = Math.max(Math.abs(min) * 0.1, 1);
        return [min - padding, max + padding];
    }

    const padding = Math.max((max - min) * 0.1, 0.1);
    return [min - padding, max + padding];
};

const formatAxisTick = (value: number | string): string => {
    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue.toFixed(1) : String(value);
};

const tooltipFormatter = (value: any, name: string) => {
    if (value === null || value === undefined) return ['-', name];
    const val = Number(value);
    // 根据名称判断是价格还是金额/电量
    const isPrice = name.includes('均价') || name.includes('价差');
    return [isPrice ? val.toFixed(3) : val.toFixed(2), name];
};

// ====== 主组件 ======
export const MonthlySettlementOverviewPage: React.FC = () => {
    const isTablet = useMediaQuery((t: Theme) => t.breakpoints.down('md'));
    const isMobile = useMediaQuery((t: Theme) => t.breakpoints.down('sm'));

    const [selectedYear, setSelectedYear] = useState<Date | null>(new Date());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [monthlyRows, setMonthlyRows] = useState<MonthlyDataRow[]>([]);
    const [chartView, setChartView] = useState<ChartViewMode>('price');

    const leftChartRef = useRef<HTMLDivElement>(null);
    const rightChartRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const tabContext = useTabContext();

    const yearStr = selectedYear ? format(selectedYear, 'yyyy') : '';

    const handleShiftYear = (offset: number) => {
        if (!selectedYear) return;
        setSelectedYear(addYears(selectedYear, offset));
    };

    // 获取数据并合并
    const fetchData = useCallback(async () => {
        if (!selectedYear) return;
        setLoading(true);
        setError(null);
        const year = format(selectedYear, 'yyyy');
        try {
            const [wsRes, rtRes] = await Promise.all([
                apiClient.get(`/api/v1/wholesale-monthly-settlement/year/${year}`),
                apiClient.get(`/api/v1/retail-settlement/monthly-summaries`, { params: { year } })
            ]);

            const wsRows = wsRes.data?.rows || [];
            const rtSummaries = rtRes.data?.data?.summaries || [];

            const months = Array.from({ length: 12 }, (_, i) => `${year}-${(i + 1).toString().padStart(2, '0')}`);

            let currentCumulativeProfit = 0;
            const combined: MonthlyDataRow[] = months.map(m => {
                const ws = wsRows.find((r: any) => r.month === m);
                const rt = rtSummaries.find((s: any) => s.month === m);

                // 判断该月是否有有效结算数据
                const hasWs = !!ws && ws.settlement_items && Object.keys(ws.settlement_items).length > 0;
                const hasRt = !!rt && rt.total_energy_mwh > 0;

                if (!hasWs && !hasRt) {
                    return {
                        month: m,
                        customer_count: null,
                        total_energy_mwh: null,
                        wholesale_total_cost: null,
                        retail_total_fee: null,
                        gross_profit: null,
                        wholesale_avg_price: null,
                        retail_avg_price: null,
                        price_spread: null,
                        excess_refund_fee: null,
                        cumulative_profit: null
                    };
                }

                // 取值逻辑：购电取批发台账，售电取零售最终结算（ settlement_total_fee / settlement_avg_price ）
                const wholesale_total_cost = ws?.settlement_items?.settlement_fee_total ?? null;
                const retail_total_fee = rt?.settlement_total_fee ?? null;
                const total_energy_mwh = rt?.total_energy_mwh ?? null;
                const gross_profit = (retail_total_fee !== null && wholesale_total_cost !== null)
                    ? retail_total_fee - wholesale_total_cost
                    : null;

                const isSettled = gross_profit !== null;

                if (isSettled) {
                    currentCumulativeProfit += gross_profit;
                }

                const retail_avg_price = (isSettled && total_energy_mwh && total_energy_mwh > 0)
                    ? retail_total_fee! / total_energy_mwh!
                    : null;

                return {
                    month: m,
                    customer_count: isSettled ? (rt?.customer_count ?? null) : null,
                    total_energy_mwh: isSettled ? (rt?.total_energy_mwh ?? null) : null,
                    wholesale_total_cost: wholesale_total_cost,
                    retail_total_fee: retail_total_fee,
                    gross_profit: gross_profit,
                    wholesale_avg_price: ws?.settlement_items?.settlement_avg_price ?? null,
                    retail_avg_price: retail_avg_price,
                    price_spread: (retail_avg_price !== null && ws?.settlement_items?.settlement_avg_price)
                        ? retail_avg_price - ws.settlement_items.settlement_avg_price
                        : null,
                    excess_refund_fee: isSettled ? (rt?.status?.excess_refund_pool ?? null) : null,
                    cumulative_profit: isSettled ? currentCumulativeProfit : null
                };
            });

            setMonthlyRows(combined);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载年度数据失败');
        } finally {
            setLoading(false);
        }
    }, [selectedYear]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const navigateToDetail = (month: string) => {
        const path = `/settlement/monthly-analysis?month=${month}`;
        if (isMobile) {
            navigate(path);
        } else if (tabContext) {
            tabContext.addTab({
                key: path,
                title: `月度结算详情 ${month}`,
                path: path,
                component: <MonthlySettlementAnalysisPage initialMonth={month} />,
            });
        }
    };

    // ====== 年度汇总指标与合计行 ======
    const yearlySummary = useMemo(() => {
        // 只有计算出了毛利的月份才参与年度累计计算（表示已完全结算）
        const finalizedRows = monthlyRows.filter(r => r.gross_profit !== null);
        const totalEnergy = finalizedRows.reduce((sum, r) => sum + (r.total_energy_mwh ?? 0), 0);
        const totalCost = finalizedRows.reduce((sum, r) => sum + (r.wholesale_total_cost ?? 0), 0);
        const totalRevenue = finalizedRows.reduce((sum, r) => sum + (r.retail_total_fee ?? 0), 0);
        const totalProfit = totalRevenue - totalCost;
        const totalRefund = finalizedRows.reduce((sum, r) => sum + (r.excess_refund_fee ?? 0), 0);
        const avgWholesale = totalEnergy > 0 ? totalCost / totalEnergy : 0;
        const avgRetail = totalEnergy > 0 ? totalRevenue / totalEnergy : 0;

        // 客户数量的累计值取最后一个已结算月的数据
        const lastCustomerCount = finalizedRows.length > 0 ? finalizedRows[finalizedRows.length - 1].customer_count ?? 0 : 0;

        return {
            customerCount: lastCustomerCount,
            totalEnergy,
            totalCost,
            totalRevenue,
            totalProfit,
            totalRefund,
            avgWholesale,
            avgRetail,
            priceSpread: avgRetail - avgWholesale,
            hasData: finalizedRows.length > 0
        };
    }, [monthlyRows]);

    // ====== 图表全屏 Hooks ======
    const { isFullscreen: isLeftFs, FullscreenEnterButton: LeftFsEnter, FullscreenExitButton: LeftFsExit, FullscreenTitle: LeftFsTitle, NavigationButtons: LeftNavBtns } = useChartFullscreen({
        chartRef: leftChartRef,
        title: chartView === 'price' ? `年度量价走势 (${yearStr})` : `购电成本/售电收入走势 (${yearStr})`,
        onPrevious: () => handleShiftYear(-1),
        onNext: () => handleShiftYear(1),
    });

    const { isFullscreen: isRightFs, FullscreenEnterButton: RightFsEnter, FullscreenExitButton: RightFsExit, FullscreenTitle: RightFsTitle, NavigationButtons: RightNavBtns } = useChartFullscreen({
        chartRef: rightChartRef,
        title: chartView === 'price' ? `月度价差走势 (${yearStr})` : `月度毛利与累计毛利 (${yearStr})`,
        onPrevious: () => handleShiftYear(-1),
        onNext: () => handleShiftYear(1),
    });

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

    // ====== 图表数据转换 ======
    const chartData = useMemo(() => {
        return monthlyRows.map((r, idx, arr) => {
            const label = r.month.substring(5) + '月';
            const wholesale_cost_wan = r.wholesale_total_cost !== null ? r.wholesale_total_cost / 10000 : null;
            const retail_revenue_wan = r.retail_total_fee !== null ? r.retail_total_fee / 10000 : null;
            const daily_profit_wan = r.gross_profit !== null ? r.gross_profit / 10000 : null;

            let cumEnergy = 0, cumProfit = 0;
            let hasFinalizedData = false;
            for (let i = 0; i <= idx; i++) {
                if (arr[i].gross_profit !== null) {
                    cumEnergy += arr[i].total_energy_mwh ?? 0;
                    cumProfit += arr[i].gross_profit ?? 0;
                    hasFinalizedData = true;
                }
            }

            const isCurrentSettled = r.gross_profit !== null;
            const cumulative_profit_wan = isCurrentSettled ? cumProfit / 10000 : null;
            const cumulativeAvgSpread = (isCurrentSettled && cumEnergy > 0) ? cumProfit / cumEnergy : null;

            return {
                ...r,
                monthLabel: label,
                wholesale_cost_wan,
                retail_revenue_wan,
                daily_profit_wan,
                cumulative_profit_wan,
                cumulative_avg_spread: cumulativeAvgSpread !== null ? parseFloat(cumulativeAvgSpread.toFixed(3)) : null
            };
        });
    }, [monthlyRows]);

    const leftChartAxisDomain = useMemo(() => {
        const values: Array<number | null | undefined> = [];

        if (chartView === 'price') {
            if (priceVis.wholesale_avg_price) {
                values.push(...chartData.map(item => item.wholesale_avg_price));
            }
            if (priceVis.retail_avg_price) {
                values.push(...chartData.map(item => item.retail_avg_price));
            }
        } else {
            if (amountVis.wholesale_cost_wan) {
                values.push(...chartData.map(item => item.wholesale_cost_wan));
            }
            if (amountVis.retail_revenue_wan) {
                values.push(...chartData.map(item => item.retail_revenue_wan));
            }
        }

        return calculateAxisDomain(values);
    }, [amountVis.retail_revenue_wan, amountVis.wholesale_cost_wan, chartData, chartView, priceVis.retail_avg_price, priceVis.wholesale_avg_price]);

    const rightLeftAxisDomain = useMemo(() => {
        const values = chartView === 'price'
            ? (spreadVis.price_spread ? chartData.map(item => item.price_spread) : [])
            : (profitVis.daily_profit_wan ? chartData.map(item => item.daily_profit_wan) : []);

        return calculateAxisDomain(values);
    }, [chartData, chartView, profitVis.daily_profit_wan, spreadVis.price_spread]);

    const rightRightAxisDomain = useMemo(() => {
        const values = chartView === 'price'
            ? (spreadVis.cumulative_avg_spread ? chartData.map(item => item.cumulative_avg_spread) : [])
            : (profitVis.cumulative_profit_wan ? chartData.map(item => item.cumulative_profit_wan) : []);

        return calculateAxisDomain(values);
    }, [chartData, chartView, profitVis.cumulative_profit_wan, spreadVis.cumulative_avg_spread]);

    const chartBoxSx = (isFs: boolean) => ({
        height: { xs: 300, sm: 350 },
        position: 'relative' as const,
        backgroundColor: isFs ? 'background.paper' : 'transparent',
        p: isFs ? 2 : 0,
        ...(isFs && { position: 'fixed' as const, top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
        '& .recharts-wrapper:focus': { outline: 'none' },
    });

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ p: { xs: 1, sm: 2 } }}>
                {/* 移动端面包屑标题 */}
                {isMobile && (
                    <Typography
                        variant="subtitle1"
                        sx={{
                            mb: 2,
                            fontWeight: 'bold',
                            color: 'text.primary'
                        }}
                    >
                        结算管理 / 月度结算总览
                    </Typography>
                )}
                {/* 统计指标卡片 */}

                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftYear(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <DatePicker
                        label="选择年份"
                        value={selectedYear}
                        onChange={(date) => setSelectedYear(date)}
                        views={['year']}
                        disabled={loading}
                        slotProps={{ textField: { sx: { width: { xs: '150px', sm: '200px' } } } }}
                    />
                    <IconButton onClick={() => handleShiftYear(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>
                </Paper>

                {loading && monthlyRows.length === 0 ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
                ) : (
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

                        {/* KPI 卡片 */}
                        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <StatCard title="年度客户" value={yearlySummary.hasData ? yearlySummary.customerCount : '-'} subValue="户" icon={<PeopleAltOutlinedIcon />} color="#673ab7" />
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <StatCard title="年度电量" value={yearlySummary.hasData ? formatNumber(yearlySummary.totalEnergy, 2) : '-'} subValue="MWh" icon={<BoltOutlinedIcon />} color="#ff9800" />
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <StatCard title="年度毛利" value={yearlySummary.hasData ? formatWanYuan(yearlySummary.totalProfit) : '-'} subValue="万元" icon={<TrendingUpOutlinedIcon />} color={profitColor(yearlySummary.totalProfit)} />
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <StatCard title="批发均价" value={yearlySummary.hasData ? yearlySummary.avgWholesale.toFixed(3) : '-'} subValue="元/MWh" icon={<PriceChangeOutlinedIcon />} color="#1976d2" />
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <StatCard title="零售均价" value={yearlySummary.hasData ? yearlySummary.avgRetail.toFixed(3) : '-'} subValue="元/MWh" icon={<StorefrontOutlinedIcon />} color="#2e7d32" />
                            </Grid>
                            <Grid size={{ xs: 6, md: 2 }}>
                                <StatCard title="年批零价差" value={yearlySummary.hasData ? (yearlySummary.priceSpread >= 0 ? '+' : '') + yearlySummary.priceSpread.toFixed(3) : '-'} subValue="元/MWh" icon={<CompareArrowsOutlinedIcon />} color={profitColor(yearlySummary.priceSpread)} />
                            </Grid>
                        </Grid>

                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                                <Typography variant="h6">走势分析</Typography>
                                <ToggleButtonGroup value={chartView} exclusive onChange={(_, v) => v && setChartView(v)} size="small">
                                    <ToggleButton value="price">价格视图</ToggleButton>
                                    <ToggleButton value="amount">金额视图</ToggleButton>
                                </ToggleButtonGroup>
                            </Box>

                            <Grid container spacing={{ xs: 1, sm: 2 }}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box ref={leftChartRef} sx={chartBoxSx(isLeftFs)}>
                                        <LeftFsEnter /><LeftFsExit /><LeftFsTitle /><LeftNavBtns />
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="monthLabel" />
                                                <YAxis
                                                    domain={leftChartAxisDomain}
                                                    tickFormatter={formatAxisTick}
                                                    label={{ value: chartView === 'price' ? '元/MWh' : '万元', angle: -90, position: 'insideLeft' }}
                                                />
                                                <Tooltip formatter={tooltipFormatter} />
                                                <Legend onClick={chartView === 'price' ? onPriceLegend : onAmountLegend} />
                                                {chartView === 'price' ? (
                                                    <>
                                                        <Line type="monotone" dataKey="wholesale_avg_price" name="购电均价" stroke="#1976d2" hide={!priceVis.wholesale_avg_price} />
                                                        <Line type="monotone" dataKey="retail_avg_price" name="售电均价" stroke="#4caf50" hide={!priceVis.retail_avg_price} />
                                                    </>
                                                ) : (
                                                    <>
                                                        <Line type="monotone" dataKey="wholesale_cost_wan" name="购电成本" stroke="#1976d2" hide={!amountVis.wholesale_cost_wan} />
                                                        <Line type="monotone" dataKey="retail_revenue_wan" name="售电收入" stroke="#4caf50" hide={!amountVis.retail_revenue_wan} />
                                                    </>
                                                )}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </Box>
                                </Grid>

                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box ref={rightChartRef} sx={chartBoxSx(isRightFs)}>
                                        <RightFsEnter /><RightFsExit /><RightFsTitle /><RightNavBtns />
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={chartData}>
                                                <CartesianGrid strokeDasharray="3 3" />
                                                <XAxis dataKey="monthLabel" />
                                                <YAxis
                                                    yAxisId="left"
                                                    domain={rightLeftAxisDomain}
                                                    tickFormatter={formatAxisTick}
                                                    label={{ value: chartView === 'price' ? '价差' : '月毛利(万)', angle: -90, position: 'insideLeft' }}
                                                />
                                                <YAxis
                                                    yAxisId="right"
                                                    orientation="right"
                                                    domain={rightRightAxisDomain}
                                                    tickFormatter={formatAxisTick}
                                                    label={{ value: '累计', angle: 90, position: 'insideRight' }}
                                                />
                                                <Tooltip formatter={tooltipFormatter} />
                                                <Legend onClick={chartView === 'price' ? onSpreadLegend : onProfitLegend} />
                                                <ReferenceLine yAxisId="left" y={0} stroke="#999" />
                                                {chartView === 'price' ? (
                                                    <>
                                                        <Bar yAxisId="left" dataKey="price_spread" name="月度价差" hide={!spreadVis.price_spread}>
                                                            {chartData.map((e, i) => <Cell key={i} fill={profitColor(e.price_spread ?? 0)} />)}
                                                        </Bar>
                                                        <Line yAxisId="right" type="monotone" dataKey="cumulative_avg_spread" name="累计均价差" stroke="#ff9800" hide={!spreadVis.cumulative_avg_spread} />
                                                    </>
                                                ) : (
                                                    <>
                                                        <Bar yAxisId="left" dataKey="daily_profit_wan" name="当月毛利" hide={!profitVis.daily_profit_wan}>
                                                            {chartData.map((e, i) => <Cell key={i} fill={profitColor(e.gross_profit ?? 0)} />)}
                                                        </Bar>
                                                        <Line yAxisId="right" type="monotone" dataKey="cumulative_profit_wan" name="累计年度毛利" stroke="#ff9800" hide={!profitVis.cumulative_profit_wan} />
                                                    </>
                                                )}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Paper>

                        <Box sx={{ mt: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 1 }}>
                                <Typography variant="h6">月度结算台账 ({yearStr})</Typography>
                                {!isMobile && (
                                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                                        单位说明：金额(元) | 电量(MWh) | 均价(元/MWh)
                                    </Typography>
                                )}
                            </Box>

                            {isMobile ? (
                                <Box>
                                    {monthlyRows.map(r => (
                                        <Card key={r.month} variant="outlined" sx={{ mb: 1.5, opacity: r.gross_profit === null ? 0.6 : 1 }}>
                                            <CardContent sx={{ p: 1.5 }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 0.5 }}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{r.month}</Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: profitColor(r.gross_profit) }}>
                                                        {r.gross_profit !== null ? `毛利: ${formatWanYuan(r.gross_profit)}` : '-'}
                                                    </Typography>
                                                </Box>
                                                <Grid container spacing={1.5}>
                                                    <Grid size={{ xs: 6 }}>
                                                        <Typography variant="caption" color="text.secondary">客户数 | 电量(MWh)</Typography>
                                                        <Typography variant="body2">{formatNumber(r.customer_count, 0)} | {formatNumber(r.total_energy_mwh, 2)}</Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 6 }}>
                                                        <Typography variant="caption" color="text.secondary">累计毛利</Typography>
                                                        <Typography variant="body2" sx={{ color: profitColor(r.cumulative_profit), fontWeight: 'bold' }}>
                                                            {formatWanYuan(r.cumulative_profit ?? 0)}
                                                        </Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 4 }}>
                                                        <Typography variant="caption" color="text.secondary">购电均价</Typography>
                                                        <Typography variant="body2">{formatNumber(r.wholesale_avg_price, 3)}</Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 4 }}>
                                                        <Typography variant="caption" color="text.secondary">售电均价</Typography>
                                                        <Typography variant="body2">{formatNumber(r.retail_avg_price, 3)}</Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 4 }}>
                                                        <Typography variant="caption" color="text.secondary">价差</Typography>
                                                        <Typography variant="body2" sx={{ color: profitColor(r.price_spread), fontWeight: 'bold' }}>
                                                            {r.price_spread !== null ? (r.price_spread > 0 ? '+' : '') + r.price_spread.toFixed(3) : '-'}
                                                        </Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 4 }}>
                                                        <Typography variant="caption" color="text.secondary">批发成本</Typography>
                                                        <Typography variant="body2">{formatWanYuan(r.wholesale_total_cost ?? 0)}</Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 4 }}>
                                                        <Typography variant="caption" color="text.secondary">零售收入</Typography>
                                                        <Typography variant="body2">{formatWanYuan(r.retail_total_fee ?? 0)}</Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 4 }}>
                                                        <Typography variant="caption" color="text.secondary">超额返还</Typography>
                                                        <Typography variant="body2" sx={{ color: 'success.main' }}>{formatWanYuan(r.excess_refund_fee ?? 0)}</Typography>
                                                    </Grid>
                                                    <Grid size={{ xs: 12 }}>
                                                        <Button size="small" fullWidth variant="outlined" onClick={() => navigateToDetail(r.month)} sx={{ mt: 0.5 }}>查看详情</Button>
                                                    </Grid>
                                                </Grid>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </Box>
                            ) : (
                                <TableContainer component={Paper} variant="outlined">
                                    <Table size="small" sx={{
                                        '& .MuiTableCell-root': { fontSize: '0.8rem' },
                                        '& .MuiTableHead-root .MuiTableCell-root': { fontWeight: 'bold' }
                                    }}>
                                        <TableHead>
                                            <TableRow sx={{ bgcolor: 'action.hover' }}>
                                                <TableCell>月份</TableCell>
                                                <TableCell align="right">客户数</TableCell>
                                                <TableCell align="right">电量</TableCell>
                                                <TableCell align="right">批发成本</TableCell>
                                                <TableCell align="right">购电均价</TableCell>
                                                <TableCell align="right">零售收入</TableCell>
                                                <TableCell align="right">售电均价</TableCell>
                                                <TableCell align="right">超额返还</TableCell>
                                                <TableCell align="right">价差</TableCell>
                                                <TableCell align="right">月度毛利</TableCell>
                                                <TableCell align="right">累计毛利</TableCell>
                                                <TableCell align="center">操作</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {monthlyRows.map(r => (
                                                <TableRow key={r.month} hover sx={{ opacity: r.gross_profit === null ? 0.7 : 1 }}>
                                                    <TableCell sx={{ fontWeight: 500 }}>{r.month}</TableCell>
                                                    <TableCell align="right">{formatNumber(r.customer_count, 0)}</TableCell>
                                                    <TableCell align="right">{formatNumber(r.total_energy_mwh, 2)}</TableCell>
                                                    <TableCell align="right">{formatYuan(r.wholesale_total_cost)}</TableCell>
                                                    <TableCell align="right">{formatNumber(r.wholesale_avg_price, 3)}</TableCell>
                                                    <TableCell align="right">{formatYuan(r.retail_total_fee)}</TableCell>
                                                    <TableCell align="right">{formatNumber(r.retail_avg_price, 3)}</TableCell>
                                                    <TableCell align="right" sx={{ color: 'success.main' }}>{formatYuan(r.excess_refund_fee)}</TableCell>
                                                    <TableCell align="right" sx={{ color: profitColor(r.price_spread) }}>
                                                        {r.price_spread !== null ? (r.price_spread > 0 ? '+' : '') + r.price_spread.toFixed(3) : '-'}
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ color: profitColor(r.gross_profit), fontWeight: 600 }}>
                                                        {formatYuan(r.gross_profit)}
                                                    </TableCell>
                                                    <TableCell align="right" sx={{ color: profitColor(r.cumulative_profit) }}>
                                                        {formatYuan(r.cumulative_profit)}
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <Button size="small" variant="text" onClick={() => navigateToDetail(r.month)} sx={{ minWidth: 0 }}>查看详情</Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {/* 年度合计行 */}
                                            <TableRow sx={{ bgcolor: alpha('#1976d2', 0.05) }}>
                                                <TableCell sx={{ fontWeight: 'bold' }}>年度累计</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{yearlySummary.customerCount}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatNumber(yearlySummary.totalEnergy, 2)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatYuan(yearlySummary.totalCost)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{yearlySummary.avgWholesale.toFixed(3)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatYuan(yearlySummary.totalRevenue)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{yearlySummary.avgRetail.toFixed(3)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>{formatYuan(yearlySummary.totalRefund)}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold', color: profitColor(yearlySummary.priceSpread) }}>
                                                    {(yearlySummary.priceSpread >= 0 ? '+' : '') + yearlySummary.priceSpread.toFixed(3)}
                                                </TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold', color: profitColor(yearlySummary.totalProfit) }}>
                                                    {formatYuan(yearlySummary.totalProfit)}
                                                </TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold', color: profitColor(yearlySummary.totalProfit) }}>
                                                    {formatYuan(yearlySummary.totalProfit)}
                                                </TableCell>
                                                <TableCell align="center">-</TableCell>
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
        </LocalizationProvider>
    );
};
