import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Paper,
    Typography,
    Grid,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    CircularProgress,
    Alert,
    Collapse,
    Button,
    Tabs,
    Tab,
    useTheme,
    useMediaQuery,
    Tooltip
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import WarningIcon from '@mui/icons-material/Warning';
import ReplayIcon from '@mui/icons-material/Replay';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { format, addDays } from 'date-fns';
import apiClient from '../api/client';


// ========== 类型定义 ==========

interface SummaryStats {
    success: number;
    skipped: number;
    failed: number;
    alerts: number;
}

interface TaskExecutionSummary {
    pipeline_name: string;
    task_key: string;
    daily_status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    execution_time: string | null;
    execution_count: number;
    last_success_date: string | null;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    target_collections: string[];
    error_message: string | null;
    message: string | null;
    duration_seconds: number | null;
}

interface DailySummaryResponse {
    date: string;
    summary: SummaryStats;
    tasks: TaskExecutionSummary[];
    has_data: boolean;
}

interface ExecutionHistoryItem {
    pipeline_name: string;
    task_key: string;
    execution_time: string;
    status: string;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    error_message: string | null;
    message: string | null;
    duration_seconds: number | null;
}

interface ExecutionBatch {
    batch_index: number;
    batch_time: string;
    start_time: string;
    end_time: string;
    task_count: number;
    success_count: number;
    failed_count: number;
    records: ExecutionHistoryItem[];
}

interface ExecutionHistoryResponse {
    date: string;
    total_batches: number;
    batches: ExecutionBatch[];
    has_data: boolean;
}

interface AlertItem {
    level: 'critical' | 'warning' | 'info';
    rule: string;
    pipeline_name: string;
    task_key: string;
    message: string;
    timestamp: string | null;
    can_retry: boolean;
}


// ========== 辅助组件 ==========

// 状态芯片
const StatusChip: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'SUCCESS':
            return <Chip icon={<CheckCircleIcon />} label="成功" color="success" size="small" />;
        case 'FAILED':
            return <Chip icon={<CancelIcon />} label="失败" color="error" size="small" />;
        case 'SKIPPED':
            return <Chip icon={<SkipNextIcon />} label="跳过" color="default" size="small" />;
        default:
            return <Chip label={status} size="small" />;
    }
};

