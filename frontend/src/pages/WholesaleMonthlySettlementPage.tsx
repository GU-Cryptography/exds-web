import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Divider,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    SelectChangeEvent,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
    useMediaQuery,
    useTheme,
    SwipeableDrawer,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';
import apiClient from '../api/client';

interface YearRow {
    month: string;
    has_data: boolean;
    settlement_items: Record<string, number | null | string>;
}

interface ReconciliationRow {
    group_key: string;
    group_label: string;
    metric: string;
    monthly_value: number;
    daily_agg_value: number;
    diff: number;
    diff_rate_pct: number | null;
}

interface ReconciliationData {
    month: string;
    version: string;
    rows: ReconciliationRow[];
    daily_side_adjustments?: {
        balancing_fee_added_to_energy_fee?: number;
    };
}

interface LedgerCol {
    key: string;
    label: string;
    group: string;
    digits?: number;
    isText?: boolean;
}

const LEDGER_COLUMNS: LedgerCol[] = [
    { key: 'contract_volume', label: '合同电量', group: '中长期合约', digits: 3 },
    { key: 'contract_avg_price', label: '合同均价', group: '中长期合约', digits: 3 },
    { key: 'contract_fee', label: '合同电费', group: '中长期合约', digits: 2 },
    { key: 'day_ahead_declared_volume', label: '日前申报电量', group: '日前市场偏差', digits: 3 },
    { key: 'day_ahead_deviation_fee', label: '日前偏差电费', group: '日前市场偏差', digits: 2 },
    { key: 'actual_consumption_volume', label: '实际用电量', group: '实时市场偏差', digits: 3 },
    { key: 'real_time_deviation_fee', label: '实时偏差电费', group: '实时市场偏差', digits: 2 },
    { key: 'green_transfer_fee', label: '绿色电能量合同转让收支费用', group: '绿色电能量合同转让收支费用', digits: 2 },
    { key: 'daily_24h_total_volume', label: '日24时段用电量合计', group: '日用电量与月度用电量偏差', digits: 3 },
    { key: 'actual_monthly_volume', label: '实际月度用电量', group: '日用电量与月度用电量偏差', digits: 3 },
    { key: 'monthly_balancing_volume', label: '月度调平电量', group: '日用电量与月度用电量偏差', digits: 3 },
    { key: 'monthly_balancing_deviation_rate_pct', label: '月度调平偏差率(%)', group: '日用电量与月度用电量偏差', digits: 4 },
    { key: 'balancing_price', label: '调平电价', group: '日用电量与月度用电量偏差', digits: 3 },
    { key: 'balancing_fee', label: '调平电费', group: '日用电量与月度用电量偏差', digits: 2 },
    { key: 'energy_fee_total', label: '电能量电费', group: '电能量合计', digits: 2 },
    { key: 'energy_avg_price', label: '电能量均价', group: '电能量合计', digits: 3 },
    { key: 'gen_side_cost_allocation', label: '发电侧成本类费用分摊', group: '资金余缺费用', digits: 2 },
    { key: 'congestion_fee_allocation', label: '阻塞费分摊', group: '资金余缺费用', digits: 2 },
    { key: 'imbalance_fund_allocation', label: '不平衡资金分摊', group: '资金余缺费用', digits: 2 },
    { key: 'deviation_recovery_fee', label: '偏差回收费', group: '资金余缺费用', digits: 2 },
    { key: 'deviation_recovery_return_fee', label: '偏差回收费补偿居农损益后返还', group: '资金余缺费用', digits: 2 },
    { key: 'fund_surplus_deficit_total', label: '资金余缺费用合计', group: '资金余缺费用', digits: 2 },
    { key: 'settlement_fee_total', label: '结算电费', group: '结算合计', digits: 2 },
    { key: 'settlement_avg_price', label: '结算均价', group: '结算合计', digits: 3 },
    { key: 'clearing_retroactive_total_fee', label: '清算退补总费', group: '对比中长期结算清算退补', digits: 2 },
    { key: 'retroactive_to_retail_users', label: '退补零售用户', group: '对比中长期结算清算退补', digits: 2 },
    { key: 'retroactive_to_retail_company', label: '退补售电公司', group: '对比中长期结算清算退补', digits: 2 },
    { key: 'remark', label: '备注信息', group: '备注信息', isText: true },
    { key: 'confirmation_status', label: '确认状态', group: '确认状态', isText: true },
    { key: 'confirmation_time', label: '确认时间', group: '确认时间', isText: true },
    { key: 'dispute_content', label: '争议内容', group: '争议内容', isText: true },
];

