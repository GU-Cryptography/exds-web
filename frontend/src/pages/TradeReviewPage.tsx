import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Card,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Grid,
    IconButton,
    Paper,
    Tab,
    Tabs,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableFooter,
    TableHead,
    TableRow,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { zhCN } from 'date-fns/locale';
import { format, parseISO } from 'date-fns';
import {
    Area,
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { tradeReviewApi } from '../api/tradeReview';
import { BatchDetailResponse, TradeDetailResponse, TradeOverviewResponse } from '../types/tradeReview';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useSelectableSeries } from '../hooks/useSelectableSeries';

const formatNumber = (value: number | null | undefined, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return '-';
    }
    return value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const formatSignedTrade = (value: number | null | undefined, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
        return `${formatNumber(value, digits)} MWh`;
    }
    return `${formatNumber(Math.abs(value), digits)} MWh（${value > 0 ? '买入' : '卖出'}）`;
};

const StatCard: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => (
    <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{title}</Typography>
            {lines.map((line) => (
                <Typography key={line} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>{line}</Typography>
            ))}
        </CardContent>
    </Card>
);

const EmptyState: React.FC<{ tradeDate: string }> = ({ tradeDate }) => (
    <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, my: 4, textAlign: 'center', borderRadius: 4, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <Box sx={{ p: 2, borderRadius: '50%', bgcolor: 'action.hover', color: 'text.disabled' }}>
            <CompareArrowsIcon sx={{ fontSize: { xs: 32, sm: 48 } }} />
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 800, fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{tradeDate} 暂无月内交易记录</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>当前选择的交易日没有可复盘的月内交易申报数据，请切换到其他交易日后再查看。</Typography>
    </Paper>
);

type ExecutionPriceSeriesKey = 'trade_avg_price' | 'market_monthly_price' | 'spot_price';
type ExecutionVolumeSeriesKey = 'actual_or_forecast_load_mwh' | 'annual_monthly_mwh' | 'monthly_mwh' | 'mechanism_mwh' | 'historical_buy_mwh' | 'historical_sell_mwh' | 'trade_day_buy_mwh' | 'trade_day_sell_mwh' | 'final_position_mwh';

const TRADE_PRICE_BUY_COLOR = '#43a047';
const TRADE_PRICE_SELL_COLOR = '#e53935';

const EXECUTION_PRICE_SERIES_META: Record<ExecutionPriceSeriesKey, { label: string; color: string }> = {
    trade_avg_price: { label: '成交均价', color: TRADE_PRICE_BUY_COLOR },
    spot_price: { label: '现货价格', color: '#90caf9' },
    market_monthly_price: { label: '市场均价', color: '#ffe082' },
};

const EXECUTION_VOLUME_SERIES_META: Record<ExecutionVolumeSeriesKey, { label: string; color: string }> = {
    actual_or_forecast_load_mwh: { label: '实际/预测电量', color: '#cfd8dc' },
    annual_monthly_mwh: { label: '年度分月', color: '#bbdefb' },
    monthly_mwh: { label: '月度', color: '#d1c4e9' },
    mechanism_mwh: { label: '机制', color: '#ffe0b2' },
    historical_buy_mwh: { label: '历史月内买入', color: '#c5e1a5' },
    historical_sell_mwh: { label: '历史月内卖出', color: '#ef9a9a' },
    trade_day_buy_mwh: { label: '当日月内买入', color: TRADE_PRICE_BUY_COLOR },
    trade_day_sell_mwh: { label: '当日月内卖出', color: TRADE_PRICE_SELL_COLOR },
    final_position_mwh: { label: '最终持仓', color: '#1e88e5' },
};
const DetailedExecutionTooltipContent: React.FC<{ row: any; label: number | string }> = ({ row, label }) => {
    if (!row) return null;

    const contractRatio = row.actual_or_forecast_load_mwh && row.actual_or_forecast_load_mwh !== 0 ? (row.final_position_mwh / row.actual_or_forecast_load_mwh) * 100 : null;

    return (
        <Paper elevation={0} sx={{ p: 2, minWidth: 320, borderRadius: 3, border: '1px solid rgba(30, 41, 59, 0.12)', background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)', boxShadow: '0 14px 36px rgba(15, 23, 42, 0.16)', backdropFilter: 'blur(10px)' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>时段 {label}</Typography>
            <Box sx={{ borderTop: '1px dashed rgba(148, 163, 184, 0.7)', my: 1 }} />
            <Box sx={{ display: 'grid', gap: 0.75 }}>
                <Typography variant="body2" sx={{ color: '#0f172a' }}>成交均价：<Box component="span" sx={{ fontWeight: 700 }}>{formatNumber(row.trade_avg_price, 3)} 元/MWh</Box>（{row.trade_count ?? 0}次）</Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>现货价格：{formatNumber(row.spot_price, 3)} 元/MWh</Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>市场均价：{formatNumber(row.market_monthly_price, 3)} 元/MWh</Typography>
            </Box>
            <Box sx={{ borderTop: '1px dashed rgba(148, 163, 184, 0.7)', my: 1.25 }} />
            <Box sx={{ display: 'grid', gap: 0.75 }}>
                <Typography variant="body2" sx={{ color: '#0f172a' }}>成交电量：<Box component="span" sx={{ fontWeight: 700 }}>{formatSignedTrade(row.trade_day_net_mwh, 2)}</Box></Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>历史成交：{formatSignedTrade(row.historical_within_month_net_mwh, 2)}</Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>基础持仓：年度：{formatNumber(row.annual_monthly_mwh, 2)} 月度：{formatNumber(row.monthly_mwh, 2)} 机制：{formatNumber(row.mechanism_mwh, 2)} MWh</Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>最终持仓：{formatNumber(row.final_position_mwh, 2)} MWh</Typography>
                <Typography variant="body2" sx={{ color: '#334155' }}>实际电量：{formatNumber(row.actual_or_forecast_load_mwh, 2)} MWh{row.load_source === 'forecast' ? '（预测）' : ''}</Typography>
                <Typography variant="body2" sx={{ color: '#0f172a' }}>签约比例：<Box component="span" sx={{ fontWeight: 700 }}>{formatNumber(contractRatio, 2)}%</Box></Typography>
            </Box>
        </Paper>
    );
};

const DetailedExecutionTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload.find((item: any) => item?.payload)?.payload || payload[0]?.payload;
    return row ? <DetailedExecutionTooltipContent row={row} label={label} /> : null;
};

