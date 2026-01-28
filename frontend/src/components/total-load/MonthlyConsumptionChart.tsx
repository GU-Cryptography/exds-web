import React, { useEffect, useState, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    CircularProgress,
    Alert,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    Legend,
    Cell,
} from 'recharts';
import apiClient from '../../api/client';

interface MonthlyData {
    month: string;
    consumption: number; // MWh
    consumption_wan: number;
    is_complete: boolean;
    days_count: number;
    yoy_change: number | null;
    tou_usage?: {
        tip: number;
        peak: number;
        flat: number;
        valley: number;
        deep: number;
    };
}

interface ChartDataPoint {
    monthLabel: string;
    monthIndex: number; // 1-12
    lastYearValue: number | null;

    // Total for refernece
    currentYearValue: number | null;

    // Stacked Components for Current Year
    currentTip: number;
    currentPeak: number;
    currentFlat: number;
    currentValley: number;
    currentDeep: number;

    lastYearData?: MonthlyData;
    currentYearData?: MonthlyData;
}

interface MonthlyConsumptionChartProps {
    onMonthSelect: (month: string) => void;
    selectedMonth: string;
}

// TOU Colors - Premium Palette (Vibrant)
const COLORS = {
    lastYear: '#90A4AE', // Blue Grey 300 (Darker for visibility)
    tip: '#FF5252',      // Red Accent 200
    peak: '#FF9800',     // Orange 500
    flat: '#4CAF50',     // Green 500
    valley: '#2196F3',   // Blue 500
    deep: '#3F51B5'      // Indigo 500
};

// TOU Colors - Light Palette (Unselected)
const COLORS_LIGHT = {
    lastYear: '#CFD8DC', // Blue Grey 100
    tip: '#FFCDD2',      // Red 100
    peak: '#FFE0B2',     // Orange 100
    flat: '#C8E6C9',     // Green 100
    valley: '#BBDEFB',     // Blue 100
    deep: '#C5CAE9'      // Indigo 100
};

// 自定义 Tooltip
const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        // Collect data
        let lastYearInfo: MonthlyData | null = null;
        let currentYearInfo: MonthlyData | null = null;

        payload.forEach((entry: any) => {
            if (entry.dataKey === 'lastYearValue') {
                lastYearInfo = entry.payload.lastYearData;
            } else if (entry.dataKey.startsWith('current')) {
                // Any current stack part has the payload reference
                currentYearInfo = entry.payload.currentYearData;
            }
        });

        return (
            <Paper
                elevation={4}
                sx={{
                    p: 2,
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                    minWidth: 180
                }}
            >
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5, color: '#263238', borderBottom: '1px solid #eee', pb: 0.5 }}>
                    {label}
                </Typography>

                {/* 去年数据 */}
                {lastYearInfo && (
                    <Box sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: 10, height: 10, backgroundColor: COLORS.lastYear, mr: 1, borderRadius: '2px' }} />
                                <Typography variant="body2" color="text.secondary">去年同期</Typography>
                            </Box>
                            <Typography variant="body2" fontWeight="bold">{(lastYearInfo as MonthlyData).consumption.toFixed(1)} <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>MWh</span></Typography>
                        </Box>
                    </Box>
                )}

                {/* 今年数据总览 */}
                {currentYearInfo && (
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="body2" color="text.primary" fontWeight="bold">当年累计</Typography>
                            <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="body2" fontWeight="bold">{(currentYearInfo as MonthlyData).consumption.toFixed(1)} <span style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>MWh</span></Typography>
                                {(currentYearInfo as MonthlyData).yoy_change !== null && (
                                    <Typography variant="caption" sx={{ color: (currentYearInfo as MonthlyData).yoy_change! >= 0 ? '#d32f2f' : '#2e7d32', fontWeight: 'bold' }}>
                                        同比 {(currentYearInfo as MonthlyData).yoy_change! > 0 ? '+' : ''}{(currentYearInfo as MonthlyData).yoy_change}%
                                    </Typography>
                                )}
                            </Box>
                        </Box>

                        {/* TOU 明细 */}
                        <Box sx={{ pl: 1, borderLeft: '2px solid #eee' }}>
                            {[
                                { label: '尖峰', key: 'tip', color: COLORS.tip, val: (currentYearInfo as MonthlyData).tou_usage?.tip || 0 },
                                { label: '高峰', key: 'peak', color: COLORS.peak, val: (currentYearInfo as MonthlyData).tou_usage?.peak || 0 },
                                { label: '平段', key: 'flat', color: COLORS.flat, val: (currentYearInfo as MonthlyData).tou_usage?.flat || 0 },
                                { label: '低谷', key: 'valley', color: COLORS.valley, val: (currentYearInfo as MonthlyData).tou_usage?.valley || 0 },
                                { label: '深谷', key: 'deep', color: COLORS.deep, val: (currentYearInfo as MonthlyData).tou_usage?.deep || 0 },
                            ].map(item => {
                                const total = (currentYearInfo as MonthlyData).consumption;
                                const percent = total > 0 ? (item.val / total * 100).toFixed(1) : '0.0';

                                return (item.val > 0) && (
                                    <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.3 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: item.color, mr: 0.8 }} />
                                            <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                                        </Box>
                                        <Typography variant="caption" fontWeight="bold">{percent}%</Typography>
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                )}
            </Paper>
        );
    }
    return null;
};

