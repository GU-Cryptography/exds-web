import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    Grid,
    InputLabel,
    LinearProgress,
    MenuItem,
    Paper,
    Select,
    SelectChangeEvent,
    Snackbar,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import apiClient from '../api/client';

interface MonthlyStatus {
    _id: string;
    month: string;
    wholesale_avg_price: number;
    retail_avg_price: number;
    retail_total_energy: number;
    retail_total_fee: number;
    excess_profit_total: number;
    excess_refund_pool: number;
}

interface MonthlySummary {
    month: string;
    customer_count: number;
    can_settle: boolean;
    wholesale_settled: boolean;
    wholesale_avg_price: number | null;
    wholesale_total_cost: number | null;
    total_energy_mwh: number | null;
    price_margin_per_mwh: number | null;
    trigger_excess_refund: boolean;
    settlement_total_fee: number | null;
    settlement_avg_price: number | null;
    status: MonthlyStatus | null;
}

interface MonthlyCustomer {
    _id: string;
    customer_name: string;
    daily_energy_mwh: number;
    retail_fee: number;
    retail_avg_price: number;
    balancing_energy_mwh: number;
    balancing_fee: number;
    balancing_avg_price: number;
    total_energy_mwh: number;
    retail_total_fee: number;
    total_fee: number;
    excess_refund_fee: number;
    excess_refund_unit_price: number;
    settlement_avg_price: number;
}

interface JobInfo {
    job_id: string;
    month: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | string;
    total_customers: number;
    processed_customers: number;
    success_count: number;
    failed_count: number;
    progress: number;
    current_customer?: string;
    message?: string;
}
const GROUP_COLORS: Record<string, string> = {
    基本信息: '#f5f5f5',  // 浅灰
    批发结算: '#fce4ec',  // 浅粉
    零售结算: '#fff3e0',  // 浅橙
    月度结算: '#fff3e0',  // 浅橙 (Alias)
    超额返还: '#e0f7fa',  // 浅青
    账单数据: '#e8eaf6',  // 浅靛青
    日清结算: '#e3f2fd',  // 浅蓝
    调平结算: '#e8f5e9',  // 浅绿
    月度汇总: '#f3e5f5',  // 浅紫
    操作: '#eeeeee',      // 浅灰
};

const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const normalizeCustomers = (raw: any): MonthlyCustomer[] => {
    let result: MonthlyCustomer[] = [];
    if (Array.isArray(raw)) result = raw;
    else if (Array.isArray(raw?.records)) result = raw.records;
    else if (Array.isArray(raw?.items)) result = raw.items;

    // 默认按客户名称排序
    return result.sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || ''));
};

const RetailMonthlySettlementPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [customers, setCustomers] = useState<MonthlyCustomer[]>([]);
    const [loadingSummaries, setLoadingSummaries] = useState(false);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [calcError, setCalcError] = useState<string | null>(null);
    const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
    const [progressOpen, setProgressOpen] = useState(false);
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [confirmMonth, setConfirmMonth] = useState<string>('');
    const pollingRef = useRef<NodeJS.Timeout | null>(null);

    const availableYears = useMemo(() => {
        const yearSet = new Set<number>();
        summaries.forEach((row) => {
            const year = Number(row.month.slice(0, 4));
            if (!Number.isNaN(year)) yearSet.add(year);
        });
        return Array.from(yearSet).sort((a, b) => b - a);
    }, [summaries]);

    const yearRows = useMemo(() => {
        const result = [];
        for (let i = 1; i <= 12; i++) {
            const mm = String(i).padStart(2, '0');
            const monthStr = `${selectedYear}-${mm}`;
            const found = summaries.find((row) => row.month === monthStr);
            if (found) {
                result.push({ ...found, _has_data: true });
            } else {
                result.push({
                    month: monthStr,
                    customer_count: 0,
                    total_energy_mwh: 0,
                    wholesale_settled: false,
                    wholesale_total_cost: 0,
                    _has_data: false,
                } as any);
            }
        }
        return result;
    }, [summaries, selectedYear]);

    const yearTotals = useMemo(() => {
        const rowsWithData = yearRows.filter((row) => row._has_data);
        const rowsWithStatus = rowsWithData.filter((row) => !!row.status);
        const retailTotalEnergy = rowsWithStatus.reduce((sum, row) => sum + (row.status?.retail_total_energy || 0), 0);
        const retailTotalFee = rowsWithStatus.reduce((sum, row) => sum + (row.status?.retail_total_fee || 0), 0);
        const retailAvgPrice = retailTotalEnergy > 0 ? retailTotalFee / (retailTotalEnergy * 1000) : null;
        const excessRefundPool = rowsWithStatus.reduce((sum, row) => sum + (row.status?.excess_refund_pool || 0), 0);
        const wholesaleSettledMonths = rowsWithData.filter((row) => row.wholesale_settled).length;
        const wholesaleTotalCost = rowsWithData.reduce((sum, row) => sum + (row.wholesale_total_cost || 0), 0);
        const totalEnergyMwh = rowsWithData.reduce((sum, row) => sum + (row.total_energy_mwh || 0), 0);
        const totalEnergyMwhWithStatus = rowsWithStatus.reduce((sum, row) => sum + (row.total_energy_mwh || 0), 0);
        const settlementTotalFee = rowsWithStatus.reduce((sum, row) => sum + (row.settlement_total_fee || 0), 0);
        const dataMonthsCount = rowsWithData.length;

        let wholesaleBilledTotal = 0;
        let wholesaleBilledEnergy = 0;
        rowsWithData.forEach(row => {
            if (row.wholesale_settled) {
                wholesaleBilledTotal += (row.wholesale_avg_price || 0) * (row.total_energy_mwh || 0);
                wholesaleBilledEnergy += (row.total_energy_mwh || 0);
            }
        });

        return {
            retailTotalEnergy,
            retailTotalFee,
            retailAvgPrice,
            excessRefundPool,
            wholesaleSettledMonths,
            wholesaleTotalCost,
            totalEnergyMwh,
            totalEnergyMwhWithStatus,
            settlementTotalFee,
            dataMonthsCount,
            wholesaleBilledTotal,
            wholesaleBilledEnergy
        };
    }, [yearRows]);

    const customerTotals = useMemo(() => {
        let dailyEnergy = 0;
        let retailFee = 0;
        let balancingEnergy = 0;
        let balancingFee = 0;
        let totalEnergy = 0;
        let retailTotalFee = 0;
        let excessRefundFee = 0;
        let totalFee = 0;

        customers.forEach((c) => {
            dailyEnergy += c.daily_energy_mwh || 0;
            retailFee += c.retail_fee || 0;
            balancingEnergy += c.balancing_energy_mwh || 0;
            balancingFee += c.balancing_fee || 0;
            totalEnergy += c.total_energy_mwh || 0;
            retailTotalFee += c.retail_total_fee || 0;
            excessRefundFee += c.excess_refund_fee || 0;
            totalFee += c.total_fee || 0;
        });

        const retailAvgPrice = dailyEnergy > 0 ? retailFee / dailyEnergy : 0;
        const settlementAvgPrice = totalEnergy > 0 ? totalFee / totalEnergy : 0;

        return {
            dailyEnergy,
            retailFee,
            retailAvgPrice,
            balancingEnergy,
            balancingFee,
            totalEnergy,
            retailTotalFee,
            excessRefundFee,
            totalFee,
            settlementAvgPrice,
        };
    }, [customers]);

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    const fetchSummaries = useCallback(async () => {
        setLoadingSummaries(true);
        try {
            const res = await apiClient.get('/api/v1/retail-settlement/monthly-summaries');
            const list = Array.isArray(res.data?.data?.summaries) ? res.data.data.summaries : [];
            setSummaries(list);
        } finally {
            setLoadingSummaries(false);
        }
    }, []);

    const fetchCustomers = useCallback(async (month: string) => {
        if (!month) return;
        setLoadingCustomers(true);
        try {
            const res = await apiClient.get('/api/v1/retail-settlement/monthly-customers', { params: { month } });
            setCustomers(normalizeCustomers(res.data?.data));
        } catch {
            setCustomers([]);
        } finally {
            setLoadingCustomers(false);
        }
    }, []);

    useEffect(() => {
        fetchSummaries();
    }, [fetchSummaries]);

    useEffect(() => {
        if (!availableYears.length) return;
        setSelectedYear((prev) => (availableYears.includes(prev) ? prev : availableYears[0]));
    }, [availableYears]);

    useEffect(() => {
        if (!yearRows.length) {
            setSelectedMonth('');
            setCustomers([]);
            return;
        }
        const firstMonth = yearRows[0].month;
        setSelectedMonth((prev) => (yearRows.some((row) => row.month === prev) ? prev : firstMonth));
    }, [yearRows]);

    useEffect(() => {
        if (selectedMonth) {
            fetchCustomers(selectedMonth);
        }
    }, [selectedMonth, fetchCustomers]);

    useEffect(() => () => stopPolling(), [stopPolling]);

    const pollProgress = useCallback(
        (jobId: string, month: string) => {
            stopPolling();
            pollingRef.current = setInterval(async () => {
                try {
                    const res = await apiClient.get(`/api/v1/retail-settlement/monthly-progress/${jobId}`);
                    const currentJob = (res.data?.data || null) as JobInfo | null;
                    setJobInfo(currentJob);

                    if (currentJob?.status !== 'pending' && currentJob?.status !== 'running') {
                        stopPolling();
                        await fetchSummaries();
                        await fetchCustomers(month);
                        if (currentJob?.status === 'completed') {
                            setSnackbarOpen(true);
                        }
                    }
                } catch {
                    stopPolling();
                }
            }, 1500);
        },
        [fetchCustomers, fetchSummaries, stopPolling]
    );

    // 弹出确认弹窗
    const closeProgressDialog = useCallback(() => {
        if (jobInfo?.status === 'pending' || jobInfo?.status === 'running') return;
        setProgressOpen(false);
        setJobInfo(null);
        setConfirmMonth('');
    }, [jobInfo?.status]);

    const handleClickSettle = (month: string) => {
        setConfirmMonth(month);
        setCalcError(null);
        setProgressOpen(true);
        setJobInfo({
            job_id: '',
            month,
            status: 'confirm',
            total_customers: 0,
            processed_customers: 0,
            success_count: 0,
            failed_count: 0,
            progress: 0,
            message: `请确认是否对 ${month} 执行零售月度结算。`,
        });
    };

    // 用户确认后，执行结算
    const handleConfirmCalc = async () => {
        const month = confirmMonth || jobInfo?.month || '';
        if (!month) return;
        setCalcError(null);
        setSelectedMonth(month);
        setProgressOpen(true);
        setJobInfo({
            job_id: '',
            month,
            status: 'pending',
            total_customers: 0,
            processed_customers: 0,
            success_count: 0,
            failed_count: 0,
            progress: 0,
            message: `正在启动 ${month} 月度结算任务...`,
        });

        try {
            const res = await apiClient.post('/api/v1/retail-settlement/monthly-calc', { month, force: true });
            if (res.data?.code && res.data.code !== 200) {
                const message = res.data?.message || '启动月度结算失败';
                setCalcError(message);
                setJobInfo((prev) =>
                    prev
                        ? {
                            ...prev,
                            status: 'failed',
                            message,
                        }
                        : prev
                );
                return;
            }

            const jobId = res.data?.data?.job_id;
            if (!jobId) {
                const message = '未获取到任务ID，无法跟踪结算进度';
                setCalcError(message);
                setJobInfo((prev) =>
                    prev
                        ? {
                            ...prev,
                            status: 'failed',
                            message,
                        }
                        : prev
                );
                return;
            }

            pollProgress(jobId, month);
        } catch (err: any) {
            const message = err.response?.data?.message || err.response?.data?.detail || err.message || '启动月度结算失败';
            setCalcError(message);
            setJobInfo((prev) =>
                prev
                    ? {
                        ...prev,
                        status: 'failed',
                        message,
                    }
                    : prev
            );
        }
    };

    const handleYearChange = (event: SelectChangeEvent<number>) => {
        setSelectedYear(Number(event.target.value));
    };

    const jobRunning = jobInfo?.status === 'pending' || jobInfo?.status === 'running';
    const awaitingConfirm = jobInfo?.status === 'confirm';
    const progressValue = useMemo(() => {
        if (!jobInfo) return 0;
        if (jobInfo.status === 'completed') return 100;

        const byCount =
            jobInfo.total_customers > 0
                ? (jobInfo.processed_customers / jobInfo.total_customers) * 100
                : 0;
        const byServerProgress = Number.isFinite(jobInfo.progress) ? jobInfo.progress : 0;

        return Math.min(100, Math.max(0, Math.max(byCount, byServerProgress)));
    }, [jobInfo]);

    return (
        <Box>
            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2, borderRadius: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <FormControl size="small" sx={{ minWidth: 180 }} disabled={loadingSummaries || !availableYears.length}>
                    <InputLabel id="retail-monthly-year">选择年份</InputLabel>
                    <Select<number>
                        labelId="retail-monthly-year"
                        value={selectedYear}
                        label="选择年份"
                        onChange={handleYearChange}
                    >
                        {availableYears.map((year) => (
                            <MenuItem key={year} value={year}>
                                {year}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2, borderRadius: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <Typography variant="h6" gutterBottom sx={{ borderLeft: '4px solid', borderColor: 'primary.main', pl: 1, fontWeight: 'bold' }}>
                    {selectedYear} 年月度结算台账
                </Typography>

                {calcError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {calcError}
                    </Alert>
                )}

                {loadingSummaries ? (
                    <Box display="flex" justifyContent="center" py={4}>
                        <CircularProgress />
                    </Box>
                ) : !yearRows.length ? (
                    <Alert severity="info">当前年份没有可结算月份数据。</Alert>
                ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table
                            size="small"
                            sx={{
                                minWidth: 1180,
                                '& .MuiTableCell-root': {
                                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                    px: { xs: 0.5, sm: 1 },
                                    whiteSpace: 'nowrap',
                                },
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell colSpan={3} align="center" sx={{ backgroundColor: GROUP_COLORS['基础信息'], fontWeight: 'bold' }}>基础信息</TableCell>
                                    <TableCell colSpan={2} align="center" sx={{ backgroundColor: GROUP_COLORS['批发结算'], fontWeight: 'bold' }}>批发结算</TableCell>
                                    <TableCell colSpan={2} align="center" sx={{ backgroundColor: GROUP_COLORS['零售结算'], fontWeight: 'bold' }}>零售结算</TableCell>
                                    <TableCell colSpan={3} align="center" sx={{ backgroundColor: GROUP_COLORS['超额返还'], fontWeight: 'bold' }}>超额返还</TableCell>
                                    <TableCell colSpan={2} align="center" sx={{ backgroundColor: GROUP_COLORS['账单数据'], fontWeight: 'bold' }}>账单数据</TableCell>
                                    <TableCell colSpan={1} rowSpan={2} align="center" sx={{ backgroundColor: GROUP_COLORS['操作'], fontWeight: 'bold' }}>操作</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ backgroundColor: GROUP_COLORS['基础信息'] }}>月份</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['基础信息'] }}>客户数</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['基础信息'] }}>总电量(MWh)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['批发结算'] }}>批发单价(元/MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['批发结算'] }}>批发金额(元)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['零售结算'] }}>零售单价(元/MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['零售结算'] }}>零售金额(元)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['超额返还'] }}>批零价差(元/MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['超额返还'] }}>返还金额(元)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['超额返还'] }}>返还单价(元/MWh)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['账单数据'] }}>零售侧单价(元/MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['账单数据'] }}>零售侧金额(元)</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {yearRows.map((row) => {
                                    const processingThisRow = jobRunning && jobInfo?.month === row.month;
                                    const hasData = row._has_data;
                                    const hasSettled = !!row.status;
                                    return (
                                        <TableRow
                                            key={row.month}
                                            hover
                                            selected={selectedMonth === row.month}
                                            onClick={() => setSelectedMonth(row.month)}
                                            sx={{ cursor: 'pointer' }}
                                        >
                                            <TableCell>{row.month}</TableCell>
                                            <TableCell align="right">{hasData ? row.customer_count : '-'}</TableCell>
                                            <TableCell align="right">{hasData ? formatNumber(row.total_energy_mwh, 3) : '-'}</TableCell>

                                            <TableCell align="right">
                                                {hasData ? (row.wholesale_settled ? formatNumber(row.wholesale_avg_price, 3) : '未发布') : '-'}
                                            </TableCell>
                                            <TableCell align="right">
                                                {hasData ? (row.wholesale_settled ? formatNumber(row.wholesale_total_cost, 2) : '-') : '-'}
                                            </TableCell>

                                            <TableCell align="right">{hasSettled ? formatNumber((row.status?.retail_avg_price || 0) * 1000, 3) : '-'}</TableCell>
                                            <TableCell align="right">{hasSettled ? formatNumber(row.status?.retail_total_fee, 2) : '-'}</TableCell>

                                            <TableCell align="right">{hasSettled ? formatNumber(row.price_margin_per_mwh, 3) : '-'}</TableCell>
                                            <TableCell align="right">{hasSettled ? formatNumber(row.status?.excess_refund_pool, 2) : '-'}</TableCell>
                                            <TableCell align="right">{hasSettled && row.total_energy_mwh ? formatNumber((row.status?.excess_refund_pool || 0) / row.total_energy_mwh, 3) : '-'}</TableCell>

                                            <TableCell align="right">{hasSettled && row.total_energy_mwh ? formatNumber(row.settlement_total_fee / row.total_energy_mwh, 3) : '-'}</TableCell>
                                            <TableCell align="right">{hasSettled ? formatNumber(row.settlement_total_fee, 2) : '-'}</TableCell>
                                            <TableCell align="center">
                                                <Button
                                                    size="small"
                                                    variant={selectedMonth === row.month ? 'contained' : 'outlined'}
                                                    disabled={jobRunning}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        handleClickSettle(row.month);
                                                    }}
                                                    startIcon={
                                                        processingThisRow ? <CircularProgress size={14} color="inherit" /> : undefined
                                                    }
                                                >
                                                    {processingThisRow ? '执行中' : (hasSettled ? '重结' : '结算')}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}

                                <TableRow>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>合计</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {yearRows.reduce((sum, row) => sum + (row.customer_count || 0), 0)}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.totalEnergyMwh, 3)}
                                    </TableCell>

                                    {/* 批发组合计 */}
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        已发布 {yearTotals.wholesaleSettledMonths}/{yearTotals.dataMonthsCount}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.wholesaleTotalCost, 2)}
                                    </TableCell>

                                    {/* 零售组合计 */}
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.retailTotalEnergy > 0 ? (yearTotals.retailTotalFee / yearTotals.retailTotalEnergy) : 0, 3)}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.retailTotalFee, 2)}
                                    </TableCell>

                                    {/* 超额返还组合计 */}
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>--</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.excessRefundPool, 2)}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.totalEnergyMwhWithStatus ? yearTotals.excessRefundPool / yearTotals.totalEnergyMwhWithStatus : 0, 3)}
                                    </TableCell>

                                    {/* 账单数据组合计 */}
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.totalEnergyMwhWithStatus ? yearTotals.settlementTotalFee / yearTotals.totalEnergyMwhWithStatus : 0, 3)}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>
                                        {formatNumber(yearTotals.settlementTotalFee, 2)}
                                    </TableCell>

                                    <TableCell align="center" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>--</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, borderRadius: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <Typography variant="h6" gutterBottom sx={{ borderLeft: '4px solid', borderColor: 'primary.main', pl: 1, fontWeight: 'bold' }}>
                    {selectedMonth || '--'} 客户月度结算记录
                </Typography>

                {loadingCustomers ? (
                    <Box display="flex" justifyContent="center" py={4}>
                        <CircularProgress />
                    </Box>
                ) : customers.length === 0 ? (
                    <Alert severity="info">当前月份暂无客户月度结算记录。</Alert>
                ) : isMobile ? (
                    <Grid container spacing={{ xs: 1, sm: 2 }}>
                        {customers.map((item, index) => (
                            <Grid size={{ xs: 12 }} key={item._id}>
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        p: 1.5,
                                        background:
                                            item.excess_refund_fee > 0
                                                ? alpha(theme.palette.success.light, 0.25)
                                                : 'transparent',
                                        borderRadius: 2,
                                    }}
                                >
                                    <Typography fontWeight={700}>#{index + 1} {item.customer_name}</Typography>
                                    <Grid container spacing={1} sx={{ mt: 0.5 }}>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">日清电量 (MWh)</Typography>
                                            <Typography>{formatNumber(item.daily_energy_mwh, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">日清电费 (元)</Typography>
                                            <Typography>{formatNumber(item.retail_fee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">日清均价 (元/MWh)</Typography>
                                            <Typography>{formatNumber(item.daily_energy_mwh ? item.retail_fee / item.daily_energy_mwh : 0, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">调平电量 (MWh)</Typography>
                                            <Typography>{formatNumber(item.balancing_energy_mwh, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">调平电费 (元)</Typography>
                                            <Typography>{formatNumber(item.balancing_fee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">零售结算电量 (MWh)</Typography>
                                            <Typography>{formatNumber(item.total_energy_mwh, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">零售结算均价 (元/MWh)</Typography>
                                            <Typography>{formatNumber(item.total_energy_mwh ? item.retail_total_fee / item.total_energy_mwh : 0, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">零售结算电费 (元)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(item.retail_total_fee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">超额返还 (元)</Typography>
                                            <Typography>{formatNumber(item.excess_refund_fee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">结算电费 (元)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(item.total_fee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">结算均价 (元/kWh)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(item.settlement_avg_price, 3)}</Typography>
                                        </Grid>
                                    </Grid>
                                </Paper>
                            </Grid>
                        ))}
                        {customers.length > 0 && (
                            <Grid size={{ xs: 12 }}>
                                <Paper variant="outlined" sx={{ p: 1.5, background: theme.palette.action.hover, borderRadius: 2 }}>
                                    <Typography fontWeight={700}>合计</Typography>
                                    <Grid container spacing={1} sx={{ mt: 0.5 }}>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">日清电量 (MWh)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.dailyEnergy, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">日清电费 (元)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.retailFee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">日清均价 (元/kWh)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.retailAvgPrice, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">调平电量 (MWh)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.balancingEnergy, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">调平电费 (元)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.balancingFee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">合计电量 (MWh)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.totalEnergy, 3)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">零售电费 (元)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.retailTotalFee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">超额返还 (元)</Typography>
                                            <Typography fontWeight={700}>{formatNumber(customerTotals.excessRefundFee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">结算电费 (元)</Typography>
                                            <Typography fontWeight={700} color="primary">{formatNumber(customerTotals.totalFee, 2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption">月度结算均价 (元/MWh)</Typography>
                                            <Typography fontWeight={700} color="primary">{formatNumber(customerTotals.totalEnergy ? customerTotals.totalFee / customerTotals.totalEnergy : 0, 3)}</Typography>
                                        </Grid>
                                    </Grid>
                                </Paper>
                            </Grid>
                        )}
                    </Grid>
                ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table
                            size="small"
                            sx={{
                                minWidth: 1180,
                                '& .MuiTableCell-root': {
                                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                    px: { xs: 0.5, sm: 1 },
                                    whiteSpace: 'nowrap',
                                },
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell colSpan={2} align="center" sx={{ backgroundColor: GROUP_COLORS['基本信息'], fontWeight: 'bold' }}>基本信息</TableCell>
                                    <TableCell colSpan={3} align="center" sx={{ backgroundColor: GROUP_COLORS['日清结算'], fontWeight: 'bold' }}>日清结算</TableCell>
                                    <TableCell colSpan={2} align="center" sx={{ backgroundColor: GROUP_COLORS['调平结算'], fontWeight: 'bold' }}>调平结算</TableCell>
                                    <TableCell colSpan={3} align="center" sx={{ backgroundColor: GROUP_COLORS['月度结算'], fontWeight: 'bold' }}>月度结算</TableCell>
                                    <TableCell colSpan={3} align="center" sx={{ backgroundColor: GROUP_COLORS['月度汇总'], fontWeight: 'bold' }}>月度汇总</TableCell>
                                </TableRow>
                                <TableRow>
                                    <TableCell sx={{ backgroundColor: GROUP_COLORS['基本信息'] }}>序号</TableCell>
                                    <TableCell sx={{ backgroundColor: GROUP_COLORS['基本信息'] }}>客户名称</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['日清结算'] }}>电量(MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['日清结算'] }}>均价(元/MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['日清结算'] }}>电费(元)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['调平结算'] }}>调平电量(MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['调平结算'] }}>调平电费(元)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['月度结算'] }}>电量(MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['月度结算'] }}>均价(元/MWh)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['月度结算'] }}>电费(元)</TableCell>

                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['月度汇总'] }}>超额返还(元)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['月度汇总'] }}>电费(元)</TableCell>
                                    <TableCell align="right" sx={{ backgroundColor: GROUP_COLORS['月度汇总'] }}>均价(元/MWh)</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {customers.map((item, index) => (
                                    <TableRow
                                        key={item._id}
                                        hover
                                    >
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>{item.customer_name}</TableCell>

                                        <TableCell align="right">{formatNumber(item.daily_energy_mwh, 3)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.daily_energy_mwh ? item.retail_fee / item.daily_energy_mwh : 0, 3)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.retail_fee, 2)}</TableCell>

                                        <TableCell align="right">{formatNumber(item.balancing_energy_mwh, 3)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.balancing_fee, 2)}</TableCell>

                                        <TableCell align="right">{formatNumber(item.total_energy_mwh, 3)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.total_energy_mwh ? item.retail_total_fee / item.total_energy_mwh : 0, 3)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.retail_total_fee, 2)}</TableCell>

                                        <TableCell align="right">{formatNumber(item.excess_refund_fee, 2)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.total_fee, 2)}</TableCell>
                                        <TableCell align="right">{formatNumber(item.total_energy_mwh ? item.total_fee / item.total_energy_mwh : 0, 3)}</TableCell>
                                    </TableRow>
                                ))}
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>合计</TableCell>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>--</TableCell>

                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.dailyEnergy, 3)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.dailyEnergy ? customerTotals.retailFee / customerTotals.dailyEnergy : 0, 3)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.retailFee, 2)}</TableCell>

                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.balancingEnergy, 3)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.balancingFee, 2)}</TableCell>

                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.totalEnergy, 3)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.totalEnergy ? customerTotals.retailTotalFee / customerTotals.totalEnergy : 0, 3)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.retailTotalFee, 2)}</TableCell>

                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.excessRefundFee, 2)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.totalFee, 2)}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 700, backgroundColor: 'action.hover' }}>{formatNumber(customerTotals.totalEnergy ? customerTotals.totalFee / customerTotals.totalEnergy : 0, 3)}</TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>

            <Dialog open={progressOpen} onClose={jobRunning ? undefined : closeProgressDialog} fullWidth maxWidth="sm">
                <DialogTitle>零售月度结算进度</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        {jobInfo?.message || '正在准备任务...'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        结算月份：{jobInfo?.month || '--'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        当前客户：{jobInfo?.current_customer || '--'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                        进度：{jobInfo?.processed_customers || 0}/{jobInfo?.total_customers || 0}，成功 {jobInfo?.success_count || 0}，失败{' '}
                        {jobInfo?.failed_count || 0}
                    </Typography>
                    {!awaitingConfirm && <LinearProgress variant="determinate" value={progressValue} sx={{ height: 8, borderRadius: 4 }} />}
                    {jobInfo?.status === 'failed' && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {jobInfo.message || '月度结算失败'}
                        </Alert>
                    )}
                    {jobInfo?.status === 'completed' && (
                        <Alert severity="success" sx={{ mt: 2 }}>
                            月度结算完成，已刷新汇总与客户记录。
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    {awaitingConfirm ? (
                        <>
                            <Button onClick={closeProgressDialog}>取消</Button>
                            <Button variant="contained" color="primary" onClick={handleConfirmCalc}>
                                确认结算
                            </Button>
                        </>
                    ) : (
                        <Button onClick={closeProgressDialog} disabled={jobRunning}>
                            关闭
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snackbarOpen}
                autoHideDuration={3000}
                onClose={() => setSnackbarOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="success" onClose={() => setSnackbarOpen(false)}>
                    月度结算完成，数据已刷新。
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default RetailMonthlySettlementPage;
