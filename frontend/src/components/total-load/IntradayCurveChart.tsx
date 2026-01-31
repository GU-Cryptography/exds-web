import React, { useEffect, useState, useRef } from 'react';
import {
    Box,
    Typography,
    Paper,
    CircularProgress,
    Alert,
    RadioGroup,
    Radio,
    FormControlLabel,
    IconButton,
    Checkbox,
    Stack,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { format, addDays, parseISO } from 'date-fns';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    Legend,
    ReferenceArea,
} from 'recharts';
import apiClient from '../../api/client';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { useTouPeriodBackground, TouPeriodData } from '../../hooks/useTouPeriodBackground';

interface CurvePoint {
    time: string;
    consumption: number;
    period_type: string;
}

interface CurveData {
    date: string;
    points: CurvePoint[];
    total: number;
    period_breakdown: Record<string, number>;
    is_average?: boolean;
}

interface IntradayCurveChartProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
}

// 自定义 Tooltip
const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <Paper sx={{ p: 1.5, boxShadow: 3 }}>
                <Typography variant="subtitle2" fontWeight="bold">{label}</Typography>
                {payload.map((entry: any, index: number) => (
                    <Typography key={index} variant="body2" sx={{ color: entry.color }}>
                        {entry.name}: {entry.value?.toFixed(1)} MWh
                    </Typography>
                ))}
            </Paper>
        );
    }
    return null;
};

