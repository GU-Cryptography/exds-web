/**
 * 日前价格预测分析页面
 * 
 * 功能：
 * 1. 展示日前价格预测曲线与实际价格对比
 * 2. 显示预测准确度评估指标
 * 3. 支持多版本回溯
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    Chip,
    Card,
    CardContent,
    LinearProgress,
    useTheme,
    useMediaQuery,
    SelectChangeEvent,
    Button,
    Snackbar,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import SyncIcon from '@mui/icons-material/Sync';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { format, addDays } from 'date-fns';
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
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useAuth } from '../contexts/AuthContext';
import { priceForecastApi, ForecastVersion, ChartDataPoint, AccuracyData, CommandStatus } from '../api/priceForecast';


// ============ 自定义 Tooltip ============
interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ dataKey: string; value: number | null }>;
    label?: string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;

    const predicted = payload.find((p) => p.dataKey === 'predicted_price')?.value ?? null;
    const actual = payload.find((p) => p.dataKey === 'actual_price')?.value ?? null;
    const conf80Lower = payload.find((p) => p.dataKey === 'confidence_80_lower')?.value ?? null;
    const conf80Upper = payload.find((p) => p.dataKey === 'confidence_80_upper')?.value ?? null;
    const conf90Lower = payload.find((p) => p.dataKey === 'confidence_90_lower')?.value ?? null;
    const conf90Upper = payload.find((p) => p.dataKey === 'confidence_90_upper')?.value ?? null;
    const error = (predicted !== null && actual !== null) ? (predicted - actual) : null;

    return (
        <Paper sx={{ p: 1.5, minWidth: 200 }}>
            <Typography variant="subtitle2" gutterBottom>{label}</Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Typography variant="body2" color="primary.main">预测价格:</Typography>
                <Typography variant="body2" fontWeight="bold">
                    {predicted !== null ? `${predicted.toFixed(2)} 元` : '-'}
                </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <Typography variant="body2" color="error.main">实际价格:</Typography>
                <Typography variant="body2" fontWeight="bold">
                    {actual !== null ? `${actual.toFixed(2)} 元` : '-'}
                </Typography>
            </Box>

            {(conf80Lower !== null || conf90Lower !== null) && (
                <Box sx={{ mt: 1, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                    {conf80Lower !== null && conf80Upper !== null && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                            <Typography variant="caption" color="text.secondary">80% 置信区间:</Typography>
                            <Typography variant="caption" fontWeight="bold">
                                [{conf80Lower.toFixed(1)}, {conf80Upper.toFixed(1)}]
                            </Typography>
                        </Box>
                    )}
                    {conf90Lower !== null && conf90Upper !== null && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                            <Typography variant="caption" color="text.secondary">90% 置信区间:</Typography>
                            <Typography variant="caption" fontWeight="bold" color="success.main">
                                [{conf90Lower.toFixed(1)}, {conf90Upper.toFixed(1)}]
                            </Typography>
                        </Box>
                    )}
                </Box>
            )}

            {error !== null && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 0.5, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" color="text.secondary">误差:</Typography>
                    <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={Math.abs(error) < 20 ? 'success.main' : error > 0 ? 'warning.main' : 'error.main'}
                    >
                        {error > 0 ? '+' : ''}{error.toFixed(2)} 元
                    </Typography>
                </Box>
            )}
        </Paper>
    );
};


// ============ 准确度颜色编码 ============
const getAccuracyColor = (accuracy: number): 'success' | 'warning' | 'error' => {
    if (accuracy >= 90) return 'success';
    if (accuracy >= 85) return 'warning';
    return 'error';
};


// ============ 核心指标卡片组件 ============
interface KpiCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    color?: 'default' | 'success' | 'warning' | 'error';
    chips?: Array<{ label: string; passed: boolean }>;
    icon?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, subtitle, color, chips, icon }) => {
    const colorMap: Record<string, string> = {
        success: 'success.main',
        warning: 'warning.main',
        error: 'error.main',
        default: 'text.primary',
    };

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">{title}</Typography>
                    {icon}
                </Box>
                <Typography
                    variant="h5"
                    fontWeight="bold"
                    color={colorMap[color || 'default']}
                    sx={{ mb: 0.5 }}
                >
                    {value}
                </Typography>
                {subtitle && (
                    <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
                )}
                {chips && chips.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {chips.map((chip, idx) => (
                            <Chip
                                key={idx}
                                label={chip.label}
                                size="small"
                                color={chip.passed ? 'success' : 'default'}
                                variant={chip.passed ? 'filled' : 'outlined'}
                                icon={chip.passed ? <CheckCircleIcon /> : undefined}
                            />
                        ))}
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};


// ============ 分时段准确度组件 ============
interface PeriodAccuracyProps {
    data: Record<string, number>;
}

const PeriodAccuracyCard: React.FC<PeriodAccuracyProps> = ({ data }) => {
    if (!data || Object.keys(data).length === 0) {
        return (
            <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                    <Typography variant="subtitle2" gutterBottom>分时段准确度</Typography>
                    <Typography variant="body2" color="text.secondary">暂无数据</Typography>
                </CardContent>
            </Card>
        );
    }

    const periodOrder = ['尖峰', '高峰', '平段', '低谷', '深谷'];
    const sortedPeriods = Object.entries(data).sort((a, b) => {
        const idxA = periodOrder.indexOf(a[0]);
        const idxB = periodOrder.indexOf(b[0]);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Typography variant="subtitle2" gutterBottom>分时段准确度</Typography>
                {sortedPeriods.map(([period, accuracy]) => (
                    <Box key={period} sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="body2">{period}</Typography>
                            <Typography
                                variant="body2"
                                fontWeight="bold"
                                color={`${getAccuracyColor(accuracy ?? 0)}.main`}
                            >
                                {(accuracy ?? 0).toFixed(1)}%
                            </Typography>
                        </Box>
                        <LinearProgress
                            variant="determinate"
                            value={Math.min(accuracy ?? 0, 100)}
                            color={getAccuracyColor(accuracy ?? 0)}
                            sx={{ height: 6, borderRadius: 3 }}
                        />
                    </Box>
                ))}
            </CardContent>
        </Card>
    );
};


// ============ 当日数据特征组件 ============
interface DailyStatsProps {
    stats: AccuracyData['stats'];
    chartData: ChartDataPoint[];
}

const DailyStatsCard: React.FC<DailyStatsProps> = ({ stats, chartData }) => {
    // 从 chartData 计算预测价格统计
    const predictedPrices = chartData
        .map(d => d.predicted_price)
        .filter((p): p is number => p !== null && p !== undefined);

    const predictedStats = predictedPrices.length > 0 ? {
        max: Math.max(...predictedPrices),
        min: Math.min(...predictedPrices),
        mean: predictedPrices.reduce((a, b) => a + b, 0) / predictedPrices.length,
        hasNegative: predictedPrices.some(p => p < 0),
    } : null;

    // 从 chartData 计算实际价格统计
    const actualPrices = chartData
        .map(d => d.actual_price)
        .filter((p): p is number => p !== null && p !== undefined);

    const actualStats = actualPrices.length > 0 ? {
        max: Math.max(...actualPrices),
        min: Math.min(...actualPrices),
        mean: actualPrices.reduce((a, b) => a + b, 0) / actualPrices.length,
        hasNegative: actualPrices.some(p => p < 0),
    } : null;

    if (!predictedStats && !actualStats) {
        return (
            <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                    <Typography variant="subtitle2" gutterBottom>当日数据特征</Typography>
                    <Typography variant="body2" color="text.secondary">暂无数据</Typography>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Typography variant="subtitle2" gutterBottom>当日数据特征</Typography>

                {/* 表头 */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}></Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 70, textAlign: 'right' }}>预测</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ width: 70, textAlign: 'right' }}>实际</Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {/* 最高价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>最高价</Typography>
                        <Typography variant="body2" fontWeight="bold" color="error.main" sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? predictedStats.max.toFixed(1) : '-'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" color="error.main" sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? actualStats.max.toFixed(1) : '-'}
                        </Typography>
                    </Box>

                    {/* 最低价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>最低价</Typography>
                        <Typography variant="body2" fontWeight="bold" color="success.main" sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? predictedStats.min.toFixed(1) : '-'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" color="success.main" sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? actualStats.min.toFixed(1) : '-'}
                        </Typography>
                    </Box>

                    {/* 均价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>均价</Typography>
                        <Typography variant="body2" fontWeight="bold" sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? predictedStats.mean.toFixed(1) : '-'}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold" sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? actualStats.mean.toFixed(1) : '-'}
                        </Typography>
                    </Box>

                    {/* 负电价 */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>负电价</Typography>
                        <Box sx={{ width: 70, textAlign: 'right' }}>
                            {predictedStats ? (
                                predictedStats.hasNegative ? (
                                    <Chip label="有" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                                ) : (
                                    <Chip label="无" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                )
                            ) : '-'}
                        </Box>
                        <Box sx={{ width: 70, textAlign: 'right' }}>
                            {actualStats ? (
                                actualStats.hasNegative ? (
                                    <Chip label="有" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
                                ) : (
                                    <Chip label="无" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                                )
                            ) : '-'}
                        </Box>
                    </Box>
                </Box>
            </CardContent>
        </Card>
    );
};