const BatchTooltip: React.FC<any> = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    return (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{row.batch_action_type === 'listing' ? '上架批次' : '下架批次'} {row.batch_id}</Typography>
            <Typography variant="body2">开始：{row.batch_start_time}</Typography>
            <Typography variant="body2">结束：{row.batch_end_time}</Typography>
            <Typography variant="body2">记录数：{row.record_count}</Typography>
            <Typography variant="body2">覆盖时段：{row.covered_period_count}</Typography>
            <Typography variant="body2">申报电量：{formatNumber(row.batch_listing_mwh, 3)} MWh</Typography>
        </Paper>
    );
};

const BatchChartTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    if (!row) return null;

    return (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>时段 {label}</Typography>
            <Typography variant="body2">申报电量：{formatNumber(row.listing_mwh, 3)} MWh</Typography>
            <Typography variant="body2">挂牌价格：{formatNumber(row.listing_price, 3)} 元/MWh</Typography>
            <Typography variant="body2">市场均价：{formatNumber(row.market_monthly_price, 3)} 元/MWh</Typography>
            <Typography variant="body2">现货价格：{formatNumber(row.spot_price, 3)} 元/MWh</Typography>
            <Typography variant="body2">实际/预测电量：{formatNumber(row.actual_or_forecast_load_mwh, 3)} MWh</Typography>
        </Paper>
    );
};

