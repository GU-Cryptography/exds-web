import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box, Paper, Typography, Grid, IconButton,
    CircularProgress, Alert, useTheme, useMediaQuery,
    ToggleButtonGroup, ToggleButton
} from '@mui/material';
import {
    ArrowBackIosNew, ArrowForwardIos
} from '@mui/icons-material';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { format, addMonths, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { trendAnalysisApi } from '../../api/trendAnalysis';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { useSelectableSeries } from '../../hooks/useSelectableSeries';

export const PriceTrendTab: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // State
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);
    const [priceType, setPriceType] = useState<'vwap' | 'twap'>('vwap'); // 价格类型选择

    // Handlers for month navigation
    const handlePrevMonth = () => setCurrentMonth(prev => subMonths(prev, 1));
    const handleNextMonth = () => setCurrentMonth(prev => addMonths(prev, 1));

    // Derived values
    const monthLabel = format(currentMonth, 'yyyy年MM月', { locale: zhCN });
    const chartHeight = { xs: 350, sm: 400 };

    // Refs for charts
    const priceChartRef = useRef<HTMLDivElement>(null);
    const spreadChartRef = useRef<HTMLDivElement>(null);
    const periodChartRef = useRef<HTMLDivElement>(null);

    // Fullscreen hooks
    const priceFullscreen = useChartFullscreen({ chartRef: priceChartRef, title: '日均价格趋势' });
    const spreadFullscreen = useChartFullscreen({ chartRef: spreadChartRef, title: '日均价差趋势' });
    const periodFullscreen = useChartFullscreen({ chartRef: periodChartRef, title: '分时段价格趋势' });

    // Series selection hooks
    const priceSeries = useSelectableSeries({ vwap_rt: true, vwap_da: true });
    const periodSeries = useSelectableSeries({
        深谷: true,
        低谷: true,
        平段: true,
        高峰: true,
        尖峰: true
    });

    // Transform period_trends data for chart (backend keys -> Chinese labels)
    const periodChartData = useMemo(() => {
        if (!data?.period_trends) return [];
        const keyMap: Record<string, string> = {
            deep_valley: '深谷',
            off_peak: '低谷',
            shoulder: '平段',
            on_peak: '高峰',
            peak: '尖峰'
        };
        const dateMap = new Map<string, any>();
        Object.entries(data.period_trends as Record<string, any[]>).forEach(([backendKey, points]) => {
            const displayKey = keyMap[backendKey] || backendKey;
            points.forEach(p => {
                if (!dateMap.has(p.date)) {
                    dateMap.set(p.date, { date: p.date });
                }
                dateMap.get(p.date)[displayKey] = p.vwap;
            });
        });
        return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [data]);

    // Data fetching
    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
            const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
            const response = await trendAnalysisApi.fetchPriceTrend({ start_date: start, end_date: end });
            setData(response.data);
        } catch (err: any) {
            console.error('Error fetching price trend:', err);
            setError(err.response?.data?.detail || '获取数据失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [currentMonth]);

    return (
        <Box>
            {/* Filter Area */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                {/* Month Navigation */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: { xs: '100%', sm: 'auto' }, justifyContent: { xs: 'space-between', sm: 'flex-start' } }}>
                    <IconButton onClick={handlePrevMonth} disabled={loading} size="small">
                        <ArrowBackIosNew fontSize="small" />
                    </IconButton>
                    <Typography variant="h6" sx={{ minWidth: 120, textAlign: 'center', fontWeight: 'bold' }}>
                        {monthLabel}
                    </Typography>
                    <IconButton onClick={handleNextMonth} disabled={loading} size="small">
                        <ArrowForwardIos fontSize="small" />
                    </IconButton>
                </Box>
                {/* VWAP/TWAP Selector */}
                <ToggleButtonGroup
                    value={priceType}
                    exclusive
                    onChange={(e, newValue) => newValue && setPriceType(newValue)}
                    size="small"
                    disabled={loading}
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    <ToggleButton value="vwap" sx={{ flex: { xs: 1, sm: 'initial' } }}>
                        加权平均
                    </ToggleButton>
                    <ToggleButton value="twap" sx={{ flex: { xs: 1, sm: 'initial' } }}>
                        算术平均
                    </ToggleButton>
                </ToggleButtonGroup>
            </Paper>

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

                    <Grid container spacing={{ xs: 1, sm: 2 }}>
                        {/* 1. Daily Price Trend */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                                <Typography variant="h6" gutterBottom>日均价格趋势</Typography>
                                <Box ref={priceChartRef} sx={{
                                    height: chartHeight,
                                    position: 'relative',
                                    bgcolor: priceFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                                    p: priceFullscreen.isFullscreen ? 2 : 0,
                                    ...(priceFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                                }}>
                                    <priceFullscreen.FullscreenEnterButton />
                                    <priceFullscreen.FullscreenExitButton />
                                    <priceFullscreen.FullscreenTitle />
                                    <ResponsiveContainer>
                                        <LineChart data={data.daily_trends}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" />
                                            <YAxis label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip />
                                            <Legend onClick={priceSeries.handleLegendClick} />
                                            <Line hide={!priceSeries.seriesVisibility.vwap_rt} type="monotone" dataKey={priceType === 'vwap' ? 'vwap_rt' : 'twap_rt'} name="实时均价" stroke="#d32f2f" strokeWidth={2} dot={false} />
                                            <Line hide={!priceSeries.seriesVisibility.vwap_da} type="monotone" dataKey={priceType === 'vwap' ? 'vwap_da' : 'twap_da'} name="日前均价" stroke="#1976d2" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Paper>
                        </Grid>

                        {/* 2. Daily Spread Trend */}
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                                <Typography variant="h6" gutterBottom>日均价差趋势</Typography>
                                <Box ref={spreadChartRef} sx={{
                                    height: chartHeight,
                                    position: 'relative',
                                    bgcolor: spreadFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                                    p: spreadFullscreen.isFullscreen ? 2 : 0,
                                    ...(spreadFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                                }}>
                                    <spreadFullscreen.FullscreenEnterButton />
                                    <spreadFullscreen.FullscreenExitButton />
                                    <spreadFullscreen.FullscreenTitle />
                                    <ResponsiveContainer>
                                        <BarChart data={data.daily_trends}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" />
                                            <YAxis label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip />
                                            <Legend />
                                            <ReferenceLine y={0} stroke="#000" />
                                            <Bar dataKey={priceType === 'vwap' ? 'vwap_spread' : 'twap_spread'} name="价差 (实时-日前)">
                                                {data.daily_trends.map((entry: any, index: number) => (
                                                    <Cell key={`cell-${index}`} fill={entry[priceType === 'vwap' ? 'vwap_spread' : 'twap_spread'] >= 0 ? '#d32f2f' : '#388e3c'} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Paper>
                        </Grid>

                        {/* 3. Period Price Trend */}
                        <Grid size={{ xs: 12 }}>
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                                <Typography variant="h6" gutterBottom>分时段价格趋势</Typography>
                                <Box ref={periodChartRef} sx={{
                                    height: chartHeight,
                                    position: 'relative',
                                    bgcolor: periodFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                                    p: periodFullscreen.isFullscreen ? 2 : 0,
                                    ...(periodFullscreen.isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                                }}>
                                    <periodFullscreen.FullscreenEnterButton />
                                    <periodFullscreen.FullscreenExitButton />
                                    <periodFullscreen.FullscreenTitle />
                                    <ResponsiveContainer>
                                        <LineChart data={periodChartData}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="date" />
                                            <YAxis label={{ value: '元/MWh', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip />
                                            <Legend onClick={periodSeries.handleLegendClick} />
                                            <Line hide={!periodSeries.seriesVisibility.深谷} type="monotone" dataKey="深谷" name="深谷" stroke="#1565c0" strokeWidth={2} dot={false} />
                                            <Line hide={!periodSeries.seriesVisibility.低谷} type="monotone" dataKey="低谷" name="低谷" stroke="#4caf50" strokeWidth={2} dot={false} />
                                            <Line hide={!periodSeries.seriesVisibility.平段} type="monotone" dataKey="平段" name="平段" stroke="#2196f3" strokeWidth={2} dot={false} />
                                            <Line hide={!periodSeries.seriesVisibility.高峰} type="monotone" dataKey="高峰" name="高峰" stroke="#ff9800" strokeWidth={2} dot={false} />
                                            <Line hide={!periodSeries.seriesVisibility.尖峰} type="monotone" dataKey="尖峰" name="尖峰" stroke="#d32f2f" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>
                </Box>
            ) : null}
        </Box>
    );
};
