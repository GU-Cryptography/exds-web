import React, { useState, useEffect, useRef } from 'react';
import {
    Box, CircularProgress, Typography, Paper, IconButton, Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Bar, ReferenceLine, Cell } from 'recharts';
import apiClient from '../api/client';
import { format, addDays } from 'date-fns';
import { CustomTooltip } from './CustomTooltip';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useSelectableSeries } from '../hooks/useSelectableSeries';

const seriesConfig = {
    total_volume_deviation: { name: '竞价空间偏差', color: '#FF8042' },
    thermal_deviation: { name: '火电偏差', color: '#FFBB28' },
    wind_deviation: { name: '风电偏差', color: '#00C49F' },
    solar_deviation: { name: '光伏偏差', color: '#0088FE' },
    hydro_deviation: { name: '水电偏差', color: '#8884d8' },
    storage_deviation: { name: '储能偏差', color: '#82ca9d' },
};

export const SpreadAnalysisTab: React.FC = () => {
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), -2));
    const [loading, setLoading] = useState(false);
    const [analysisData, setAnalysisData] = useState<{ time_series: any[], systematic_bias: any[], price_distribution: any[] }>({
        time_series: [],
        systematic_bias: [],
        price_distribution: []
    });

    const [priceSpreadDomain, setPriceSpreadDomain] = useState<[number, number] | undefined>(undefined);
    const [deviationDomain, setDeviationDomain] = useState<[number, number] | undefined>(undefined);

    const chart1Ref = useRef<HTMLDivElement>(null);
    const chart2Ref = useRef<HTMLDivElement>(null);
    const chart3Ref = useRef<HTMLDivElement>(null);

    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
    };

    const { isFullscreen: isFs1, FullscreenEnterButton: FSEnter1, FullscreenExitButton: FSExit1, FullscreenTitle: FSTitle1, NavigationButtons: FSNav1 } = useChartFullscreen({ chartRef: chart1Ref, title: `价格偏差主图 (${dateStr})`, onPrevious: () => handleShiftDate(-1), onNext: () => handleShiftDate(1) });
    const { isFullscreen: isFs2, FullscreenEnterButton: FSEnter2, FullscreenExitButton: FSExit2, FullscreenTitle: FSTitle2, NavigationButtons: FSNav2 } = useChartFullscreen({ chartRef: chart2Ref, title: `价差分布直方图 (${dateStr})`, onPrevious: () => handleShiftDate(-1), onNext: () => handleShiftDate(1) });
    const { isFullscreen: isFs3, FullscreenEnterButton: FSEnter3, FullscreenExitButton: FSExit3, FullscreenTitle: FSTitle3, NavigationButtons: FSNav3 } = useChartFullscreen({ chartRef: chart3Ref, title: `核心偏差归因 (${dateStr})`, onPrevious: () => handleShiftDate(-1), onNext: () => handleShiftDate(1) });

    const { seriesVisibility, handleLegendClick } = useSelectableSeries<keyof typeof seriesConfig>({
        total_volume_deviation: true, // 默认显示竞价空间偏差
        thermal_deviation: false,
        wind_deviation: false,
        solar_deviation: false,
        hydro_deviation: false,
        storage_deviation: false,
    });

    const fetchData = (date: Date | null) => {
        if (!date) return;
        setLoading(true);
        const formattedDate = format(date, 'yyyy-MM-dd');
        apiClient.get(`/api/v1/market-analysis/spread-attribution?date=${formattedDate}`)
            .then(response => setAnalysisData(response.data))
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
                // total_volume_deviation is '竞价空间偏差'
                if (entry.total_volume_deviation !== null && entry.total_volume_deviation !== undefined) {
                    maxDeviationAbs = Math.max(maxDeviationAbs, Math.abs(entry.total_volume_deviation));
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
    }, [analysisData.time_series]);

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
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box>
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftDate(-1)}><ArrowLeftIcon /></IconButton>
                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } }
                            }
                        }}
                    />
                    <IconButton onClick={() => handleShiftDate(1)}><ArrowRightIcon /></IconButton>
                    <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>价差含义：</strong>绿色表示日前价格高于实时价格（正价差）。
                        </Typography>
                        <Typography variant="body2">
                            <strong>售电侧策略（买方）：</strong>正价差意味着实时市场价格偏低，建议多报日前，锁定高价收益。
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
                                                    <Typography variant="body2">区间：{data.range_label} 元/MWh</Typography>
                                                    <Typography variant="body2">频次：{data.count}次</Typography>
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
                        {renderChartContainer(chart3Ref, isFs3, '核心偏差归因', FSEnter3(), FSExit3(), FSTitle3(), FSNav3(),
                            <ComposedChart data={analysisData.time_series}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="time_str" interval={11} tick={{ fontSize: 12 }} />
                                <YAxis yAxisId="left" label={{ value: '价差(元/MWh)', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 12 }} domain={priceSpreadDomain} />
                                <YAxis yAxisId="right" orientation="right" label={{ value: '偏差(MW)', angle: -90, position: 'insideRight' }} tick={{ fontSize: 12 }} domain={deviationDomain} />
                                <Tooltip content={<CustomTooltip unitMap={{ price_spread: '元/MWh' }} unit="MW" />} />
                                <Legend onClick={handleLegendClick} />
                                <ReferenceLine y={0} stroke="#000" yAxisId="left" />
                                <ReferenceLine y={0} stroke="#000" yAxisId="right" />
                                <Bar yAxisId="left" dataKey="price_spread" name="价格偏差" barSize={20}>
                                    {analysisData.time_series.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.price_spread > 0 ? 'rgba(244, 67, 54, 0.5)' : 'rgba(76, 175, 80, 0.5)'} />
                                    ))}
                                </Bar>
                                {Object.entries(seriesConfig).map(([key, config]) => (
                                    seriesVisibility[key as keyof typeof seriesConfig] &&
                                    <Line key={key} yAxisId="right" type="monotone" dataKey={key} name={config.name} stroke={config.color} dot={false} />
                                ))}
                            </ComposedChart>
                        )}
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
                                    <TableCell align="right">平均火电偏差</TableCell>
                                    <TableCell align="right">平均风电偏差</TableCell>
                                    <TableCell align="right">平均光伏偏差</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {analysisData.systematic_bias.map((row) => (
                                    <TableRow key={row.period_name}>
                                        <TableCell component="th" scope="row">{row.period_name}</TableCell>
                                        {renderTableCell(row.avg_price_spread)}
                                        {renderTableCell(row.avg_total_volume_deviation)}
                                        {renderTableCell(row.avg_thermal_deviation)}
                                        {renderTableCell(row.avg_wind_deviation)}
                                        {renderTableCell(row.avg_solar_deviation)}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            </Box>
        </LocalizationProvider>
    );
};