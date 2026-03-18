import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import {
    calculateIntentRetailSimulation,
    deleteIntentRetailSimulationPackage,
    getIntentCustomerWholesaleSimulation,
    getIntentRetailSimulationDetail,
    IntentCustomerSummary,
    IntentRetailCalculatedPackageItem,
    IntentRetailMonthResultRow,
    IntentRetailPackageOption,
    IntentRetailSimulationDetail,
    listIntentRetailActivePackages,
    listIntentRetailCalculatedPackages,
    listIntentRetailMonthResults,
} from '../../api/intentCustomerDiagnosis';
import IntentRetailSimulationDetailPanel from './IntentRetailSimulationDetailPanel';

const TEXT = {
    selectCustomer: '\u8bf7\u5148\u9009\u62e9\u610f\u5411\u5ba2\u6237',
    loadPackagesError: '\u52a0\u8f7d\u5df2\u8ba1\u7b97\u5957\u9910\u5931\u8d25',
    loadMonthsError: '\u52a0\u8f7d\u6708\u4efd\u7ed3\u7b97\u7ed3\u679c\u5931\u8d25',
    loadDetailError: '\u52a0\u8f7d\u96f6\u552e\u7ed3\u7b97\u8be6\u60c5\u5931\u8d25',
    noWholesale: '\u5f53\u524d\u5ba2\u6237\u8fd8\u6ca1\u6709\u6279\u53d1\u4fa7\u6a21\u62df\u7ed3\u679c\uff0c\u8bf7\u5148\u5b8c\u6210\u6279\u53d1\u7ed3\u7b97\u6a21\u62df',
    loadDialogError: '\u52a0\u8f7d\u5957\u9910\u5217\u8868\u5931\u8d25',
    calcError: '\u6267\u884c\u96f6\u552e\u7ed3\u7b97\u6a21\u62df\u5931\u8d25',
    calculatedPackages: '\u5df2\u8ba1\u7b97\u5957\u9910',
    calculatedPackagesHint: '\u70b9\u51fb\u5957\u9910\u540d\u79f0\u540e\uff0c\u4e0b\u65b9\u6708\u4efd\u7ed3\u7b97\u7ed3\u679c\u548c\u6708\u5ea6\u7ed3\u7b97\u8be6\u60c5\u4f1a\u540c\u6b65\u5207\u6362\u5230\u5bf9\u5e94\u5957\u9910\u3002',
    addPackageCalc: '\u589e\u52a0\u5957\u9910\u7ed3\u7b97',
    emptyPackages: '\u5f53\u524d\u5ba2\u6237\u5c1a\u672a\u751f\u6210\u96f6\u552e\u7ed3\u7b97\u6a21\u62df\u7ed3\u679c\uff0c\u8bf7\u70b9\u51fb\u201c\u589e\u52a0\u5957\u9910\u7ed3\u7b97\u201d\u3002',
    monthResults: '\u6708\u4efd\u7ed3\u7b97\u7ed3\u679c',
    colMonth: '\u7ed3\u7b97\u6708\u4efd',
    colEnergy: '\u603b\u7535\u91cf(MWh)',
    colWholesalePrice: '\u6279\u53d1\u5355\u4ef7(\u5143/MWh)',
    colWholesaleAmount: '\u6279\u53d1\u91d1\u989d(\u5143)',
    colRetailPrice: '\u96f6\u552e\u5355\u4ef7(\u5143/MWh)',
    colRetailAmount: '\u96f6\u552e\u91d1\u989d(\u5143)',
    colProfit: '\u6708\u6bdb\u5229(\u5143)',
    colSpread: '\u6279\u96f6\u4ef7\u5dee(\u5143/MWh)',
    noMonthRows: '\u6682\u65e0\u6708\u4efd\u7ed3\u7b97\u7ed3\u679c',
    detailTitle: '\u6708\u5ea6\u7ed3\u7b97\u8be6\u60c5',
    dialogInfo: '\u5957\u9910\u4e0b\u62c9\u6846\u5c55\u793a\u5f53\u524d\u6240\u6709\u72b6\u6001\u4e3a\u6d3b\u8dc3\u7684\u96f6\u552e\u5957\u9910\uff1b\u70b9\u51fb\u201c\u5f00\u59cb\u8ba1\u7b97\u201d\u540e\u4f1a\u81ea\u52a8\u5bf9\u8be5\u5ba2\u6237\u6240\u6709\u5df2\u5b8c\u6210\u6279\u53d1\u6a21\u62df\u7684\u6708\u4efd\u6267\u884c\u96f6\u552e\u7ed3\u7b97\u3002',
    selectPackage: '\u9009\u62e9\u5957\u9910',
    cancel: '\u53d6\u6d88',
    calculating: '\u8ba1\u7b97\u4e2d...',
    submit: '\u5f00\u59cb\u8ba1\u7b97',
    deletePackageTitle: '\u5220\u9664\u5df2\u8ba1\u7b97\u5957\u9910',
    deletePackageConfirm: '\u786e\u5b9a\u5220\u9664\u5957\u9910\u201c{package}\u201d\u7684\u96f6\u552e\u7ed3\u7b97\u7ed3\u679c\u5417\uff1f',
    deletePackageHint: '\u5c06\u5220\u9664\u8be5\u610f\u5411\u5ba2\u6237\u4e0b\u8be5\u5957\u9910\u6240\u6709\u5df2\u8ba1\u7b97\u6708\u4efd\u7684\u96f6\u552e\u6a21\u62df\u7ed3\u679c\uff0c\u4e0d\u5f71\u54cd\u6279\u53d1\u6a21\u62df\u7ed3\u679c\u3002',
    deleting: '\u5220\u9664\u4e2d...',
    confirmDelete: '\u786e\u8ba4\u5220\u9664',
    deleteError: '\u5220\u9664\u5df2\u8ba1\u7b97\u5957\u9910\u5931\u8d25',
};

