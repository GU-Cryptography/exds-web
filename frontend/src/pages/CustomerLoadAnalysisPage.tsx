import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Paper,
    Typography,
    Grid,
    Card,
    CardContent,
    Stack,
    CircularProgress,
    Button,
    Chip,
    Divider,
    IconButton,
    Autocomplete,
    TextField,
    useTheme,
    useMediaQuery,
    Tooltip,
    Alert
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, subDays, addDays, parseISO, getDay } from 'date-fns';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell,
    ReferenceArea
} from 'recharts';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import DeleteIcon from '@mui/icons-material/Delete';
import { CustomTooltip } from '../components/CustomTooltip';

import { customerAnalysisApi, DailyViewResponse, AnalysisStats, AutoTag } from '../api/customerAnalysis';
import customerApi, { CustomerListItem, Tag } from '../api/customer';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import TagSelector from '../components/customer/TagSelector';

export const CustomerLoadAnalysisPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // State
    const [selectedDate, setSelectedDate] = useState<Date | null>(subDays(new Date(), 2));
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerListItem | null>(null);
    const [customers, setCustomers] = useState<CustomerListItem[]>([]);

    // Data State
    const [dailyData, setDailyData] = useState<DailyViewResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [historyType, setHistoryType] = useState<'daily' | 'monthly'>('daily');
    const [historyData, setHistoryData] = useState<any[]>([]);

    const [aiAnalyzing, setAiAnalyzing] = useState(false);
    const [aiSummary, setAiSummary] = useState<string | null>(null);

    // Tags State (Local cache for display)
    const [manualTags, setManualTags] = useState<Tag[]>([]);
    const [autoTags, setAutoTags] = useState<Tag[]>([]);

    const chartRef = useRef<HTMLDivElement>(null);

    // Hooks
    const { FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons, isFullscreen } = useChartFullscreen({
        chartRef,
        title: selectedCustomer ? `${selectedCustomer.user_name} 负荷分析` : '客户负荷分析',
        onPrevious: () => handleDateShift(-1),
        onNext: () => handleDateShift(1)
    });

    // TOU Background - use period_type from backend data
    const { TouPeriodAreas } = useTouPeriodBackground(dailyData?.main_curve || null);

    // Initial Customer Load
    useEffect(() => {
        // Sort by contract amount descending by default for selection list
        customerApi.getCustomers({
            page_size: 100,
            sort_field: 'current_year_contract_amount',
            sort_order: 'desc'
        }).then(res => {
            if (res.data.items && res.data.items.length > 0) {
                setCustomers(res.data.items);
                // Default select first one for convenience
                setSelectedCustomer(res.data.items[0]);
            }
        });
    }, []);

    // Fetch Daily View
    useEffect(() => {
        if (!selectedCustomer || !selectedDate) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                const res = await customerAnalysisApi.fetchDailyView(selectedCustomer.id, dateStr);
                setDailyData(res.data);

                // Update Tags from Customer Object (Need to re-fetch customer or assume latest?)
                // Actually `daily-view` doesn't return tags. We should probably fetch customer details separately to get latest tags
                // Or we rely on `selectedCustomer.tags` but that might be stale if we add/remove.
                // Let's fetch customer details to get fresh tags.
                const custRes = await customerApi.getCustomer(selectedCustomer.id);
                const tags = custRes.data.tags || [];
                setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
                setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));

            } catch (err: any) {
                console.error(err);
                setError(err.response?.data?.detail || '获取数据失败');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [selectedCustomer, selectedDate]);

    // Fetch History
    useEffect(() => {
        if (!selectedCustomer || !selectedDate) return;
        const fetchHistory = async () => {
            try {
                const dateStr = format(selectedDate, 'yyyy-MM-dd');
                const res = await customerAnalysisApi.fetchHistory(selectedCustomer.id, historyType, dateStr);
                setHistoryData(res.data);
            } catch (err) {
                console.error(err);
            }
        };
        fetchHistory();
    }, [selectedCustomer, selectedDate, historyType]);

    const handleDateShift = (days: number) => {
        if (selectedDate) {
            setSelectedDate(addDays(selectedDate, days));
        }
    };

    const handleAiDiagnose = async () => {
        if (!selectedCustomer || !selectedDate) return;
        setAiAnalyzing(true);
        try {
            const dateStr = format(selectedDate, 'yyyy-MM-dd');
            const res = await customerAnalysisApi.triggerAiDiagnose(selectedCustomer.id, dateStr);
            setAiSummary(res.data.summary);

            // Add suggested tags automatically? Or just show them?
            // "AI Mode Recognition" button usually implies applying the analysis.
            // Let's assume we want to sync these tags to the backend immediately or refresh.
            // For this implementation, we'll refresh the tags after AI runs if AI updates backend (the API I mocked just returns summary, doesn't save?).
            // Wait, the API mock just returns Response. It does NOT save to DB in my mock implementation of `triggerAiDiagnose`.
            // So we need to save them. FE should call `addTag`.
            // BUT, the requirement says "AI识别结果以芯片形式展示" and "自动标签可手工删除".
            // So we should save them.

            // Let's save them sequentially
            for (const tag of res.data.auto_tags) {
                try {
                    await customerAnalysisApi.addTag(selectedCustomer.id, {
                        name: tag.name,
                        source: 'AUTO',
                        reason: tag.reason
                    });
                } catch (e) {
                    // ignore duplicates
                }
            }

            // Refresh tags
            const custRes = await customerApi.getCustomer(selectedCustomer.id);
            const tags = custRes.data.tags || [];
            setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
            setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));

        } catch (err) {
            console.error(err);
        } finally {
            setAiAnalyzing(false);
        }
    };

    const handleManualTagChange = async (newTags: Tag[]) => {
        if (!selectedCustomer) return;

        // TagSelector passes the NEW full list of tags. 
        // We need to diff to find what was added or removed. 
        // Or simpler: TagSelector in `CustomerEditorDialog` manages the list state locally and calls `onChange`.
        // Here, `TagSelector` is controlled. `tags={manualTags}`.
        // When `onChange` fires with `newTags`, we figure out the delta.

        const currentNames = new Set(manualTags.map(t => t.name));
        const newNames = new Set(newTags.map(t => t.name));

        // Find added
        for (const tag of newTags) {
            if (!currentNames.has(tag.name)) {
                await customerAnalysisApi.addTag(selectedCustomer.id, { name: tag.name, source: 'MANUAL' });
            }
        }

        // Find removed
        for (const tag of manualTags) {
            if (!newNames.has(tag.name)) {
                await customerAnalysisApi.removeTag(selectedCustomer.id, tag.name);
            }
        }

        // Refresh
        const custRes = await customerApi.getCustomer(selectedCustomer.id);
        const tags = custRes.data.tags || [];
        setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
        setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));
    };

    const handleRemoveAutoTag = async (tagName: string) => {
        if (!selectedCustomer) return;
        await customerAnalysisApi.removeTag(selectedCustomer.id, tagName);

        // Refresh
        const custRes = await customerApi.getCustomer(selectedCustomer.id);
        const tags = custRes.data.tags || [];
        setManualTags(tags.filter((t: Tag) => t.source === 'MANUAL'));
        setAutoTags(tags.filter((t: Tag) => t.source === 'AUTO'));
    };

    // --- Render Helpers ---

    const renderStatCard = (title: string, value: string | number, subtext?: string, color: string = 'text.primary') => (
        <Card variant="outlined">
            <CardContent sx={{ p: '8px !important', '&:last-child': { pb: '8px !important' } }}>
                <Typography variant="caption" color="text.secondary">{title}</Typography>
                <Typography variant="h6" sx={{ my: 0.5, fontWeight: 'medium', color }}>
                    {value}
                </Typography>
                {subtext && <Typography variant="caption" color="text.secondary">{subtext}</Typography>}
            </CardContent>
        </Card>
    );

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                        <Autocomplete
                            options={customers}
                            getOptionLabel={(option) => option.user_name}
                            value={selectedCustomer}
                            onChange={(_, newValue) => setSelectedCustomer(newValue)}
                            renderInput={(params) => <TextField {...params} label="选择客户" size="small" />}
                            sx={{ width: { xs: '100%', md: 300 } }}
                        />

                        <Stack direction="row" spacing={1} alignItems="center">
                            <IconButton onClick={() => handleDateShift(-1)} disabled={loading}><ArrowLeftIcon /></IconButton>
                            <DatePicker
                                label="选择日期"
                                value={selectedDate}
                                onChange={(date) => setSelectedDate(date)}
                                slotProps={{ textField: { size: 'small', sx: { width: 160 } } }}
                            />
                            <IconButton onClick={() => handleDateShift(1)} disabled={loading}><ArrowRightIcon /></IconButton>
                        </Stack>
                    </Stack>
                </Paper>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {loading && !dailyData && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                        <CircularProgress />
                    </Box>
                )}

                {dailyData && (
                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        {/* Main Chart */}
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Paper variant="outlined" sx={{ p: 1, height: '100%', position: 'relative' }}>
                                <Box ref={chartRef} sx={{
                                    height: 440,
                                    display: 'flex', flexDirection: 'column',
                                    position: 'relative',
                                    ...(isFullscreen && { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1400, bgcolor: 'background.paper', height: '100vh', p: 2 })
                                }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2, flexShrink: 0 }}>
                                        <Stack direction="row" alignItems="center" spacing={1}>
                                            <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                            <Typography variant="h6" fontSize="1rem" fontWeight="bold">日内48点负荷曲线</Typography>
                                        </Stack>
                                        <Box>
                                            <FullscreenEnterButton />
                                            <FullscreenExitButton />
                                        </Box>
                                    </Box>
                                    <FullscreenTitle />
                                    <NavigationButtons />

                                    <Box sx={{ flex: 1, minHeight: 0 }}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={dailyData.main_curve} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                                                {TouPeriodAreas}
                                                <XAxis
                                                    dataKey="time"
                                                    tick={{ fill: '#888', fontSize: 11 }}
                                                    tickLine={{ stroke: '#ccc' }}
                                                    axisLine={{ stroke: '#ccc' }}
                                                    interval={11}
                                                    tickFormatter={(value, index) => {
                                                        const totalPoints = dailyData?.main_curve?.length || 48;
                                                        if (index === 0) return '00:30';
                                                        if (index === totalPoints - 1) return '24:00';
                                                        return value;
                                                    }}
                                                />
                                                <YAxis
                                                    tick={{ fill: '#888', fontSize: 12 }}
                                                    tickLine={{ stroke: '#ccc' }}
                                                    axisLine={{ stroke: '#ccc' }}
                                                    tickCount={5}
                                                />
                                                <RechartsTooltip content={<CustomTooltip unit="kW" />} />
                                                <Legend
                                                    verticalAlign="top"
                                                    align="right"
                                                    iconType="circle"
                                                    iconSize={8}
                                                    wrapperStyle={{ top: -10, right: 20, fontSize: 11 }}
                                                />
                                                <Line type="monotone" dataKey="current" name="当日" stroke="#2196f3" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                                                <Line type="monotone" dataKey="last_day" name="昨日" stroke="#4caf50" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="benchmark" name="基准" stroke="#9e9e9e" strokeDasharray="3 3" dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </Box>
                                </Box>
                            </Paper>
                        </Grid>

                        {/* Statistics */}
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                        <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                        <Typography variant="h6" fontSize="1rem" fontWeight="bold">统计指标</Typography>
                                    </Stack>
                                </Stack>

                                <Stack spacing={1.5}>
                                    {/* 本年度合同电量 */}
                                    <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                                        <CardContent sx={{ p: '12px !important', '&:last-child': { pb: '12px !important' } }}>
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                                <Typography variant="caption" color="text.secondary">本年度合同电量</Typography>
                                            </Stack>
                                            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary', mt: 0.5 }}>
                                                {dailyData.stats.annual_contract} <Typography component="span" variant="body2" color="text.secondary">MWh</Typography>
                                            </Typography>
                                        </CardContent>
                                    </Card>

                                    {/* 累计用电量 */}
                                    <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                                        <CardContent sx={{ p: '12px !important', '&:last-child': { pb: '12px !important' } }}>
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                                <Typography variant="caption" color="text.secondary">累计用电量</Typography>
                                            </Stack>
                                            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary', mt: 0.5 }}>
                                                {dailyData.stats.annual_cumulative} <Typography component="span" variant="body2" color="text.secondary">MWh</Typography>
                                            </Typography>
                                        </CardContent>
                                    </Card>

                                    {/* 当日用电量与结构 */}
                                    <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                                        <CardContent sx={{ p: '12px !important', '&:last-child': { pb: '12px !important' } }}>
                                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                                {/* 左侧：总量显示 */}
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">当日用电量</Typography>
                                                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary', mt: 0.2 }}>
                                                        {dailyData.stats.day_total} <Typography component="span" variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>MWh</Typography>
                                                    </Typography>
                                                </Box>

                                                {/* 右侧：分时细项 */}
                                                <Box sx={{ borderLeft: '1px solid', borderColor: 'divider', pl: 1, ml: 1, flexShrink: 0 }}>
                                                    <Grid container spacing={0.5} sx={{ width: '135px' }}>
                                                        {[
                                                            { label: '尖', value: dailyData.stats.tou_usage.tip, color: '#ff5252' },
                                                            { label: '峰', value: dailyData.stats.tou_usage.peak, color: '#ff9800' },
                                                            { label: '平', value: dailyData.stats.tou_usage.flat, color: '#4caf50' },
                                                            { label: '谷', value: dailyData.stats.tou_usage.valley, color: '#2196f3' },
                                                            { label: '深', value: dailyData.stats.tou_usage.deep, color: '#3f51b5' },
                                                        ].map((item) => (
                                                            <Grid size={{ xs: 6 }} key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                <Typography variant="caption" sx={{ color: item.color, fontWeight: 'bold', fontSize: '0.65rem' }}>
                                                                    {item.label}
                                                                </Typography>
                                                                <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                                                    {item.value || 0}
                                                                </Typography>
                                                            </Grid>
                                                        ))}
                                                    </Grid>
                                                </Box>
                                            </Stack>
                                        </CardContent>
                                    </Card>

                                    {/* 峰谷比 */}
                                    <Card variant="outlined" sx={{ bgcolor: 'grey.50' }}>
                                        <CardContent sx={{ p: '12px !important', '&:last-child': { pb: '12px !important' } }}>
                                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                                <Typography variant="caption" color="text.secondary">峰谷比</Typography>
                                                <Chip label="平稳" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                            </Stack>
                                            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary', mt: 0.5 }}>
                                                {dailyData.stats.peak_valley_ratio}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">(尖峰+高峰) / (低谷+深谷)</Typography>
                                        </CardContent>
                                    </Card>
                                </Stack>
                            </Paper>
                        </Grid>
                    </Grid>
                )}

                <Grid container spacing={2}>
                    {/* Tags & AI */}
                    <Grid size={{ xs: 12, md: 5 }}>
                        <Paper variant="outlined" sx={{ p: 1, height: '100%' }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                    <Typography variant="h6" fontSize="1rem" fontWeight="bold">用电特征标签与模式识别</Typography>
                                </Stack>
                                <Button
                                    variant="outlined"
                                    color="secondary"
                                    startIcon={aiAnalyzing ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                                    onClick={handleAiDiagnose}
                                    disabled={aiAnalyzing}
                                    size="small"
                                >
                                    AI 模式识别
                                </Button>
                            </Stack>

                            {aiSummary && (
                                <Alert severity="info" sx={{ mb: 2, fontSize: '0.875rem' }}>
                                    {aiSummary}
                                </Alert>
                            )}

                            <Box sx={{ mb: 3 }}>
                                <Typography variant="subtitle2" gutterBottom color="text.secondary">手工标签</Typography>
                                <TagSelector tags={manualTags} onChange={handleManualTagChange} />
                            </Box>

                            <Box>
                                <Typography variant="subtitle2" gutterBottom color="text.secondary">自动标签</Typography>
                                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    {autoTags.length === 0 && <Typography variant="caption" color="text.disabled">暂无自动标签</Typography>}
                                    {autoTags.map(tag => (
                                        <Chip
                                            key={tag.name}
                                            label={tag.name}
                                            color="secondary"
                                            variant="outlined"
                                            size="small"
                                            onDelete={() => handleRemoveAutoTag(tag.name)}
                                            deleteIcon={<DeleteIcon />}
                                        />
                                    ))}
                                </Stack>
                            </Box>
                        </Paper>
                    </Grid>

                    {/* History Chart */}
                    <Grid size={{ xs: 12, md: 7 }}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                    <Typography variant="h6" fontSize="1rem" fontWeight="bold">历史趋势</Typography>
                                </Stack>
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        variant={historyType === 'daily' ? 'contained' : 'outlined'}
                                        size="small"
                                        onClick={() => setHistoryType('daily')}
                                    >
                                        30天
                                    </Button>
                                    <Button
                                        variant={historyType === 'monthly' ? 'contained' : 'outlined'}
                                        size="small"
                                        onClick={() => setHistoryType('monthly')}
                                    >
                                        12个月
                                    </Button>
                                </Stack>
                            </Stack>

                            <Box sx={{ height: 220 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={historyData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                        <YAxis />
                                        <RechartsTooltip content={<CustomTooltip unit="MWh" />} />
                                        <Bar dataKey="value" name="电量 (MWh)">
                                            {historyData.map((entry, index) => {
                                                let color = historyType === 'daily' ? "#8caac4" : "#e0e0e0"; // Soft Blue for daily, Grey for monthly history
                                                if (historyType === 'daily') {
                                                    try {
                                                        const day = getDay(parseISO(entry.date));
                                                        if (day === 0 || day === 6) {
                                                            color = "#c48c8c"; // Morandi Rose for weekend
                                                        }
                                                    } catch (e) {
                                                        // Fallback
                                                    }
                                                } else if (historyType === 'monthly') {
                                                    // Highlight current month
                                                    const currentMonthStr = selectedDate ? format(selectedDate, 'yyyy-MM') : '';
                                                    if (entry.date === currentMonthStr) {
                                                        color = theme.palette.primary.main; // Primary Blue for current month
                                                    }
                                                }
                                                return <Cell key={`cell-${index}`} fill={color} />;
                                            })}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            </Box>
        </LocalizationProvider>
    );
};
