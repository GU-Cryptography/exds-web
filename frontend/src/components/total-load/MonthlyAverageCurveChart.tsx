import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    IconButton,
    RadioGroup,
    FormControlLabel,
    Radio,
    useTheme,
    useMediaQuery,
    ToggleButtonGroup,
    ToggleButton
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import TimelineIcon from '@mui/icons-material/Timeline';
import CategoryIcon from '@mui/icons-material/Category';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
    ReferenceArea
} from 'recharts';
import { format, addMonths, parse } from 'date-fns';
import apiClient from '../../api/client';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { useTouPeriodBackground } from '../../hooks/useTouPeriodBackground';

interface CurvePoint {
    time: string; // HH:mm
    consumption: number | null;
    period_type: string;
}

interface MonthlyAverageResponse {
    month: string;
    current: {
        overall: { points: CurvePoint[], total: number } | null;
        workday: { points: CurvePoint[], total: number } | null;
        weekend: { points: CurvePoint[], total: number } | null;
        holiday: { points: CurvePoint[], total: number } | null;
    };
    compare: {
        overall?: { points: CurvePoint[], total: number } | null;
        workday?: { points: CurvePoint[], total: number } | null;
        weekend?: { points: CurvePoint[], total: number } | null;
        holiday?: { points: CurvePoint[], total: number } | null;
        market?: { points: CurvePoint[], total: number } | null;
        business?: { points: CurvePoint[], total: number } | null;
    } | null;
    compare_type: string;
}

interface MonthlyAverageCurveChartProps {
    month: string;
    onMonthChange: (month: string) => void;
}

// Custom Tooltip
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <Paper elevation={3} sx={{ p: 1.5, bgcolor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #eee' }}>
                <Typography variant="subtitle2" sx={{ mb: 1, borderBottom: '1px solid #eee', pb: 0.5 }}>
                    {label}
                </Typography>
                {payload.map((entry: any, index: number) => (
                    <Box key={index} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, gap: 2 }}>
                        <Typography variant="caption" sx={{ color: entry.color, display: 'flex', alignItems: 'center' }}>
                            <Box component="span" sx={{ width: 8, height: 8, bgcolor: entry.color, borderRadius: '50%', mr: 0.5 }} />
                            {entry.name}
                        </Typography>
                        <Typography variant="caption" fontWeight="bold">
                            {entry.value !== null ? entry.value.toFixed(2) : '-'} MWh
                        </Typography>
                    </Box>
                ))}
            </Paper>
        );
    }
    return null;
};

