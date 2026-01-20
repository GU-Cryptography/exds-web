import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Grid,
    CircularProgress,
    Alert,
    IconButton,
    Chip,
    Button,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Snackbar
} from '@mui/material';
import {
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon,
    FileUpload as ImportIcon,
    Refresh as RefreshIcon,
    Compare as CompareIcon,
    MergeType as MergeIcon,
    Tune as TuneIcon
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, addDays, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, parseISO } from 'date-fns';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

import { LoadDataAggregationDialog } from '../components/load-diagnosis/LoadDataAggregationDialog';
import { CoefficientCalibrationDialog } from '../components/load-diagnosis/CoefficientCalibrationDialog';

interface Props {
    customerId: string;
}

interface CustomerDetail {
    customer_id: string;
    customer_name: string;
    stats: {
        account_count: number;
        meter_count: number;
        mp_count: number;
    };
    quality: {
        gap_days: number;
        mp_incomplete_days: number;
        avg_accuracy: number | null;
        total_days: number;
    };
    date_range: string | null;
    accounts: Array<{
        account_no: string;
        meters: Array<{ meter_id: string; multiplier: number; allocation_ratio: number | null }>;
        metering_points: string[];
    }>;
}

interface CalendarDay {
    date: string;
    // coverage: number; // 移除百分比字段
    has_meter_data: boolean;
    daily_accuracy: number | null;
    mp_missing: number;
    meter_actual: number;
    meter_expected: number;
    missing_mps: string[];
}

interface CurveData {
    date: string;
    mp_values: number[];
    meter_values: number[];
    mp_total: number | null;
    meter_total: number | null;
    daily_error: number | null;
}

interface TimelineData {
    date: string;
    has_mp: boolean;
    has_meter: boolean;
    mp_missing: number;
}