export const MonthlyConsumptionChart: React.FC<MonthlyConsumptionChartProps> = ({
    onMonthSelect,
    selectedMonth,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rawData, setRawData] = useState<MonthlyData[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                // 后端接口虽然可能接受参数，但逻辑已改为"自动使用当前月往前推两年"
                // 传参保持兼容
                const response = await apiClient.get('/api/v1/total-load/monthly', {
                    params: {
                        start_month: '2025-01', // 这里的参数实际后端可能忽略了，或作为backup
                        end_month: '2026-12',
                    },
                });
                setRawData(response.data.data || []);
            } catch (err: any) {
                console.error('Failed to fetch monthly data:', err);
                setError(err.response?.data?.detail || err.message || '加载失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // 处理数据：转换为 1-12 月的对比结构
    const processedData = useMemo(() => {
        const defaultRet = {
            chartData: [] as ChartDataPoint[],
            lastYear: new Date().getFullYear() - 1,
            currentYear: new Date().getFullYear()
        };

        if (!rawData.length) return defaultRet;

        // 识别年份
        // 假设数据里涵盖了 去年 和 今年
        // 我们取数据中最大的年份作为"今年"
        const years = Array.from(new Set(rawData.map(d => parseInt(d.month.split('-')[0]))));
        if (years.length === 0) return defaultRet;

        const currentYear = Math.max(...years);
        const lastYear = currentYear - 1;

        const chartData: ChartDataPoint[] = [];

        for (let m = 1; m <= 12; m++) {
            const mStr = String(m).padStart(2, '0');
            const lastYearMonth = `${lastYear}-${mStr}`;
            const currentYearMonth = `${currentYear}-${mStr}`;

            const lastData = rawData.find(d => d.month === lastYearMonth);
            const currData = rawData.find(d => d.month === currentYearMonth);

            chartData.push({
                monthLabel: `${m}月`,
                monthIndex: m,
                lastYearValue: lastData ? lastData.consumption : null,
                currentYearValue: currData ? currData.consumption : null, // 未来月份可能为null或0

                // Extract TOU
                currentTip: currData?.tou_usage?.tip || 0,
                currentPeak: currData?.tou_usage?.peak || 0,
                currentFlat: currData?.tou_usage?.flat || 0,
                currentValley: currData?.tou_usage?.valley || 0,
                currentDeep: currData?.tou_usage?.deep || 0,

                lastYearData: lastData,
                currentYearData: currData
            });
        }
        return { chartData, lastYear, currentYear };
    }, [rawData]);

    const { chartData, lastYear, currentYear } = processedData;

    // 处理特定年份柱子的点击
    const handleYearBarClick = (data: any, isCurrentYear: boolean, e?: React.MouseEvent) => {
        // e?.stopPropagation(); // Remove stopPropagation to allow bubbling if needed, but we want specific logic.
        // Actually, if we stop propagation, BarChart onClick won't fire.
        // If we DON'T stop, BarChart onClick fires. BarChart click logic (below) prefers currentYearData.
        // So if I click Last Year bar, and don't stop prop, ChartClick runs and selects Current Year month!
        // So I MUST stop propagation.
        e?.stopPropagation();

        // Compatibility: Recharts sometimes passes the data item directly in `data` or in `data.payload`.
        // When using Cell, `data` might be the specific cell data payload?
        const point = data?.payload || data;

        if (!point) return;

        if (isCurrentYear && point.currentYearData) {
            onMonthSelect(point.currentYearData.month);
        } else if (!isCurrentYear && point.lastYearData) {
            onMonthSelect(point.lastYearData.month);
        }
    };

    // 处理图表背景点击 (默认优先选今年，没有则选去年)
    const handleChartClick = (data: any) => {
        if (data && data.activePayload && data.activePayload.length) {
            const point = data.activePayload[0].payload as ChartDataPoint;
            if (point.currentYearData) {
                onMonthSelect(point.currentYearData.month);
            } else if (point.lastYearData) {
                onMonthSelect(point.lastYearData.month);
            }
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
        );
    }

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 2,
                height: '100%',
                background: 'linear-gradient(to bottom, #ffffff, #fafafa)',
                borderRadius: 2
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Box
                    sx={{
                        width: 4,
                        height: 18,
                        background: 'linear-gradient(180deg, #1976D2 0%, #64B5F6 100%)',
                        mr: 1.5,
                        borderRadius: 1
                    }}
                />
                <Typography variant="subtitle1" fontWeight="700" color="#2c3e50">
                    月度电量对比 ({lastYear} vs {currentYear})
                </Typography>
            </Box>

            <Box sx={{ height: { xs: 210, sm: 250 }, width: '100%', '& .recharts-surface:focus': { outline: 'none' } }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                        barGap={2} // 紧凑间距
                        onClick={handleChartClick}
                    >
                        {/* 加深的网格线 */}
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cfd8dc" strokeOpacity={0.8} />
                        <XAxis
                            dataKey="monthLabel"
                            tick={{ fontSize: 12, fill: '#546e7a', fontWeight: 500 }}
                            axisLine={{ stroke: '#cfd8dc' }}
                            tickLine={false}
                            dy={10}
                        />
                        <YAxis
                            tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                            tick={{ fontSize: 11, fill: '#78909c' }}
                            axisLine={false}
                            tickLine={false}
                            label={{
                                value: 'MWh',
                                angle: -90,
                                position: 'insideLeft',
                                fontSize: 11,
                                fill: '#78909c',
                                offset: 0
                            }}
                        />
                        <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                        <Legend
                            verticalAlign="top"
                            align="right"
                            height={36}
                            iconType="circle"
                            formatter={(value) => <span style={{ color: '#455a64', fontSize: '12px', fontWeight: 500 }}>{value}</span>}
                        />

                        {/* 去年 - 单柱 */}
                        <Bar
                            name={`${lastYear}年`}
                            dataKey="lastYearValue"
                            fill={COLORS.lastYear}  // Legend color
                            radius={[2, 2, 0, 0]}
                            barSize={isMobile ? 8 : 16}
                            animationDuration={1500}
                            onClick={(data, index, e) => handleYearBarClick(data, false, e)}
                            cursor="pointer"
                        >
                            {
                                chartData.map((entry, index) => {
                                    const isSelected = entry.lastYearData && entry.lastYearData.month === selectedMonth;
                                    // User requested Blue for selected Last Year bar
                                    return <Cell key={`cell-${index}`} fill={isSelected ? COLORS.valley : COLORS_LIGHT.lastYear} />;
                                })
                            }
                        </Bar>

                        {/* 今年 - 堆叠柱 */}
                        <Bar
                            name="深谷"
                            dataKey="currentDeep"
                            stackId="current"
                            fill={COLORS.deep}
                            barSize={isMobile ? 8 : 16}
                            onClick={(data, index, e) => handleYearBarClick(data, true, e)}
                            cursor="pointer"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-d-${index}`} fill={entry.currentYearData?.month === selectedMonth ? COLORS.deep : COLORS_LIGHT.deep} />
                            ))}
                        </Bar>

                        <Bar
                            name="低谷"
                            dataKey="currentValley"
                            stackId="current"
                            fill={COLORS.valley}
                            barSize={isMobile ? 8 : 16}
                            onClick={(data, index, e) => handleYearBarClick(data, true, e)}
                            cursor="pointer"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-v-${index}`} fill={entry.currentYearData?.month === selectedMonth ? COLORS.valley : COLORS_LIGHT.valley} />
                            ))}
                        </Bar>

                        <Bar
                            name="平段"
                            dataKey="currentFlat"
                            stackId="current"
                            fill={COLORS.flat}
                            barSize={isMobile ? 8 : 16}
                            onClick={(data, index, e) => handleYearBarClick(data, true, e)}
                            cursor="pointer"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-f-${index}`} fill={entry.currentYearData?.month === selectedMonth ? COLORS.flat : COLORS_LIGHT.flat} />
                            ))}
                        </Bar>

                        <Bar
                            name="高峰"
                            dataKey="currentPeak"
                            stackId="current"
                            fill={COLORS.peak}
                            barSize={isMobile ? 8 : 16}
                            onClick={(data, index, e) => handleYearBarClick(data, true, e)}
                            cursor="pointer"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-p-${index}`} fill={entry.currentYearData?.month === selectedMonth ? COLORS.peak : COLORS_LIGHT.peak} />
                            ))}
                        </Bar>

                        <Bar
                            name="尖峰"
                            dataKey="currentTip"
                            stackId="current"
                            fill={COLORS.tip}
                            radius={[2, 2, 0, 0]}
                            barSize={isMobile ? 8 : 16}
                            onClick={(data, index, e) => handleYearBarClick(data, true, e)}
                            cursor="pointer"
                        >
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-t-${index}`} fill={entry.currentYearData?.month === selectedMonth ? COLORS.tip : COLORS_LIGHT.tip} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </Box>


        </Paper>
    );
};

export default MonthlyConsumptionChart;
