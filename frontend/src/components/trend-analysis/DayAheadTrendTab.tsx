import React, { useRef, useState } from 'react';
import {
    Box, Paper, Typography, CircularProgress, Alert, Chip, Stack,
    FormControl, FormLabel, RadioGroup, FormControlLabel, Radio
} from '@mui/material';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceArea
} from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';

interface DayAheadTrendTabProps {
    data: any;
    loading: boolean;
    error: string | null;
}

// 因素选项配置
const factorOptions = [
    { value: 'total_load', label: '系统负荷', color: '#1976d2' },
    { value: 'total_renewable', label: '新能源', color: '#4caf50' },
    { value: 'total_bidding_space', label: '竞价空间', color: '#ff9800' },
    { value: 'total_hydro', label: '水电', color: '#00bcd4' },
    { value: 'total_tieline', label: '联络线', color: '#9c27b0' },
    { value: 'total_thermal', label: '火电', color: '#ff5722' }
];

// 渲染周末背景标记
const renderWeekendAreas = (data: any[]) => {
    if (!data || data.length === 0) return null;
    return data.map((entry, index) => {
        if (!entry.date) return null;
        const date = new Date(entry.date);
        const day = date.getDay();
        if (day === 0 || day === 6) {
            return (
                <ReferenceArea
                    key={`weekend-${index}`}
                    x1={entry.date}
                    x2={entry.date}
                    strokeOpacity={0}
                    fill="#e0e0e0"
                    fillOpacity={0.3}
                />
            );
        }
        return null;
    });
};

// 相关性系数显示组件
const CorrelationPanel: React.FC<{ correlations: Record<string, number>, selectedFactor: string }> = ({ correlations, selectedFactor }) => {
    const items = [
        { key: 'price_vs_load', label: '负荷', factor: 'total_load' },
        { key: 'price_vs_renewable', label: '新能源', factor: 'total_renewable' },
        { key: 'price_vs_bidding_space', label: '竞价空间', factor: 'total_bidding_space' },
        { key: 'price_vs_hydro', label: '水电', factor: 'total_hydro' },
        { key: 'price_vs_tieline', label: '联络线', factor: 'total_tieline' },
        { key: 'price_vs_thermal', label: '火电', factor: 'total_thermal' }
    ];

    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>价格相关性系数</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {items.map(item => {
                    const value = correlations[item.key] ?? 0;
                    const isSelected = item.factor === selectedFactor;
                    const chipColor = value > 0.3 ? 'error' : value < -0.3 ? 'success' : 'default';
                    return (
                        <Chip
                            key={item.key}
                            label={`${item.label}: ${value > 0 ? '+' : ''}${(value * 100).toFixed(0)}%`}
                            size="small"
                            color={isSelected ? chipColor : 'default'}
                            variant={isSelected ? 'filled' : 'outlined'}
                        />
                    );
                })}
            </Stack>
        </Paper>
    );
};

export const DayAheadTrendTab: React.FC<DayAheadTrendTabProps> = ({ data, loading, error }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const [selectedFactor, setSelectedFactor] = useState<string>('total_load');

    // 全屏 Hook
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } =
        useChartFullscreen({ chartRef, title: '日前价格与供需因素趋势' });

    const chartData = data?.daily_data || [];
    const correlations = data?.correlations || {};

    // 获取选中因素的配置
    const selectedOption = factorOptions.find(opt => opt.value === selectedFactor);

    return (
        <Box>
            {loading && !data ? (
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            ) : error ? (
                <Alert severity="error">{error}</Alert>
            ) : data ? (
                <Box sx={{ position: 'relative' }}>
                    {loading && (
                        <Box sx={{
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)', zIndex: 1000
                        }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {/* 相关性系数面板 */}
                    <CorrelationPanel correlations={correlations} selectedFactor={selectedFactor} />

                    {/* 主图表：价格与供需因素趋势 */}
                    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                        <Typography variant="h6" gutterBottom>日前价格与供需因素趋势</Typography>

                        {/* 因素选择器 */}
                        <Box sx={{ mb: 2 }}>
                            <FormControl component="fieldset">
                                <FormLabel component="legend">选择对比因素</FormLabel>
                                <RadioGroup
                                    row
                                    value={selectedFactor}
                                    onChange={(e) => setSelectedFactor(e.target.value)}
                                    sx={{ flexWrap: 'wrap' }}
                                >
                                    {factorOptions.map(option => (
                                        <FormControlLabel
                                            key={option.value}
                                            value={option.value}
                                            control={<Radio size="small" sx={{ color: option.color, '&.Mui-checked': { color: option.color } }} />}
                                            label={option.label}
                                            sx={{ mr: { xs: 1, sm: 2 } }}
                                        />
                                    ))}
                                </RadioGroup>
                            </FormControl>
                        </Box>

                        <Box
                            ref={chartRef}
                            sx={{
                                height: { xs: 350, sm: 400 },
                                position: 'relative',
                                bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                                p: isFullscreen ? 2 : 0,
                                ...(isFullscreen && {
                                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400
                                })
                            }}
                        >
                            <FullscreenEnterButton />
                            <FullscreenExitButton />
                            <FullscreenTitle />

                            {chartData.length === 0 ? (
                                <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                                    <Typography>无数据</Typography>
                                </Box>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        {renderWeekendAreas(chartData)}
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis
                                            yAxisId="left"
                                            label={{ value: '元/MWh', angle: -90, position: 'insideLeft', fontSize: 12 }}
                                            tick={{ fontSize: 11 }}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            label={{ value: 'GWh', angle: -90, position: 'insideRight', fontSize: 12 }}
                                            tick={{ fontSize: 11 }}
                                        />
                                        <Tooltip
                                            formatter={(value: number, name: string) => {
                                                if (name === '日均价格') return [`${value.toFixed(2)} 元/MWh`, name];
                                                return [`${value.toFixed(1)} GWh`, name];
                                            }}
                                        />
                                        <Legend />

                                        {/* 价格曲线 - 左Y轴 - 虚线 */}
                                        <Line
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="avg_price"
                                            name="日均价格"
                                            stroke="#d32f2f"
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            dot={false}
                                        />

                                        {/* 选中的因素柱状图 - 右Y轴 */}
                                        <Bar
                                            yAxisId="right"
                                            dataKey={selectedFactor}
                                            name={selectedOption?.label || selectedFactor}
                                            fill={selectedOption?.color || '#1976d2'}
                                            opacity={0.7}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            )}
                        </Box>
                    </Paper>
                </Box>
            ) : null}
        </Box>
    );
};
