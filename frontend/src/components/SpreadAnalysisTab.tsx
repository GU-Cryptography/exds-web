import React, { useState, useEffect, useRef } from 'react';
import {
    Box, CircularProgress, Typography, Paper, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    FormControl, FormLabel, RadioGroup, FormControlLabel, Radio
} from '@mui/material';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Bar, ReferenceLine, Cell } from 'recharts';
import apiClient from '../api/client';
import { format } from 'date-fns';
import { CustomTooltip } from './CustomTooltip';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

// 偏差类型配置
const deviationTypeOptions = [
    { value: 'total_volume_deviation', label: '市场竞价空间偏差' },
    { value: 'system_load_deviation', label: '系统负荷偏差' },
    { value: 'renewable_deviation', label: '新能源偏差' },
    { value: 'nonmarket_unit_deviation', label: '非市场化机组偏差' },
    { value: 'tieline_deviation', label: '联络线偏差' }
];

interface SpreadAnalysisTabProps {
    selectedDate: Date | null;
}

export const SpreadAnalysisTab: React.FC<SpreadAnalysisTabProps> = ({ selectedDate }) => {
    const [selectedDeviationType, setSelectedDeviationType] = useState<string>('total_volume_deviation');
    const [loading, setLoading] = useState(false);
    const [analysisData, setAnalysisData] = useState<{ time_series: any[], systematic_bias: any[], price_distribution: any[] }>({
        time_series: [],
        systematic_bias: [],
        price_distribution: []
    });

    // 数据缓存
    const [cachedDate, setCachedDate] = useState<string | null>(null);
    const [cachedData, setCachedData] = useState<{ time_series: any[], systematic_bias: any[], price_distribution: any[] } | null>(null);

    const [priceSpreadDomain, setPriceSpreadDomain] = useState<[number, number] | undefined>(undefined);
    const [deviationDomain, setDeviationDomain] = useState<[number, number] | undefined>(undefined);

    const chart1Ref = useRef<HTMLDivElement>(null);
    const chart2Ref = useRef<HTMLDivElement>(null);
    const chart3Ref = useRef<HTMLDivElement>(null);

    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    const { isFullscreen: isFs1, FullscreenEnterButton: FSEnter1, FullscreenExitButton: FSExit1, FullscreenTitle: FSTitle1, NavigationButtons: FSNav1 } = useChartFullscreen({ chartRef: chart1Ref, title: `价格偏差主图 (${dateStr})` });
    const { isFullscreen: isFs2, FullscreenEnterButton: FSEnter2, FullscreenExitButton: FSExit2, FullscreenTitle: FSTitle2, NavigationButtons: FSNav2 } = useChartFullscreen({ chartRef: chart2Ref, title: `价差分布直方图 (${dateStr})` });
    const { isFullscreen: isFs3, FullscreenEnterButton: FSEnter3, FullscreenExitButton: FSExit3, FullscreenTitle: FSTitle3, NavigationButtons: FSNav3 } = useChartFullscreen({ chartRef: chart3Ref, title: `核心偏差归因 (${dateStr})` });

    const fetchData = (date: Date | null) => {
        if (!date) return;

        const formattedDate = format(date, 'yyyy-MM-dd');

        // 检查缓存
        if (cachedDate === formattedDate && cachedData) {
            setAnalysisData(cachedData);
            return;
        }

        setLoading(true);
        apiClient.get(`/api/v1/market-analysis/spread-attribution?date=${formattedDate}`)
            .then(response => {
                setAnalysisData(response.data);
                // 更新缓存
                setCachedDate(formattedDate);
                setCachedData(response.data);
            })
            .catch(error => {
                console.error('Error fetching spread analysis data:', error);
                setAnalysisData({ time_series: [], systematic_bias: [], price_distribution: [] });
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchData(selectedDate);
    }, [selectedDate]);

    useEffect(() => {
        if (analysisData.time_series.length > 0) {
            let maxPriceSpreadAbs = 0;
            let maxDeviationAbs = 0;

            analysisData.time_series.forEach(entry => {
                if (entry.price_spread !== null && entry.price_spread !== undefined) {
                    maxPriceSpreadAbs = Math.max(maxPriceSpreadAbs, Math.abs(entry.price_spread));
                }
                // 根据选中的偏差类型计算最大值
                const deviationValue = entry[selectedDeviationType as keyof typeof entry];
                if (deviationValue !== null && deviationValue !== undefined && typeof deviationValue === 'number') {
                    maxDeviationAbs = Math.max(maxDeviationAbs, Math.abs(deviationValue));
                }
            });

            // Set a minimum domain extent to avoid axis collapsing if all values are zero
            const priceSpreadExtent = Math.max(maxPriceSpreadAbs * 1.1, 10); // Ensure at least +/-10
            setPriceSpreadDomain([-priceSpreadExtent, priceSpreadExtent]);

            const deviationExtent = Math.max(maxDeviationAbs * 1.1, 10); // Ensure at least +/-10
            setDeviationDomain([-deviationExtent, deviationExtent]);

        } else {
            setPriceSpreadDomain(undefined);
            setDeviationDomain(undefined);
        }
    }, [analysisData.time_series, selectedDeviationType]);

    const renderTableCell = (value: number | null) => {
        if (value === null || value === undefined) return <TableCell align="right">N/A</TableCell>;
        const color = value > 0 ? 'error.main' : value < 0 ? 'success.main' : 'text.primary';
        return <TableCell align="right" sx={{ color, fontWeight: 'bold' }}>{value.toFixed(2)}</TableCell>;
    };

    const renderChartContainer = (ref: React.RefObject<HTMLDivElement | null>, isFullscreen: boolean, title: string, enter: React.ReactElement, exit: React.ReactElement, fsTitle: React.ReactElement, nav: React.ReactElement, chart: React.ReactElement, height: number = 400) => (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
            <Typography variant="h6" gutterBottom>{title}</Typography>
            <Box
                ref={ref}
                sx={{
                    height: { xs: 350, sm: height },
                    position: 'relative',
                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                    p: isFullscreen ? 2 : 0,
                    ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                }}
            >
                {enter}{exit}{fsTitle}{nav}
                {loading ? (
                    <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
                ) : !analysisData.time_series || analysisData.time_series.length === 0 ? (
                    <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Typography>无数据</Typography></Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
                )}
            </Box>
        </Paper>
    );

    return (
        <Box>
            <Paper variant="outlined" sx={{ p: 2, mb: 2, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderRadius: 2, boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold' }}>价差含义</Box>
                        绿色表示日前价格高于实时价格(正价差)
                    </Typography>
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.2)', px: 1, py: 0.5, borderRadius: 1, fontWeight: 'bold' }}>售电侧策略</Box>
                        正价差意味着实时市场价格偏低,建议多报日前,锁定高价收益
                    </Typography>
                </Box>
            </Paper>

            <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
                <Grid size={{ xs: 12, md: 6 }}>
                    {renderChartContainer(chart1Ref, isFs1, '价格偏差主图', FSEnter1(), FSExit1(), FSTitle1(), FSNav1(),
                        <ComposedChart data={analysisData.time_series}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time_str" interval={11} tick={{ fontSize: 10 }} />
                            <YAxis label={{ value: '价差(元/MWh)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 10 }} />
                            <Tooltip content={<CustomTooltip unit="元/MWh" />} />
                            <ReferenceLine y={0} stroke="#000" />
                            <Bar dataKey="price_spread" name="价格偏差">
                                {analysisData.time_series.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.price_spread > 0 ? '#f44336' : '#4caf50'} />
                                ))}
                            </Bar>
                        </ComposedChart>
                    )}
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    {renderChartContainer(chart2Ref, isFs2, '价差分布直方图', FSEnter2(), FSExit2(), FSTitle2(), FSNav2(),
                        <>
                            <ComposedChart data={analysisData.price_distribution}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="range_label"
                                    label={{ value: '价差区间 (元/MWh)', position: 'insideBottom', offset: -5 }}
                                    angle={-45}
                                    textAnchor="end"
                                    tick={false}
                                />
                                <YAxis
                                    label={{ value: '时段数量', angle: -90, position: 'insideLeft' }}
                                    allowDecimals={false}
                                    tick={false}
                                />
                                <Tooltip content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc' }}>
                                                <Typography variant="body2">区间:{data.range_label} 元/MWh</Typography>
                                                <Typography variant="body2">频次:{data.count}次</Typography>
                                            </Paper>
                                        );
                                    }
                                    return null;
                                }} />
                                <ReferenceLine x={0} stroke="#000" />
                                <Bar dataKey="count" name="时段数量">
                                    {analysisData.price_distribution.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.range_min >= 0 ? '#f44336' : '#4caf50'} />
                                    ))}
                                </Bar>
                            </ComposedChart>
                        </>
                    )}
                </Grid>
                <Grid size={{ xs: 12 }}>
                    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                        <Typography variant="h6" gutterBottom>核心偏差归因</Typography>

                        {/* 偏差类型选择器 */}
                        <Box sx={{ mb: 2 }}>
                            <FormControl component="fieldset">
                                <FormLabel component="legend">选择偏差维度</FormLabel>
                                <RadioGroup
                                    row
                                    value={selectedDeviationType}
                                    onChange={(e) => setSelectedDeviationType(e.target.value)}
                                    sx={{ flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
                                >
                                    {deviationTypeOptions.map(option => (
                                        <FormControlLabel
                                            key={option.value}
                                            value={option.value}
                                            control={<Radio />}
                                            label={option.label}
                                            sx={{ mr: { xs: 1, sm: 2 } }}
                                        />
                                    ))}
                                </RadioGroup>
                            </FormControl>
                        </Box>

                        {/* 图表容器 */}
                        <Box
                            ref={chart3Ref}
                            sx={{
                                height: { xs: 350, sm: 400 },
                                position: 'relative',
                                backgroundColor: isFs3 ? 'background.paper' : 'transparent',
                                p: isFs3 ? 2 : 0,
                                ...(isFs3 && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                            }}
                        >
                            {FSEnter3()}{FSExit3()}{FSTitle3()}{FSNav3()}
                            {loading ? (
                                <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>
                            ) : !analysisData.time_series || analysisData.time_series.length === 0 ? (
                                <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><Typography>无数据</Typography></Box>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={analysisData.time_series}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="time_str" interval={11} tick={{ fontSize: 12 }} />
                                        <YAxis yAxisId="left" label={{ value: '价差(元/MWh)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} domain={priceSpreadDomain} />
                                        <YAxis yAxisId="right" orientation="right" label={{ value: '偏差(MW)', angle: -90, position: 'insideRight' }} tick={{ fontSize: 12 }} domain={deviationDomain} />
                                        <Tooltip content={<CustomTooltip unitMap={{ price_spread: '元/MWh' }} unit="MW" />} />
                                        <Legend />
                                        <ReferenceLine y={0} stroke="#000" yAxisId="left" />
                                        <ReferenceLine y={0} stroke="#000" yAxisId="right" />
                                        <Bar yAxisId="left" dataKey="price_spread" name="价格偏差" barSize={20}>
                                            {analysisData.time_series.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.price_spread > 0 ? 'rgba(244, 67, 54, 0.5)' : 'rgba(76, 175, 80, 0.5)'} />
                                            ))}
                                        </Bar>
                                        <Line
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey={selectedDeviationType}
                                            name={deviationTypeOptions.find(opt => opt.value === selectedDeviationType)?.label}
                                            stroke="#FF8042"
                                            dot={false}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            )}
                        </Box>
                    </Paper>
                </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                <Typography variant="h6" gutterBottom>系统性偏差分析</Typography>
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table
                        size="small"
                        sx={{
                            '& .MuiTableCell-root': {
                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                px: { xs: 0.5, sm: 2 },
                            }
                        }}
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell>时段</TableCell>
                                <TableCell align="right">平均价差</TableCell>
                                <TableCell align="right">平均竞价空间偏差</TableCell>
                                <TableCell align="right">平均系统负荷偏差</TableCell>
                                <TableCell align="right">平均新能源偏差</TableCell>
                                <TableCell align="right">平均非市场化机组偏差</TableCell>
                                <TableCell align="right">平均联络线偏差</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {analysisData.systematic_bias.map((row) => (
                                <TableRow key={row.period_name}>
                                    <TableCell component="th" scope="row">{row.period_name}</TableCell>
                                    {renderTableCell(row.avg_price_spread)}
                                    {renderTableCell(row.avg_total_volume_deviation)}
                                    {renderTableCell(row.avg_system_load_deviation)}
                                    {renderTableCell(row.avg_renewable_deviation)}
                                    {renderTableCell(row.avg_nonmarket_unit_deviation)}
                                    {renderTableCell(row.avg_tieline_deviation)}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>
        </Box>
    );
};