export const MonthlyAverageCurveChart: React.FC<MonthlyAverageCurveChartProps> = ({
    month,
    onMonthChange,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<MonthlyAverageResponse | null>(null);
    const [compareType, setCompareType] = useState<string>('none');
    const [viewMode, setViewMode] = useState<'overall' | 'split'>('overall');

    const chartRef = useRef<HTMLDivElement>(null);

    // Fullscreen Hook
    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons,
    } = useChartFullscreen({
        chartRef,
        title: `月度均值曲线 (${month}) - ${viewMode === 'overall' ? '整月平均' : '分类显示'}`,
        onPrevious: () => handleMonthShift(-1),
        onNext: () => handleMonthShift(1),
    });

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await apiClient.get('/api/v1/total-load/monthly-average', {
                params: {
                    month: month,
                    compare_type: compareType,
                },
            });
            setData(response.data);
        } catch (err: any) {
            console.error('Failed to fetch monthly average data:', err);
            setError(err.response?.data?.detail || err.message || '加载失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (month) {
            fetchData();
        }
    }, [month, compareType, viewMode]);

    const handleMonthShift = (months: number) => {
        try {
            const date = parse(month, 'yyyy-MM', new Date());
            const newDate = addMonths(date, months);
            onMonthChange(format(newDate, 'yyyy-MM'));
        } catch (e) {
            console.error("Date parse error", e);
        }
    };

    const handleCompareTypeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setCompareType(event.target.value);
    };

    const handleViewModeChange = (
        event: React.MouseEvent<HTMLElement>,
        newMode: 'overall' | 'split' | null,
    ) => {
        if (newMode !== null) {
            setViewMode(newMode);
        }
    };

    // Prepare Chart Data
    const chartData = useMemo(() => {
        // Find a valid base series to generate time axis
        let baseSeries = null;
        if (data?.current?.workday?.points) baseSeries = data.current.workday.points;
        else if (data?.current?.overall?.points) baseSeries = data.current.overall.points;

        if (!baseSeries) return [];

        const getVal = (series: any, idx: number) => {
            if (!series || !series.points) return null;
            return series.points[idx]?.consumption ?? null;
        };

        // Use first series to get period_type for background
        // (Assuming all series align on time/period which they should for same month)

        return baseSeries.map((pt, idx) => ({
            time: pt.time,
            period_type: pt.period_type,
            // Current
            overall: getVal(data?.current.overall, idx),
            workday: getVal(data?.current.workday, idx),
            weekend: getVal(data?.current.weekend, idx),
            holiday: getVal(data?.current.holiday, idx),
            // Compare
            comp_market: compareType === 'typical' ? getVal(data?.compare?.market, idx) : null,
            comp_business: compareType === 'typical' ? getVal(data?.compare?.business, idx) : null,

            comp_overall: (compareType === 'last_month' || compareType === 'last_year') ? getVal(data?.compare?.overall, idx) : null,
            comp_workday: (compareType === 'last_month' || compareType === 'last_year') ? getVal(data?.compare?.workday, idx) : null,
            comp_weekend: (compareType === 'last_month' || compareType === 'last_year') ? getVal(data?.compare?.weekend, idx) : null,
            comp_holiday: (compareType === 'last_month' || compareType === 'last_year') ? getVal(data?.compare?.holiday, idx) : null,
        }));
    }, [data, compareType, viewMode]);

    // TOU Background
    const { TouPeriodAreas } = useTouPeriodBackground(chartData);

    const getCompareLabelPrefix = () => {
        if (compareType === 'last_month') return '上月';
        if (compareType === 'last_year') return '去年';
        return '';
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            {/* Header Row: Title & Month Picker */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 32, mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                    <Typography variant="h6" fontSize="0.95rem" fontWeight="bold">月度均值曲线</Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'grey.50', px: 0.5, py: 0.25, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    <IconButton size="small" onClick={() => handleMonthShift(-1)} disabled={loading}>
                        <ArrowLeftIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="body2" sx={{ minWidth: 60, textAlign: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        {month}
                    </Typography>
                    <IconButton size="small" onClick={() => handleMonthShift(1)} disabled={loading}>
                        <ArrowRightIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Box>

            {/* Control Bar: View Mode & Compare Options */}
            <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                mb: 2,
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                {/* View Mode Toggle */}
                <ToggleButtonGroup
                    value={viewMode}
                    exclusive
                    onChange={handleViewModeChange}
                    size="small"
                    aria-label="view mode"
                    sx={{ height: 32 }}
                >
                    <ToggleButton value="overall" aria-label="overall" sx={{ px: 1.5 }}>
                        <TimelineIcon fontSize="small" sx={{ mr: 0.5 }} />
                        <Typography variant="caption" fontWeight="bold">整月平均</Typography>
                    </ToggleButton>
                    <ToggleButton value="split" aria-label="split" sx={{ px: 1.5 }}>
                        <CategoryIcon fontSize="small" sx={{ mr: 0.5 }} />
                        <Typography variant="caption" fontWeight="bold">分类显示</Typography>
                    </ToggleButton>
                </ToggleButtonGroup>

                {/* Compare Options */}
                <RadioGroup
                    row
                    value={compareType}
                    onChange={handleCompareTypeChange}
                    sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.85rem' } }}
                >
                    <FormControlLabel value="none" control={<Radio size="small" sx={{ p: 0.5 }} />} label="无对比" />
                    <FormControlLabel value="last_month" control={<Radio size="small" sx={{ p: 0.5 }} />} label="上月" />
                    <FormControlLabel value="last_year" control={<Radio size="small" sx={{ p: 0.5 }} />} label="去年" />
                    <FormControlLabel value="typical" control={<Radio size="small" sx={{ p: 0.5 }} />} label="典型" />
                </RadioGroup>
            </Box>

            {/* Chart Area */}
            {loading && !data ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 350 }}>
                    <CircularProgress />
                </Box>
            ) : error ? (
                <Alert severity="error">{error}</Alert>
            ) : (
                <Box sx={{ position: 'relative' }}>
                    {loading && (
                        <Box
                            sx={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                backgroundColor: 'rgba(255,255,255,0.7)',
                                zIndex: 1000,
                            }}
                        >
                            <CircularProgress />
                        </Box>
                    )}
                    <Box
                        ref={chartRef}
                        sx={{
                            height: { xs: 285, sm: 325 },
                            position: 'relative',
                            backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                            p: isFullscreen ? 2 : 0,
                            ...(isFullscreen && {
                                position: 'fixed',
                                top: 0, left: 0,
                                width: '100vw', height: '100vh',
                                zIndex: 1400,
                            }),
                            '& *:focus': { outline: 'none !important' }
                        }}
                    >
                        <FullscreenEnterButton />
                        <FullscreenExitButton />
                        <FullscreenTitle />
                        <NavigationButtons />

                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />

                                <XAxis
                                    dataKey="time"
                                    tick={{ fontSize: 11, fill: '#888' }}
                                    tickLine={{ stroke: '#ccc' }}
                                    axisLine={{ stroke: '#ccc' }}
                                    interval={11}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#888' }}
                                    tickLine={{ stroke: '#ccc' }}
                                    axisLine={{ stroke: '#ccc' }}
                                    label={{ value: 'MWh', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#888' }}
                                />
                                <RechartsTooltip content={<CustomTooltip />} />
                                <Legend wrapperStyle={{ paddingTop: 10 }} />

                                {/* TOU Background (Standardized) */}
                                {TouPeriodAreas}

                                {/* Curves depending on View Mode */}
                                {viewMode === 'overall' && (
                                    <Line type="monotone" dataKey="overall" name="月度均值(当月)" stroke="#1976D2" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls />
                                )}

                                {viewMode === 'split' && (
                                    <>
                                        <Line type="monotone" dataKey="workday" name="工作日(当月)" stroke="#1976D2" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                                        <Line type="monotone" dataKey="weekend" name="休息日(当月)" stroke="#388E3C" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                                        <Line type="monotone" dataKey="holiday" name="节假日(当月)" stroke="#D32F2F" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                                    </>
                                )}

                                {/* Compare: Typical */}
                                {compareType === 'typical' && (
                                    <>
                                        <Line type="monotone" dataKey="comp_market" name="市场化典型" stroke="#FF9800" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
                                        <Line type="monotone" dataKey="comp_business" name="工商业典型" stroke="#9C27B0" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
                                    </>
                                )}

                                {/* Compare: History (Last Month / Last Year) */}
                                {(compareType === 'last_month' || compareType === 'last_year') && (
                                    <>
                                        {viewMode === 'overall' && (
                                            <Line type="monotone" dataKey="comp_overall" name={`${getCompareLabelPrefix()}均值`} stroke="#90CAF9" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
                                        )}
                                        {viewMode === 'split' && (
                                            <>
                                                <Line type="monotone" dataKey="comp_workday" name={`${getCompareLabelPrefix()}工作日`} stroke="#90CAF9" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
                                                <Line type="monotone" dataKey="comp_weekend" name={`${getCompareLabelPrefix()}休息日`} stroke="#A5D6A7" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
                                                <Line type="monotone" dataKey="comp_holiday" name={`${getCompareLabelPrefix()}节假日`} stroke="#EF9A9A" strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
                                            </>
                                        )}
                                    </>
                                )}

                            </LineChart>
                        </ResponsiveContainer>
                    </Box>
                </Box>
            )}
        </Paper>
    );
};
