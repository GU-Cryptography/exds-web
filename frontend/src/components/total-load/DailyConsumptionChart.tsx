import React, { useEffect, useState, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    CircularProgress,
    Alert,
    IconButton,
    Stack,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    ReferenceLine,
    Cell,
    Legend
} from 'recharts';
import apiClient from '../../api/client';

interface DayData {
    date: string;
    consumption: number | null;
    day_type: 'workday' | 'weekend' | 'holiday' | 'adjusted_workday';
    holiday_name: string | null;
    weekday: number;
    tou_usage?: {
        tip: number;
        peak: number;
        flat: number;
        valley: number;
        deep: number;
    };
}

interface DailyResponse {
    month: string;
    days: DayData[];
    avg_consumption: number;
    total_consumption: number;
}

interface DailyConsumptionChartProps {
    month: string;
    onMonthChange: (month: string) => void;
    onDaySelect: (date: string) => void;
    selectedDate: string;
}

// TOU 颜色配置 (Consistent with MonthlyConsumptionChart)
const COLORS = {
    tip: '#FF5252',      // 尖峰
    peak: '#FF9800',     // 高峰
    flat: '#4CAF50',     // 平段
    valley: '#2196F3',   // 低谷
    deep: '#3F51B5'      // 深谷
};

// TOU Colors - Light (Unselected)
const COLORS_LIGHT = {
    tip: '#FFCDD2',      // Red 100
    peak: '#FFE0B2',     // Orange 100
    flat: '#C8E6C9',     // Green 100
    valley: '#BBDEFB',   // Blue 100
    deep: '#C5CAE9'      // Indigo 100
};

// Log Colors for XAxis
const DAY_TICK_COLORS = {
    workday: '#666666',      // 普通工作日
    weekend: '#4CAF50',      // 周末 (Green)
    holiday: '#F44336',      // 节假日 (Red)
    adjusted_workday: '#333' // 调休
};

