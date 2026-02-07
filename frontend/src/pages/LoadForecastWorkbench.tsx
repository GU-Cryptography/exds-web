import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    Grid,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    Alert,
    useTheme,
    useMediaQuery,
    Divider,
    TextField,
    InputAdornment,
    List,
    ListItemButton,
    ListItemText,
    Chip,
    Tabs,
    Tab,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, addDays, subDays } from 'date-fns';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import SearchIcon from '@mui/icons-material/Search';
import {
    ComposedChart,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

import { loadForecastApi, LoadForecastVersion, LoadForecastData, LoadForecastCustomer, PerformanceOverview } from '../api/loadForecast';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';

/**
 * 负荷预测综合工作台
 */
export const LoadForecastWorkbench: React.FC = () => {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

    // --- 状态管理 ---
    const [targetDate, setTargetDate] = useState<Date | null>(addDays(new Date(), 1)); // 默认看明天
    const [forecastVersions, setForecastVersions] = useState<LoadForecastVersion[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');
    const [loadingVersions, setLoadingVersions] = useState(false);

    const [overallData, setOverallData] = useState<LoadForecastData | null>(null);
    const [loadingOverall, setLoadingOverall] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [customers, setCustomers] = useState<LoadForecastCustomer[]>([]);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

    const [customerDetailData, setCustomerDetailData] = useState<LoadForecastData | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [detailTab, setDetailTab] = useState(0); // 0: 图表, 1: 手工调整

    const [performance, setPerformance] = useState<PerformanceOverview | null>(null);

    // --- 图表引用 ---
    const overallChartRef = useRef<HTMLDivElement>(null);
    const customerChartRef = useRef<HTMLDivElement>(null);

    // --- 衍生状态 ---
    const targetDateStr = targetDate ? format(targetDate, 'yyyy-MM-dd') : '';
    const currentVersion = useMemo(() => forecastVersions.find(v => v.forecast_id === selectedVersion), [forecastVersions, selectedVersion]);

    const filteredCustomers = useMemo(() => {
        return customers.filter(c =>
            c.short_name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
            c.customer_id.toLowerCase().includes(searchKeyword.toLowerCase())
        );
    }, [customers, searchKeyword]);

    // --- 评级工具函数 ---
    const getAccuracyRating = (accuracy?: number | null, fallbackAccuracy?: number | null) => {
        const value = (accuracy !== undefined && accuracy !== null) ? accuracy : fallbackAccuracy;

        if (value === undefined || value === null) return { label: '待结算', color: 'default' as const };
        if (value > 85) return { label: '优', color: 'success' as const };
        if (value >= 70) return { label: '良', color: 'warning' as const };
        return { label: '差', color: 'error' as const };
    };

    // --- 数据加载 ---

    // 0. 加载 TOU 背景 (This useEffect is now redundant as period_types come with forecast data)
    // useEffect(() => {
    //     if (!targetDateStr) return;
    //     apiClient.get<TouPeriodData[]>('/api/v1/common/tou-rules/day', { params: { date: targetDateStr } })
    //         .then(res => setTouData(res.data))
    //         .catch(err => console.error('Failed to load TOU rules', err));
    // }, [targetDateStr]);

    // 1. 加载版本与总体性能
    useEffect(() => {
        if (!targetDateStr) return;
        setLoadingVersions(true);

        // (sortBy state removed, defaulting to 'energy')

        Promise.all([
            loadForecastApi.getVersions(targetDateStr),
            loadForecastApi.getPerformanceOverview('AGGREGATE')
        ]).then(([vRes, pRes]) => {
            setForecastVersions(vRes.data);
            setPerformance(pRes.data);
            if (vRes.data.length > 0) {
                setSelectedVersion(vRes.data[0].forecast_id);
            } else {
                setSelectedVersion('');
            }
        }).catch(err => {
            console.error(err);
            setError('获取版本及概览失败');
        }).finally(() => setLoadingVersions(false));
    }, [targetDateStr]);

    // 2. 加载整体数据和客户列表
    useEffect(() => {
        if (!targetDateStr || !currentVersion) {
            setOverallData(null);
            setCustomers([]);
            return;
        }

        const fetchAll = async () => {
            setLoadingOverall(true);
            setLoadingCustomers(true);
            try {
                const [dataRes, custRes] = await Promise.all([
                    loadForecastApi.getForecastData(targetDateStr, currentVersion.forecast_date, 'AGGREGATE'),
                    loadForecastApi.getCustomers(targetDateStr, currentVersion.forecast_date)
                ]);
                setOverallData(dataRes.data);
                setCustomers(custRes.data);
            } catch (err) {
                console.error(err);
                setError('数据加载失败');
            } finally {
                setLoadingOverall(false);
                setLoadingCustomers(false);
            }
        };

        fetchAll();
    }, [targetDateStr, currentVersion]);

    // 3. 加载客户详情数据
    useEffect(() => {
        if (!targetDateStr || !currentVersion || !selectedCustomerId) {
            setCustomerDetailData(null);
            return;
        }

        setLoadingDetail(true);
        loadForecastApi.getForecastData(targetDateStr, currentVersion.forecast_date, selectedCustomerId)
            .then(res => setCustomerDetailData(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoadingDetail(false));
    }, [targetDateStr, currentVersion, selectedCustomerId]);

    // --- 交互逻辑 ---
    const handleShiftDate = (days: number) => {
        if (!targetDate) return;
        setTargetDate(addDays(targetDate, days));
    };

    // --- 全屏 Hooks ---
    // const { touAreas, TouPeriodAreas } = useTouPeriodBackground(touData); // This is now redundant

    const overallFullscreen = useChartFullscreen({
        chartRef: overallChartRef,
        title: `全网预测 - ${targetDateStr}`,
        onPrevious: () => handleShiftDate(-1),
        onNext: () => handleShiftDate(1)
    });

    const customerFullscreen = useChartFullscreen({
        chartRef: customerChartRef,
        title: `客户预测 - ${selectedCustomerId} (${targetDateStr})`
    });

    // --- 列表过滤与排序 ---
    const sortedCustomers = useMemo(() => {
        return [...filteredCustomers].sort((a, b) => {
            // 默认按预测电量从大向小排 (V3: 移除准度排序，固定为电量排序)
            return (b.pred_sum || 0) - (a.pred_sum || 0);
        });
    }, [filteredCustomers]);

    // --- 衍生图表数据 (48点适配) ---
    const overallChartData = useMemo(() => {
        if (!overallData) return [];
        return overallData.values.map((v, i) => {
            // 48点: 00:30, 01:00, ..., 24:00
            const minutes = (i + 1) * 30;
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            const time = minutes >= 1440 ? "24:00" : `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

            const actual = overallData.actual_values?.[i];
            const period_type = overallData.period_types?.[i] || '平段';
            return {
                time,
                forecast: v,
                actual: actual,
                diff: actual !== undefined ? Math.abs(v - actual) : null,
                interval: [overallData.confidence_90_lower?.[i], overallData.confidence_90_upper?.[i]],
                period_type
            };
        });
    }, [overallData]);

    const customerChartData = useMemo(() => {
        if (!customerDetailData) return [];
        return customerDetailData.values.map((v, i) => {
            const minutes = (i + 1) * 30;
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            const time = minutes >= 1440 ? "24:00" : `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

            const actual = customerDetailData.actual_values?.[i];
            const period_type = customerDetailData.period_types?.[i] || '平段';
            return {
                time,
                forecast: v,
                actual: actual,
                diff: actual !== undefined ? Math.abs(v - actual) : null,
                interval: [customerDetailData.confidence_90_lower?.[i], customerDetailData.confidence_90_upper?.[i]],
                period_type
            };
        });
    }, [customerDetailData]);

    // 使用合并后的数据计算 TOU 背景 (确保对齐)
    const overallTou = useTouPeriodBackground(overallChartData, '24:00', 'left');
    const customerTou = useTouPeriodBackground(customerChartData, '24:00', 'left');

    // (V3.2: 修复 TOU 背景色在多 Y 轴下显示问题，增加 yAxisId="left")
    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{
                height: isDesktop ? 'calc(100vh - 110px)' : 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                overflow: 'hidden'
            }}>
                {/* L1: 控制面板 (高度固定) */}
                <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                    <Box display="flex" alignItems="center">
                        <IconButton onClick={() => handleShiftDate(-1)}><ArrowLeftIcon /></IconButton>
                        <DatePicker
                            label="目标日期"
                            value={targetDate}
                            onChange={setTargetDate}
                            slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
                        />
                        <IconButton onClick={() => handleShiftDate(1)}><ArrowRightIcon /></IconButton>
                    </Box>

                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>预测/参考版本</InputLabel>
                        <Select
                            value={selectedVersion}
                            label="预测/参考版本"
                            onChange={(e) => setSelectedVersion(e.target.value)}
                        >
                            {forecastVersions.map(v => (
                                <MenuItem key={v.forecast_id} value={v.forecast_id}>
                                    {v.forecast_date} 发布 (Gap {v.gap})
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* KPI 概览 (整合在控制栏) */}
                    {(overallData || performance) && (
                        <Box display="flex" gap={2} ml="auto">
                            <Box textAlign="center">
                                <Typography variant="caption" color="text.secondary">
                                    {overallData?.accuracy?.wmape_accuracy ? '当日准确率' : `历史均准(近${performance?.count || 7}天)`}
                                </Typography>
                                <Typography variant="body1" fontWeight="bold" color="primary">
                                    {overallData?.accuracy?.wmape_accuracy
                                        ? `${overallData.accuracy.wmape_accuracy.toFixed(2)}%`
                                        : performance?.avg_accuracy
                                            ? `${performance.avg_accuracy.toFixed(2)}%`
                                            : '---'}
                                </Typography>
                            </Box>
                            <Divider orientation="vertical" flexItem />
                            <Box textAlign="center">
                                <Typography variant="caption" color="text.secondary">预测日电量</Typography>
                                <Typography variant="body1" fontWeight="bold">
                                    {(overallData?.accuracy?.pred_sum ?? overallData?.pred_sum) // 修复：有些版本直接在根部有 pred_sum
                                        ? `${(overallData?.accuracy?.pred_sum ?? overallData?.pred_sum ?? 0).toFixed(2)} MWh`
                                        : '---'}
                                </Typography>
                            </Box>
                        </Box>
                    )}
                </Paper>

                {/* 主内容区: L2 + L3 */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>

                    {/* L2: 整体预测图表 (Desktop: ~40% 高度) */}
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 1.5,
                            flex: isDesktop ? '0 0 40%' : 'none',
                            minHeight: 350,
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            全网预测负荷曲线
                        </Typography>

                        <Box ref={overallChartRef} sx={{ flex: 1, position: 'relative' }}>
                            <overallFullscreen.FullscreenEnterButton />
                            <overallFullscreen.FullscreenExitButton />
                            <overallFullscreen.FullscreenTitle />

                            {loadingOverall ? (
                                <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                    <CircularProgress />
                                </Box>
                            ) : overallData ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={overallChartData}
                                        margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="time"
                                            interval={5} // 48个点，跳过5个显示一个 (约每3小时显示一次)
                                            tickFormatter={(v) => v}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            hide
                                            domain={['auto', 'auto']}
                                        />
                                        <YAxis
                                            yAxisId="diff"
                                            hide
                                            domain={['auto', 'auto']}
                                        />
                                        <Tooltip
                                            content={({ active, payload, label }) => {
                                                if (active && payload && payload.length) {
                                                    return (
                                                        <Paper sx={{ p: 1.5, boxShadow: 3 }}>
                                                            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>{label}</Typography>
                                                            {payload.map((entry: any, index: number) => {
                                                                if (entry.dataKey === 'interval') {
                                                                    const [low, high] = entry.value;
                                                                    return (
                                                                        <Typography key={index} variant="caption" display="block" color="text.secondary">
                                                                            90% 置信区间: {low?.toFixed(2)} ~ {high?.toFixed(2)} MWh
                                                                        </Typography>
                                                                    );
                                                                }
                                                                return (
                                                                    <Typography key={index} variant="body2" sx={{ color: entry.stroke || entry.fill }}>
                                                                        {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value} MWh
                                                                    </Typography>
                                                                );
                                                            })}
                                                        </Paper>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Legend verticalAlign="top" height={36} />
                                        {overallTou.TouPeriodAreas}
                                        <Area
                                            yAxisId="left"
                                            name="90% 置信区间"
                                            type="monotone"
                                            dataKey="interval"
                                            stroke="none"
                                            fill={theme.palette.primary.main}
                                            fillOpacity={0.08}
                                        />
                                        {overallData.actual_values && (
                                            <Area
                                                yAxisId="diff"
                                                name="偏差绝对值"
                                                type="step"
                                                dataKey="diff"
                                                stroke="none"
                                                fill={theme.palette.error.main}
                                                fillOpacity={0.05}
                                            />
                                        )}
                                        {overallData.actual_values && (
                                            <Line
                                                yAxisId="left"
                                                name="实际负荷"
                                                type="monotone"
                                                dataKey="actual"
                                                stroke="#666"
                                                strokeDasharray="5 5"
                                                dot={false}
                                                strokeWidth={2}
                                            />
                                        )}
                                        <Line
                                            yAxisId="left"
                                            name="预测负荷"
                                            type="monotone"
                                            dataKey="forecast"
                                            stroke={theme.palette.primary.main}
                                            dot={false}
                                            strokeWidth={2.5}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            ) : (
                                <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                    <Typography color="text.secondary">无数据</Typography>
                                </Box>
                            )}
                        </Box>
                    </Paper>

                    {/* L3: 客户工作区 (Desktop: ~50% 高度, 左右结构) */}
                    <Box sx={{ flex: isDesktop ? '1' : 'none', minHeight: 400, display: 'flex', gap: 1, overflow: 'hidden' }}>

                        <Grid size={{ xs: 12, md: 3 }} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        placeholder="搜索客户..."
                                        value={searchKeyword}
                                        onChange={(e) => setSearchKeyword(e.target.value)}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <SearchIcon fontSize="small" />
                                                </InputAdornment>
                                            ),
                                        }}
                                        sx={{ mb: 1 }}
                                    />
                                    {/* 排序方式已按用户要求删除，默认按电量排 */}
                                </Box>
                                <List sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
                                    {loadingCustomers ? (
                                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress size={24} /></Box>
                                    ) : sortedCustomers.map((customer) => {
                                        return (
                                            <ListItemButton
                                                key={customer.customer_id}
                                                selected={selectedCustomerId === customer.customer_id}
                                                onClick={() => setSelectedCustomerId(customer.customer_id)}
                                                sx={{ borderBottom: 1, borderColor: 'grey.100', py: 1 }}
                                            >
                                                <ListItemText
                                                    primary={
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <Typography variant="body2" noWrap sx={{ maxWidth: '140px' }}>
                                                                {customer.short_name}
                                                            </Typography>
                                                            <Chip
                                                                label={getAccuracyRating(customer.wmape, customer.history_wmape).label}
                                                                color={getAccuracyRating(customer.wmape, customer.history_wmape).color}
                                                                size="small"
                                                                sx={{ height: 20, fontSize: '0.65rem' }}
                                                            />
                                                        </Box>
                                                    }
                                                    secondary={
                                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                                                            <Typography variant="caption" color="text.secondary">
                                                                {customer.wmape !== null
                                                                    ? `当日准度: ${customer.wmape.toFixed(2)}%`
                                                                    : customer.history_wmape !== null
                                                                        ? `历史准度: ${customer.history_wmape.toFixed(2)}%`
                                                                        : '暂无精度'}
                                                            </Typography>
                                                            <Typography variant="caption" color="primary">
                                                                {customer.pred_sum !== null && customer.pred_sum !== undefined ? `${(customer.pred_sum).toFixed(2)} MWh` : ''}
                                                            </Typography>
                                                        </Box>
                                                    }
                                                />
                                            </ListItemButton>
                                        );
                                    })}
                                    {sortedCustomers.length === 0 && !loadingCustomers && (
                                        <Box p={2} textAlign="center">
                                            <Typography variant="caption" color="text.secondary">未找到匹配客户</Typography>
                                        </Box>
                                    )}
                                </List>
                            </Paper>
                        </Grid>

                        {/* 详情视图 (右侧 剩余空间) */}
                        <Paper variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                                <Tabs value={detailTab} onChange={(e, v) => setDetailTab(v)}>
                                    <Tab label="预测曲线" />
                                    <Tab label="手工调整" disabled />
                                </Tabs>
                            </Box>

                            <Box sx={{ flex: 1, p: 1.5, position: 'relative', overflow: 'hidden' }}>
                                {!selectedCustomerId ? (
                                    <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                        <Typography color="text.secondary">请从左侧选择客户</Typography>
                                    </Box>
                                ) : loadingDetail ? (
                                    <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                        <CircularProgress />
                                    </Box>
                                ) : customerDetailData ? (
                                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold', color: 'primary.main', display: 'flex', alignItems: 'center' }}>
                                            <Box component="span" sx={{ width: 3, height: 14, bgcolor: 'primary.main', mr: 1, borderRadius: 1 }} />
                                            {sortedCustomers.find(c => c.customer_id === selectedCustomerId)?.short_name || '未知客户'} - 预测详情
                                        </Typography>
                                        <Box ref={customerChartRef} sx={{ flex: 1, position: 'relative' }}>
                                            <customerFullscreen.FullscreenEnterButton />
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={customerChartData}
                                                    margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="time" interval={5} />
                                                    <YAxis
                                                        yAxisId="left"
                                                        hide
                                                        domain={['auto', 'auto']}
                                                    />
                                                    <YAxis
                                                        yAxisId="diff"
                                                        hide
                                                        domain={['auto', 'auto']}
                                                    />
                                                    <Tooltip
                                                        content={({ active, payload, label }) => {
                                                            if (active && payload && payload.length) {
                                                                return (
                                                                    <Paper sx={{ p: 1.5, boxShadow: 3 }}>
                                                                        <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>{label}</Typography>
                                                                        {payload.map((entry: any, index: number) => {
                                                                            if (entry.dataKey === 'interval') {
                                                                                const [low, high] = entry.value;
                                                                                return (
                                                                                    <Typography key={index} variant="caption" display="block" color="text.secondary">
                                                                                        90% 置信区间: {low?.toFixed(2)} ~ {high?.toFixed(2)} MWh
                                                                                    </Typography>
                                                                                );
                                                                            }
                                                                            return (
                                                                                <Typography key={index} variant="body2" sx={{ color: entry.stroke || entry.fill }}>
                                                                                    {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value} MWh
                                                                                </Typography>
                                                                            );
                                                                        })}
                                                                    </Paper>
                                                                );
                                                            }
                                                            return null;
                                                        }}
                                                    />
                                                    {customerTou.TouPeriodAreas}
                                                    <Area
                                                        yAxisId="left"
                                                        name="90% 置信区间"
                                                        type="monotone"
                                                        dataKey="interval"
                                                        stroke="none"
                                                        fill={theme.palette.success.main}
                                                        fillOpacity={0.08}
                                                    />
                                                    {customerDetailData.actual_values && (
                                                        <Area
                                                            yAxisId="diff"
                                                            name="偏差绝对值"
                                                            type="step"
                                                            dataKey="diff"
                                                            stroke="none"
                                                            fill={theme.palette.error.main}
                                                            fillOpacity={0.05}
                                                        />
                                                    )}
                                                    {customerDetailData.actual_values && (
                                                        <Line
                                                            yAxisId="left"
                                                            name="实际负荷"
                                                            type="monotone"
                                                            dataKey="actual"
                                                            stroke="#666"
                                                            strokeDasharray="5 5"
                                                            dot={false}
                                                            strokeWidth={2}
                                                        />
                                                    )}
                                                    <Line
                                                        yAxisId="left"
                                                        name="客户预测"
                                                        type="monotone"
                                                        dataKey="forecast"
                                                        stroke={theme.palette.success.main}
                                                        dot={false}
                                                    />
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    </Box>
                                ) : (
                                    <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                                        <Typography color="text.secondary">该客户暂无预测数据</Typography>
                                    </Box>
                                )}
                            </Box>
                        </Paper>
                    </Box>
                </Box>

                {/* 错误提示 */}
                {error && (
                    <Alert severity="error" onClose={() => setError(null)} sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 2000 }}>
                        {error}
                    </Alert>
                )}
            </Box>
        </LocalizationProvider>
    );
};

export default LoadForecastWorkbench;