export const IntradayCurveChart: React.FC<IntradayCurveChartProps> = ({
    selectedDate,
    onDateChange,
}) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [targetData, setTargetData] = useState<CurveData | null>(null);
    const [compareData, setCompareData] = useState<CurveData | null>(null);
    const [marketTypicalData, setMarketTypicalData] = useState<CurveData | null>(null);
    const [businessTypicalData, setBusinessTypicalData] = useState<CurveData | null>(null);
    const [compareType, setCompareType] = useState<string>('yesterday');

    // 典型曲线显示控制 - 已移除，改为单选

    const chartRef = useRef<HTMLDivElement>(null);
    const dateObj = selectedDate ? parseISO(selectedDate) : new Date();

    // 全屏 Hook
    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons,
    } = useChartFullscreen({
        chartRef,
        title: `日内电量曲线 (${selectedDate})`,
        onPrevious: () => handleDateShift(-1),
        onNext: () => handleDateShift(1),
    });

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await apiClient.get('/api/v1/total-load/curve', {
                params: {
                    date: selectedDate,
                    // If typical selected, send 'none' or keep existing logic?
                    // Backend ignores unknown types for 'compare' field but still returns typical data.
                    // So we can just pass the value.
                    compare_type: compareType,
                },
            });
            setTargetData(response.data.target);
            setCompareData(response.data.compare);
            setMarketTypicalData(response.data.market_typical);
            setBusinessTypicalData(response.data.business_typical);
        } catch (err: any) {
            console.error('Failed to fetch curve data:', err);
            setError(err.response?.data?.detail || err.message || '加载失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedDate) {
            fetchData();
        }
    }, [selectedDate, compareType]);

    const handleDateShift = (days: number) => {
        const newDate = addDays(dateObj, days);
        onDateChange(format(newDate, 'yyyy-MM-dd'));
    };

    const handleCompareTypeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setCompareType(event.target.value);
    };

    // 合并数据用于图表
    const chartData = targetData?.points?.map((point, index) => {
        let compareVal = null;

        if (compareType === 'market_typical') {
            compareVal = marketTypicalData?.points?.[index]?.consumption;
        } else if (compareType === 'business_typical') {
            compareVal = businessTypicalData?.points?.[index]?.consumption;
        } else {
            compareVal = compareData?.points?.[index]?.consumption;
        }

        return {
            time: point.time,
            target: typeof point.consumption === 'number' ? point.consumption : null,
            compare: typeof compareVal === 'number' ? compareVal : null,
            period_type: point.period_type,
        };
    }) || [];

    console.log('IntradayCurveChart chartData:', chartData);

    // 获取对比日期标签
    const getCompareLabel = () => {
        if (compareType === 'market_typical') return '市场化典型曲线';
        if (compareType === 'business_typical') return '工商业典型曲线';
        if (!compareData) return '对比日';
        if (compareData.is_average) return compareData.date;
        return compareData.date;
    };

    // Use usage TOU background hook
    const { TouPeriodAreas } = useTouPeriodBackground(chartData as TouPeriodData[]);

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {/* Header Row: Title, DatePicker, Fullscreen Button */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 32, mb: 1.5, flexShrink: 0 }}>
                        <Stack direction="row" alignItems="center">
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                <Typography variant="h6" fontSize="0.95rem" fontWeight="bold">日内电量曲线</Typography>
                            </Stack>

                            {/* Integrated Date Picker (Desktop) */}
                            {!isFullscreen && (
                                <Box sx={{
                                    display: { xs: 'none', sm: 'flex' },
                                    alignItems: 'center',
                                    bgcolor: 'grey.50',
                                    borderRadius: 2,
                                    px: 0.5,
                                    py: 0.25,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    ml: 2
                                }}>
                                    <IconButton size="small" onClick={() => handleDateShift(-1)} disabled={loading}>
                                        <ArrowLeftIcon fontSize="small" />
                                    </IconButton>
                                    <DatePicker
                                        value={dateObj}
                                        onChange={(date) => date && onDateChange(format(date, 'yyyy-MM-dd'))}
                                        disabled={loading}
                                        slotProps={{
                                            textField: {
                                                variant: 'standard',
                                                size: 'small',
                                                InputProps: { disableUnderline: true },
                                                sx: {
                                                    width: 140,
                                                    '& .MuiInputBase-input': {
                                                        textAlign: 'center',
                                                        fontSize: '0.875rem',
                                                        fontWeight: 500,
                                                        py: 0.3,
                                                        cursor: 'pointer'
                                                    }
                                                }
                                            }
                                        }}
                                    />
                                    <IconButton size="small" onClick={() => handleDateShift(1)} disabled={loading}>
                                        <ArrowRightIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            )}
                        </Stack>

                        <Box>
                            <FullscreenEnterButton />
                            <FullscreenExitButton />
                        </Box>
                    </Box>

                    {/* Integrated Date Picker (Mobile) */}
                    {!isFullscreen && (
                        <Box sx={{
                            display: { xs: 'flex', sm: 'none' },
                            alignItems: 'center',
                            bgcolor: 'grey.50',
                            borderRadius: 2,
                            px: 0.5,
                            py: 0.25,
                            border: '1px solid',
                            borderColor: 'divider',
                            mb: 2,
                            alignSelf: 'flex-start'
                        }}>
                            <IconButton size="small" onClick={() => handleDateShift(-1)} disabled={loading}>
                                <ArrowLeftIcon fontSize="small" />
                            </IconButton>
                            <DatePicker
                                value={dateObj}
                                onChange={(date) => date && onDateChange(format(date, 'yyyy-MM-dd'))}
                                disabled={loading}
                                slotProps={{
                                    textField: {
                                        variant: 'standard',
                                        size: 'small',
                                        InputProps: { disableUnderline: true },
                                        sx: {
                                            width: 130,
                                            '& .MuiInputBase-input': {
                                                textAlign: 'center',
                                                fontSize: '0.75rem',
                                                fontWeight: 500,
                                                py: 0.3,
                                                cursor: 'pointer'
                                            }
                                        }
                                    }
                                }}
                            />
                            <IconButton size="small" onClick={() => handleDateShift(1)} disabled={loading}>
                                <ArrowRightIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    )}

                    {/* Controls Row: Comparison Options */}
                    {!isFullscreen && (
                        <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center' }}>
                            <RadioGroup
                                row
                                value={compareType}
                                onChange={handleCompareTypeChange}
                                sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.85rem' } }}
                            >
                                <FormControlLabel value="yesterday" control={<Radio size="small" sx={{ p: 0.5 }} />} label="昨日" />
                                <FormControlLabel value="last_week" control={<Radio size="small" sx={{ p: 0.5 }} />} label="上周" />
                                <FormControlLabel value="last_year" control={<Radio size="small" sx={{ p: 0.5 }} />} label="去年" />
                                <FormControlLabel value="workday_avg" control={<Radio size="small" sx={{ p: 0.5 }} />} label="工作日均值" />
                                <FormControlLabel value="market_typical" control={<Radio size="small" sx={{ p: 0.5 }} />} label="市场化典型" />
                                <FormControlLabel value="business_typical" control={<Radio size="small" sx={{ p: 0.5 }} />} label="工商业典型" />
                            </RadioGroup>
                        </Box>
                    )}

                    {/* Chart Area */}
                    {loading && !targetData ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                            <CircularProgress />
                        </Box>
                    ) : error ? (
                        <Alert severity="error">{error}</Alert>
                    ) : (
                        <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
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
                                    height: '100%',
                                    minHeight: 300,
                                    position: 'relative',
                                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                                    p: isFullscreen ? 2 : 0,
                                    ...(isFullscreen && {
                                        position: 'fixed',
                                        top: 0, left: 0,
                                        width: '100vw', height: '100vh',
                                        zIndex: 1400,
                                    }),
                                    '& *:focus': {
                                        outline: 'none !important'
                                    }
                                }}
                            >
                                <FullscreenEnterButton />
                                <FullscreenExitButton />
                                <FullscreenTitle />
                                <NavigationButtons />

                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                        {TouPeriodAreas}
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                                        <XAxis
                                            dataKey="time"
                                            tick={{ fontSize: 11, fill: '#888' }}
                                            tickLine={{ stroke: '#ccc' }}
                                            axisLine={{ stroke: '#ccc' }}
                                            interval={11}
                                            tickFormatter={(value, index) => {
                                                const totalPoints = chartData.length;
                                                if (index === 0) return '00:30';
                                                if (index === totalPoints - 1) return '24:00';
                                                return value;
                                            }}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 11, fill: '#888' }}
                                            tickLine={{ stroke: '#ccc' }}
                                            axisLine={{ stroke: '#ccc' }}
                                            label={{ value: 'MWh', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#888' }}
                                        />
                                        <RechartsTooltip content={<CustomTooltip unit="MWh" />} />
                                        <Legend wrapperStyle={{ top: -5 }} />

                                        <Line
                                            type="monotone"
                                            dataKey="target"
                                            name={selectedDate}
                                            stroke="#1976D2"
                                            strokeWidth={2}
                                            dot={false}
                                            activeDot={{ r: 4 }}
                                        />

                                        {(compareData || compareType === 'market_typical' || compareType === 'business_typical') && (
                                            <Line
                                                type="monotone"
                                                dataKey="compare"
                                                name={getCompareLabel()}
                                                stroke="#9E9E9E"
                                                strokeWidth={1.5}
                                                strokeDasharray="5 5"
                                                dot={false}
                                            />
                                        )}
                                    </LineChart>
                                </ResponsiveContainer>
                            </Box>
                        </Box>
                    )}

                    {!compareData && !loading && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            对比日暂无数据
                        </Typography>
                    )}
                </Box>
            </Paper>
        </LocalizationProvider>
    );
};

export default IntradayCurveChart;