export const TradeReviewPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const [selectedTradeDate, setSelectedTradeDate] = useState<Date | null>(null);
    const [availableTradeDates, setAvailableTradeDates] = useState<string[]>([]);
    const [overview, setOverview] = useState<TradeOverviewResponse | null>(null);
    const [detail, setDetail] = useState<TradeDetailResponse | null>(null);
    const [selectedDeliveryDate, setSelectedDeliveryDate] = useState('');
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [batchDetail, setBatchDetail] = useState<BatchDetailResponse | null>(null);
    const [executionTab, setExecutionTab] = useState(0);
    const [batchTab, setBatchTab] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadingBatch, setLoadingBatch] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const executionChartRef = useRef<HTMLDivElement>(null);
    const batchChartRef = useRef<HTMLDivElement>(null);
    const tradeDateStr = selectedTradeDate ? format(selectedTradeDate, 'yyyy-MM-dd') : '';
    const executionFullscreen = useChartFullscreen({ chartRef: executionChartRef, title: `月内交易成交分析 (${tradeDateStr} / ${selectedDeliveryDate || '-'})` });
    const batchFullscreen = useChartFullscreen({ chartRef: batchChartRef, title: `批次详情 (${selectedBatchId || '-'})` });

    const { seriesVisibility: executionPriceVisibility, handleLegendClick: handleExecutionPriceLegendClick } = useSelectableSeries<ExecutionPriceSeriesKey>({ trade_avg_price: true, spot_price: true, market_monthly_price: false });
    const { seriesVisibility: executionVolumeVisibility, handleLegendClick: handleExecutionVolumeLegendClick } = useSelectableSeries<ExecutionVolumeSeriesKey>({ actual_or_forecast_load_mwh: true, annual_monthly_mwh: true, monthly_mwh: true, mechanism_mwh: true, historical_buy_mwh: true, historical_sell_mwh: true, trade_day_buy_mwh: true, trade_day_sell_mwh: true, final_position_mwh: true });

    useEffect(() => {
        const loadTradeDates = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await tradeReviewApi.fetchTradeDates();
                setAvailableTradeDates(response.data.trade_dates || []);
                if (response.data.latest_trade_date) setSelectedTradeDate(parseISO(response.data.latest_trade_date));
            } catch (err: any) {
                setError(err.response?.data?.detail || err.message || '加载交易日列表失败');
            } finally {
                setLoading(false);
            }
        };
        loadTradeDates();
    }, []);

    useEffect(() => {
        setOverview(null);
        setDetail(null);
        setBatchDetail(null);
        setSelectedDeliveryDate('');
        setSelectedBatchId('');
    }, [tradeDateStr]);

    useEffect(() => {
        const loadOverview = async () => {
            if (!tradeDateStr) return;
            setLoading(true);
            setError(null);
            try {
                const response = await tradeReviewApi.fetchTradeOverview(tradeDateStr);
                setOverview(response.data);
                setSelectedDeliveryDate(response.data.delivery_summaries[0]?.delivery_date || '');
            } catch (err: any) {
                setOverview(null);
                setSelectedDeliveryDate('');
                setError(err.response?.data?.detail || err.message || '加载月内交易总览失败');
            } finally {
                setLoading(false);
            }
        };
        loadOverview();
    }, [tradeDateStr]);

    useEffect(() => {
        const loadDetail = async () => {
            if (!tradeDateStr || !selectedDeliveryDate) return;
            if (overview?.trade_date !== tradeDateStr) return;
            if (!overview.delivery_summaries.some((item) => item.delivery_date === selectedDeliveryDate)) return;
            setLoading(true);
            setError(null);
            try {
                const response = await tradeReviewApi.fetchTradeDetail(tradeDateStr, selectedDeliveryDate);
                setDetail(response.data);
                setBatchDetail(response.data.default_batch_detail);
                setSelectedBatchId(response.data.default_batch_id || response.data.default_batch_detail?.batch_id || '');
            } catch (err: any) {
                setDetail(null);
                setBatchDetail(null);
                setError(err.response?.data?.detail || err.message || '加载成交结果复盘详情失败');
            } finally {
                setLoading(false);
            }
        };
        loadDetail();
    }, [tradeDateStr, selectedDeliveryDate, overview]);

    useEffect(() => {
        const loadBatchDetail = async () => {
            if (!tradeDateStr || !selectedDeliveryDate || !selectedBatchId) return;
            if (detail?.default_batch_detail?.batch_id === selectedBatchId) {
                setBatchDetail(detail.default_batch_detail);
                return;
            }
            setLoadingBatch(true);
            try {
                const response = await tradeReviewApi.fetchBatchDetail(tradeDateStr, selectedDeliveryDate, selectedBatchId);
                setBatchDetail(response.data);
            } catch (err: any) {
                setError(err.response?.data?.detail || err.message || '加载批次详情失败');
            } finally {
                setLoadingBatch(false);
            }
        };
        loadBatchDetail();
    }, [tradeDateStr, selectedDeliveryDate, selectedBatchId, detail]);

    const handleShiftTradeDate = (offset: number) => {
        if (!tradeDateStr) return;
        const currentIndex = availableTradeDates.indexOf(tradeDateStr);
        const targetIndex = currentIndex - offset;
        if (targetIndex < 0 || targetIndex >= availableTradeDates.length) return;
        setSelectedTradeDate(parseISO(availableTradeDates[targetIndex]));
    };

    const executionData = useMemo(() => (detail?.execution_chart || []).map((row) => ({
        ...row,
        historical_buy_mwh: Math.max(row.historical_within_month_net_mwh, 0),
        historical_sell_mwh: Math.min(row.historical_within_month_net_mwh, 0),
        trade_day_buy_mwh: Math.max(row.trade_day_net_mwh, 0),
        trade_day_sell_mwh: Math.min(row.trade_day_net_mwh, 0),
        trade_avg_price_buy: row.trade_day_net_mwh >= 0 ? row.trade_avg_price : null,
        trade_avg_price_sell: row.trade_day_net_mwh < 0 ? row.trade_avg_price : null,
    })), [detail]);

    const batchTimelineData = useMemo(() => (detail?.batch_timeline || []).map((item, index) => ({
        ...item,
        batch_label: `${item.batch_action_type === 'listing' ? '上架批次' : '下架批次'}${index + 1}`,
    })), [detail]);

    const summary = detail?.summary_cards;
    const executionAnalysisSummary = detail?.execution_analysis_summary;
    const executionPeriods = useMemo(() => executionData.map((row) => row.period), [executionData]);
    const executionXAxisProps = {
        dataKey: 'period',
        type: 'number' as const,
        domain: executionPeriods.length > 0 ? [Math.min(...executionPeriods) - 0.5, Math.max(...executionPeriods) + 0.5] : [0.5, 48.5],
        ticks: executionPeriods,
        allowDecimals: false,
        tickFormatter: (value: number) => `${value}`,
    };

    const executionPriceDomain = useMemo<[number | 'auto', number | 'auto']>(() => {
        const values = executionData.flatMap((row) => [executionPriceVisibility.trade_avg_price ? row.trade_avg_price : null, executionPriceVisibility.market_monthly_price ? row.market_monthly_price : null, executionPriceVisibility.spot_price ? row.spot_price : null].filter((value): value is number => value !== null && value !== undefined && !Number.isNaN(value)));
        if (values.length === 0) return ['auto', 'auto'];
        const min = Math.min(...values);
        const max = Math.max(...values);
        const padding = Math.max((max - min) * 0.1, 5);
        return [Math.floor(min - padding), Math.ceil(max + padding)];
    }, [executionData, executionPriceVisibility]);

    const executionVolumeDomain = useMemo<[number, number]>(() => {
        const values = executionData.flatMap((row) => [executionVolumeVisibility.final_position_mwh ? row.final_position_mwh : null, executionVolumeVisibility.actual_or_forecast_load_mwh ? row.actual_or_forecast_load_mwh ?? 0 : null, executionVolumeVisibility.annual_monthly_mwh ? row.annual_monthly_mwh : null, executionVolumeVisibility.monthly_mwh ? row.monthly_mwh : null, executionVolumeVisibility.mechanism_mwh ? row.mechanism_mwh : null, executionVolumeVisibility.historical_buy_mwh ? row.historical_buy_mwh : null, executionVolumeVisibility.historical_sell_mwh ? row.historical_sell_mwh : null, executionVolumeVisibility.trade_day_buy_mwh ? row.trade_day_buy_mwh : null, executionVolumeVisibility.trade_day_sell_mwh ? row.trade_day_sell_mwh : null].filter((value): value is number => value !== null && value !== undefined && !Number.isNaN(value)));
        if (values.length === 0) return [-1, 1];
        const min = Math.min(0, ...values);
        const max = Math.max(0, ...values);
        const padding = Math.max((max - min) * 0.08, 1);
        return [Math.floor(min - padding), Math.ceil(max + padding)];
    }, [executionData, executionVolumeVisibility]);

    const executionPriceDot = (props: any) => {
        const { cx, cy, payload, value } = props;
        if (cx === undefined || cy === undefined || value === null || value === undefined || Number.isNaN(value)) return <g />;
        const tradeCount = Number(payload.trade_count ?? 0);
        const radius = Math.min(10, Math.max(4, 4 + tradeCount * 0.8));
        const fillColor = payload.trade_day_net_mwh < 0 ? TRADE_PRICE_SELL_COLOR : TRADE_PRICE_BUY_COLOR;
        return (
            <g>
                <circle cx={cx} cy={cy} r={radius} fill={fillColor} fillOpacity={0.92} stroke="#ffffff" strokeWidth={1.5} />
                {tradeCount > 1 && <text x={cx + radius + 2} y={cy - radius + 2} fontSize="10" fill={fillColor} fontWeight="bold">{tradeCount}</text>}
            </g>
        );
    };

    const executionPanelBodyHeight = executionAnalysisSummary ? { xs: 390, sm: 480 } : { xs: 430, sm: 520 };
    const executionPanelTotalHeight = executionAnalysisSummary ? { xs: 480, sm: 580 } : executionPanelBodyHeight;
    const executionTableTotals = useMemo(
        () => {
            const rows = detail?.execution_table ?? [];
            const totalActualLoad = rows.reduce((sum, row) => sum + (row.actual_or_forecast_load_mwh ?? 0), 0);
            const totalFinalPosition = rows.reduce((sum, row) => sum + row.final_position_mwh, 0);
            const totalTradeCount = rows.reduce((sum, row) => sum + row.trade_count, 0);
            const totalTradeVolume = rows.reduce((sum, row) => sum + row.trade_volume_mwh, 0);
            const totalTradePriceAmount = rows.reduce(
                (sum, row) => sum + (row.trade_avg_price ?? 0) * row.trade_volume_mwh,
                0
            );
            const spotPriceRows = rows.filter((row) => row.spot_price !== null && row.spot_price !== undefined);

            return {
                annual: rows.reduce((sum, row) => sum + row.annual_monthly_mwh, 0),
                monthly: rows.reduce((sum, row) => sum + row.monthly_mwh, 0),
                mechanism: rows.reduce((sum, row) => sum + row.mechanism_mwh, 0),
                historical: rows.reduce((sum, row) => sum + row.historical_within_month_net_mwh, 0),
                tradeDay: rows.reduce((sum, row) => sum + row.trade_day_net_mwh, 0),
                finalPosition: totalFinalPosition,
                actualLoad: totalActualLoad,
                contractRatio:
                    totalActualLoad !== 0 ? (totalFinalPosition / totalActualLoad) * 100 : null,
                tradeCount: totalTradeCount,
                tradeAvgPrice: totalTradeVolume !== 0 ? totalTradePriceAmount / totalTradeVolume : null,
                spotPrice:
                    spotPriceRows.length > 0
                        ? spotPriceRows.reduce((sum, row) => sum + (row.spot_price ?? 0), 0) / spotPriceRows.length
                        : null,
                totalProfit: rows.reduce((sum, row) => sum + (row.period_profit_amount ?? 0), 0),
            };
        },
        [detail]
    );
    const segmentedTabsSx = {
        minHeight: 44,
        p: 0.5,
        borderRadius: 2,
        bgcolor: 'action.hover',
        '& .MuiTabs-indicator': { display: 'none' },
        '& .MuiTab-root': { minHeight: 36, px: 2, borderRadius: 1.5, fontSize: '0.95rem', fontWeight: 600, color: 'text.secondary', textTransform: 'none' as const },
        '& .MuiTab-root.Mui-selected': { color: 'text.primary', bgcolor: 'background.paper', boxShadow: theme.shadows[1] },
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {isTablet && <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 700, color: 'text.primary' }}>月内交易复盘 / 成交结果与批次分析</Typography>}

                <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftTradeDate(-1)} disabled={loading}><ArrowLeftIcon /></IconButton>
                    <DatePicker label="选择交易日" value={selectedTradeDate} onChange={(date) => setSelectedTradeDate(date)} disabled={loading} slotProps={{ textField: { size: 'small', sx: { width: { xs: '150px', sm: '200px' } } } }} />
                    <IconButton onClick={() => handleShiftTradeDate(1)} disabled={loading}><ArrowRightIcon /></IconButton>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', ml: { md: 'auto' } }}>
                        {(overview?.delivery_summaries || []).map((item) => (
                            <Chip key={item.delivery_date} label={`${item.delivery_date} (${item.record_count})`} color={selectedDeliveryDate === item.delivery_date ? 'primary' : 'default'} variant={selectedDeliveryDate === item.delivery_date ? 'filled' : 'outlined'} onClick={() => setSelectedDeliveryDate(item.delivery_date)} disabled={loading} />
                        ))}
                    </Box>
                </Paper>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {loading && !detail ? (
                    <Box sx={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
                ) : overview && overview.delivery_summaries.length === 0 ? (
                    <EmptyState tradeDate={tradeDateStr} />
                ) : detail ? (
                    <>
                        <Grid container spacing={{ xs: 1, sm: 2 }}>
                            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard title="记录概览" lines={[`总记录数：${summary?.record_overview.total_records ?? 0}`, `有成交记录：${summary?.record_overview.traded_records ?? 0}`]} /></Grid>
                            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard title="成交电量" lines={[`总成交电量：${formatNumber(summary?.trade_overview.traded_mwh, 3)} MWh`, `买入 / 卖出：${formatNumber(summary?.trade_overview.buy_traded_mwh, 3)} / ${formatNumber(summary?.trade_overview.sell_traded_mwh, 3)} MWh`]} /></Grid>
                            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard title="成交时段" lines={[`有成交时段：${summary?.period_overview.traded_period_count ?? 0}`, `买入 / 卖出：${summary?.period_overview.buy_traded_period_count ?? 0} / ${summary?.period_overview.sell_traded_period_count ?? 0}`]} /></Grid>
                            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard title="批次概览" lines={[`上架批次：${summary?.batch_overview.listing_batch_count ?? 0}`, `下架批次：${summary?.batch_overview.off_shelf_batch_count ?? 0}`]} /></Grid>
                        </Grid>
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>月内交易成交分析</Typography>
                                <Tabs value={executionTab} onChange={(_, value) => setExecutionTab(value)} sx={{ ...segmentedTabsSx, mb: 0, ml: 'auto' }}>
                                    <Tab label="图表" />
                                    <Tab label="数据" />
                                </Tabs>
                            </Box>

                            {executionTab === 0 ? (
                                <Box ref={executionChartRef} sx={{ height: executionPanelBodyHeight, position: 'relative', backgroundColor: executionFullscreen.isFullscreen ? 'background.paper' : 'transparent', p: executionFullscreen.isFullscreen ? 2 : 0, ...(executionFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }) }}>
                                    <executionFullscreen.FullscreenEnterButton />
                                    <executionFullscreen.FullscreenExitButton />
                                    <executionFullscreen.FullscreenTitle />
                                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 0.5 }}>
                                        {(Object.keys(EXECUTION_PRICE_SERIES_META) as ExecutionPriceSeriesKey[]).map((key) => (
                                            <Box key={key} onClick={() => handleExecutionPriceLegendClick({ dataKey: key } as any)} sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                                                <Checkbox checked={executionPriceVisibility[key]} size="small" sx={{ p: 0.5, color: EXECUTION_PRICE_SERIES_META[key].color, '&.Mui-checked': { color: EXECUTION_PRICE_SERIES_META[key].color } }} />
                                                <Typography variant="body2" sx={{ color: executionPriceVisibility[key] ? 'text.primary' : 'text.disabled', mr: 1 }}>{EXECUTION_PRICE_SERIES_META[key].label}</Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 88px)', gap: 0.75 }}>
                                        <Box sx={{ flex: 1, minHeight: 0 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={executionData} syncId="execution-review">
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis {...executionXAxisProps} hide />
                                                    <YAxis yAxisId="price" orientation="right" domain={executionPriceDomain} label={{ value: '交易价格', angle: -90, position: 'insideRight' }} />
                                                    <Tooltip content={<DetailedExecutionTooltip />} cursor={{ stroke: '#9e9e9e', strokeDasharray: '3 3' }} wrapperStyle={{ zIndex: 1401 }} />
                                                    {executionPriceVisibility.trade_avg_price && <><Line yAxisId="price" type="linear" dataKey="trade_avg_price_buy" name="成交均价" stroke={TRADE_PRICE_BUY_COLOR} strokeWidth={0} connectNulls={false} dot={executionPriceDot} activeDot={false} /><Line yAxisId="price" type="linear" dataKey="trade_avg_price_sell" name="成交均价" stroke={TRADE_PRICE_SELL_COLOR} strokeWidth={0} connectNulls={false} dot={executionPriceDot} activeDot={false} legendType="none" /></>}
                                                    {executionPriceVisibility.market_monthly_price && <Line yAxisId="price" type="monotone" dataKey="market_monthly_price" name="市场均价" stroke={EXECUTION_PRICE_SERIES_META.market_monthly_price.color} strokeWidth={1.5} connectNulls dot={false} activeDot={false} />}
                                                    {executionPriceVisibility.spot_price && <Line yAxisId="price" type="monotone" dataKey="spot_price" name="现货价格" stroke={EXECUTION_PRICE_SERIES_META.spot_price.color} strokeWidth={1.5} connectNulls dot={false} activeDot={false} />}
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        </Box>
                                        <Box sx={{ flex: 1.25, minHeight: 0 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={executionData} syncId="execution-review">
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis {...executionXAxisProps} />
                                                    <YAxis yAxisId="volume" orientation="right" domain={executionVolumeDomain} label={{ value: '交易电量', angle: -90, position: 'insideRight' }} />
                                                    <Tooltip content={() => null} cursor={false} wrapperStyle={{ display: 'none' }} />
                                                    <ReferenceLine yAxisId="volume" y={0} stroke="#9e9e9e" strokeDasharray="3 3" />
                                                    {executionVolumeVisibility.actual_or_forecast_load_mwh && <Area yAxisId="volume" type="monotone" dataKey="actual_or_forecast_load_mwh" name="实际/预测电量" fill={EXECUTION_VOLUME_SERIES_META.actual_or_forecast_load_mwh.color} stroke="#b0bec5" fillOpacity={0.25} />}
                                                    {executionVolumeVisibility.annual_monthly_mwh && <Bar yAxisId="volume" dataKey="annual_monthly_mwh" stackId="base" name="年度分月" fill={EXECUTION_VOLUME_SERIES_META.annual_monthly_mwh.color} />}
                                                    {executionVolumeVisibility.monthly_mwh && <Bar yAxisId="volume" dataKey="monthly_mwh" stackId="base" name="月度" fill={EXECUTION_VOLUME_SERIES_META.monthly_mwh.color} />}
                                                    {executionVolumeVisibility.mechanism_mwh && <Bar yAxisId="volume" dataKey="mechanism_mwh" stackId="base" name="机制" fill={EXECUTION_VOLUME_SERIES_META.mechanism_mwh.color} />}
                                                    {executionVolumeVisibility.historical_buy_mwh && <Bar yAxisId="volume" dataKey="historical_buy_mwh" stackId="base" name="历史月内买入" fill={EXECUTION_VOLUME_SERIES_META.historical_buy_mwh.color} />}
                                                    {executionVolumeVisibility.historical_sell_mwh && <Bar yAxisId="volume" dataKey="historical_sell_mwh" stackId="base" name="历史月内卖出" fill={EXECUTION_VOLUME_SERIES_META.historical_sell_mwh.color} />}
                                                    {executionVolumeVisibility.trade_day_buy_mwh && <Bar yAxisId="volume" dataKey="trade_day_buy_mwh" stackId="base" name="当日月内买入" fill={EXECUTION_VOLUME_SERIES_META.trade_day_buy_mwh.color} />}
                                                    {executionVolumeVisibility.trade_day_sell_mwh && <Bar yAxisId="volume" dataKey="trade_day_sell_mwh" stackId="base" name="当日月内卖出" fill={EXECUTION_VOLUME_SERIES_META.trade_day_sell_mwh.color} />}
                                                    {executionVolumeVisibility.final_position_mwh && <Line yAxisId="volume" type="monotone" dataKey="final_position_mwh" name="最终持仓" stroke={EXECUTION_VOLUME_SERIES_META.final_position_mwh.color} strokeDasharray="6 4" dot={false} />}
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.25 }}>
                                        {(Object.keys(EXECUTION_VOLUME_SERIES_META) as ExecutionVolumeSeriesKey[]).map((key) => (
                                            <Box key={key} onClick={() => handleExecutionVolumeLegendClick({ dataKey: key } as any)} sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                                                <Checkbox checked={executionVolumeVisibility[key]} size="small" sx={{ p: 0.5, color: EXECUTION_VOLUME_SERIES_META[key].color, '&.Mui-checked': { color: EXECUTION_VOLUME_SERIES_META[key].color } }} />
                                                <Typography variant="body2" sx={{ color: executionVolumeVisibility[key] ? 'text.primary' : 'text.disabled', mr: 1 }}>{EXECUTION_VOLUME_SERIES_META[key].label}</Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            
                            
                            ) : (
                                <Box sx={{ height: executionPanelTotalHeight, overflow: 'hidden' }}>
                                    <TableContainer sx={{ height: '100%', overflowX: 'auto', overflowY: 'auto' }}>
                                        <Table stickyHeader sx={{ '& .MuiTableCell-root': { fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 0.5, sm: 2 } } }}>
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>{'\u65f6\u6bb5'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u5e74\u5ea6'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u6708\u5ea6'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u673a\u5236'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u5386\u53f2\u6708\u5185'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u5f53\u65e5\u6210\u4ea4'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u6700\u7ec8\u6301\u4ed3'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u5b9e\u9645\u7535\u91cf'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{'\u7b7e\u7ea6\u6bd4\u4f8b'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff7ed' }}>{'\u6210\u4ea4\u6b21\u6570'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff7ed' }}>{'\u6210\u4ea4\u5747\u4ef7'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff7ed' }}>{'\u5b9e\u65f6\u4ef7\u683c'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff7ed' }}>{'\u4ea4\u6613\u6536\u76ca'}</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {detail.execution_table.map((row) => {
                                                    const contractRatio = row.actual_or_forecast_load_mwh && row.actual_or_forecast_load_mwh !== 0
                                                        ? (row.final_position_mwh / row.actual_or_forecast_load_mwh) * 100
                                                        : null;

                                                    return (
                                                        <TableRow key={row.period}>
                                                            <TableCell>{row.period}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.annual_monthly_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.monthly_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.mechanism_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.historical_within_month_net_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.trade_day_net_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.final_position_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{formatNumber(row.actual_or_forecast_load_mwh, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#f5f7fb' }}>{contractRatio === null ? '-' : `${formatNumber(contractRatio, 2)}%`}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#fff7ed' }}>{row.trade_count}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#fff7ed' }}>{formatNumber(row.trade_avg_price, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#fff7ed' }}>{formatNumber(row.spot_price, 3)}</TableCell>
                                                            <TableCell sx={{ backgroundColor: '#fff7ed', color: (row.period_profit_amount ?? 0) >= 0 ? 'success.main' : 'error.main', fontWeight: 700 }}>
                                                                {formatNumber(row.period_profit_amount, 2)}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                            <TableFooter
                                                sx={{
                                                    position: 'sticky',
                                                    bottom: 0,
                                                    zIndex: 2,
                                                    backgroundColor: 'background.paper',
                                                    '& .MuiTableCell-root': {
                                                        backgroundColor: 'background.paper',
                                                        borderTop: '1px solid',
                                                        borderColor: 'divider',
                                                        fontWeight: 700,
                                                    },
                                                }}
                                            >
                                                <TableRow>
                                                    <TableCell>{'\u5408\u8ba1/\u5747\u503c'}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.annual, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.monthly, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.mechanism, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.historical, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.tradeDay, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.finalPosition, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>{formatNumber(executionTableTotals.actualLoad, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#eef3ff' }}>
                                                        {executionTableTotals.contractRatio === null ? '-' : `${formatNumber(executionTableTotals.contractRatio, 2)}%`}
                                                    </TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff1df' }}>{executionTableTotals.tradeCount}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff1df' }}>{formatNumber(executionTableTotals.tradeAvgPrice, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff1df' }}>{formatNumber(executionTableTotals.spotPrice, 3)}</TableCell>
                                                    <TableCell sx={{ backgroundColor: '#fff1df', color: executionTableTotals.totalProfit >= 0 ? 'success.main' : 'error.main' }}>
                                                        {formatNumber(executionTableTotals.totalProfit, 2)}
                                                    </TableCell>
                                                </TableRow>
                                            </TableFooter>
                                        </Table>
                                    </TableContainer>
                                </Box>
                            )}
                            {false && executionTab === 0 && executionAnalysisSummary && (
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        mt: 2,
                                        p: { xs: 1.5, sm: 2 },
                                        borderColor: 'divider',
                                        backgroundColor: 'grey.50',
                                    }}
                                >
                                    <Typography
                                        variant="subtitle1"
                                        sx={{
                                            fontWeight: 800,
                                            fontSize: { xs: '1rem', sm: '1.1rem' },
                                            lineHeight: 1.9,
                                            color: 'text.primary',
                                        }}
                                    >
                                        盈利笔数：{executionAnalysisSummary!.profit_count}，
                                        盈利金额：{formatNumber(executionAnalysisSummary!.profit_amount, 2)}元；
                                        亏损笔数：{executionAnalysisSummary!.loss_count}，
                                        亏损金额：{formatNumber(executionAnalysisSummary!.loss_amount, 2)}元；
                                        当日交易总收益：
                                        <Box
                                            component="span"
                                            sx={{
                                                ml: 0.5,
                                                color: executionAnalysisSummary!.total_profit_amount >= 0 ? 'success.main' : 'error.main',
                                            }}
                                        >
                                            {formatNumber(executionAnalysisSummary!.total_profit_amount, 2)}元
                                        </Box>
                                    </Typography>
                                </Paper>
                            )}
                            {executionTab === 0 && executionAnalysisSummary && (
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        mt: 0.25,
                                        p: { xs: 1.25, sm: 1.5 },
                                        borderColor: 'divider',
                                        backgroundColor: 'grey.50',
                                    }}
                                >
                                    <Typography
                                        variant="subtitle1"
                                        sx={{
                                            fontWeight: 800,
                                            fontSize: { xs: '1rem', sm: '1.1rem' },
                                            lineHeight: 1.8,
                                            color: 'text.primary',
                                        }}
                                    >
                                        盈利笔数：
                                        <Box component="span" sx={{ color: 'success.main', fontWeight: 900 }}>
                                            {executionAnalysisSummary!.profit_count}
                                        </Box>
                                        ，盈利金额：
                                        <Box component="span" sx={{ color: 'success.main', fontWeight: 900 }}>
                                            {formatNumber(executionAnalysisSummary!.profit_amount, 2)}元
                                        </Box>
                                        ；亏损笔数：
                                        <Box component="span" sx={{ color: 'error.main', fontWeight: 900 }}>
                                            {executionAnalysisSummary!.loss_count}
                                        </Box>
                                        ，亏损金额：
                                        <Box component="span" sx={{ color: 'error.main', fontWeight: 900 }}>
                                            {formatNumber(executionAnalysisSummary!.loss_amount, 2)}元
                                        </Box>
                                        ；当日交易总收益：
                                        <Box
                                            component="span"
                                            sx={{
                                                ml: 0.5,
                                                color: executionAnalysisSummary!.total_profit_amount >= 0 ? 'success.main' : 'error.main',
                                                fontWeight: 900,
                                            }}
                                        >
                                            {formatNumber(executionAnalysisSummary!.total_profit_amount, 2)}元
                                        </Box>
                                    </Typography>
                                </Paper>
                            )}
                        </Paper>
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                            <Typography variant="h6" sx={{ mb: 2 }}>批次维度复盘</Typography>
                            <Grid container spacing={{ xs: 1, sm: 2 }}>
                                <Grid size={{ xs: 12, lg: 4 }}>
                                    <Paper variant="outlined" sx={{ p: 1, height: '100%' }}>
                                        <Typography variant="subtitle1" sx={{ mb: 1 }}>批次申报时间轴</Typography>
                                        <Box sx={{ height: { xs: 280, sm: 320 } }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={batchTimelineData}>
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis dataKey="batch_label" interval={0} angle={-20} textAnchor="end" height={60} />
                                                    <YAxis />
                                                    <Tooltip content={<BatchTooltip />} />
                                                    <Bar dataKey="batch_listing_mwh" name="批次申报电量" fill="#90caf9" />
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        </Box>
                                        <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                            {batchTimelineData.map((item) => (
                                                <Chip key={item.batch_id} size="small" label={`${item.batch_action_type === 'listing' ? '上架批次' : '下架批次'} ${item.batch_start_time.slice(11)}`} color={selectedBatchId === item.batch_id ? 'primary' : 'default'} variant={selectedBatchId === item.batch_id ? 'filled' : 'outlined'} onClick={() => setSelectedBatchId(item.batch_id)} />
                                            ))}
                                        </Box>
                                    </Paper>
                                </Grid>
                                <Grid size={{ xs: 12, lg: 8 }}>
                                    <Paper variant="outlined" sx={{ p: 1, height: '100%' }}>
                                        <Tabs value={batchTab} onChange={(_, value) => setBatchTab(value)} sx={segmentedTabsSx}><Tab label="图表" /><Tab label="明细" /></Tabs>
                                        {batchTab === 0 ? (
                                            <Box ref={batchChartRef} sx={{ height: { xs: 350, sm: 400 }, position: 'relative', backgroundColor: batchFullscreen.isFullscreen ? 'background.paper' : 'transparent', p: batchFullscreen.isFullscreen ? 2 : 0, ...(batchFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }) }}>
                                                <batchFullscreen.FullscreenEnterButton />
                                                <batchFullscreen.FullscreenExitButton />
                                                <batchFullscreen.FullscreenTitle />
                                                {loadingBatch && !batchDetail ? (
                                                    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
                                                ) : (
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <ComposedChart data={batchDetail?.batch_chart_rows || []}>
                                                            <CartesianGrid strokeDasharray="3 3" />
                                                            <XAxis dataKey="period" />
                                                            <YAxis yAxisId="price" orientation="left" />
                                                            <YAxis yAxisId="volume" orientation="right" />
                                                            <Tooltip content={<BatchChartTooltip />} />
                                                            <Legend />
                                                            <Area yAxisId="volume" type="monotone" dataKey="actual_or_forecast_load_mwh" name="实际/预测电量" fill="#cfd8dc" stroke="#b0bec5" fillOpacity={0.3} />
                                                            <Bar yAxisId="volume" dataKey="listing_mwh" name="申报电量" fill="#90caf9" />
                                                            <Line yAxisId="price" type="monotone" dataKey="listing_price" name="挂牌价格" stroke="#ef6c00" />
                                                            <Line yAxisId="price" type="monotone" dataKey="market_monthly_price" name="市场均价" stroke="#8e24aa" dot={false} />
                                                            <Line yAxisId="price" type="monotone" dataKey="spot_price" name="现货价格" stroke="#d81b60" dot={false} />
                                                        </ComposedChart>
                                                    </ResponsiveContainer>
                                                )}
                                            </Box>
                                        ) : (
                                            <TableContainer sx={{ overflowX: 'auto' }}>
                                                <Table sx={{ '& .MuiTableCell-root': { fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 0.5, sm: 2 } } }}>
                                                    <TableHead><TableRow><TableCell>时段</TableCell><TableCell>交易方向</TableCell><TableCell>申报电量</TableCell><TableCell>成交电量</TableCell><TableCell>挂牌价格</TableCell><TableCell>上架时间</TableCell><TableCell>下架时间</TableCell><TableCell>下架类型</TableCell></TableRow></TableHead>
                                                    <TableBody>{(batchDetail?.batch_records || []).map((row) => (<TableRow key={row.record_key}><TableCell>{row.period}</TableCell><TableCell>{row.trade_direction}</TableCell><TableCell>{formatNumber(row.listing_mwh, 3)}</TableCell><TableCell>{formatNumber(row.traded_mwh, 3)}</TableCell><TableCell>{formatNumber(row.listing_price, 3)}</TableCell><TableCell>{row.listing_time || '-'}</TableCell><TableCell>{row.off_shelf_time || '-'}</TableCell><TableCell>{row.off_shelf_type || '-'}</TableCell></TableRow>))}</TableBody>
                                                </Table>
                                            </TableContainer>
                                        )}
                                    </Paper>
                                </Grid>
                            </Grid>
                        </Paper>
                    </>
                ) : null}
            </Box>
        </LocalizationProvider>
    );
};

export default TradeReviewPage;