const formatYuan = (val: number): string =>
    val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMwh = (val: number): string =>
    val.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatPrice = (val: number): string =>
    val.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const profitColor = (val: number): string => (val >= 0 ? '#2e7d32' : '#d32f2f');

const formatText = (template: string, values: Record<string, string>): string =>
    Object.entries(values).reduce(
        (result, [key, value]) => result.replace(`{${key}}`, value),
        template
    );

const getErrorMessage = (error: any, fallback: string): string => {
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
        return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
        return detail
            .map((item) => {
                if (typeof item === 'string') {
                    return item;
                }
                if (item && typeof item === 'object') {
                    return item.msg || JSON.stringify(item);
                }
                return String(item);
            })
            .join('?');
    }
    if (detail && typeof detail === 'object') {
        return detail.msg || JSON.stringify(detail);
    }
    if (typeof error?.message === 'string' && error.message.trim()) {
        return error.message;
    }
    return fallback;
};

interface Props {
    selectedCustomer: IntentCustomerSummary | null;
}

const IntentRetailSimulationTab: React.FC<Props> = ({ selectedCustomer }) => {
    const [packages, setPackages] = useState<IntentRetailCalculatedPackageItem[]>([]);
    const [packagesLoading, setPackagesLoading] = useState(false);
    const [activePackageId, setActivePackageId] = useState<string | null>(null);

    const [monthRows, setMonthRows] = useState<IntentRetailMonthResultRow[]>([]);
    const [monthRowsLoading, setMonthRowsLoading] = useState(false);
    const [activeMonth, setActiveMonth] = useState<string | null>(null);

    const [detail, setDetail] = useState<IntentRetailSimulationDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [activePackageOptions, setActivePackageOptions] = useState<IntentRetailPackageOption[]>([]);
    const [packageOptionsLoading, setPackageOptionsLoading] = useState(false);
    const [selectedPackageOption, setSelectedPackageOption] = useState<IntentRetailPackageOption | null>(null);
    const [submitLoading, setSubmitLoading] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState<IntentRetailCalculatedPackageItem | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const [pageError, setPageError] = useState<string | null>(null);

    const activePackage = useMemo(
        () => packages.find((item) => item.package_id === activePackageId) || null,
        [packages, activePackageId]
    );

    useEffect(() => {
        setPackages([]);
        setActivePackageId(null);
        setMonthRows([]);
        setActiveMonth(null);
        setDetail(null);
        setDetailError(null);
        setPageError(null);

        if (!selectedCustomer) {
            return;
        }

        const loadPackages = async () => {
            setPackagesLoading(true);
            try {
                const items = await listIntentRetailCalculatedPackages(selectedCustomer.id);
                setPackages(items);
                setActivePackageId((current) =>
                    current && items.some((item) => item.package_id === current)
                        ? current
                        : (items[0]?.package_id || null)
                );
            } catch (error: any) {
                setPageError(getErrorMessage(error, TEXT.loadPackagesError));
            } finally {
                setPackagesLoading(false);
            }
        };

        void loadPackages();
    }, [selectedCustomer]);

    useEffect(() => {
        if (!selectedCustomer || !activePackageId) {
            setMonthRows([]);
            setActiveMonth(null);
            setDetail(null);
            return;
        }

        const loadMonths = async () => {
            setMonthRowsLoading(true);
            setPageError(null);
            try {
                const response = await listIntentRetailMonthResults(selectedCustomer.id, activePackageId);
                setMonthRows(response.rows);
                setActiveMonth((current) =>
                    current && response.rows.some((item) => item.settlement_month === current)
                        ? current
                        : (response.rows[0]?.settlement_month || null)
                );
            } catch (error: any) {
                setMonthRows([]);
                setActiveMonth(null);
                setPageError(getErrorMessage(error, TEXT.loadMonthsError));
            } finally {
                setMonthRowsLoading(false);
            }
        };

        void loadMonths();
    }, [selectedCustomer, activePackageId]);

    useEffect(() => {
        if (!selectedCustomer || !activePackageId || !activeMonth) {
            setDetail(null);
            return;
        }

        const loadDetail = async () => {
            setDetailLoading(true);
            setDetailError(null);
            try {
                const response = await getIntentRetailSimulationDetail(
                    selectedCustomer.id,
                    activePackageId,
                    activeMonth
                );
                setDetail(response);
            } catch (error: any) {
                setDetail(null);
                setDetailError(getErrorMessage(error, TEXT.loadDetailError));
            } finally {
                setDetailLoading(false);
            }
        };

        void loadDetail();
    }, [selectedCustomer, activePackageId, activeMonth]);

    const loadDialogData = async () => {
        if (!selectedCustomer) {
            return;
        }
        setDialogOpen(true);
        setSelectedPackageOption(null);
        setPageError(null);
        setPackageOptionsLoading(true);
        try {
            const [packageItems, wholesale] = await Promise.all([
                listIntentRetailActivePackages(),
                getIntentCustomerWholesaleSimulation(selectedCustomer.id),
            ]);
            if (wholesale.summary_rows.length === 0) {
                throw new Error(TEXT.noWholesale);
            }
            setActivePackageOptions(packageItems);
        } catch (error: any) {
            setPageError(getErrorMessage(error, TEXT.loadDialogError));
        } finally {
            setPackageOptionsLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!selectedCustomer || !selectedPackageOption) {
            return;
        }
        setSubmitLoading(true);
        try {
            const result = await calculateIntentRetailSimulation(
                selectedCustomer.id,
                selectedPackageOption.package_id
            );
            const refreshedPackages = await listIntentRetailCalculatedPackages(selectedCustomer.id);
            setPackages(refreshedPackages);
            setActivePackageId(result.package_id);
            const monthResponse = await listIntentRetailMonthResults(selectedCustomer.id, result.package_id);
            setMonthRows(monthResponse.rows);
            setActiveMonth(result.settlement_month);
            setDetail(result);
            setDialogOpen(false);
        } catch (error: any) {
            setPageError(getErrorMessage(error, TEXT.calcError));
        } finally {
            setSubmitLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedCustomer || !deleteTarget) {
            return;
        }
        setDeleteLoading(true);
        try {
            await deleteIntentRetailSimulationPackage(selectedCustomer.id, deleteTarget.package_id);
            const refreshedPackages = await listIntentRetailCalculatedPackages(selectedCustomer.id);
            setPackages(refreshedPackages);
            if (deleteTarget.package_id === activePackageId) {
                const nextPackageId = refreshedPackages[0]?.package_id || null;
                setActivePackageId(nextPackageId);
                if (!nextPackageId) {
                    setMonthRows([]);
                    setActiveMonth(null);
                    setDetail(null);
                    setDetailError(null);
                }
            }
            setDeleteTarget(null);
        } catch (error: any) {
            setPageError(getErrorMessage(error, TEXT.deleteError));
        } finally {
            setDeleteLoading(false);
        }
    };

    if (!selectedCustomer) {
        return <Alert severity="info">{TEXT.selectCustomer}</Alert>;
    }

    return (
        <Stack spacing={2}>
            {pageError ? <Alert severity="error">{pageError}</Alert> : null}

            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'stretch', md: 'center' }}
                    spacing={1.5}
                >
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold">{TEXT.calculatedPackages}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {TEXT.calculatedPackagesHint}
                        </Typography>
                    </Box>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => void loadDialogData()}>
                        {TEXT.addPackageCalc}
                    </Button>
                </Stack>

                <Box sx={{ mt: 2 }}>
                    {packagesLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : packages.length > 0 ? (
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {packages.map((item) => (
                                <Chip
                                    key={item.package_id}
                                    label={item.package_name}
                                    clickable
                                    color={item.package_id === activePackageId ? 'primary' : 'default'}
                                    variant={item.package_id === activePackageId ? 'filled' : 'outlined'}
                                    onClick={() => setActivePackageId(item.package_id)}
                                    onDelete={() => setDeleteTarget(item)}
                                    deleteIcon={<CloseIcon />}
                                />
                            ))}
                        </Stack>
                    ) : (
                        <Alert severity="info">{TEXT.emptyPackages}</Alert>
                    )}
                </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                <Typography variant="subtitle1" fontWeight="bold">
                    {TEXT.monthResults}{activePackage ? ` - ${activePackage.package_name}` : ''}
                </Typography>
                <TableContainer sx={{ mt: 1.5, overflowX: 'auto' }}>
                    <Table
                        size="small"
                        sx={{
                            '& .MuiTableCell-root': {
                                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                px: { xs: 0.5, sm: 1.5 },
                            },
                        }}
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell>{TEXT.colMonth}</TableCell>
                                <TableCell align="right">{TEXT.colEnergy}</TableCell>
                                <TableCell align="right">{TEXT.colWholesalePrice}</TableCell>
                                <TableCell align="right">{TEXT.colWholesaleAmount}</TableCell>
                                <TableCell align="right">{TEXT.colRetailPrice}</TableCell>
                                <TableCell align="right">{TEXT.colRetailAmount}</TableCell>
                                <TableCell align="right">{TEXT.colProfit}</TableCell>
                                <TableCell align="right">{TEXT.colSpread}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {monthRowsLoading ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                                        <CircularProgress size={24} />
                                    </TableCell>
                                </TableRow>
                            ) : monthRows.length > 0 ? (
                                monthRows.map((row) => (
                                    <TableRow
                                        key={row.settlement_month}
                                        hover
                                        selected={row.settlement_month === activeMonth}
                                        onClick={() => setActiveMonth(row.settlement_month)}
                                        sx={{ cursor: 'pointer' }}
                                    >
                                        <TableCell>{row.settlement_month}</TableCell>
                                        <TableCell align="right">{formatMwh(row.total_energy_mwh)}</TableCell>
                                        <TableCell align="right">{formatPrice(row.wholesale_unit_price)}</TableCell>
                                        <TableCell align="right">{formatYuan(row.wholesale_amount)}</TableCell>
                                        <TableCell align="right">{formatPrice(row.retail_unit_price)}</TableCell>
                                        <TableCell align="right">{formatYuan(row.retail_amount)}</TableCell>
                                        <TableCell align="right" sx={{ color: profitColor(row.monthly_gross_profit), fontWeight: 700 }}>
                                            {formatYuan(row.monthly_gross_profit)}
                                        </TableCell>
                                        <TableCell align="right" sx={{ color: profitColor(row.price_spread_per_mwh), fontWeight: 700 }}>
                                            {formatPrice(row.price_spread_per_mwh)}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                                        <Typography variant="body2" color="text.secondary">{TEXT.noMonthRows}</Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1.5 }}>
                    {TEXT.detailTitle}{detail ? ` - ${detail.package_name} / ${detail.settlement_month}` : ''}
                </Typography>
                <IntentRetailSimulationDetailPanel detail={detail} loading={detailLoading} error={detailError} />
            </Paper>

            <Dialog open={dialogOpen} onClose={submitLoading ? undefined : () => setDialogOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>{TEXT.addPackageCalc}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        {packageOptionsLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                <CircularProgress size={24} />
                            </Box>
                        ) : (
                            <>
                                <Alert severity="info">{TEXT.dialogInfo}</Alert>
                                <Autocomplete
                                    options={activePackageOptions}
                                    value={selectedPackageOption}
                                    onChange={(_, value) => setSelectedPackageOption(value)}
                                    getOptionLabel={(option) => option.package_name}
                                    renderInput={(params) => <TextField {...params} label={TEXT.selectPackage} />}
                                />
                            </>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)} disabled={submitLoading}>{TEXT.cancel}</Button>
                    <Button
                        variant="contained"
                        onClick={() => void handleSubmit()}
                        disabled={submitLoading || !selectedPackageOption}
                    >
                        {submitLoading ? TEXT.calculating : TEXT.submit}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={Boolean(deleteTarget)}
                onClose={deleteLoading ? undefined : () => setDeleteTarget(null)}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>{TEXT.deletePackageTitle}</DialogTitle>
                <DialogContent>
                    <Stack spacing={1.5} sx={{ mt: 1 }}>
                        <Typography variant="body2">
                            {formatText(TEXT.deletePackageConfirm, { package: deleteTarget?.package_name || '' })}
                        </Typography>
                        <Alert severity="warning">{TEXT.deletePackageHint}</Alert>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>{TEXT.cancel}</Button>
                    <Button variant="contained" color="error" onClick={() => void handleDelete()} disabled={deleteLoading}>
                        {deleteLoading ? TEXT.deleting : TEXT.confirmDelete}
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    );
};

export default IntentRetailSimulationTab;