// 统计卡片
const StatCard: React.FC<{
    title: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    onClick?: () => void;
}> = ({ title, value, icon, color, onClick }) => {
    return (
        <Paper
            elevation={2}
            sx={{
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: onClick ? 'pointer' : 'default',
                '&:hover': onClick ? { bgcolor: 'action.hover' } : {}
            }}
            onClick={onClick}
        >
            <Box sx={{ color, fontSize: 32, mb: 1 }}>{icon}</Box>
            <Typography variant="h4" sx={{ fontWeight: 'bold', color }}>
                {value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                {title}
            </Typography>
        </Paper>
    );
};


// ========== 主组件 ==========

export const RpaMonitorPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // 日期状态
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // 数据状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dailySummary, setDailySummary] = useState<DailySummaryResponse | null>(null);
    const [executionHistory, setExecutionHistory] = useState<ExecutionHistoryResponse | null>(null);
    const [alerts, setAlerts] = useState<AlertItem[]>([]);

    // 批次选择
    const [selectedBatchIndex, setSelectedBatchIndex] = useState<number>(0);

    // 告警展开状态
    const [alertsExpanded, setAlertsExpanded] = useState(true);

    // 全局重试状态
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryDisabledUntil, setRetryDisabledUntil] = useState<Date | null>(null);

    // 检查重试按钮是否应该禁用
    const isRetryDisabled = isRetrying || (retryDisabledUntil && new Date() < retryDisabledUntil);

    // 加载数据
    const fetchData = useCallback(async (date: Date | null) => {
        if (!date) return;

        setLoading(true);
        setError(null);

        const formattedDate = format(date, 'yyyy-MM-dd');

        try {
            // 并行请求所有数据
            const [summaryRes, historyRes, alertsRes] = await Promise.all([
                apiClient.get(`/api/v1/rpa/execution/daily?date=${formattedDate}`),
                apiClient.get(`/api/v1/rpa/execution/history?date=${formattedDate}`),
                apiClient.get(`/api/v1/rpa/alerts?date=${formattedDate}`)
            ]);

            setDailySummary(summaryRes.data);
            setExecutionHistory(historyRes.data);
            setAlerts(alertsRes.data.alerts || []);

            // 默认选择最后一个批次
            if (historyRes.data.batches && historyRes.data.batches.length > 0) {
                setSelectedBatchIndex(historyRes.data.batches.length - 1);
            } else {
                setSelectedBatchIndex(0);
            }
        } catch (err: any) {
            console.error('加载数据失败:', err);
            setError(err.response?.data?.detail || err.message || '加载数据失败');
        } finally {
            setLoading(false);
        }
    }, []);

    // 自动加载数据
    useEffect(() => {
        fetchData(selectedDate);
    }, [selectedDate, fetchData]);

    // 日期导航
    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
    };

    // 刷新数据
    const handleRefresh = () => {
        fetchData(selectedDate);
    };

    // 重试所有失败任务
    const handleRetryAll = async () => {
        // 筛选可重试的告警
        const retryableAlerts = alerts.filter(a => a.can_retry);
        if (retryableAlerts.length === 0) {
            setError('没有可重试的任务');
            return;
        }

        setIsRetrying(true);
        setError(null);

        try {
            // 并行发送所有重试请求
            const retryPromises = retryableAlerts.map(alert =>
                apiClient.post(`/api/v1/rpa/tasks/${encodeURIComponent(alert.pipeline_name)}/${encodeURIComponent(alert.task_key)}/retry`)
                    .catch(err => {
                        console.error(`重试 ${alert.pipeline_name}/${alert.task_key} 失败:`, err);
                        return null; // 忽略单个失败
                    })
            );

            await Promise.all(retryPromises);

            // 设置 10 分钟超时
            const timeout = new Date();
            timeout.setMinutes(timeout.getMinutes() + 10);
            setRetryDisabledUntil(timeout);

        } catch (err: any) {
            console.error('重试请求失败:', err);
            setError(err.response?.data?.detail || err.message || '重试请求失败');
        } finally {
            setIsRetrying(false);
        }
    };

    // 获取当前选中的批次
    const currentBatch = executionHistory?.batches?.[selectedBatchIndex];

    // 渲染空状态
    const renderEmptyState = () => (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', mt: 3 }}>
            <Box sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }}>📭</Box>
            <Typography variant="h6" gutterBottom>
                暂无执行记录
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                RPA 任务尚未在 {dateStr} 执行
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                预计执行时间：09:10、12:00、21:00
            </Typography>
            <Button
                variant="outlined"
                onClick={() => setSelectedDate(addDays(new Date(), -1))}
            >
                查看昨日记录
            </Button>
        </Paper>
    );

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
                    >
                        系统管理 / 数据下载监控
                    </Typography>
                )}

                {/* 日期选择器和刷新按钮 */}
                <Paper variant="outlined" sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>

                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } }
                            }
                        }}
                    />

                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>

                    <Box sx={{ flexGrow: 1 }} />

                    <Tooltip title="刷新数据">
                        <IconButton onClick={handleRefresh} disabled={loading}>
                            <RefreshIcon />
                        </IconButton>
                    </Tooltip>
                </Paper>

                {/* 错误提示 */}
                {error && (
                    <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {/* 首次加载 */}
                {loading && !dailySummary ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : (
                    <Box sx={{ position: 'relative' }}>
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
                                    zIndex: 1000
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}

                        {/* 统计卡片 */}
                        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 2 }}>
                            <Grid size={{ xs: 6, sm: 2.4 }}>
                                <StatCard
                                    title="任务数"
                                    value={dailySummary?.tasks.length || 0}
                                    icon={<AssignmentIcon fontSize="inherit" />}
                                    color="#3B82F6"
                                />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 2.4 }}>
                                <StatCard
                                    title="成功"
                                    value={dailySummary?.summary.success || 0}
                                    icon={<CheckCircleIcon fontSize="inherit" />}
                                    color="#10B981"
                                />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 2.4 }}>
                                <StatCard
                                    title="跳过"
                                    value={dailySummary?.summary.skipped || 0}
                                    icon={<SkipNextIcon fontSize="inherit" />}
                                    color="#6B7280"
                                />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 2.4 }}>
                                <StatCard
                                    title="失败"
                                    value={dailySummary?.summary.failed || 0}
                                    icon={<CancelIcon fontSize="inherit" />}
                                    color="#EF4444"
                                />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 2.4 }}>
                                <StatCard
                                    title="告警"
                                    value={alerts.length}
                                    icon={<WarningIcon fontSize="inherit" />}
                                    color="#F59E0B"
                                    onClick={() => setAlertsExpanded(!alertsExpanded)}
                                />
                            </Grid>
                        </Grid>

                        {/* 告警展开区 */}
                        {alerts.length > 0 && (
                            <Paper variant="outlined" sx={{ mt: 2 }}>
                                <Box
                                    sx={{
                                        p: 2,
                                        display: 'flex',
                                        alignItems: 'center',
                                        bgcolor: 'warning.light'
                                    }}
                                >
                                    <Box
                                        sx={{ display: 'flex', alignItems: 'center', flexGrow: 1, cursor: 'pointer' }}
                                        onClick={() => setAlertsExpanded(!alertsExpanded)}
                                    >
                                        <WarningIcon sx={{ mr: 1, color: 'warning.dark' }} />
                                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                                            告警信息 ({alerts.length})
                                        </Typography>
                                    </Box>
                                    {/* 重试按钮放在标题栏 */}
                                    {alerts.some(a => a.can_retry) && (
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            startIcon={isRetrying ? <CircularProgress size={14} sx={{ color: 'warning.dark' }} /> : <ReplayIcon />}
                                            onClick={(e) => { e.stopPropagation(); handleRetryAll(); }}
                                            disabled={!!isRetryDisabled}
                                            sx={{
                                                mr: 1,
                                                color: 'warning.dark',
                                                borderColor: 'warning.dark',
                                                '&:hover': {
                                                    borderColor: 'warning.main',
                                                    bgcolor: 'rgba(237, 137, 54, 0.1)'
                                                },
                                                '&.Mui-disabled': {
                                                    color: 'warning.main',
                                                    borderColor: 'warning.main',
                                                    opacity: 0.7
                                                }
                                            }}
                                        >
                                            {isRetrying ? '重试中...' : retryDisabledUntil && new Date() < retryDisabledUntil ? '已发送' : '重试'}
                                        </Button>
                                    )}
                                    <IconButton
                                        size="small"
                                        onClick={() => setAlertsExpanded(!alertsExpanded)}
                                        sx={{ color: 'warning.dark' }}
                                    >
                                        {alertsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                    </IconButton>
                                </Box>
                                <Collapse in={alertsExpanded}>
                                    <Box sx={{ p: 2 }}>
                                        {alerts.map((alert, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 1,
                                                    p: 1,
                                                    borderBottom: index < alerts.length - 1 ? '1px solid' : 'none',
                                                    borderColor: 'divider'
                                                }}
                                            >
                                                <Chip
                                                    label={alert.level === 'critical' ? '严重' : alert.level === 'warning' ? '警告' : '提示'}
                                                    size="small"
                                                    color={alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warning' : 'info'}
                                                />
                                                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                                                    <strong>{alert.pipeline_name}/{alert.task_key}</strong>: {alert.message}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Box>
                                </Collapse>
                            </Paper>
                        )}

                        {/* 无数据状态 */}
                        {!dailySummary?.has_data && renderEmptyState()}

                        {/* 有数据时显示表格 */}
                        {dailySummary?.has_data && (
                            <>
                                {/* 当日摘要表格 */}
                                <Paper variant="outlined" sx={{ mt: 2, p: { xs: 1, sm: 2 } }}>
                                    <Typography variant="h6" gutterBottom>
                                        当日摘要
                                    </Typography>
                                    <TableContainer sx={{ overflowX: 'auto' }}>
                                        <Table
                                            size="small"
                                            sx={{
                                                '& .MuiTableCell-root': {
                                                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                                    px: { xs: 0.5, sm: 2 }
                                                }
                                            }}
                                        >
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell align="center">序号</TableCell>
                                                    <TableCell>管道</TableCell>
                                                    <TableCell>任务</TableCell>
                                                    <TableCell>状态</TableCell>
                                                    <TableCell align="right">记录数</TableCell>
                                                    <TableCell>执行时间</TableCell>
                                                    <TableCell align="right">耗时</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {dailySummary.tasks.map((task, index) => (
                                                    <TableRow key={`${task.pipeline_name}-${task.task_key}-${index}`}>
                                                        <TableCell align="center">{index + 1}</TableCell>
                                                        <TableCell>{task.pipeline_name}</TableCell>
                                                        <TableCell>{task.task_key}</TableCell>
                                                        <TableCell>
                                                            <StatusChip status={task.daily_status} />
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {task.daily_status === 'SUCCESS' ? (
                                                                <>
                                                                    {task.records_inserted > 0 && `+${task.records_inserted}`}
                                                                    {task.records_updated > 0 && ` ↻${task.records_updated}`}
                                                                </>
                                                            ) : '-'}
                                                        </TableCell>
                                                        <TableCell>
                                                            {task.execution_time
                                                                ? format(new Date(task.execution_time), 'HH:mm:ss')
                                                                : task.last_success_date || '-'}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {task.duration_seconds != null
                                                                ? `${task.duration_seconds.toFixed(1)}s`
                                                                : '-'}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </Paper>

                                {/* 执行历史 */}
                                {executionHistory?.has_data && executionHistory.batches.length > 0 && (
                                    <Paper variant="outlined" sx={{ mt: 2, p: { xs: 1, sm: 2 } }}>
                                        <Typography variant="h6" gutterBottom>
                                            执行历史
                                        </Typography>

                                        {/* 批次选择 Tabs */}
                                        <Tabs
                                            value={selectedBatchIndex}
                                            onChange={(_, val) => setSelectedBatchIndex(val)}
                                            variant="scrollable"
                                            scrollButtons="auto"
                                            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
                                        >
                                            {executionHistory.batches.map((batch, index) => (
                                                <Tab
                                                    key={batch.batch_index}
                                                    label={`${batch.batch_time} 第${batch.batch_index}次`}
                                                    value={index}
                                                />
                                            ))}
                                        </Tabs>

                                        {/* 当前批次详情 */}
                                        {currentBatch && (
                                            <>
                                                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                                                    <Chip
                                                        label={`任务数: ${currentBatch.task_count}`}
                                                        variant="outlined"
                                                        size="small"
                                                    />
                                                    <Chip
                                                        icon={<CheckCircleIcon />}
                                                        label={`成功: ${currentBatch.success_count}`}
                                                        color="success"
                                                        variant="outlined"
                                                        size="small"
                                                    />
                                                    <Chip
                                                        icon={<CancelIcon />}
                                                        label={`失败: ${currentBatch.failed_count}`}
                                                        color="error"
                                                        variant="outlined"
                                                        size="small"
                                                    />
                                                </Box>

                                                <TableContainer sx={{ overflowX: 'auto' }}>
                                                    <Table
                                                        size="small"
                                                        sx={{
                                                            '& .MuiTableCell-root': {
                                                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                                                px: { xs: 0.5, sm: 2 }
                                                            }
                                                        }}
                                                    >
                                                        <TableHead>
                                                            <TableRow>
                                                                <TableCell>时间</TableCell>
                                                                <TableCell>管道</TableCell>
                                                                <TableCell>任务</TableCell>
                                                                <TableCell>状态</TableCell>
                                                                <TableCell align="right">耗时</TableCell>
                                                                <TableCell>消息</TableCell>
                                                            </TableRow>
                                                        </TableHead>
                                                        <TableBody>
                                                            {currentBatch.records.map((record, index) => (
                                                                <TableRow key={index}>
                                                                    <TableCell>
                                                                        {format(new Date(record.execution_time), 'HH:mm:ss')}
                                                                    </TableCell>
                                                                    <TableCell>{record.pipeline_name}</TableCell>
                                                                    <TableCell>{record.task_key}</TableCell>
                                                                    <TableCell>
                                                                        <StatusChip status={record.status} />
                                                                    </TableCell>
                                                                    <TableCell align="right">
                                                                        {record.duration_seconds != null
                                                                            ? `${record.duration_seconds.toFixed(1)}s`
                                                                            : '-'}
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        {record.error_message || record.message || '-'}
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </TableContainer>
                                            </>
                                        )}
                                    </Paper>
                                )}
                            </>
                        )}
                    </Box>
                )}
            </Box>
        </LocalizationProvider>
    );
};

export default RpaMonitorPage;
