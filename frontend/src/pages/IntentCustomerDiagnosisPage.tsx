import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    ButtonGroup,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid,
    IconButton,
    Paper,
    Stack,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import {
    addDays,
    addMonths,
    endOfMonth,
    format,
    isAfter,
    isBefore,
    isSameDay,
    isSameMonth,
    parseISO,
    startOfMonth
} from 'date-fns';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis
} from 'recharts';
import {
    calculateIntentCustomerWholesaleSimulation,
    deleteIntentCustomer,
    getIntentCustomerLoadData,
    getIntentCustomerWholesaleSimulation,
    importIntentCustomerFiles,
    IntentCustomerSummary,
    IntentWholesaleDailyDetail,
    IntentWholesaleMonthDetail,
    IntentWholesalePeriodDetail,
    IntentWholesaleSummaryRow,
    IntentImportConfig,
    IntentPreviewResponse,
    listIntentCustomers,
    previewIntentCustomerFiles
} from '../api/intentCustomerDiagnosis';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import IntentRetailSimulationTab from '../components/intent-customer-diagnosis/IntentRetailSimulationTab';
import { useAuth } from '../contexts/AuthContext';

type DiagnosisTabKey = 'load' | 'wholesale' | 'retail';

interface DailyPoint {
    date: Date;
    rawDate: string;
    label: string;
    totalLoad: number;
    isMissing: boolean;
    isWeekend?: boolean;
}

interface IntradayPoint {
    time: string;
    load: number;
}

interface PreviewConfigItem extends IntentImportConfig {
    extractedCustomerName?: string | null;
    startDate: string;
    endDate: string;
    recordCount: number;
}

const countFullCoveredMonths = (start: Date, end: Date): number => {
    let cursor = startOfMonth(start);
    let count = 0;

    while (!isAfter(cursor, end)) {
        const monthStart = startOfMonth(cursor);
        const monthEnd = endOfMonth(cursor);
        const isCoveredWholeMonth =
            isSameDay(monthStart, start) || (monthStart > start && !isAfter(monthStart, end));
        const monthEndCovered =
            isSameDay(monthEnd, end) || (monthEnd < end && !isBefore(monthEnd, start));
        if (isCoveredWholeMonth && monthEndCovered) {
            count += 1;
        }
        cursor = addMonths(cursor, 1);
    }

    return count;
};

const parseDateOrNull = (value?: string | null): Date | null => {
    if (!value) {
        return null;
    }
    return parseISO(value);
};

const TabPanel: React.FC<{ value: DiagnosisTabKey; index: DiagnosisTabKey; children: React.ReactNode }> = ({ value, index, children }) => (
    <div hidden={value !== index}>{value === index && <Box sx={{ pt: 3 }}>{children}</Box>}</div>
);

const MetricCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color = 'text.primary' }) => (
    <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="h6" sx={{ mt: 0.5, color, fontWeight: 700 }}>{value}</Typography>
        </CardContent>
    </Card>
);

const PlaceholderTabCard: React.FC<{ title: string; description: string }> = ({ title, description }) => (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, textAlign: 'center' }}>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{description}</Typography>
    </Paper>
);

const WHOLESALE_PERIOD_COLORS: Record<string, string> = {
    '\u5c16\u5cf0': '#ff5252',
    '\u9ad8\u5cf0': '#ff9800',
    '\u5e73\u6bb5': '#4caf50',
    '\u4f4e\u8c37': '#2196f3',
    '\u6df1\u8c37': '#3f51b5',
    period_type_mix: '#9e9e9e'
};