// 自定义 Tooltip
const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        // payload[0] usually contains the first stack item, we need the original payload
        const data = payload[0].payload as DayData;
        if (data.consumption === null) return null;

        const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        const dayTypeNames: Record<string, string> = {
            workday: '工作日',
            weekend: '周末',
            holiday: '节假日',
            adjusted_workday: '调休工作日',
        };

        const hasTou = data.tou_usage && (data.tou_usage.tip + data.tou_usage.peak + data.tou_usage.flat + data.tou_usage.valley + data.tou_usage.deep > 0);

        return (
            <Paper elevation={4} sx={{
                p: 2,
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                backdropFilter: 'blur(4px)',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                minWidth: 160
            }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5, color: '#263238', borderBottom: '1px solid #eee', pb: 0.5 }}>
                    {data.date} <span style={{ fontSize: '0.75em', fontWeight: 'normal' }}>({dayNames[data.weekday]})</span>
                </Typography>

                <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        {dayTypeNames[data.day_type]}
                        {data.holiday_name && ` - ${data.holiday_name}`}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" fontWeight="bold">总电量</Typography>
                    <Typography variant="body2" fontWeight="bold">{data.consumption.toFixed(1)} <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>MWh</span></Typography>
                </Box>

                {hasTou && data.tou_usage && (
                    <Box sx={{ pl: 1, borderLeft: '2px solid #eee' }}>
                        {[
                            { label: '尖峰', key: 'tip', color: COLORS.tip, val: data.tou_usage.tip },
                            { label: '高峰', key: 'peak', color: COLORS.peak, val: data.tou_usage.peak },
                            { label: '平段', key: 'flat', color: COLORS.flat, val: data.tou_usage.flat },
                            { label: '低谷', key: 'valley', color: COLORS.valley, val: data.tou_usage.valley },
                            { label: '深谷', key: 'deep', color: COLORS.deep, val: data.tou_usage.deep },
                        ].map(item => {
                            const total = data.consumption || 0;
                            const percent = total > 0 ? (item.val / total * 100).toFixed(1) : '0.0';

                            return (item.val > 0) && (
                                <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.3 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: item.color, mr: 0.8 }} />
                                        <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                                    </Box>
                                    <Box sx={{ textAlign: 'right' }}>
                                        <Typography variant="caption" fontWeight="500" sx={{ mr: 1 }}>{item.val.toFixed(1)}</Typography>
                                        <Typography variant="caption" color="text.secondary">({percent}%)</Typography>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Paper>
        );
    }
    return null;
};

// 自定义 X轴 Tick
const CustomizedAxisTick: React.FC<any> = (props) => {
    const { x, y, stroke, payload } = props;
    // payload.value is date string
    // We need to find the day type for this date from the props (but props only gives index/value)
    // Trick: pass data map to the tick or lookup?
    // Easiest is to format the value simple, but verify color in formatting?
    // We can't easily access the full data record here unless we pass it down contextually
    // Simplified: Just use the date string for display. 
    // To color it, we need data.
    // We will use tickFormatter on the Axis, but coloring the Tick component requires knowledge of the day.
    // Let's rely on finding the data item by matching payload.value (date) string within the data array?
    // 'props.data' might be passed if we inject it? No.
    // workaround: passed `userData` prop is not standard.
    // We'll accept standard props and render.

    return (
        <g transform={`translate(${x},${y})`}>
            <text x={0} y={0} dy={16} textAnchor="middle" fill="#666" fontSize={11}>
                {payload.value.split('-')[2].replace(/^0/, '')}
            </text>
        </g>
    );
};


export const DailyConsumptionChart: React.FC<DailyConsumptionChartProps> = ({
    month,
    onMonthChange,
    onDaySelect,
    selectedDate,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DailyResponse | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await apiClient.get('/api/v1/total-load/daily', {
                    params: { month },
                });
                setData(response.data);
            } catch (err: any) {
                console.error('Failed to fetch daily data:', err);
                setError(err.response?.data?.detail || err.message || '加载失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [month]);

    const processedData = useMemo(() => {
        if (!data || !data.days) return [];
        return data.days.map(day => ({
            ...day,
            // Flatten TOU for stacking
            tip: day.tou_usage?.tip || 0,
            peak: day.tou_usage?.peak || 0,
            flat: day.tou_usage?.flat || 0,
            valley: day.tou_usage?.valley || 0,
            deep: day.tou_usage?.deep || 0,
        }));
    }, [data]);

    const lastLoadedMonth = React.useRef<string | null>(null);

    // 自动选择最后有数据的一天
    // 自动选择最后有数据的一天
    useEffect(() => {
        // Ensure we have data, and the data matches the currently requested month
        if (processedData.length > 0 && data?.month === month) {
            // Only auto-select if we haven't done so for this month yet
            if (lastLoadedMonth.current !== month) {
                // BUG FIX: If the currently selectedDate is already in this month, 
                // it means the user (or parent logic) explicitly selected a date (e.g. from Intraday Chart).
                // We should respect that and NOT override it with the last day.
                // Note: When switching months via Header, parent sets date to YYYY-MM-01, 
                // so this will startWith(month) and we will show 01. This is acceptable/safer than overriding.
                if (selectedDate && selectedDate.startsWith(month)) {
                    lastLoadedMonth.current = month;
                    return;
                }

                // Find the last day with *valid* data (consumption > 0)
                const validDays = processedData.filter(d => d.consumption !== null && d.consumption > 0);

                // If we have valid days, pick the last one. Otherwise fallback to the last day in the list
                const lastDayItem = validDays.length > 0 ? validDays[validDays.length - 1] : processedData[processedData.length - 1];

                if (lastDayItem) {
                    onDaySelect(lastDayItem.date);
                }

                // Mark this month as processed to prevent future auto-selections (which would override manual clicks)
                lastLoadedMonth.current = month;
            }
        }
    }, [processedData, month, data, onDaySelect, selectedDate]);

    // 月份导航
    const handleMonthShift = (direction: number) => {
        const [year, mon] = month.split('-').map(Number);
        let newYear = year;
        let newMonth = mon + direction;

        if (newMonth > 12) {
            newMonth = 1;
            newYear++;
        } else if (newMonth < 1) {
            newMonth = 12;
            newYear--;
        }

        // Limit range roughly
        if (newYear < 2020) return;

        onMonthChange(`${newYear}-${String(newMonth).padStart(2, '0')}`);
    };

    const handleBarItemClick = (data: any, index: number, e: any) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (data && data.date) {
            onDaySelect(data.date);
        }
    };

    const handleChartClick = (data: any) => {
        if (data && data.activePayload && data.activePayload[0]) {
            const dayData = data.activePayload[0].payload as DayData;
            onDaySelect(dayData.date);
        }
    };

    // Custom Tick Component with Data access
    const CustomTick = (props: any) => {
        const { x, y, payload } = props;
        const dateStr = payload.value;
        const dayItem = processedData.find(d => d.date === dateStr);
        let fill = DAY_TICK_COLORS.workday;

        if (dayItem) {
            if (dayItem.day_type === 'holiday') fill = DAY_TICK_COLORS.holiday;
            else if (dayItem.day_type === 'weekend') fill = DAY_TICK_COLORS.weekend;
        }

        // Highlight selected date
        const isSelected = dateStr === selectedDate;
        const fontWeight = isSelected ? 'bold' : (fill === DAY_TICK_COLORS.workday ? "normal" : "bold");
        const fontSize = isSelected ? 13 : 11;

        return (
            <g transform={`translate(${x},${y})`}>
                <text x={0} y={0} dy={16} textAnchor="middle" fill={fill} fontSize={fontSize} fontWeight={fontWeight}>
                    {dateStr.split('-')[2].replace(/^0/, '')}
                </text>
            </g>
        );
    };

    // Custom Legend Content
    const renderLegend = (props: any) => {
        return (
            <Stack direction="row" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap', justifyContent: 'flex-end', fontSize: '0.75rem' }}>
                <Typography variant="caption" sx={{ mr: 1, fontWeight: 'bold', color: '#666', display: 'flex', alignItems: 'center' }}>
                    日期颜色:
                    <span style={{ color: DAY_TICK_COLORS.workday, marginLeft: 4 }}>工作日</span>/
                    <span style={{ color: DAY_TICK_COLORS.weekend, margin: '0 2px' }}>周末</span>/
                    <span style={{ color: DAY_TICK_COLORS.holiday, margin: '0 2px' }}>节假日</span>
                </Typography>
                {/* TOU Legend */}
                {Object.entries(COLORS).map(([key, color]) => {
                    const labels: any = { tip: '尖峰', peak: '高峰', flat: '平段', valley: '低谷', deep: '深谷' };
                    return (
                        <Box key={key} sx={{ display: 'flex', alignItems: 'center' }}>
                            <Box sx={{ width: 10, height: 10, bgcolor: color, borderRadius: '50%', mr: 0.5 }} />
                            <Typography variant="caption" color="text.secondary">{labels[key]}</Typography>
                        </Box>
                    )
                })}
            </Stack>
        );
    };

    if (loading && !data) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
    }

    return (
        <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
            {/* 标题和月份导航 */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', mr: 1, borderRadius: 1 }} />
                    <Typography variant="h6" fontSize="1rem" fontWeight="bold">
                        日电量分布
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'grey.50', px: 0.5, py: 0.25, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                    <IconButton
                        size="small"
                        onClick={() => handleMonthShift(-1)}
                        disabled={loading}
                    >
                        <ArrowLeftIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="body2" sx={{ minWidth: 70, textAlign: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        {month}
                    </Typography>
                    <IconButton
                        size="small"
                        onClick={() => handleMonthShift(1)}
                        disabled={loading}
                    >
                        <ArrowRightIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Box>

            {/* 图表区域 */}
            <Box sx={{ position: 'relative', height: { xs: 210, sm: 250 }, width: '100%', '& .recharts-surface:focus': { outline: 'none' } }}>
                {loading && (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            zIndex: 1000,
                        }}
                    >
                        <CircularProgress />
                    </Box>
                )}
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={processedData}
                        onClick={handleChartClick}
                        margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                        barCategoryGap="20%"
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cfd8dc" strokeOpacity={0.8} />
                        <XAxis
                            dataKey="date"
                            tick={<CustomTick />}
                            axisLine={{ stroke: '#ccc' }}
                            tickLine={{ stroke: '#ccc' }}
                            interval={0}
                        />
                        <YAxis
                            tickFormatter={(value) => value.toFixed(0)}
                            tick={{ fontSize: 11, fill: '#888' }}
                            axisLine={{ stroke: '#ccc' }}
                            tickLine={{ stroke: '#ccc' }}
                            label={{
                                value: 'MWh',
                                angle: -90,
                                position: 'insideLeft',
                                fontSize: 11,
                                fill: '#888'
                            }}
                        />
                        <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                        <Legend content={renderLegend} verticalAlign="top" height={36} />

                        {/* Stacks for TOU */}
                        <Bar
                            dataKey="tip"
                            stackId="a"
                            name="尖峰"
                            fill={COLORS.tip}
                            cursor="pointer"
                        >
                            {processedData.map((entry, index) => (
                                <Cell
                                    key={`cell-t-${index}`}
                                    fill={entry.date === selectedDate ? COLORS.tip : COLORS_LIGHT.tip}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDaySelect(entry.date);
                                    }}
                                    cursor="pointer"
                                />
                            ))}
                        </Bar>

                        <Bar
                            dataKey="peak"
                            stackId="a"
                            name="高峰"
                            fill={COLORS.peak}
                            cursor="pointer"
                        >
                            {processedData.map((entry, index) => (
                                <Cell
                                    key={`cell-p-${index}`}
                                    fill={entry.date === selectedDate ? COLORS.peak : COLORS_LIGHT.peak}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDaySelect(entry.date);
                                    }}
                                    cursor="pointer"
                                />
                            ))}
                        </Bar>

                        <Bar
                            dataKey="flat"
                            stackId="a"
                            name="平段"
                            fill={COLORS.flat}
                            cursor="pointer"
                        >
                            {processedData.map((entry, index) => (
                                <Cell
                                    key={`cell-f-${index}`}
                                    fill={entry.date === selectedDate ? COLORS.flat : COLORS_LIGHT.flat}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDaySelect(entry.date);
                                    }}
                                    cursor="pointer"
                                />
                            ))}
                        </Bar>

                        <Bar
                            dataKey="valley"
                            stackId="a"
                            name="低谷"
                            fill={COLORS.valley}
                            cursor="pointer"
                        >
                            {processedData.map((entry, index) => (
                                <Cell
                                    key={`cell-v-${index}`}
                                    fill={entry.date === selectedDate ? COLORS.valley : COLORS_LIGHT.valley}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDaySelect(entry.date);
                                    }}
                                    cursor="pointer"
                                />
                            ))}
                        </Bar>

                        <Bar
                            dataKey="deep"
                            stackId="a"
                            name="深谷"
                            fill={COLORS.deep}
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                        >
                            {processedData.map((entry, index) => (
                                <Cell
                                    key={`cell-d-${index}`}
                                    fill={entry.date === selectedDate ? COLORS.deep : COLORS_LIGHT.deep}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDaySelect(entry.date);
                                    }}
                                    cursor="pointer"
                                />
                            ))}
                        </Bar>

                        {/* Reference Line */}
                        {data?.avg_consumption && data.avg_consumption > 0 && (
                            <ReferenceLine
                                y={data.avg_consumption}
                                stroke="#9E9E9E"
                                strokeDasharray="5 5"
                                label={{
                                    value: `日均 ${data.avg_consumption.toFixed(1)}`,
                                    position: 'right',
                                    fontSize: 10,
                                    fill: '#666',
                                }}
                            />
                        )}
                    </BarChart>
                </ResponsiveContainer>
            </Box>


        </Paper>
    );
};

export default DailyConsumptionChart;