const MOBILE_SUMMARY_COLUMNS: LedgerCol[] = [
    { key: 'actual_monthly_volume', label: '实际电量', group: '日用电量与月度用电量偏差', digits: 3 },
    { key: 'settlement_fee_total', label: '结算电费', group: '结算合计', digits: 2 },
    { key: 'settlement_avg_price', label: '结算均价', group: '结算合计', digits: 3 },
];

const GROUP_COLORS: Record<string, string> = {
    中长期合约: '#e3f2fd',
    日前市场偏差: '#e8f5e9',
    实时市场偏差: '#fff3e0',
    绿色电能量合同转让收支费用: '#f3e5f5',
    日用电量与月度用电量偏差: '#e0f2f1',
    电能量合计: '#e8eaf6',
    资金余缺费用: '#fff8e1',
    结算合计: '#fce4ec',
    对比中长期结算清算退补: '#efebe9',
    备注信息: '#f5f5f5',
    确认状态: '#f5f5f5',
    确认时间: '#f5f5f5',
    争议内容: '#f5f5f5',
};

const formatNumber = (value?: number | null, digits = 2): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    return Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
};

const getCellValue = (row: YearRow, key: string): number | string | null => {
    if (!row.has_data) return null;
    return (row.settlement_items?.[key] as number | string | null) ?? null;
};

const groupMeta = (() => {
    const orderedGroups: { name: string; count: number }[] = [];
    LEDGER_COLUMNS.forEach((col) => {
        const found = orderedGroups.find((g) => g.name === col.group);
        if (found) {
            found.count += 1;
        } else {
            orderedGroups.push({ name: col.group, count: 1 });
        }
    });
    return orderedGroups;
})();

const WholesaleMonthlySettlementPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [years, setYears] = useState<number[]>([]);
    const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
    const [rows, setRows] = useState<YearRow[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
    const [mobileDetailOpen, setMobileDetailOpen] = useState<boolean>(false);

    const [loadingYearData, setLoadingYearData] = useState<boolean>(false);
    const [loadingReconciliation, setLoadingReconciliation] = useState<boolean>(false);
    const [importing, setImporting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const selectedRow = useMemo(
        () => rows.find((item) => item.month === selectedMonth && item.has_data) || null,
        [rows, selectedMonth]
    );

    const reconciliationGroups = useMemo(() => {
        const map = new Map<string, ReconciliationRow[]>();
        (reconciliation?.rows || []).forEach((row) => {
            const arr = map.get(row.group_label) || [];
            arr.push(row);
            map.set(row.group_label, arr);
        });
        return Array.from(map.entries()).map(([groupLabel, items]) => ({
            groupLabel,
            items,
        }));
    }, [reconciliation]);

    const fetchYears = async () => {
        const res = await apiClient.get('/api/v1/wholesale-monthly-settlement/years');
        const list: number[] = res.data?.years || [];
        const yearSet = new Set<number>(list);
        yearSet.add(new Date().getFullYear());
        const sorted = Array.from(yearSet).sort((a, b) => b - a);
        setYears(sorted);
        if (!sorted.includes(selectedYear)) {
            setSelectedYear(sorted[0]);
        }
    };

    const fetchYearData = async (year: number) => {
        setLoadingYearData(true);
        setError(null);
        try {
            const res = await apiClient.get(`/api/v1/wholesale-monthly-settlement/year/${year}`);
            const list: YearRow[] = res.data?.rows || [];
            setRows(list);
            const firstWithData = list.find((item) => item.has_data);
            if (firstWithData) {
                setSelectedMonth((prev) => (prev.startsWith(String(year)) ? prev : firstWithData.month));
            } else {
                setSelectedMonth(`${year}-01`);
                setReconciliation(null);
            }
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载年度数据失败');
        } finally {
            setLoadingYearData(false);
        }
    };

    const fetchReconciliation = async (month: string) => {
        const target = rows.find((item) => item.month === month);
        if (!target || !target.has_data) {
            setReconciliation(null);
            return;
        }
        setLoadingReconciliation(true);
        setError(null);
        try {
            const res = await apiClient.get(`/api/v1/wholesale-monthly-settlement/${month}/reconciliation`);
            setReconciliation(res.data as ReconciliationData);
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '加载对账数据失败');
            setReconciliation(null);
        } finally {
            setLoadingReconciliation(false);
        }
    };

    useEffect(() => {
        fetchYears().catch((err) => {
            setError(err?.message || '加载年份列表失败');
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        fetchYearData(selectedYear);
    }, [selectedYear]);

    useEffect(() => {
        if (selectedMonth) {
            fetchReconciliation(selectedMonth);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth, rows]);

    const totals = useMemo(() => {
        return LEDGER_COLUMNS.reduce<Record<string, number>>((acc, col) => {
            if (col.isText) return acc;
            const sum = rows.reduce((total, row) => {
                if (!row.has_data) return total;
                const value = row.settlement_items?.[col.key];
                return total + (typeof value === 'number' ? value : 0);
            }, 0);
            acc[col.key] = sum;
            return acc;
        }, {});
    }, [rows]);

    const mobileSettlementAvgTotal = useMemo(() => {
        let totalFee = 0;
        let totalVolume = 0;
        rows.forEach((row) => {
            if (!row.has_data) return;
            const fee = row.settlement_items?.settlement_fee_total;
            const vol = row.settlement_items?.actual_monthly_volume;
            totalFee += typeof fee === 'number' ? fee : 0;
            totalVolume += typeof vol === 'number' ? vol : 0;
        });
        if (totalVolume <= 0) return null;
        return totalFee / totalVolume;
    }, [rows]);

    const handleYearChange = (event: SelectChangeEvent<number>) => {
        setSelectedYear(Number(event.target.value));
    };

    const doImport = async (file: File, overwrite: boolean) => {
        const formData = new FormData();
        formData.append('file', file);
        setImporting(true);
        setError(null);
        try {
            await apiClient.post('/api/v1/wholesale-monthly-settlement/import', formData, {
                params: { overwrite },
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            await fetchYears();
            await fetchYearData(selectedYear);
        } catch (err: any) {
            if (err.response?.status === 409) {
                const confirmOverwrite = window.confirm('该月份数据已存在，是否覆盖导入？');
                if (confirmOverwrite) {
                    await doImport(file, true);
                }
                return;
            }
            setError(err.response?.data?.detail || err.message || '导入失败');
        } finally {
            setImporting(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleChooseFile = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await doImport(file, false);
    };

    return (
        <Box sx={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
            {isTablet && (
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}>
                    结算管理 / 月度结算复核
                </Typography>
            )}

            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 1, width: '100%', maxWidth: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel id="year-select-label">选择年度</InputLabel>
                        <Select<number> labelId="year-select-label" value={selectedYear} label="选择年度" onChange={handleYearChange}>
                            {years.map((year) => (
                                <MenuItem key={year} value={year}>
                                    {year}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Box>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xls,.xlsx"
                            style={{ display: 'none' }}
                            onChange={handleFileChange}
                        />
                        <Button variant="contained" startIcon={<UploadFileIcon />} onClick={handleChooseFile} disabled={importing}>
                            {importing ? '导入中...' : isMobile ? '导入' : '导入月度结算文件'}
                        </Button>
                    </Box>
                </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
                <Typography variant="h6" gutterBottom>
                    {selectedYear} 年月度结算台账
                </Typography>

                {loadingYearData ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
                        <CircularProgress />
                    </Box>
                ) : isMobile ? (
                    <TableContainer sx={{ width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
                        <Table
                            size="small"
                            sx={{
                                width: '100%',
                                tableLayout: 'fixed',
                                '& .MuiTableCell-root': {
                                    fontSize: '0.75rem',
                                    px: 0.5,
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word',
                                },
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell>月份</TableCell>
                                    {MOBILE_SUMMARY_COLUMNS.map((col) => (
                                        <TableCell key={col.key} align="right">
                                            {col.label}
                                        </TableCell>
                                    ))}
                                    <TableCell align="center" sx={{ width: 52 }}>详情</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rows.map((row) => {
                                    const active = selectedMonth === row.month;
                                    return (
                                        <TableRow key={row.month} selected={active}>
                                            <TableCell>{row.month}</TableCell>
                                            {MOBILE_SUMMARY_COLUMNS.map((col) => {
                                                const value = getCellValue(row, col.key);
                                                return (
                                                    <TableCell key={col.key} align="right">
                                                        {formatNumber(typeof value === 'number' ? value : null, col.digits || 2)}
                                                    </TableCell>
                                                );
                                            })}
                                            <TableCell align="center">
                                                <Button
                                                    size="small"
                                                    sx={{ minWidth: 36, px: 0.5 }}
                                                    onClick={() => {
                                                        setSelectedMonth(row.month);
                                                        if (row.has_data) {
                                                            setMobileDetailOpen(true);
                                                        }
                                                    }}
                                                    disabled={!row.has_data}
                                                >
                                                    查看
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                <TableRow sx={{ backgroundColor: 'action.hover' }}>
                                    <TableCell sx={{ fontWeight: 'bold' }}>合计</TableCell>
                                    {MOBILE_SUMMARY_COLUMNS.map((col) => {
                                        if (col.key === 'settlement_avg_price') {
                                            return (
                                                <TableCell key={col.key} align="right" sx={{ fontWeight: 'bold' }}>
                                                    {formatNumber(mobileSettlementAvgTotal, col.digits || 3)}
                                                </TableCell>
                                            );
                                        }
                                        return (
                                            <TableCell key={col.key} align="right" sx={{ fontWeight: 'bold' }}>
                                                {formatNumber(totals[col.key], col.digits || 2)}
                                            </TableCell>
                                        );
                                    })}
                                    <TableCell />
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : (
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table
                            size="small"
                            sx={{
                                minWidth: 2200,
                                '& .MuiTableCell-root': {
                                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                    px: { xs: 0.5, sm: 1 },
                                    whiteSpace: 'nowrap',
                                },
                            }}
                        >
                            <TableHead>
                                <TableRow>
                                    <TableCell rowSpan={2} sx={{ position: 'sticky', left: 0, zIndex: 3, backgroundColor: '#fafafa', minWidth: 80 }}>
                                        结算月份
                                    </TableCell>
                                    {groupMeta.map((group) => (
                                        <TableCell
                                            key={group.name}
                                            align="center"
                                            colSpan={group.count}
                                            sx={{ backgroundColor: GROUP_COLORS[group.name] || '#f5f5f5', fontWeight: 'bold' }}
                                        >
                                            {group.name}
                                        </TableCell>
                                    ))}
                                </TableRow>
                                <TableRow>
                                    {LEDGER_COLUMNS.map((col) => (
                                        <TableCell key={col.key} align={col.isText ? 'left' : 'right'} sx={{ backgroundColor: GROUP_COLORS[col.group] || '#f5f5f5' }}>
                                            {col.label}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rows.map((row) => {
                                    const active = selectedMonth === row.month;
                                    return (
                                        <TableRow key={row.month} hover selected={active} onClick={() => setSelectedMonth(row.month)} sx={{ cursor: 'pointer' }}>
                                            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, backgroundColor: active ? '#e3f2fd' : '#fff' }}>
                                                {row.month}
                                            </TableCell>
                                            {LEDGER_COLUMNS.map((col) => {
                                                const value = getCellValue(row, col.key);
                                                return (
                                                    <TableCell key={col.key} align={col.isText ? 'left' : 'right'}>
                                                        {col.isText ? (value ? String(value) : '--') : formatNumber(typeof value === 'number' ? value : null, col.digits || 2)}
                                                    </TableCell>
                                                );
                                            })}
                                        </TableRow>
                                    );
                                })}
                                <TableRow sx={{ backgroundColor: 'action.hover' }}>
                                    <TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, fontWeight: 'bold', backgroundColor: 'action.hover' }}>
                                        合计
                                    </TableCell>
                                    {LEDGER_COLUMNS.map((col) => (
                                        <TableCell key={col.key} align={col.isText ? 'left' : 'right'} sx={{ fontWeight: 'bold' }}>
                                            {col.isText ? '--' : formatNumber(totals[col.key], col.digits || 2)}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
                <Typography variant="h6" gutterBottom>
                    月度对账数据（{selectedMonth || '--'}）
                </Typography>

                {loadingReconciliation ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
                        <CircularProgress />
                    </Box>
                ) : !reconciliation ? (
                    <Alert severity="info">当前月份无可对账数据，请先导入该月份月结文件。</Alert>
                ) : isMobile ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {reconciliationGroups.map((group) => (
                            <Paper key={group.groupLabel} variant="outlined" sx={{ backgroundColor: GROUP_COLORS[group.groupLabel] || '#fff' }}>
                                <Box sx={{ px: 1.5, py: 1, fontWeight: 'bold' }}>{group.groupLabel}</Box>
                                <Divider />
                                <Box sx={{ px: 1, py: 1 }}>
                                    {group.items.map((row) => {
                                        const positive = row.diff > 0;
                                        const negative = row.diff < 0;
                                        return (
                                            <Box key={`${row.group_key}-${row.metric}`} sx={{ mb: 1 }}>
                                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                    {row.metric}
                                                </Typography>
                                                <Typography variant="caption" display="block">
                                                    月结: {formatNumber(row.monthly_value, 4)}
                                                </Typography>
                                                <Typography variant="caption" display="block">
                                                    日清: {formatNumber(row.daily_agg_value, 4)}
                                                </Typography>
                                                <Typography
                                                    variant="caption"
                                                    display="block"
                                                    sx={{ color: positive ? 'success.main' : negative ? 'error.main' : 'text.primary', fontWeight: 600 }}
                                                >
                                                    差值: {formatNumber(row.diff, 4)} / 差异率: {row.diff_rate_pct === null ? '--' : formatNumber(row.diff_rate_pct, 4)}%
                                                </Typography>
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </Paper>
                        ))}
                        <Alert severity="warning">
                            电能量电费对账时，日清聚合值已叠加调平电费（
                            {formatNumber(reconciliation.daily_side_adjustments?.balancing_fee_added_to_energy_fee ?? 0, 2)}）。
                        </Alert>
                    </Box>
                ) : (
                    <Box>
                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table
                                size="small"
                                sx={{
                                    minWidth: 1000,
                                    '& .MuiTableCell-root': {
                                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                        px: { xs: 0.5, sm: 1 },
                                    },
                                }}
                            >
                                <TableHead>
                                    <TableRow>
                                        <TableCell>分组</TableCell>
                                        <TableCell>指标</TableCell>
                                        <TableCell align="right">月结值</TableCell>
                                        <TableCell align="right">日清聚合值（PLATFORM_DAILY）</TableCell>
                                        <TableCell align="right">差值</TableCell>
                                        <TableCell align="right">差异率(%)</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {reconciliation.rows.map((row, idx) => {
                                        const positive = row.diff > 0;
                                        const negative = row.diff < 0;
                                        const showGroup = idx === 0 || reconciliation.rows[idx - 1].group_key !== row.group_key;
                                        return (
                                            <TableRow key={`${row.group_key}-${row.metric}-${idx}`} sx={{ backgroundColor: GROUP_COLORS[row.group_label] || '#fff' }}>
                                                <TableCell sx={{ fontWeight: showGroup ? 'bold' : 'normal' }}>{showGroup ? row.group_label : ''}</TableCell>
                                                <TableCell>{row.metric}</TableCell>
                                                <TableCell align="right">{formatNumber(row.monthly_value, 4)}</TableCell>
                                                <TableCell align="right">{formatNumber(row.daily_agg_value, 4)}</TableCell>
                                                <TableCell
                                                    align="right"
                                                    sx={{ color: positive ? 'success.main' : negative ? 'error.main' : 'text.primary', fontWeight: 600 }}
                                                >
                                                    {formatNumber(row.diff, 4)}
                                                </TableCell>
                                                <TableCell align="right">{row.diff_rate_pct === null ? '--' : formatNumber(row.diff_rate_pct, 4)}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                        <Alert severity="warning" sx={{ mt: 1 }}>
                            电能量电费对账时，日清聚合值已叠加调平电费（
                            {formatNumber(reconciliation.daily_side_adjustments?.balancing_fee_added_to_energy_fee ?? 0, 2)}）。
                            电能量电费按“每天电能量电费合计累计”计算，不做标准值判断。
                        </Alert>
                    </Box>
                )}
            </Paper>

            <SwipeableDrawer
                anchor="bottom"
                open={mobileDetailOpen}
                onClose={() => setMobileDetailOpen(false)}
                onOpen={() => setMobileDetailOpen(true)}
                disableDiscovery
                ModalProps={{ keepMounted: true }}
                sx={{
                    '& .MuiDrawer-paper': {
                        maxHeight: '85vh',
                        borderTopLeftRadius: 12,
                        borderTopRightRadius: 12,
                    },
                }}
            >
                <Box sx={{ p: 1, overflowY: 'auto' }}>
                    <Box sx={{ width: 36, height: 4, bgcolor: 'grey.400', borderRadius: 2, mx: 'auto', my: 0.5 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                            月份详情（{selectedMonth || '--'}）
                        </Typography>
                        <IconButton aria-label="关闭详情抽屉" onClick={() => setMobileDetailOpen(false)} size="small">
                            <CloseIcon />
                        </IconButton>
                    </Box>
                    <Divider sx={{ mb: 1 }} />
                    {!selectedRow ? (
                        <Alert severity="info">当前月份无数据</Alert>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {groupMeta.map((group) => (
                                <Paper key={group.name} variant="outlined" sx={{ backgroundColor: GROUP_COLORS[group.name] || '#fff' }}>
                                    <Box sx={{ px: 1.5, py: 1, fontWeight: 'bold' }}>{group.name}</Box>
                                    <Divider />
                                    <Box sx={{ px: 1.5, py: 1 }}>
                                        {LEDGER_COLUMNS.filter((col) => col.group === group.name).map((col) => {
                                            const value = getCellValue(selectedRow, col.key);
                                            return (
                                                <Box key={col.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}>
                                                    <Typography variant="caption">{col.label}</Typography>
                                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                        {col.isText
                                                            ? value
                                                                ? String(value)
                                                                : '--'
                                                            : formatNumber(typeof value === 'number' ? value : null, col.digits || 2)}
                                                    </Typography>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </Paper>
                            ))}
                        </Box>
                    )}

                    <Box sx={{ mt: 1.5 }}>
                        <Button fullWidth variant="outlined" onClick={() => setMobileDetailOpen(false)}>
                            关闭
                        </Button>
                    </Box>
                </Box>
            </SwipeableDrawer>

            {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {typeof error === 'string' ? error : JSON.stringify(error)}
                </Alert>
            )}
        </Box>
    );
};

export default WholesaleMonthlySettlementPage;
