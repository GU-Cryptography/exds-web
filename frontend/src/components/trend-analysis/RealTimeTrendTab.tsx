import React, { useRef, useState } from 'react';
import {
    Box, Paper, Typography, CircularProgress, Alert, Grid,
    FormControl, FormLabel, RadioGroup, FormControlLabel, Radio
} from '@mui/material';
import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, ReferenceArea
} from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';

interface RealTimeTrendTabProps {
    data: any;
    loading: boolean;
    error: string | null;
}

// 因素选项配置（实时分析使用实际运行数据）
const factorOptions = [
    { value: 'total_load', label: '系统负荷', color: '#1976d2' },
    { value: 'total_renewable', label: '新能源', color: '#4caf50' },
    { value: 'total_bidding_space', label: '竞价空间', color: '#ff9800' },
    { value: 'total_thermal', label: '火电', color: '#ff5722' },
    { value: 'total_hydro', label: '水电', color: '#00bcd4' },
    { value: 'total_tieline', label: '联络线', color: '#9c27b0' },
    { value: 'total_storage', label: '储能', color: '#795548' }
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

// 相关性系数显示组件（竖排布局，用于右侧面板）
const CorrelationPanel: React.FC<{ correlations: Record<string, number>, selectedFactor: string }> = ({ correlations, selectedFactor }) => {
    const items = [
        { key: 'price_vs_load', label: '负荷', factor: 'total_load', color: '#1976d2' },
        { key: 'price_vs_renewable', label: '新能源', factor: 'total_renewable', color: '#4caf50' },
        { key: 'price_vs_bidding_space', label: '竞价', factor: 'total_bidding_space', color: '#ff9800' },
        { key: 'price_vs_hydro', label: '水电', factor: 'total_hydro', color: '#00bcd4' },
        { key: 'price_vs_thermal', label: '火电', factor: 'total_thermal', color: '#ff5722' },
        { key: 'price_vs_tieline', label: '联络线', factor: 'total_tieline', color: '#9c27b0' },
        { key: 'price_vs_storage', label: '储能', factor: 'total_storage', color: '#795548' }
    ];

    // 获取相关性条形颜色（正相关红色，负相关绿色）
    const getBarColor = (value: number) => {
        if (value > 0) return `rgba(211, 47, 47, ${Math.min(Math.abs(value) + 0.3, 1)})`;
        if (value < 0) return `rgba(46, 125, 50, ${Math.min(Math.abs(value) + 0.3, 1)})`;
        return '#bdbdbd';
    };

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            height: '100%',
            justifyContent: 'flex-start',
            pt: 0
        }}>
            <Typography
                component="legend"
                sx={{
                    fontWeight: 400,
                    fontSize: '1rem',
                    color: 'text.secondary',
                    textAlign: 'center',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    pb: 0.5,
                    mb: 0.5
                }}
            >
                相关性系数
            </Typography>
            {items.map(item => {
                const value = correlations[item.key] ?? 0;
                const isSelected = item.factor === selectedFactor;
                const barWidth = Math.abs(value) * 100;

                return (
                    <Box
                        key={item.key}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.25,
                            p: 0.5,
                            borderRadius: 1,
                            bgcolor: isSelected ? 'action.selected' : 'transparent',
                            border: isSelected ? '1px solid' : '1px solid transparent',
                            borderColor: isSelected ? item.color : 'transparent',
                            transition: 'all 0.2s'
                        }}
                    >
                        {/* 标签行 */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography
                                variant="caption"
                                sx={{
                                    fontSize: '0.875rem',
                                    fontWeight: isSelected ? 'bold' : 'normal',
                                    color: isSelected ? item.color : 'text.secondary'
                                }}
                            >
                                {item.label}
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{
                                    fontSize: '0.875rem',
                                    fontWeight: 'bold',
                                    color: getBarColor(value)
                                }}
                            >
                                {value > 0 ? '+' : ''}{(value * 100).toFixed(0)}%
                            </Typography>
                        </Box>
                        {/* 进度条 */}
                        <Box sx={{
                            height: 4,
                            bgcolor: 'grey.200',
                            borderRadius: 2,
                            overflow: 'hidden',
                            position: 'relative'
                        }}>
                            <Box sx={{
                                position: 'absolute',
                                left: value >= 0 ? '50%' : `${50 - barWidth / 2}%`,
                                width: `${barWidth / 2}%`,
                                height: '100%',
                                bgcolor: getBarColor(value),
                                borderRadius: 2,
                                transition: 'all 0.3s ease'
                            }} />
                            {/* 中心线 */}
                            <Box sx={{
                                position: 'absolute',
                                left: '50%',
                                top: 0,
                                bottom: 0,
                                width: 1,
                                bgcolor: 'grey.400'
                            }} />
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
};

export const RealTimeTrendTab: React.FC<RealTimeTrendTabProps> = ({ data, loading, error }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const [selectedFactor, setSelectedFactor] = useState<string>('total_load');

    // 全屏 Hook
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } =
        useChartFullscreen({ chartRef, title: '实时价格与运行因素趋势' });

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


                    {/* 主内容区：曲线 + 相关性面板 */}
                    <Grid container spacing={{ xs: 1, sm: 2 }}>
                        {/* 曲线面板 */}
                        <Grid size={{ xs: 12, md: 9.5 }}>
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                                <Typography variant="h6" gutterBottom>实时价格与运行因素趋势</Typography>

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
                        </Grid>

                        {/* 相关性面板 */}
                        <Grid size={{ xs: 12, md: 2.5 }}>
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: { md: '100%' } }}>
                                <CorrelationPanel correlations={correlations} selectedFactor={selectedFactor} />
                            </Paper>
                        </Grid>
                    </Grid>
                </Box>
            ) : null}
        </Box>
    );
};
