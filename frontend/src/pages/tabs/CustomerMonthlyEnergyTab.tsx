import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, CircularProgress,
    Alert, Dialog, DialogTitle, DialogContent, DialogContentText,
    DialogActions, IconButton, Select, MenuItem, FormControl,
    InputLabel, SelectChangeEvent, Snackbar
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import apiClient from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

interface CustomerEnergyRecord {
    customer_no: string;
    customer_name: string;
    mp_no: string;
    energy_mwh: number;
    auth_status: string;
    auth_end_date: string;
}

interface MonthMeta {
    _id: string;
    month: string;
}

interface MonthData {
    month: string;
    records: CustomerEnergyRecord[];
}

const formatMpNo = (value?: string): string => {
    if (!value) return '—';
    const trimmed = String(value).trim();
    return trimmed.replace(/^(\d+)\.0+$/, '$1');
};

const CustomerMonthlyEnergyTab: React.FC = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:basic_monthly_manual_import:edit');
    const [months, setMonths] = useState<MonthMeta[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [monthData, setMonthData] = useState<MonthData | null>(null);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
        open: false, msg: '', severity: 'success'
    });

    const fetchMonths = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await apiClient.get('/api/v1/customer-energy');
            const list: MonthMeta[] = res.data.months || [];
            setMonths(list);
            if (list.length > 0 && !selectedMonth) {
                setSelectedMonth(list[0]._id);
            }
        } catch (e: any) {
            setError(e.response?.data?.detail || e.message || '加载列表失败');
        } finally {
            setLoadingList(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { fetchMonths(); }, [fetchMonths]);

    useEffect(() => {
        if (!selectedMonth) return;
        setLoadingDetail(true);
        setError(null);
        apiClient.get(`/api/v1/customer-energy/${selectedMonth}`)
            .then(res => setMonthData(res.data))
            .catch(e => setError(e.response?.data?.detail || e.message || '加载详情失败'))
            .finally(() => setLoadingDetail(false));
    }, [selectedMonth]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!canEdit) return;
        const f = e.target.files?.[0] || null;
        setImportFile(f);
        if (f) {
            setImportDialogOpen(true);
        }
    };

    const handleImport = async () => {
        if (!canEdit) return;
        if (!importFile) return;
        setImporting(true);
        const formData = new FormData();
        formData.append('file', importFile);
        try {
            const res = await apiClient.post('/api/v1/customer-energy/import', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const { month } = res.data;
            setSnackbar({ open: true, msg: `月份 ${month} 数据导入成功`, severity: 'success' });
            setImportDialogOpen(false);
            setImportFile(null);
            await fetchMonths();
            setSelectedMonth(month);
        } catch (e: any) {
            setSnackbar({ open: true, msg: e.response?.data?.detail || e.message || '导入失败', severity: 'error' });
        } finally {
            setImporting(false);
        }
    };

    const handleDelete = async () => {
        if (!canEdit) return;
        if (!selectedMonth) return;
        setDeleting(true);
        try {
            await apiClient.delete(`/api/v1/customer-energy/${selectedMonth}`);
            setSnackbar({ open: true, msg: `月份 ${selectedMonth} 数据已删除`, severity: 'success' });
            setDeleteDialogOpen(false);
            setMonthData(null);
            const remaining = months.filter(m => m._id !== selectedMonth);
            setMonths(remaining);
            setSelectedMonth(remaining.length > 0 ? remaining[0]._id : '');
        } catch (e: any) {
            setSnackbar({ open: true, msg: e.response?.data?.detail || '删除失败', severity: 'error' });
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Box>
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {months.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>选择月份</InputLabel>
                        <Select
                            value={selectedMonth}
                            label="选择月份"
                            onChange={(e: SelectChangeEvent) => setSelectedMonth(e.target.value)}
                        >
                            {months.map(m => (
                                <MenuItem key={m._id} value={m._id}>{m.month}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                <Box sx={{ flexGrow: 1 }} />

                <Button variant="contained" startIcon={<UploadFileIcon />} component="label" disabled={!canEdit}>
                    导入月度结算电量
                    <input type="file" hidden accept=".xlsx,.xls" onChange={handleFileChange} />
                </Button>

                {selectedMonth && (
                    <IconButton color="error" size="small" onClick={() => setDeleteDialogOpen(true)} title={`删除 ${selectedMonth} 数据`} disabled={!canEdit}>
                        <DeleteOutlineIcon />
                    </IconButton>
                )}
            </Paper>

            {loadingList && <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {!loadingList && months.length === 0 && (
                <Alert severity="info">暂无客户结算月度电量数据，请点击导入。</Alert>
            )}

            {selectedMonth && !loadingList && (
                loadingDetail
                    ? <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
                    : monthData && (
                        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                客户结算月度电量
                            </Typography>
                            <TableContainer sx={{ overflowX: 'auto', maxHeight: 500 }}>
                                <Table stickyHeader size="small" sx={{ '& .MuiTableCell-root': { fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: { xs: 1, sm: 2 } } }}>
                                    <TableHead>
                                        <TableRow sx={{ '& th': { bgcolor: 'background.paper', zIndex: 1 } }}>
                                            <TableCell>序号</TableCell>
                                            <TableCell>户名</TableCell>
                                            <TableCell>户号</TableCell>
                                            <TableCell>计量点号</TableCell>
                                            <TableCell align="right">用电量 (MWh)</TableCell>
                                            <TableCell>授权状态</TableCell>
                                            <TableCell>授权结束日期</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {monthData.records.map((r, idx) => (
                                            <TableRow key={idx} hover>
                                                <TableCell>{idx + 1}</TableCell>
                                                <TableCell>{r.customer_name}</TableCell>
                                                <TableCell>{r.customer_no}</TableCell>
                                                <TableCell>{formatMpNo(r.mp_no)}</TableCell>
                                                <TableCell align="right">
                                                    {r.auth_status === '已授权' ? (r.energy_mwh?.toFixed(3) ?? '0.000') : '—'}
                                                </TableCell>
                                                <TableCell>{r.auth_status || '—'}</TableCell>
                                                <TableCell>{r.auth_end_date || '—'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Paper>
                    )
            )}

            <Dialog open={importDialogOpen} onClose={() => !importing && setImportDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>确认导入数据</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        即将导入：<strong>{importFile?.name}</strong>
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setImportDialogOpen(false)} disabled={importing}>取消</Button>
                    <Button onClick={handleImport} variant="contained" disabled={importing || !canEdit} startIcon={importing ? <CircularProgress size={16} /> : undefined}>
                        {importing ? '导入中...' : '确认导入'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
                <DialogTitle>删除确认</DialogTitle>
                <DialogContent>
                    <DialogContentText>确定删除月份 <strong>{selectedMonth}</strong> 的数据？不可撤销。</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>取消</Button>
                    <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting || !canEdit} startIcon={deleting ? <CircularProgress size={16} /> : undefined}>
                        {deleting ? '删除中...' : '确认删除'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default CustomerMonthlyEnergyTab;