export const LoadDataDiagnosisWorkbench: React.FC<Props> = ({ customerId }) => {
    // 状态
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<CustomerDetail | null>(null);

    const [aggregationOpen, setAggregationOpen] = useState(false);
    const [calibrationOpen, setCalibrationOpen] = useState(false);

    // Snackbar
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info' | 'warning';
    }>({
        open: false,
        message: '',
        severity: 'info'
    });

    const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'success') => {
        setSnackbar({ open: true, message, severity });
    };

    const handleSnackbarClose = () => {
        setSnackbar({ ...snackbar, open: false });
    };

    // 时间线状态（全周期）
    const [timelineData, setTimelineData] = useState<TimelineData[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);

    // 日历状态
    const [calendarMonth, setCalendarMonth] = useState(new Date());
    const [calendarData, setCalendarData] = useState<CalendarDay[]>([]);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [selectedCalendarDay, setSelectedCalendarDay] = useState<CalendarDay | null>(null);

    // 曲线状态
    const [curveDate, setCurveDate] = useState<Date>(addDays(new Date(), -2));
    const [curveData, setCurveData] = useState<CurveData | null>(null);
    const [curveLoading, setCurveLoading] = useState(false);
    const [lastError, setLastError] = useState<string>('');
    const [curveMode, setCurveMode] = useState<'compare' | 'merge'>('compare');

    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton } = useChartFullscreen({
        chartRef,
        title: `负荷曲线 ${format(curveDate, 'yyyy-MM-dd')}`
    });

    const handleReaggregate = () => {
        setAggregationOpen(true);
    };

    // 加载客户详情
    const fetchDetail = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await apiClient.get(`/api/v1/load-data/customers/${customerId}`);
            setDetail(response.data);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载失败');
        } finally {
            setLoading(false);
        }
    };

    // 加载时间线数据（全周期）
    const fetchTimeline = async () => {
        try {
            setTimelineLoading(true);
            // 获取全周期数据（使用 all=true 参数）
            const response = await apiClient.get(`/api/v1/load-data/customers/${customerId}/calendar?all=true`);
            const calendar = response.data.calendar || [];
            setTimelineData(calendar.map((d: CalendarDay) => ({
                date: d.date,
                has_mp: d.mp_missing < (detail?.stats?.mp_count || 0), // 如果缺失数小于总数，说明有数据
                has_meter: d.has_meter_data,
                // mp_coverage: d.coverage // 移除
                mp_missing: d.mp_missing
            })));
        } catch (err) {
            console.error('加载时间线失败:', err);
        } finally {
            setTimelineLoading(false);
        }
    };

    // 加载日历数据
    const fetchCalendar = async (month: Date) => {
        try {
            setCalendarLoading(true);
            const monthStr = format(month, 'yyyy-MM');
            const response = await apiClient.get(`/api/v1/load-data/customers/${customerId}/calendar?month=${monthStr}`);
            setCalendarData(response.data.calendar || []);
        } catch (err) {
            console.error('加载日历失败:', err);
        } finally {
            setCalendarLoading(false);
        }
    };

    // 加载曲线数据
    const fetchCurve = async (date: Date) => {
        try {
            setCurveLoading(true);
            const dateStr = format(date, 'yyyy-MM-dd');
            const response = await apiClient.get(`/api/v1/load-data/customers/${customerId}/curves`, {
                params: {
                    start_date: dateStr,
                    end_date: dateStr,
                    detail_date: dateStr
                }
            });
            setCurveData(response.data);
        } catch (err: any) {
            console.error('加载曲线失败:', err);
            setCurveData(null);
        } finally {
            setCurveLoading(false);
        }
    };

    // 初始化
    useEffect(() => {
        fetchDetail();
        fetchTimeline();
    }, [customerId]);

    useEffect(() => {
        fetchCalendar(calendarMonth);
    }, [customerId, calendarMonth]);

    useEffect(() => {
        fetchCurve(curveDate);
    }, [customerId, curveDate]);

    // 日历点击联动曲线
    const handleCalendarDayClick = (day: CalendarDay) => {
        setSelectedCalendarDay(day);
        setCurveDate(parseISO(day.date));
    };

    // 获取日期状态颜色（优先按准确率着色）
    const getDayColor = (dateStr: string): string => {
        const dayData = calendarData.find(d => d.date === dateStr);
        if (!dayData) return '#e0e0e0'; // 灰色 - 无数据

        // 优先检查准确率：低于95%显示红色
        if (dayData.daily_accuracy !== null && dayData.daily_accuracy < 95) {
            return '#f44336'; // 红色 - 准确率不达标
        }

        // 然后按数据完整度着色
        const totalMp = detail?.stats?.mp_count || 0;
        const mpActual = Math.max(0, totalMp - dayData.mp_missing);
        const isMpComplete = totalMp > 0 && mpActual === totalMp;
        const hasMpData = mpActual > 0;

        if (isMpComplete && dayData.has_meter_data) return '#4caf50'; // 绿色 - 完整
        if (hasMpData || dayData.has_meter_data) return '#ff9800'; // 橙色 - 部分
        return '#f44336'; // 红色 - 缺失 (如果有天但没数据)
    };

    // 渲染时间线
    const renderTimeline = () => {
        if (timelineData.length === 0) {
            return <Typography variant="caption" color="text.secondary">暂无全周期数据</Typography>;
        }

        const totalDays = timelineData.length;

        return (
            <Box>
                {/* MP 时间线 */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ width: 50, flexShrink: 0 }}>MP</Typography>
                    <Box sx={{ display: 'flex', flex: 1, height: 16, borderRadius: 1, overflow: 'hidden' }}>
                        {timelineData.map((d, i) => (
                            <Tooltip key={d.date} title={`${d.date}: ${d.has_mp ? `计量点 ${Math.max(0, (detail?.stats?.mp_count || 0) - d.mp_missing)}/${detail?.stats?.mp_count || 0}` : '无数据'}`}>
                                <Box
                                    sx={{
                                        flex: 1,
                                        backgroundColor: d.has_mp
                                            ? (d.mp_missing === 0 ? '#4caf50' : '#ff9800')
                                            : '#e0e0e0',
                                        cursor: 'pointer',
                                        '&:hover': { opacity: 0.8 }
                                    }}
                                    onClick={() => setCurveDate(parseISO(d.date))}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>
                {/* Meter 时间线 */}
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ width: 50, flexShrink: 0 }}>Meter</Typography>
                    <Box sx={{ display: 'flex', flex: 1, height: 16, borderRadius: 1, overflow: 'hidden' }}>
                        {timelineData.map((d, i) => (
                            <Tooltip key={d.date} title={`${d.date}: ${d.has_meter ? '有数据' : '无数据'}`}>
                                <Box
                                    sx={{
                                        flex: 1,
                                        backgroundColor: d.has_meter ? '#4caf50' : '#e0e0e0',
                                        cursor: 'pointer',
                                        '&:hover': { opacity: 0.8 }
                                    }}
                                    onClick={() => setCurveDate(parseISO(d.date))}
                                />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    共 {totalDays} 天 ({timelineData[0]?.date} ~ {timelineData[totalDays - 1]?.date})
                </Typography>
            </Box>
        );
    };

    // 渲染日历
    const renderCalendar = () => {
        const monthStart = startOfMonth(calendarMonth);
        const monthEnd = endOfMonth(calendarMonth);
        const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
        const startDayOfWeek = getDay(monthStart); // 0=周日

        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        const emptyDays = Array(startDayOfWeek).fill(null);

        return (
            <Box>
                {/* 月份导航 */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <IconButton size="small" onClick={() => setCalendarMonth(addMonths(calendarMonth, -1))}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <Typography variant="subtitle1" fontWeight="bold">
                        {format(calendarMonth, 'yyyy年M月')}
                    </Typography>
                    <IconButton size="small" onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))}>
                        <ArrowRightIcon />
                    </IconButton>
                </Box>

                {/* 星期标题 */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 0.5 }}>
                    {weekDays.map(day => (
                        <Typography key={day} variant="caption" align="center" color="text.secondary">
                            {day}
                        </Typography>
                    ))}
                </Box>

                {/* 日期格子 */}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
                    {emptyDays.map((_, i) => (
                        <Box key={`empty-${i}`} sx={{ aspectRatio: '1', p: 0.5 }} />
                    ))}
                    {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayData = calendarData.find(d => d.date === dateStr);
                        const color = getDayColor(dateStr);
                        const isSelected = selectedCalendarDay?.date === dateStr || isSameDay(day, curveDate);

                        return (
                            <Tooltip
                                key={dateStr}
                                title={
                                    dayData ? (
                                        <Box>
                                            <Typography variant="caption" display="block" fontWeight="bold">{dateStr}</Typography>
                                            <Typography variant="caption" display="block">
                                                计量点: {Math.max(0, (detail?.stats?.mp_count || 0) - dayData.mp_missing)}/{detail?.stats?.mp_count || 0}
                                            </Typography>
                                            <Typography variant="caption" display="block">
                                                电表: {dayData.meter_actual}/{dayData.meter_expected}
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                display="block"
                                                sx={{ color: dayData.daily_accuracy !== null && dayData.daily_accuracy < 95 ? '#ff6b6b' : 'inherit' }}
                                            >
                                                准确率: {dayData.daily_accuracy !== null ? `${dayData.daily_accuracy}%` : '-'}
                                            </Typography>
                                        </Box>
                                    ) : `${dateStr}: 无数据`
                                }
                                arrow
                            >
                                <Box
                                    onClick={() => dayData && handleCalendarDayClick(dayData)}
                                    sx={{
                                        aspectRatio: '1',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        backgroundColor: color,
                                        borderRadius: 1,
                                        cursor: dayData ? 'pointer' : 'default',
                                        border: isSelected ? '2px solid #1976d2' : 'none',
                                        '&:hover': dayData ? { opacity: 0.8 } : {}
                                    }}
                                >
                                    <Typography variant="caption" sx={{ color: '#fff', fontWeight: isSelected ? 'bold' : 'normal' }}>
                                        {format(day, 'd')}
                                    </Typography>
                                </Box>
                            </Tooltip>
                        );
                    })}
                </Box>
            </Box>
        );
    };

    // 准备曲线图数据
    const chartData = useMemo(() => {
        if (!curveData) return [];

        // 处理可能是数组的情况 (API返回列表时)
        const dataObj: CurveData = Array.isArray(curveData) ? (curveData.length > 0 ? curveData[0] : null) : curveData;

        if (!dataObj || !dataObj.mp_values || !dataObj.meter_values) return [];

        // 确保 values 也是数组
        const mpValues = Array.isArray(dataObj.mp_values) ? dataObj.mp_values : [];
        const meterValues = Array.isArray(dataObj.meter_values) ? dataObj.meter_values : [];

        return Array.from({ length: 48 }, (_, i) => {
            const mpVal = mpValues[i] !== undefined && mpValues[i] !== null ? mpValues[i] : null;
            const meterVal = meterValues[i] !== undefined && meterValues[i] !== null ? meterValues[i] : null;

            return {
                time: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
                mp: mpVal,
                meter: meterVal,
                merged: curveMode === 'merge' && mpVal !== null && meterVal !== null ? (mpVal + meterVal) / 2 : null
            };
        });
    }, [curveData, curveMode]);

    // 渲染曲线图
    const renderCurveChart = () => (
        <Box ref={chartRef} sx={{ width: '100%', height: { xs: 240, md: 'auto' }, aspectRatio: { md: '2.5/1' }, position: 'relative' }}>
            <FullscreenEnterButton />
            <FullscreenExitButton />

            {curveLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <CircularProgress />
                </Box>
            ) : !curveData || (Array.isArray(curveData) && curveData.length === 0) || (!Array.isArray(curveData) && (!curveData.mp_values || curveData.mp_values.length === 0) && (!curveData.meter_values || curveData.meter_values.length === 0)) ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <Typography color="text.secondary">无曲线数据</Typography>
                </Box>
            ) : (
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={5} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RechartsTooltip />
                        <Legend />
                        {curveMode === 'compare' ? (
                            <>
                                {/* 电表曲线 - 底层，粗实线 */}
                                <Line type="monotone" dataKey="meter" name="电表" stroke="#f57c00" dot={false} strokeWidth={3} />
                                {/* 计量点曲线 - 上层，虚线，便于重合时区分 */}
                                <Line type="monotone" dataKey="mp" name="计量点" stroke="#1976d2" dot={false} strokeWidth={2} strokeDasharray="5 3" />
                            </>
                        ) : (
                            <Line type="monotone" dataKey="merged" name="融合" stroke="#4caf50" dot={false} strokeWidth={2} />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            )}
        </Box>
    );

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error || !detail) {
        return (
            <Box sx={{ p: 2 }}>
                <Alert severity="error">{error || '加载失败'}</Alert>
            </Box>
        );
    }

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
                {/* 头部区域 */}
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                        {/* 客户信息 */}
                        <Box>
                            <Typography variant="h6">{detail.customer_name}</Typography>
                            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                                <Chip size="small" label={`户号: ${detail.stats.account_count}`} variant="outlined" />
                                <Chip size="small" label={`电表: ${detail.stats.meter_count}`} variant="outlined" />
                                <Chip size="small" label={`计量点: ${detail.stats.mp_count}`} variant="outlined" />
                            </Box>
                        </Box>

                        {/* 质量指标 */}
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Chip
                                size="small"
                                label={`断点: ${detail.quality.gap_days}天`}
                                color={detail.quality.gap_days > 0 ? 'error' : 'success'}
                            />
                            <Chip
                                size="small"
                                label={`MP异常: ${detail.quality.mp_incomplete_days}天`}
                                color={detail.quality.mp_incomplete_days > 0 ? 'warning' : 'success'}
                            />
                            <Chip
                                size="small"
                                label={`准确率: ${detail.quality.avg_accuracy ?? '-'}%`}
                                color={detail.quality.avg_accuracy && detail.quality.avg_accuracy >= 95 ? 'success' : 'warning'}
                            />
                        </Box>

                        {/* 操作按钮 */}
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button variant="outlined" size="small" startIcon={<TuneIcon />} onClick={() => setCalibrationOpen(true)}>
                                系数校核
                            </Button>
                            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={handleReaggregate}>
                                重新聚合
                            </Button>
                        </Box>
                    </Box>
                </Paper>

                {/* 区域A: 时间线视图 */}
                <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>全周期数据分布</Typography>
                    {timelineLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={20} />
                        </Box>
                    ) : (
                        renderTimeline()
                    )}
                </Paper>

                {/* 区域B: 日历热力图 + 负荷曲线（并排） */}
                <Grid container spacing={2} sx={{ alignItems: 'stretch' }}>
                    {/* 左侧：日历热力图 */}
                    <Grid size={{ xs: 12, md: 4 }}>
                        <Paper variant="outlined" sx={{ p: 2, minHeight: 250, height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <Box sx={{ maxWidth: { md: 400 }, width: '100%', mx: 'auto', display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <Typography variant="subtitle2" sx={{ mb: 2 }}>月度数据分布</Typography>
                                {calendarLoading ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                                        <CircularProgress size={24} />
                                    </Box>
                                ) : (
                                    <>
                                        {renderCalendar()}

                                        {/* 图例 */}
                                        <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Box sx={{ width: 12, height: 12, backgroundColor: '#4caf50', borderRadius: 0.5 }} />
                                                <Typography variant="caption">完整</Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Box sx={{ width: 12, height: 12, backgroundColor: '#ff9800', borderRadius: 0.5 }} />
                                                <Typography variant="caption">部分</Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Box sx={{ width: 12, height: 12, backgroundColor: '#f44336', borderRadius: 0.5 }} />
                                                <Typography variant="caption">缺失</Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Box sx={{ width: 12, height: 12, backgroundColor: '#e0e0e0', borderRadius: 0.5 }} />
                                                <Typography variant="caption">无数据</Typography>
                                            </Box>
                                        </Box>

                                        {/* 选中日期详情（移动端显示） */}
                                        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                            {selectedCalendarDay ? (
                                                <Box>
                                                    <Typography variant="body2" fontWeight="bold">
                                                        {selectedCalendarDay.date}
                                                    </Typography>
                                                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 0.5 }}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            计量点数据: {Math.max(0, (detail?.stats?.mp_count || 0) - selectedCalendarDay.mp_missing)}/{detail?.stats?.mp_count || 0}
                                                            {selectedCalendarDay.mp_missing > 0 && ` (缺${selectedCalendarDay.mp_missing})`}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            电表数据: {selectedCalendarDay.meter_actual}/{selectedCalendarDay.meter_expected}
                                                        </Typography>
                                                    </Box>
                                                    <Typography
                                                        variant="caption"
                                                        display="block"
                                                        sx={{ mt: 0.5, color: selectedCalendarDay.daily_accuracy !== null && selectedCalendarDay.daily_accuracy < 95 ? 'error.main' : 'text.secondary' }}
                                                    >
                                                        准确率: {selectedCalendarDay.daily_accuracy !== null ? `${selectedCalendarDay.daily_accuracy}%` : '-'}
                                                    </Typography>
                                                </Box>
                                            ) : (
                                                <Typography variant="caption" color="text.secondary">点击日期查看详情</Typography>
                                            )}
                                        </Box>
                                    </>
                                )}
                            </Box>
                        </Paper>
                    </Grid>

                    {/* 右侧：负荷曲线 */}
                    <Grid size={{ xs: 12, md: 8 }}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                            {/* 标题栏 + 控制栏整合 */}
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                                <Typography variant="subtitle2">负荷曲线比对</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <IconButton size="small" onClick={() => setCurveDate(addDays(curveDate, -1))}>
                                        <ArrowLeftIcon fontSize="small" />
                                    </IconButton>
                                    <DatePicker
                                        value={curveDate}
                                        onChange={(date) => date && setCurveDate(date)}
                                        slotProps={{
                                            textField: {
                                                size: 'small',
                                                variant: 'standard',
                                                sx: { width: 110 },
                                                InputProps: { disableUnderline: true, style: { fontSize: '0.875rem' } }
                                            }
                                        }}
                                    />
                                    <IconButton size="small" onClick={() => setCurveDate(addDays(curveDate, 1))}>
                                        <ArrowRightIcon fontSize="small" />
                                    </IconButton>

                                    {curveData?.daily_error !== null && curveData?.daily_error !== undefined && (
                                        <Chip
                                            size="small"
                                            label={`${((1 - Math.abs(curveData.daily_error)) * 100).toFixed(0)}%`}
                                            color={Math.abs(curveData.daily_error) < 0.05 ? 'success' : 'warning'}
                                            sx={{ height: 24, '& .MuiChip-label': { px: 1, fontSize: '0.75rem' } }}
                                        />
                                    )}

                                    <ToggleButtonGroup
                                        value={curveMode}
                                        exclusive
                                        onChange={(_, newMode) => newMode && setCurveMode(newMode)}
                                        size="small"
                                        sx={{ height: 24 }}
                                    >
                                        <ToggleButton value="compare" sx={{ py: 0, fontSize: '0.75rem' }}>对比</ToggleButton>
                                        <ToggleButton value="merge" sx={{ py: 0, fontSize: '0.75rem' }}>融合</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            </Box>

                            {/* 图表区域 */}
                            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                                {renderCurveChart()}
                            </Box>

                            {/* 底部统计信息 */}
                            {curveData && (curveData.mp_total || curveData.meter_total) && (
                                <Box sx={{ display: 'flex', gap: 2, mt: 0.5, justifyContent: 'center' }}>
                                    {curveData.mp_total && (
                                        <Typography variant="caption" color="text.secondary">
                                            计量点: {curveData.mp_total.toFixed(2)} MWh
                                        </Typography>
                                    )}
                                    {curveData.meter_total && (
                                        <Typography variant="caption" color="text.secondary">
                                            电表: {curveData.meter_total.toFixed(2)} MWh
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </Paper>
                    </Grid>
                </Grid>

                <LoadDataAggregationDialog
                    open={aggregationOpen}
                    customerId={customerId}
                    onClose={() => setAggregationOpen(false)}
                    onSuccess={() => {
                        fetchDetail();
                        fetchTimeline();
                        fetchCalendar(calendarMonth);
                        fetchCurve(curveDate);
                        showSnackbar('聚合操作已完成', 'success');
                    }}
                />

                <CoefficientCalibrationDialog
                    open={calibrationOpen}
                    onClose={() => setCalibrationOpen(false)}
                    customerId={customerId}
                    customerName={detail.customer_name}
                    onSuccess={() => {
                        fetchDetail();
                        fetchTimeline();
                        fetchCalendar(calendarMonth);
                        fetchCurve(curveDate);
                        showSnackbar('系数校核应用成功', 'success');
                    }}
                />

                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={6000}
                    onClose={handleSnackbarClose}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                >
                    <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: '100%' }}>
                        {snackbar.message}
                    </Alert>
                </Snackbar>
            </Box>
        </LocalizationProvider>
    );
};
