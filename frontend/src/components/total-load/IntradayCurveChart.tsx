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
    const [compareType, setCompareType] = useState<string>('yesterday');

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
                    compare_type: compareType,
                },
            });
            setTargetData(response.data.target);
            setCompareData(response.data.compare);
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
        const compareVal = compareData?.points?.[index]?.consumption;
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
        if (!compareData) return '对比日';
        if (compareData.is_average) return compareData.date;
        return compareData.date;
    };

    // Use usage TOU background hook
    const { TouPeriodAreas } = useTouPeriodBackground(chartData as TouPeriodData[]);

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', mr: 1, borderRadius: 1 }} />
                    <Typography variant="h6" fontSize="1rem" fontWeight="bold">
                        日内电量曲线
                    </Typography>
                </Box>

                {/* 控制栏 */}
                <Box sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 2,
                    alignItems: 'center',
                    bgcolor: 'grey.50',
                    p: 1,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider'
                }}>
                    {/* 日期选择 */}
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <IconButton size="small" onClick={() => handleDateShift(-1)} disabled={loading}>
                            <ArrowLeftIcon />
                        </IconButton>
                        <DatePicker
                            value={dateObj}
                            onChange={(date) => date && onDateChange(format(date, 'yyyy-MM-dd'))}
                            disabled={loading}
                            slotProps={{
                                textField: {
                                    size: 'small',
                                    variant: 'standard',
                                    InputProps: { disableUnderline: true },
                                    sx: {
                                        width: 140,
                                        '& .MuiInputBase-input': {
                                            textAlign: 'center',
                                            fontWeight: 500,
                                            fontSize: '0.9rem'
                                        }
                                    }
                                }
                            }}
                        />
                        <IconButton size="small" onClick={() => handleDateShift(1)} disabled={loading}>
                            <ArrowRightIcon />
                        </IconButton>
                    </Box>

                    {/* 对比选项 */}
                    <RadioGroup
                        row
                        value={compareType}
                        onChange={handleCompareTypeChange}
                        sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }}
                    >
                        <FormControlLabel value="yesterday" control={<Radio size="small" />} label="昨日" />
                        <FormControlLabel value="last_week" control={<Radio size="small" />} label="上周" />
                        <FormControlLabel value="last_year" control={<Radio size="small" />} label="去年" />
                        <FormControlLabel value="workday_avg" control={<Radio size="small" />} label="工作日均值" />
                    </RadioGroup>
                </Box>

                {/* 图表区域 */}
                {loading && !targetData ? (
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
                                // Remove focus outline for all chart elements
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
                                    <Legend />

                                    {/* 目标日曲线 */}
                                    <Line
                                        type="monotone"
                                        dataKey="target"
                                        name={selectedDate}
                                        stroke="#1976D2"
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={{ r: 4 }}
                                    />

                                    {/* 对比日曲线 */}
                                    {compareData && (
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

                {/* 无对比数据提示 */}
                {!compareData && !loading && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        对比日暂无数据
                    </Typography>
                )}
            </Paper>
        </LocalizationProvider>
    );
};

export default IntradayCurveChart;