const ImportDialog: React.FC<{
    open: boolean;
    selectedCustomer: IntentCustomerSummary | null;
    onClose: () => void;
    onImported: (customerId: string, message: string) => void;
}> = ({ open, selectedCustomer, onClose, onImported }) => {
    const [files, setFiles] = useState<File[]>([]);
    const [preview, setPreview] = useState<IntentPreviewResponse | null>(null);
    const [configs, setConfigs] = useState<PreviewConfigItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setFiles([]);
            setPreview(null);
            setConfigs([]);
            setError(null);
            setPreviewLoading(false);
            setSubmitting(false);
        }
    }, [open, selectedCustomer]);

    const validationError = useMemo(() => {
        if (files.length === 0) {
            return '请先选择或拖入电表数据文件。';
        }
        if (!preview?.validation.can_import) {
            return preview?.validation.errors[0] || '文件预校验未通过。';
        }
        if (configs.some((item) => !item.account_id.trim())) {
            return '存在未识别到户号的文件，请先确认。';
        }
        if (configs.some((item) => Number(item.multiplier) <= 0)) {
            return '倍率必须大于0。';
        }
        if (!preview?.suggested_customer_name) {
            return '未能从电表数据文件中唯一识别意向客户名称。';
        }
        return null;
    }, [configs, files.length, preview]);

    const canSubmit = !previewLoading && !submitting && !validationError && configs.length > 0;

    const rePreviewWithFiles = async (nextFiles: File[]) => {
        if (nextFiles.length === 0) {
            setFiles([]);
            setPreview(null);
            setConfigs([]);
            setError(null);
            return;
        }
        await handlePreviewFiles(nextFiles);
    };

    const handleRemoveFile = async (filename: string) => {
        const nextFiles = files.filter((file) => file.name !== filename);
        await rePreviewWithFiles(nextFiles);
    };

    const handlePreviewFiles = async (selectedFiles: File[]) => {
        const excelFiles = selectedFiles.filter((file) => {
            const lower = file.name.toLowerCase();
            return lower.endsWith('.xlsx') || lower.endsWith('.xls');
        });

        if (excelFiles.length === 0) {
            setError('仅支持 Excel 电表数据文件。');
            return;
        }

        setPreviewLoading(true);
        setError(null);
        try {
            const previewResult = await previewIntentCustomerFiles(excelFiles);
            setFiles(excelFiles);
            setPreview(previewResult);
            setConfigs(
                previewResult.files.map((item) => ({
                    filename: item.filename,
                    meter_id: item.meter_id,
                    account_id: item.account_id,
                    multiplier: item.default_multiplier || 1,
                    extractedCustomerName: item.extracted_customer_name,
                    startDate: item.start_date,
                    endDate: item.end_date,
                    recordCount: item.record_count
                }))
            );
        } catch (previewError: any) {
            setFiles([]);
            setPreview(null);
            setConfigs([]);
            setError(previewError.response?.data?.detail || previewError.message || '文件预解析失败');
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleConfirm = async () => {
        if (validationError) {
            setError(validationError);
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const result = await importIntentCustomerFiles(configs, files);
            onImported(result.customer.id, result.message);
        } catch (submitError: any) {
            setError(submitError.response?.data?.detail || submitError.message || '导入聚合失败');
        } finally {
            setSubmitting(false);
        }
    };

    return (
            <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
            <DialogTitle>新增/导入意向客户数据</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Alert severity="warning">
                        请务必一次性导入该意向客户的全部电表文件。当前导入采用覆盖方式，若文件不全，会按本次上传结果重建该客户电表清单和聚合结果。
                    </Alert>
                    {preview?.suggested_customer_name && (
                        <Alert severity="info">已识别意向客户名称：{preview.suggested_customer_name}</Alert>
                    )}

                    <Paper
                        variant="outlined"
                        sx={{ p: 3, borderStyle: 'dashed', textAlign: 'center', bgcolor: 'action.hover', cursor: submitting ? 'default' : 'pointer' }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            if (!submitting) {
                                void handlePreviewFiles(Array.from(event.dataTransfer.files));
                            }
                        }}
                        onClick={() => {
                            if (!submitting) {
                                fileInputRef.current?.click();
                            }
                        }}
                    >
                        <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                        <Typography variant="subtitle1" fontWeight={700}>一次性拖入该客户全部电表数据文件</Typography>
                        <Typography variant="body2" color="text.secondary">
                            系统会先提取用户名、户号、表号等信息，再要求补录倍率后才能执行导入聚合。
                        </Typography>
                        <input
                            ref={fileInputRef}
                            type="file"
                            hidden
                            multiple
                            accept=".xlsx,.xls"
                            onChange={(event) => {
                                void handlePreviewFiles(Array.from(event.target.files || []));
                                event.target.value = '';
                            }}
                        />
                    </Paper>

                    {previewLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={28} />
                        </Box>
                    )}

                    {preview && (
                        <Paper variant="outlined" sx={{ p: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>文件提取结果与倍率录入</Typography>
                            <Stack spacing={1.5}>
                                {configs.map((item) => (
                                    <Paper key={item.filename} variant="outlined" sx={{ p: 1.5 }}>
                                        <Grid container spacing={{ xs: 1, sm: 2 }} alignItems="center">
                                            <Grid size={{ xs: 12, md: 3 }}>
                                                <TextField label="文件名" value={item.filename} fullWidth size="small" disabled />
                                            </Grid>
                                            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                                                <TextField label="用户名" value={item.extractedCustomerName || '-'} fullWidth size="small" disabled />
                                            </Grid>
                                            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                                                <TextField label="户号" value={item.account_id} fullWidth size="small" disabled />
                                            </Grid>
                                            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                                                <TextField label="表号" value={item.meter_id} fullWidth size="small" disabled />
                                            </Grid>
                                            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                                                <TextField
                                                    label="倍率"
                                                    type="number"
                                                    value={item.multiplier}
                                                    onChange={(event) => {
                                                        const multiplier = Number(event.target.value || 0);
                                                        setConfigs((current) => current.map((config) => (
                                                            config.filename === item.filename ? { ...config, multiplier } : config
                                                        )));
                                                    }}
                                                    fullWidth
                                                    size="small"
                                                    disabled={submitting}
                                                    inputProps={{ min: 0, step: 1 }}
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 1 }}>
                                                <Button
                                                    color="error"
                                                    variant="text"
                                                    startIcon={<DeleteOutlineIcon />}
                                                    onClick={() => void handleRemoveFile(item.filename)}
                                                    disabled={submitting || previewLoading}
                                                    sx={{ whiteSpace: 'nowrap' }}
                                                >
                                                    剔除
                                                </Button>
                                            </Grid>
                                            <Grid size={{ xs: 12 }}>
                                                <Typography variant="caption" color="text.secondary">
                                                    数据范围 {item.startDate} 到 {item.endDate}，共 {item.recordCount} 天
                                                </Typography>
                                            </Grid>
                                            {(preview.files.find((previewItem) => previewItem.filename === item.filename)?.parse_errors || []).map((message) => (
                                                <Grid size={{ xs: 12 }} key={`${item.filename}-${message}`}>
                                                    <Alert severity="warning" sx={{ py: 0 }}>{message}</Alert>
                                                </Grid>
                                            ))}
                                        </Grid>
                                    </Paper>
                                ))}
                            </Stack>
                        </Paper>
                    )}

                    {preview?.validation.errors.map((message) => (
                        <Alert key={message} severity="error">{message}</Alert>
                    ))}
                    {preview?.validation.warnings.map((message) => (
                        <Alert key={message} severity="warning">{message}</Alert>
                    ))}
                    {error && <Alert severity="error">{error}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={submitting}>取消</Button>
                <Button variant="contained" onClick={() => void handleConfirm()} disabled={!canSubmit}>
                    {submitting ? '导入中...' : '导入聚合'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const DeleteDialog: React.FC<{
    open: boolean;
    customerName?: string;
    onClose: () => void;
    onConfirm: (password: string) => Promise<void>;
}> = ({ open, customerName, onClose, onConfirm }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setPassword('');
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    const handleConfirm = async () => {
        if (!password.trim()) {
            setError('请输入登录密码确认删除。');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onConfirm(password.trim());
        } catch (confirmError: any) {
            setError(confirmError.response?.data?.detail || confirmError.message || '删除失败');
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle>删除意向客户</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Alert severity="warning">确认删除客户“{customerName || ''}”吗？删除前需要再次输入登录密码确认。</Alert>
                    <TextField
                        label="确认密码"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        fullWidth
                        disabled={submitting}
                    />
                    {error && <Alert severity="error">{error}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={submitting}>取消</Button>
                <Button color="error" variant="contained" onClick={() => void handleConfirm()} disabled={submitting}>
                    {submitting ? '删除中...' : '确认删除'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

type WholesaleDetailMode = 'chart' | 'table';

const WholesaleSimulationTab: React.FC<{
    selectedCustomer: IntentCustomerSummary | null;
    canEdit: boolean;
}> = ({ selectedCustomer, canEdit }) => {
    const detailPanelHeight = { xs: 350, sm: 400 };
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [summaryRows, setSummaryRows] = useState<IntentWholesaleSummaryRow[]>([]);
    const [monthDetails, setMonthDetails] = useState<IntentWholesaleMonthDetail[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
    const [periodMode, setPeriodMode] = useState<WholesaleDetailMode>('chart');
    const [dailyMode, setDailyMode] = useState<WholesaleDetailMode>('chart');

    const periodChartRef = useRef<HTMLDivElement>(null);
    const dailyChartRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSummaryRows([]);
        setMonthDetails([]);
        setSelectedMonth(null);
        setError(null);
        setMessage(null);
        setPeriodMode('chart');
        setDailyMode('chart');
    }, [selectedCustomer?.id]);

    useEffect(() => {
        if (!selectedCustomer) {
            return;
        }

        let cancelled = false;
        const loadSavedResult = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await getIntentCustomerWholesaleSimulation(selectedCustomer.id);
                if (cancelled) {
                    return;
                }
                setSummaryRows(response.summary_rows);
                setMonthDetails(response.month_details);
                setSelectedMonth((current) => current || response.summary_rows[0]?.settlement_month || null);
            } catch (loadError: any) {
                if (cancelled) {
                    return;
                }
                setError(loadError.response?.data?.detail || loadError.message || '加载批发侧结算结果失败');
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadSavedResult();
        return () => {
            cancelled = true;
        };
    }, [selectedCustomer]);

    const selectedMonthDetail = useMemo(
        () => monthDetails.find((item) => item.settlement_month === selectedMonth) || null,
        [monthDetails, selectedMonth]
    );

    useEffect(() => {
        if (!selectedMonthDetail && monthDetails.length > 0) {
            setSelectedMonth(monthDetails[0].settlement_month);
        }
    }, [monthDetails, selectedMonthDetail]);

    const periodChartData = useMemo(
        () => (selectedMonthDetail?.period_details || []).map((item) => ({
            ...item,
            short_label: item.period.toString(),
            period_type: item.period_type || 'period_type_mix'
        })),
        [selectedMonthDetail]
    );

    const dailyChartData = useMemo(
        () => (selectedMonthDetail?.daily_details || []).map((item) => ({
            ...item,
            label: item.date.slice(5)
        })),
        [selectedMonthDetail]
    );

    const {
        isFullscreen: isPeriodFullscreen,
        FullscreenEnterButton: PeriodFullscreenEnterButton,
        FullscreenExitButton: PeriodFullscreenExitButton,
        FullscreenTitle: PeriodFullscreenTitle
    } = useChartFullscreen({
        chartRef: periodChartRef,
        title: selectedMonth ? `48时段成本明细 ${selectedMonth}` : '48时段成本明细'
    });

    const {
        isFullscreen: isDailyFullscreen,
        FullscreenEnterButton: DailyFullscreenEnterButton,
        FullscreenExitButton: DailyFullscreenExitButton,
        FullscreenTitle: DailyFullscreenTitle
    } = useChartFullscreen({
        chartRef: dailyChartRef,
        title: selectedMonth ? `每日成本明细 ${selectedMonth}` : '每日成本明细'
    });

    const handleCalculate = async () => {
        if (!canEdit) {
            return;
        }
        if (!selectedCustomer) {
            return;
        }
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            const response = await calculateIntentCustomerWholesaleSimulation(selectedCustomer.id);
            setSummaryRows(response.summary_rows);
            setMonthDetails(response.month_details);
            setSelectedMonth(response.summary_rows[0]?.settlement_month || null);
            setMessage(response.summary_rows.length > 0 ? '批发侧月度模拟结算已完成。' : '没有可计算的结算月份。');
        } catch (calcError: any) {
            setError(calcError.response?.data?.detail || calcError.message || '批发侧月度模拟结算失败');
            setSummaryRows([]);
            setMonthDetails([]);
            setSelectedMonth(null);
        } finally {
            setLoading(false);
        }
    };

    const renderSummaryTable = () => (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table
                size="small"
                sx={{
                    '& .MuiTableCell-root': {
                        fontSize: { xs: '0.75rem', sm: '0.875rem' },
                        px: { xs: 0.5, sm: 1.5 }
                    }
                }}
            >
                <TableHead>
                    <TableRow>
                        <TableCell>结算月份</TableCell>
                        <TableCell align="right">总电量(MWh)</TableCell>
                        <TableCell align="right">每日成本汇总(元)</TableCell>
                        <TableCell align="right">每日成本均价(元/MWh)</TableCell>
                        <TableCell align="right">资金余缺分摊(元)</TableCell>
                        <TableCell align="right">批发总成本(元)</TableCell>
                        <TableCell align="right">批发单价(元/MWh)</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {summaryRows.map((row) => {
                        const active = row.settlement_month === selectedMonth;
                        const dailyCostUnitPrice = row.total_energy_mwh > 0
                            ? row.daily_cost_total / row.total_energy_mwh
                            : 0;
                        return (
                            <TableRow
                                key={row.settlement_month}
                                hover
                                selected={active}
                                onClick={() => setSelectedMonth(row.settlement_month)}
                                sx={{ cursor: 'pointer' }}
                            >
                                <TableCell>{row.settlement_month}</TableCell>
                                <TableCell align="right">{row.total_energy_mwh.toFixed(3)}</TableCell>
                                <TableCell align="right">{row.daily_cost_total.toFixed(3)}</TableCell>
                                <TableCell align="right">{dailyCostUnitPrice.toFixed(3)}</TableCell>
                                <TableCell align="right">{row.surplus_cost.toFixed(3)}</TableCell>
                                <TableCell align="right">{row.total_cost.toFixed(3)}</TableCell>
                                <TableCell align="right">{row.unit_cost_yuan_per_mwh.toFixed(3)}</TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );

    const renderPeriodTable = (rows: IntentWholesalePeriodDetail[]) => {
        const totals = rows.reduce(
            (acc, row) => ({
                load_mwh: acc.load_mwh + row.load_mwh,
                daily_cost_total: acc.daily_cost_total + row.daily_cost_total,
                surplus_cost: acc.surplus_cost + row.surplus_cost,
                total_cost: acc.total_cost + row.total_cost
            }),
            { load_mwh: 0, daily_cost_total: 0, surplus_cost: 0, total_cost: 0 }
        );

        return (
            <Box sx={{ height: detailPanelHeight }}>
                <TableContainer sx={{ overflow: 'auto', height: '100%' }}>
                    <Table
                        stickyHeader
                        size="small"
                        sx={{
                            '& .MuiTableCell-root': {
                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                px: { xs: 0.5, sm: 1.5 }
                            }
                        }}
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell>时段</TableCell>
                                <TableCell>时间</TableCell>
                                <TableCell align="right">电量(MWh)</TableCell>
                                <TableCell align="right">每日成本汇总(元)</TableCell>
                                <TableCell align="right">资金余缺分摊(元)</TableCell>
                                <TableCell align="right">总成本(元)</TableCell>
                                <TableCell align="right">时段均价</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.period}>
                                    <TableCell>{row.period}</TableCell>
                                    <TableCell>{row.time_label}</TableCell>
                                    <TableCell align="right">{row.load_mwh.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.daily_cost_total.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.surplus_cost.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.total_cost.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.final_unit_price.toFixed(3)}</TableCell>
                                </TableRow>
                            ))}
                            <TableRow
                                sx={{
                                    position: 'sticky',
                                    bottom: 0,
                                    backgroundColor: '#f5f7fa',
                                    '& .MuiTableCell-root': { fontWeight: 700 }
                                }}
                            >
                                <TableCell colSpan={2}>合计</TableCell>
                                <TableCell align="right">{totals.load_mwh.toFixed(3)}</TableCell>
                                <TableCell align="right">{totals.daily_cost_total.toFixed(3)}</TableCell>
                                <TableCell align="right">{totals.surplus_cost.toFixed(3)}</TableCell>
                                <TableCell align="right">{totals.total_cost.toFixed(3)}</TableCell>
                                <TableCell align="right">{(totals.total_cost / totals.load_mwh || 0).toFixed(3)}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        );
    };

    const renderDailyTable = (rows: IntentWholesaleDailyDetail[]) => {
        const totals = rows.reduce(
            (acc, row) => ({
                total_energy_mwh: acc.total_energy_mwh + row.total_energy_mwh,
                daily_cost_total: acc.daily_cost_total + row.daily_cost_total,
                surplus_cost: acc.surplus_cost + row.surplus_cost,
                total_cost: acc.total_cost + row.total_cost
            }),
            { total_energy_mwh: 0, daily_cost_total: 0, surplus_cost: 0, total_cost: 0 }
        );

        return (
            <Box sx={{ height: detailPanelHeight }}>
                <TableContainer sx={{ overflow: 'auto', height: '100%' }}>
                    <Table
                        stickyHeader
                        size="small"
                        sx={{
                            '& .MuiTableCell-root': {
                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                px: { xs: 0.5, sm: 1.5 }
                            }
                        }}
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell>日期</TableCell>
                                <TableCell align="right">总电量(MWh)</TableCell>
                                <TableCell align="right">每日成本汇总(元)</TableCell>
                                <TableCell align="right">资金余缺分摊(元)</TableCell>
                                <TableCell align="right">总成本(元)</TableCell>
                                <TableCell align="right">日均单价(元/MWh)</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.date}>
                                    <TableCell>{row.date}</TableCell>
                                    <TableCell align="right">{row.total_energy_mwh.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.daily_cost_total.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.surplus_cost.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.total_cost.toFixed(3)}</TableCell>
                                    <TableCell align="right">{row.unit_cost_yuan_per_mwh.toFixed(3)}</TableCell>
                                </TableRow>
                            ))}
                            <TableRow
                                sx={{
                                    position: 'sticky',
                                    bottom: 0,
                                    backgroundColor: '#f5f7fa',
                                    '& .MuiTableCell-root': { fontWeight: 700 }
                                }}
                            >
                                <TableCell>合计</TableCell>
                                <TableCell align="right">{totals.total_energy_mwh.toFixed(3)}</TableCell>
                                <TableCell align="right">{totals.daily_cost_total.toFixed(3)}</TableCell>
                                <TableCell align="right">{totals.surplus_cost.toFixed(3)}</TableCell>
                                <TableCell align="right">{totals.total_cost.toFixed(3)}</TableCell>
                                <TableCell align="right">{(totals.total_cost / totals.total_energy_mwh || 0).toFixed(3)}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        );
    };

    if (!selectedCustomer) {
        return (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">请先新增或选择意向客户。</Typography>
            </Paper>
        );
    }

    return (
        <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                    spacing={1.5}
                >
                    <Box>
                        <Typography variant="h6" fontSize="1rem" fontWeight="bold">批发侧结算结果</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            自动识别该客户已覆盖且已完成批发月结的月份，一次性计算全部月份。
                        </Typography>
                    </Box>
                    <Button variant="contained" onClick={() => void handleCalculate()} disabled={loading || !canEdit}>
                        {loading ? '计算中...' : '计算批发侧结算'}
                    </Button>
                </Stack>
            </Paper>

            {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

            {loading && summaryRows.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : summaryRows.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                    <Typography color="text.secondary">点击上方按钮后，将在这里显示批发侧月度结算结果。</Typography>
                </Paper>
            ) : (
                <Stack spacing={2}>
                    {renderSummaryTable()}

                    {selectedMonthDetail && (
                        <Grid container spacing={{ xs: 1, sm: 2 }} alignItems="stretch">
                            <Grid size={{ xs: 12, lg: 6 }}>
                                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
                                        <Box>
                                            <Typography variant="h6" fontSize="1rem" fontWeight="bold">48时段成本明细</Typography>
                                            <Typography variant="body2" color="text.secondary">{selectedMonthDetail.settlement_month}</Typography>
                                        </Box>
                                        <ButtonGroup size="small" variant="outlined">
                                            <Button variant={periodMode === 'chart' ? 'contained' : 'outlined'} onClick={() => setPeriodMode('chart')}>图表</Button>
                                            <Button variant={periodMode === 'table' ? 'contained' : 'outlined'} onClick={() => setPeriodMode('table')}>表格</Button>
                                        </ButtonGroup>
                                    </Stack>
                                    <Box sx={{ flex: 1, minHeight: 0 }}>
                                        {periodMode === 'chart' ? (
                                            <Box
                                                ref={periodChartRef}
                                                sx={{
                                                    height: detailPanelHeight,
                                                    position: 'relative',
                                                    backgroundColor: isPeriodFullscreen ? 'background.paper' : 'transparent',
                                                    p: isPeriodFullscreen ? 2 : 0,
                                                    ...(isPeriodFullscreen && {
                                                        position: 'fixed',
                                                        top: 0,
                                                        left: 0,
                                                        width: '100vw',
                                                        height: '100vh',
                                                        zIndex: 1400
                                                    })
                                                }}
                                            >
                                                <PeriodFullscreenEnterButton />
                                                <PeriodFullscreenExitButton />
                                                <PeriodFullscreenTitle />
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart data={periodChartData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                        <XAxis dataKey="short_label" tick={{ fontSize: 11 }} interval={3} />
                                                        <YAxis yAxisId="left" />
                                                        <YAxis yAxisId="right" orientation="right" />
                                                        <RechartsTooltip />
                                                        <Legend />
                                                        <Bar yAxisId="left" dataKey="load_mwh" name="电量(MWh)">
                                                            {periodChartData.map((entry) => (
                                                                <Cell
                                                                    key={`period-load-${entry.period}`}
                                                                    fill={`${WHOLESALE_PERIOD_COLORS[entry.period_type || 'period_type_mix'] || '#9e9e9e'}CC`}
                                                                />
                                                            ))}
                                                        </Bar>
                                                        <Line yAxisId="right" type="monotone" dataKey="total_cost" name="总成本(元)" stroke="#ef6c00" strokeWidth={2.5} dot={false} />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        ) : (
                                            renderPeriodTable(selectedMonthDetail.period_details)
                                        )}
                                    </Box>
                                </Paper>
                            </Grid>

                            <Grid size={{ xs: 12, lg: 6 }}>
                                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
                                        <Box>
                                            <Typography variant="h6" fontSize="1rem" fontWeight="bold">每日成本明细</Typography>
                                            <Typography variant="body2" color="text.secondary">{selectedMonthDetail.settlement_month}</Typography>
                                        </Box>
                                        <ButtonGroup size="small" variant="outlined">
                                            <Button variant={dailyMode === 'chart' ? 'contained' : 'outlined'} onClick={() => setDailyMode('chart')}>图表</Button>
                                            <Button variant={dailyMode === 'table' ? 'contained' : 'outlined'} onClick={() => setDailyMode('table')}>表格</Button>
                                        </ButtonGroup>
                                    </Stack>
                                    <Box sx={{ flex: 1, minHeight: 0 }}>
                                        {dailyMode === 'chart' ? (
                                            <Box
                                                ref={dailyChartRef}
                                                sx={{
                                                    height: detailPanelHeight,
                                                    position: 'relative',
                                                    backgroundColor: isDailyFullscreen ? 'background.paper' : 'transparent',
                                                    p: isDailyFullscreen ? 2 : 0,
                                                    ...(isDailyFullscreen && {
                                                        position: 'fixed',
                                                        top: 0,
                                                        left: 0,
                                                        width: '100vw',
                                                        height: '100vh',
                                                        zIndex: 1400
                                                    })
                                                }}
                                            >
                                                <DailyFullscreenEnterButton />
                                                <DailyFullscreenExitButton />
                                                <DailyFullscreenTitle />
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ComposedChart data={dailyChartData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                                        <YAxis yAxisId="left" />
                                                        <YAxis yAxisId="right" orientation="right" />
                                                        <RechartsTooltip />
                                                        <Legend />
                                                        <Bar yAxisId="left" dataKey="total_energy_mwh" name="电量(MWh)" fill="#4caf50" />
                                                        <Line yAxisId="right" type="monotone" dataKey="total_cost" name="总成本(元)" stroke="#1976d2" strokeWidth={2.5} dot={false} />
                                                    </ComposedChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        ) : (
                                            renderDailyTable(selectedMonthDetail.daily_details)
                                        )}
                                    </Box>
                                </Paper>
                            </Grid>
                        </Grid>
                    )}
                </Stack>
            )}
        </Stack>
    );
};

export const IntentCustomerDiagnosisPage: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:analysis_intent_customer_diagnosis:edit');
    const canDelete = canEdit;

    const [customers, setCustomers] = useState<IntentCustomerSummary[]>([]);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<DiagnosisTabKey>('load');
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pageMessage, setPageMessage] = useState<string | null>(null);
    const [pageError, setPageError] = useState<string | null>(null);
    const [listLoading, setListLoading] = useState(false);
    const [dataLoading, setDataLoading] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState<Date | null>(new Date());
    const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());
    const [monthData, setMonthData] = useState<DailyPoint[]>([]);
    const [intradayData, setIntradayData] = useState<IntradayPoint[]>([]);
    const [selectedDayTotal, setSelectedDayTotal] = useState(0);

    const monthlyChartRef = useRef<HTMLDivElement>(null);
    const dailyChartRef = useRef<HTMLDivElement>(null);

    const selectedCustomer = useMemo(
        () => customers.find((item) => item.id === selectedCustomerId) || null,
        [customers, selectedCustomerId]
    );

    const coverageSummary = useMemo(() => {
        if (!selectedCustomer?.coverage_start || !selectedCustomer?.coverage_end) {
            return null;
        }
        const start = parseISO(selectedCustomer.coverage_start);
        const end = parseISO(selectedCustomer.coverage_end);
        const fullMonthCount = countFullCoveredMonths(start, end);
        const settlementHint = fullMonthCount >= 2 ? '，可以做结算模拟' : '';

        return {
            dateRange: `${format(start, 'yyyy-MM-dd')} 到 ${format(end, 'yyyy-MM-dd')}`,
            rangeText: `${selectedCustomer.coverage_days}天（共${fullMonthCount}个完整月${settlementHint}）`
        };
    }, [selectedCustomer]);

    const fetchCustomers = async (preferredCustomerId?: string | null) => {
        setListLoading(true);
        try {
            const items = await listIntentCustomers();
            setCustomers(items);

            const nextSelectedId = preferredCustomerId && items.some((item) => item.id === preferredCustomerId)
                ? preferredCustomerId
                : (selectedCustomerId && items.some((item) => item.id === selectedCustomerId) ? selectedCustomerId : items[0]?.id || null);
            setSelectedCustomerId(nextSelectedId);

            const targetCustomer = items.find((item) => item.id === nextSelectedId);
            if (targetCustomer?.coverage_end) {
                const endDate = parseISO(targetCustomer.coverage_end);
                setSelectedMonth(startOfMonth(endDate));
                setSelectedDay(endDate);
            } else if (!targetCustomer) {
                setSelectedMonth(new Date());
                setSelectedDay(new Date());
            }
        } catch (fetchError: any) {
            setPageError(fetchError.response?.data?.detail || fetchError.message || '加载意向客户列表失败');
        } finally {
            setListLoading(false);
        }
    };

    useEffect(() => {
        void fetchCustomers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedCustomer?.coverage_end) {
            return;
        }

        const coverageEnd = parseISO(selectedCustomer.coverage_end);
        if (!selectedMonth || !isSameMonth(selectedMonth, coverageEnd)) {
            setSelectedMonth(startOfMonth(coverageEnd));
        }
        if (!selectedDay || !isSameDay(selectedDay, coverageEnd)) {
            setSelectedDay(coverageEnd);
        }
    }, [selectedCustomer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!selectedCustomer || !selectedMonth || !selectedDay) {
            setMonthData([]);
            setIntradayData([]);
            setSelectedDayTotal(0);
            return;
        }

        let cancelled = false;
        const loadData = async () => {
            setDataLoading(true);
            try {
                const response = await getIntentCustomerLoadData(
                    selectedCustomer.id,
                    format(selectedMonth, 'yyyy-MM'),
                    format(selectedDay, 'yyyy-MM-dd')
                );
                if (cancelled) {
                    return;
                }
                setMonthData(response.month_data.map((item) => ({
                    date: parseISO(item.date),
                    rawDate: item.date,
                    label: item.label,
                    totalLoad: item.totalLoad,
                    isMissing: item.isMissing,
                    isWeekend: [0, 6].includes(parseISO(item.date).getDay())
                })));
                setIntradayData(response.intraday_data);
                setSelectedDayTotal(response.selected_day_total);
                setPageError(null);
            } catch (fetchError: any) {
                if (cancelled) {
                    return;
                }
                setPageError(fetchError.response?.data?.detail || fetchError.message || '加载客户负荷数据失败');
                setMonthData([]);
                setIntradayData([]);
                setSelectedDayTotal(0);
            } finally {
                if (!cancelled) {
                    setDataLoading(false);
                }
            }
        };

        void loadData();
        return () => {
            cancelled = true;
        };
    }, [selectedCustomer, selectedMonth, selectedDay]);

    useEffect(() => {
        if (!selectedMonth || monthData.length === 0) {
            return;
        }
        if (!selectedDay || !isSameMonth(selectedDay, selectedMonth)) {
            setSelectedDay(monthData[0].date);
            return;
        }
        if (!monthData.some((item) => isSameDay(item.date, selectedDay))) {
            setSelectedDay(monthData[0].date);
        }
    }, [monthData, selectedDay, selectedMonth]);

    const monthTotalLoad = useMemo(
        () => monthData.reduce((sum, item) => sum + item.totalLoad, 0),
        [monthData]
    );

    const {
        isFullscreen: isMonthFullscreen,
        FullscreenEnterButton: MonthFullscreenEnterButton,
        FullscreenExitButton: MonthFullscreenExitButton,
        FullscreenTitle: MonthFullscreenTitle
    } = useChartFullscreen({
        chartRef: monthlyChartRef,
        title: selectedCustomer && selectedMonth
            ? `${selectedCustomer.customer_name} 月度日电量曲线 ${format(selectedMonth, 'yyyy-MM')}`
            : '月度日电量曲线'
    });

    const handleDayShift = (days: number) => {
        if (!selectedDay) {
            return;
        }
        const nextDay = addDays(selectedDay, days);
        const coverageStart = parseDateOrNull(selectedCustomer?.coverage_start);
        const coverageEnd = parseDateOrNull(selectedCustomer?.coverage_end);

        if (coverageStart && isBefore(nextDay, coverageStart)) {
            return;
        }
        if (coverageEnd && isAfter(nextDay, coverageEnd)) {
            return;
        }
        setSelectedDay(nextDay);
        setSelectedMonth(startOfMonth(nextDay));
    };

    const {
        isFullscreen: isDayFullscreen,
        FullscreenEnterButton: DayFullscreenEnterButton,
        FullscreenExitButton: DayFullscreenExitButton,
        FullscreenTitle: DayFullscreenTitle,
        NavigationButtons: DayNavigationButtons
    } = useChartFullscreen({
        chartRef: dailyChartRef,
        title: selectedCustomer && selectedDay
            ? `${selectedCustomer.customer_name} 日内48时段负荷 ${format(selectedDay, 'yyyy-MM-dd')}`
            : '日内48时段负荷',
        onPrevious: () => handleDayShift(-1),
        onNext: () => handleDayShift(1)
    });

    const handleImportSuccess = async (customerId: string, message: string) => {
        setImportDialogOpen(false);
        setPageMessage(message);
        await fetchCustomers(customerId);
    };

    const handleDeleteConfirm = async (password: string) => {
        if (!canDelete) {
            return;
        }
        if (!selectedCustomer) {
            return;
        }
        await deleteIntentCustomer(selectedCustomer.id, password);
        setDeleteDialogOpen(false);
        setPageError(null);
        setPageMessage(`客户“${selectedCustomer.customer_name}”已删除。`);
        await fetchCustomers();
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {isTablet && (
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}>
                        负荷分析 / 外部客户诊断
                    </Typography>
                )}

                <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
                    <Grid container spacing={{ xs: 1, sm: 2 }} alignItems="center">
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Autocomplete
                                options={customers}
                                getOptionLabel={(option) => option.customer_name}
                                value={selectedCustomer}
                                loading={listLoading}
                                onChange={(_, value) => {
                                    setSelectedCustomerId(value?.id || null);
                                }}
                                renderInput={(params) => <TextField {...params} label="选择意向客户" size="small" />}
                                noOptionsText="暂无意向客户"
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Button variant="contained" startIcon={<AddIcon />} onClick={() => setImportDialogOpen(true)} disabled={!canEdit}>
                                    新增/导入
                                </Button>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    startIcon={<DeleteOutlineIcon />}
                                    onClick={() => setDeleteDialogOpen(true)}
                                    disabled={!selectedCustomer || !canDelete}
                                >
                                    删除客户
                                </Button>
                            </Stack>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                                <Typography variant="caption" color="text.secondary">数据导入时间</Typography>
                                <Typography variant="subtitle1" fontWeight={700}>
                                    {selectedCustomer?.last_imported_at ? format(parseISO(selectedCustomer.last_imported_at), 'yyyy-MM-dd HH:mm') : '暂无导入记录'}
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>
                </Paper>

                {pageMessage && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setPageMessage(null)}>{pageMessage}</Alert>}
                {pageError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPageError(null)}>{pageError}</Alert>}

                <Paper variant="outlined" sx={{ borderColor: 'divider' }}>
                    <Tabs value={activeTab} onChange={(_, value) => setActiveTab(value)} variant="scrollable" scrollButtons="auto">
                        <Tab label="客户负荷数据" value="load" />
                        <Tab label="批发结算模拟" value="wholesale" />
                        <Tab label="零售套餐分析" value="retail" />
                    </Tabs>
                </Paper>

                <TabPanel value={activeTab} index="load">
                    {!selectedCustomer ? (
                        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                            <Typography color="text.secondary">请先新增或选择意向客户。</Typography>
                        </Paper>
                    ) : (
                        <Stack spacing={2}>
                            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                                <Stack
                                    direction={{ xs: 'column', md: 'row' }}
                                    justifyContent="space-between"
                                    alignItems={{ xs: 'flex-start', md: 'center' }}
                                    spacing={1.5}
                                    sx={{ mb: 2 }}
                                >
                                    <Stack direction="row" alignItems="center" spacing={1}>
                                        <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                        <Typography variant="h6" fontSize="1rem" fontWeight="bold">负荷汇总与完整性信息</Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                        <Chip label={`电表数 ${selectedCustomer.meter_count}`} color="primary" variant="outlined" size="small" />
                                        <Chip
                                            label={`最近聚合 ${selectedCustomer.last_aggregated_at ? format(parseISO(selectedCustomer.last_aggregated_at), 'MM-dd HH:mm') : '-'}`}
                                            color="success"
                                            variant="outlined"
                                            size="small"
                                        />
                                        <Chip label={`缺失天数 ${selectedCustomer.missing_days}`} color="warning" variant="outlined" size="small" />
                                    </Stack>
                                </Stack>

                                <Grid container spacing={{ xs: 1, sm: 2 }}>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="数据范围" value={coverageSummary?.dateRange || '-'} />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="覆盖范围" value={coverageSummary?.rangeText || '-'} />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="缺失天数" value={`${selectedCustomer.missing_days} 天`} color="warning.main" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="完整率" value={`${selectedCustomer.completeness}%`} color="success.main" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="日均电量" value={`${selectedCustomer.avg_daily_load} MWh`} />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="最大日电量" value={`${selectedCustomer.max_daily_load} MWh`} color="error.main" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="最小日电量" value={`${selectedCustomer.min_daily_load} MWh`} color="info.main" />
                                    </Grid>
                                    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                                        <MetricCard label="缺失电表天数" value={`${selectedCustomer.missing_meter_days} 天`} color="warning.main" />
                                    </Grid>
                                </Grid>

                                <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mt: 0.5 }}>
                                    <Grid size={{ xs: 12, md: 7 }}>
                                        <Paper variant="outlined" sx={{ p: 2, height: '100%', bgcolor: 'action.hover' }}>
                                            <Typography variant="subtitle2" fontWeight={700}>数据诊断提示</Typography>
                                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                                当前页面直接展示聚合后的客户负荷结果。月度柱状图用于查看每日电量走势和缺失天分布，右侧曲线用于查看单日 48 时段负荷结构。
                                            </Typography>
                                        </Paper>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 5 }}>
                                        <Paper variant="outlined" sx={{ p: 2, height: '100%', bgcolor: 'action.hover' }}>
                                            <Typography variant="subtitle2" fontWeight={700}>质量摘要</Typography>
                                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                                                <Chip label={`插值天数 ${selectedCustomer.interpolated_days}`} color="info" variant="outlined" size="small" />
                                                <Chip label={`脏数据天数 ${selectedCustomer.dirty_days}`} color="error" variant="outlined" size="small" />
                                                <Chip label={`缺失电表天数 ${selectedCustomer.missing_meter_days}`} color="warning" variant="outlined" size="small" />
                                            </Stack>
                                        </Paper>
                                    </Grid>
                                </Grid>
                            </Paper>

                            <Grid container spacing={{ xs: 1, sm: 2 }}>
                                <Grid size={{ xs: 12, lg: 7 }}>
                                    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
                                            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
                                                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                                <Typography variant="h6" fontSize="1rem" fontWeight="bold">月度日电量曲线</Typography>
                                                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                                                    月电量 {monthTotalLoad.toFixed(2)} MWh
                                                </Typography>
                                            </Stack>
                                            <DatePicker
                                                views={['year', 'month']}
                                                openTo="month"
                                                label="选择月份"
                                                value={selectedMonth}
                                                onChange={(value) => {
                                                    if (value) {
                                                        const nextMonth = startOfMonth(value);
                                                        setSelectedMonth(nextMonth);
                                                        setSelectedDay(nextMonth);
                                                    }
                                                }}
                                                slotProps={{ textField: { size: 'small', sx: { width: { xs: '150px', sm: '200px' } } } }}
                                            />
                                        </Stack>

                                        <Box
                                            ref={monthlyChartRef}
                                            sx={{
                                                height: { xs: 420, sm: 470 },
                                                position: 'relative',
                                                backgroundColor: isMonthFullscreen ? 'background.paper' : 'transparent',
                                                p: isMonthFullscreen ? 2 : 0,
                                                ...(isMonthFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                                            }}
                                        >
                                            <MonthFullscreenEnterButton />
                                            <MonthFullscreenExitButton />
                                            <MonthFullscreenTitle />

                                            {dataLoading && (
                                                <Box
                                                    sx={{
                                                        position: 'absolute',
                                                        inset: 0,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: 'rgba(255,255,255,0.65)',
                                                        zIndex: 1000
                                                    }}
                                                >
                                                    <CircularProgress />
                                                </Box>
                                            )}

                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={monthData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                                    <YAxis />
                                                    <RechartsTooltip />
                                                    <Legend />
                                                    <Bar
                                                        dataKey="totalLoad"
                                                        name="日电量"
                                                        radius={[4, 4, 0, 0]}
                                                        onClick={(payload: unknown) => {
                                                            const point = payload as { payload?: DailyPoint };
                                                            if (point.payload) {
                                                                setSelectedDay(point.payload.date);
                                                            }
                                                        }}
                                                    >
                                                        {monthData.map((entry) => (
                                                            <Cell
                                                                key={entry.rawDate}
                                                                fill={
                                                                    entry.isMissing
                                                                        ? '#f59e0b'
                                                                        : (selectedDay && isSameDay(entry.date, selectedDay)
                                                                            ? '#1976d2'
                                                                            : entry.isWeekend
                                                                                ? '#4caf50'
                                                                                : '#8caac4')
                                                                }
                                                            />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    </Paper>
                                </Grid>

                                <Grid size={{ xs: 12, lg: 5 }}>
                                    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                                        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ mb: 2 }}>
                                            <Stack direction="row" alignItems="center" spacing={1}>
                                                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                                                <Typography variant="h6" fontSize="1rem" fontWeight="bold">日内 48 时段负荷</Typography>
                                            </Stack>
                                            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                                                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                                    当日电量 {selectedDayTotal.toFixed(2)} MWh
                                                </Typography>
                                                <Stack direction="row" spacing={1} alignItems="center">
                                                    <IconButton onClick={() => handleDayShift(-1)} disabled={dataLoading}><ArrowLeftIcon /></IconButton>
                                                    <DatePicker
                                                        label="选择日期"
                                                        value={selectedDay}
                                                        onChange={(value) => value && setSelectedDay(value)}
                                                        disabled={dataLoading}
                                                        slotProps={{ textField: { size: 'small', sx: { width: { xs: '150px', sm: '200px' } } } }}
                                                    />
                                                    <IconButton onClick={() => handleDayShift(1)} disabled={dataLoading}><ArrowRightIcon /></IconButton>
                                                </Stack>
                                            </Stack>
                                        </Stack>

                                        <Box
                                            ref={dailyChartRef}
                                            sx={{
                                                height: { xs: 420, sm: 470 },
                                                position: 'relative',
                                                backgroundColor: isDayFullscreen ? 'background.paper' : 'transparent',
                                                p: isDayFullscreen ? 2 : 0,
                                                ...(isDayFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                                            }}
                                        >
                                            <DayFullscreenEnterButton />
                                            <DayFullscreenExitButton />
                                            <DayFullscreenTitle />
                                            <DayNavigationButtons />

                                            {dataLoading && (
                                                <Box
                                                    sx={{
                                                        position: 'absolute',
                                                        inset: 0,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: 'rgba(255,255,255,0.65)',
                                                        zIndex: 1000
                                                    }}
                                                >
                                                    <CircularProgress />
                                                </Box>
                                            )}

                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={intradayData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="time" tick={{ fontSize: 11 }} interval={3} />
                                                    <YAxis />
                                                    <RechartsTooltip />
                                                    <Legend />
                                                    <Line type="monotone" dataKey="load" name="48时段负荷" stroke="#ef6c00" strokeWidth={2.5} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    </Paper>
                                </Grid>
                            </Grid>
                        </Stack>
                    )}
                </TabPanel>

                <TabPanel value={activeTab} index="wholesale">
                    <WholesaleSimulationTab selectedCustomer={selectedCustomer} canEdit={canEdit} />
                </TabPanel>

                <TabPanel value={activeTab} index="retail">
                    <IntentRetailSimulationTab selectedCustomer={selectedCustomer} canEdit={canEdit} canDelete={canDelete} />
                </TabPanel>

                <ImportDialog
                    open={importDialogOpen}
                    selectedCustomer={selectedCustomer}
                    onClose={() => setImportDialogOpen(false)}
                    onImported={(customerId, message) => {
                        void handleImportSuccess(customerId, message);
                    }}
                />
                <DeleteDialog
                    open={deleteDialogOpen}
                    customerName={selectedCustomer?.customer_name}
                    onClose={() => setDeleteDialogOpen(false)}
                    onConfirm={handleDeleteConfirm}
                />
            </Box>
        </LocalizationProvider>
    );
};

export default IntentCustomerDiagnosisPage;