// ============ 主页面组件 ============
export const DayAheadPriceForecastPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:forecast_dayahead_price:edit');

    // 状态管理
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
    const [versions, setVersions] = useState<ForecastVersion[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');
    const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
    const [accuracy, setAccuracy] = useState<AccuracyData | null>(null);

    const [loadingVersions, setLoadingVersions] = useState(false);
    const [loadingChart, setLoadingChart] = useState(false);
    const [loadingAccuracy, setLoadingAccuracy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

    // 预测触发相关状态
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [commandId, setCommandId] = useState<string | null>(null);
    const [commandStatus, setCommandStatus] = useState<CommandStatus['status'] | null>(null);
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // 日期限制：最多选到明天
    const maxDate = addDays(new Date(), 1);

    // 计算预测均价
    const avgPredictedPrice = useMemo(() => {
        if (chartData.length === 0) return null;
        const validPoints = chartData.filter(d => d.predicted_price !== null);
        if (validPoints.length === 0) return null;
        const sum = validPoints.reduce((acc, curr) => acc + (curr.predicted_price || 0), 0);
        return sum / validPoints.length;
    }, [chartData]);

    // 图表全屏
    const chartRef = useRef<HTMLDivElement>(null);
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
    const currentVersion = versions.find(v => v.forecast_id === selectedVersion);

    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons,
    } = useChartFullscreen({
        chartRef,
        title: `日前价格预测 (${dateStr})`,
        onPrevious: () => handleShiftDate(-1),
        onNext: () => handleShiftDate(1),
    });

    // 加载预测版本列表
    const fetchVersions = async (date: Date | null) => {
        if (!date) return;

        setLoadingVersions(true);
        setError(null);
        try {
            const response = await priceForecastApi.fetchVersions({
                target_date: format(date, 'yyyy-MM-dd'),
                forecast_type: 'd1_price',
            });
            const data = response.data;
            setVersions(data);

            // 自动选中第一个（最新）版本
            if (data.length > 0) {
                setSelectedVersion(data[0].forecast_id);
            } else {
                setSelectedVersion('');
                setChartData([]);
                setAccuracy(null);
            }
        } catch (err: any) {
            console.error('获取预测版本失败:', err);
            setError(err.response?.data?.detail || err.message || '获取预测版本失败');
            setVersions([]);
            setSelectedVersion('');
        } finally {
            setLoadingVersions(false);
        }
    };

    // 加载图表数据
    const fetchChartData = async (forecastId: string, date: Date | null) => {
        if (!forecastId || !date) return;

        setLoadingChart(true);
        try {
            const response = await priceForecastApi.fetchChartData({
                forecast_id: forecastId,
                target_date: format(date, 'yyyy-MM-dd'),
            });
            setChartData(response.data);
        } catch (err: any) {
            console.error('获取图表数据失败:', err);
            setChartData([]);
        } finally {
            setLoadingChart(false);
        }
    };

    // 加载准确度数据
    const fetchAccuracy = async (forecastId: string, date: Date | null) => {
        if (!forecastId || !date) return;

        setLoadingAccuracy(true);
        try {
            const response = await priceForecastApi.fetchAccuracy({
                forecast_id: forecastId,
                target_date: format(date, 'yyyy-MM-dd'),
            });
            setAccuracy(response.data);
        } catch (err: any) {
            console.error('获取准确度数据失败:', err);
            setAccuracy(null);
        } finally {
            setLoadingAccuracy(false);
        }
    };

    // 日期变化时加载版本
    useEffect(() => {
        fetchVersions(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate]);

    // 版本或日期变化时加载数据
    useEffect(() => {
        if (selectedVersion && selectedDate) {
            fetchChartData(selectedVersion, selectedDate);
            fetchAccuracy(selectedVersion, selectedDate);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedVersion, selectedDate]);

    // 日期导航
    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = addDays(selectedDate, days);
        // 限制最大日期为明天
        if (newDate > maxDate) return;
        setSelectedDate(newDate);
    };

    // 检查是否可以向右导航（+1天）
    const canNavigateNext = selectedDate ? addDays(selectedDate, 1) <= maxDate : false;

    // 停止轮询
    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    }, []);

    // 轮询命令状态
    const startPolling = useCallback((cmdId: string) => {
        stopPolling();
        pollIntervalRef.current = setInterval(async () => {
            try {
                const response = await priceForecastApi.getCommandStatus(cmdId);
                const status = response.data.status;
                setCommandStatus(status);

                if (status === 'completed') {
                    stopPolling();
                    setSnackbar({ open: true, message: '预测任务已完成！', severity: 'success' });
                    // 刷新版本列表
                    fetchVersions(selectedDate);
                    setCommandId(null);
                    setCommandStatus(null);
                } else if (status === 'failed') {
                    stopPolling();
                    setSnackbar({ open: true, message: response.data.error_message || '预测任务执行失败', severity: 'error' });
                    setCommandId(null);
                    setCommandStatus(null);
                }
            } catch (err) {
                console.error('轮询命令状态失败:', err);
            }
        }, 5000); // 每 5 秒轮询一次
    }, [stopPolling, selectedDate]);

    // 组件卸载时清理轮询
    useEffect(() => {
        return () => stopPolling();
    }, [stopPolling]);

    // 触发预测
    const handleTriggerForecast = async () => {
        if (!canEdit) return;
        if (!selectedDate) return;

        const targetDate = format(selectedDate, 'yyyy-MM-dd');
        setTriggerLoading(true);

        try {
            // 1. 检查数据充足性
            const checkResponse = await priceForecastApi.checkDataAvailability({ target_date: targetDate });
            if (!checkResponse.data.is_sufficient) {
                setSnackbar({
                    open: true,
                    message: `数据不足（${checkResponse.data.count}/96条），无法触发预测`,
                    severity: 'warning'
                });
                setTriggerLoading(false);
                return;
            }

            // 2. 触发预测任务
            const triggerResponse = await priceForecastApi.triggerForecast({ target_date: targetDate });
            if (triggerResponse.data.success) {
                const cmdId = triggerResponse.data.command_id!;
                setCommandId(cmdId);
                setCommandStatus('pending');
                setSnackbar({ open: true, message: '预测任务已提交，预计1-2分钟完成', severity: 'info' });
                // 开始轮询状态
                startPolling(cmdId);
            } else {
                // 已有任务在执行中
                if (triggerResponse.data.existing_command_id) {
                    const cmdId = triggerResponse.data.existing_command_id;
                    setCommandId(cmdId);
                    setCommandStatus(triggerResponse.data.status as CommandStatus['status']);
                    setSnackbar({ open: true, message: triggerResponse.data.message, severity: 'warning' });
                    startPolling(cmdId);
                } else {
                    setSnackbar({ open: true, message: triggerResponse.data.message, severity: 'error' });
                }
            }
        } catch (err: any) {
            console.error('触发预测失败:', err);
            setSnackbar({ open: true, message: err.response?.data?.detail || '触发预测失败', severity: 'error' });
        } finally {
            setTriggerLoading(false);
        }
    };

    // 处理预测按钮点击
    const handlePredictClick = () => {
        if (!canEdit) return;
        if (versions.length > 0) {
            setConfirmDialogOpen(true);
        } else {
            handleTriggerForecast();
        }
    };

    // 确认重新预测
    const handleConfirmPredict = () => {
        if (!canEdit) return;
        setConfirmDialogOpen(false);
        handleTriggerForecast();
    };

    // 版本选择
    const handleVersionChange = (event: SelectChangeEvent<string>) => {
        setSelectedVersion(event.target.value);
    };

    // 格式化版本显示
    const formatVersionLabel = (version: ForecastVersion): string => {
        const time = new Date(version.created_at).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });
        return `${time} - ${version.model_type}`;
    };

    const loading = loadingVersions || loadingChart;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
                    >
                        价格预测 / 日前价格预测
                    </Typography>
                )}

                {/* 区域 A：控制栏 */}
                <Paper
                    variant="outlined"
                    sx={{
                        p: 2,
                        display: 'flex',
                        gap: 1,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>

                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        maxDate={maxDate}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } },
                            },
                        }}
                    />

                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading || !canNavigateNext}>
                        <ArrowRightIcon />
                    </IconButton>

                    <FormControl
                        size="small"
                        sx={{ minWidth: { xs: 180, sm: 280 }, ml: { xs: 0, sm: 2 } }}
                        disabled={loading || versions.length === 0}
                    >
                        <InputLabel>预测版本</InputLabel>
                        <Select
                            value={selectedVersion}
                            onChange={handleVersionChange}
                            label="预测版本"
                        >
                            {versions.map((v) => (
                                <MenuItem key={v.forecast_id} value={v.forecast_id}>
                                    {formatVersionLabel(v)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* 预测均价卡片 */}
                    {avgPredictedPrice !== null && (
                        <Box sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            ml: { xs: 0, sm: 2 },
                            px: 1.5,
                            py: 0.5,
                            border: '1px solid',
                            borderColor: 'primary.light',
                            borderRadius: 1,
                            bgcolor: 'rgba(25, 118, 210, 0.04)',
                        }}>
                            <Typography variant="caption" color="text.secondary">预测均价:</Typography>
                            <Typography variant="body2" fontWeight="bold" color="primary.main">
                                {avgPredictedPrice.toFixed(2)} 元
                            </Typography>
                        </Box>
                    )}

                    {/* 预测按钮 */}
                    <Button
                        variant="contained"
                        color={commandStatus ? 'warning' : 'primary'}
                        startIcon={
                            triggerLoading ? <CircularProgress size={16} color="inherit" /> :
                                commandStatus === 'pending' ? <HourglassEmptyIcon /> :
                                    commandStatus === 'running' ? <SyncIcon sx={{
                                        animation: 'spin 2s linear infinite',
                                        '@keyframes spin': {
                                            '0%': { transform: 'rotate(0deg)' },
                                            '100%': { transform: 'rotate(360deg)' }
                                        }
                                    }} /> :
                                        versions.length > 0 ? <SyncIcon /> : <PlayArrowIcon />
                        }
                        onClick={handlePredictClick}
                        disabled={
                            !canEdit ||
                            loading ||
                            triggerLoading ||
                            commandStatus === 'pending' ||
                            commandStatus === 'running'
                        }
                        sx={{ ml: { xs: 0, sm: 'auto' } }}
                    >
                        {commandStatus === 'pending' ? '等待中...' :
                            commandStatus === 'running' ? '执行中...' :
                                versions.length > 0 ? '重新预测' : '预测'}
                    </Button>
                </Paper>

                {/* 重新预测确认对话框 */}
                <Dialog
                    open={confirmDialogOpen}
                    onClose={() => setConfirmDialogOpen(false)}
                >
                    <DialogTitle>确认重新预测？</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            该日期已存在预测版本。重新预测将生成新的版本。是否继续？
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmDialogOpen(false)}>取消</Button>
                        <Button onClick={handleConfirmPredict} variant="contained" autoFocus disabled={!canEdit}>
                            执行重新预测
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* Snackbar 提示 */}
                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={6000}
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                >
                    <Alert
                        onClose={() => setSnackbar({ ...snackbar, open: false })}
                        severity={snackbar.severity}
                        sx={{ width: '100%' }}
                    >
                        {snackbar.message}
                    </Alert>
                </Snackbar>

                {/* 错误提示 */}
                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                )}

                {/* 首次加载 */}
                {loading && chartData.length === 0 ? (
                    <Box
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        minHeight="400px"
                    >
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        {/* 区域 B：趋势对比图 */}
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2, position: 'relative' }}>
                            {/* 数据刷新覆盖层 */}
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

                            <Typography variant="h6" gutterBottom>
                                预测与实际价格对比
                            </Typography>

                            <Box
                                ref={chartRef}
                                sx={{
                                    height: { xs: 350, sm: 450 },
                                    position: 'relative',
                                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                                    p: isFullscreen ? 2 : 0,
                                    ...(isFullscreen && {
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        width: '100vw',
                                        height: '100vh',
                                        zIndex: 1400,
                                    }),
                                }}
                            >
                                <FullscreenEnterButton />
                                <FullscreenExitButton />
                                <FullscreenTitle />
                                <NavigationButtons />

                                {chartData.length === 0 ? (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            height: '100%',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Typography color="text.secondary">
                                            {versions.length === 0
                                                ? '该日期暂无预测数据'
                                                : '加载中...'}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={chartData}
                                            margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis
                                                dataKey="time"
                                                tick={{ fontSize: 11 }}
                                                interval="preserveStartEnd"
                                            />
                                            <YAxis
                                                tick={{ fontSize: 11 }}
                                                label={{
                                                    value: '元/MWh',
                                                    angle: -90,
                                                    position: 'insideLeft',
                                                }}
                                            />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend />

                                            {/* 置信区间 */}
                                            {/* 置信区间 90% (浅绿色范围) */}
                                            {chartData.some(d => d.confidence_90_lower != null) && (
                                                <Area
                                                    type="monotone"
                                                    dataKey={(d: any) => [d.confidence_90_lower, d.confidence_90_upper]}
                                                    stroke="none"
                                                    fill="#4caf50"
                                                    fillOpacity={0.15}
                                                    name="90%置信区间"
                                                    connectNulls
                                                />
                                            )}

                                            {/* 置信区间 80% (淡蓝色范围) */}
                                            {chartData.some(d => d.confidence_80_lower != null) && (
                                                <Area
                                                    type="monotone"
                                                    dataKey={(d: any) => [d.confidence_80_lower, d.confidence_80_upper]}
                                                    stroke="none"
                                                    fill="#1976d2"
                                                    fillOpacity={0.15}
                                                    name="80%置信区间"
                                                    connectNulls
                                                />
                                            )}

                                            {/* 预测曲线 */}
                                            <Line
                                                type="monotone"
                                                dataKey="predicted_price"
                                                stroke="#1976d2"
                                                strokeWidth={2}
                                                dot={false}
                                                name="预测价格"
                                                connectNulls
                                            />

                                            {/* 实际曲线 */}
                                            <Line
                                                type="monotone"
                                                dataKey="actual_price"
                                                stroke="#d32f2f"
                                                strokeWidth={2}
                                                dot={false}
                                                name="实际价格"
                                                connectNulls
                                            />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                )}
                            </Box>
                        </Paper>

                        {/* 区域 C：准确度评估详情 */}
                        {loadingAccuracy ? (
                            <Box display="flex" justifyContent="center" my={4}>
                                <CircularProgress size={24} />
                            </Box>
                        ) : accuracy ? (
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
                                <Typography variant="h6" gutterBottom>
                                    准确度评估
                                </Typography>

                                {/* Row 1: 核心指标 */}
                                <Grid container spacing={{ xs: 1, sm: 2 }}>
                                    <Grid size={{ xs: 6, sm: 6, md: 3 }}>
                                        <KpiCard
                                            title="WMAPE准确率"
                                            value={`${(accuracy.wmape_accuracy ?? 0).toFixed(2)}%`}
                                            color={getAccuracyColor(accuracy.wmape_accuracy ?? 0)}
                                            chips={[
                                                { label: '90%达标', passed: accuracy.rate_90_pass ?? false },
                                                { label: '85%达标', passed: accuracy.rate_85_pass ?? false },
                                            ]}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 6, md: 3 }}>
                                        <KpiCard
                                            title="方向准确率"
                                            value={`${(accuracy.direction_accuracy ?? 0).toFixed(1)}%`}
                                            subtitle="涨跌趋势预测"
                                            icon={
                                                (accuracy.direction_accuracy ?? 0) >= 60 ? (
                                                    <TrendingUpIcon color="success" />
                                                ) : (
                                                    <TrendingDownIcon color="error" />
                                                )
                                            }
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 6, md: 3 }}>
                                        <KpiCard
                                            title="误差指标"
                                            value={`${(accuracy.mae ?? 0).toFixed(1)}`}
                                            subtitle={`MAE / RMSE: ${(accuracy.rmse ?? 0).toFixed(1)}`}
                                        />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 6, md: 3 }}>
                                        <KpiCard
                                            title="拟合度 R²"
                                            value={(accuracy.r2 ?? 0).toFixed(3)}
                                            color={(accuracy.r2 ?? 0) >= 0.8 ? 'success' : (accuracy.r2 ?? 0) >= 0.6 ? 'warning' : 'error'}
                                        />
                                    </Grid>
                                </Grid>

                                {/* Row 2: 分时段 + 当日特征 */}
                                <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 1 }}>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <PeriodAccuracyCard data={accuracy.period_accuracy} />
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <DailyStatsCard stats={accuracy.stats} chartData={chartData} />
                                    </Grid>
                                </Grid>
                            </Paper>
                        ) : versions.length > 0 && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                等待实际价格出清后生成评估报告
                            </Alert>
                        )}
                    </>
                )}
            </Box>
        </LocalizationProvider>
    );
};

export default DayAheadPriceForecastPage;
