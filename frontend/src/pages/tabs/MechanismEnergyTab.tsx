import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, CircularProgress,
    Alert, Dialog, DialogTitle, DialogContent, DialogContentText,
    DialogActions, Snackbar
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import apiClient from '../../api/client';

interface MonthMeta {
    _id: string;
    month: string;
    period_values?: number[];
}

const MechanismEnergyTab: React.FC = () => {
    const [months, setMonths] = useState<MonthMeta[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 导入对话框
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);

    // 反馈
    const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
        open: false, msg: '', severity: 'success'
    });

    const fetchMonths = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await apiClient.get('/api/v1/mechanism-energy');
            const list: MonthMeta[] = res.data.months || [];
            setMonths(list);
        } catch (e: any) {
            setError(e.response?.data?.detail || e.message || '加载列表失败');
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => { fetchMonths(); }, [fetchMonths]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0] || null;
        setImportFile(f);
        if (f) {
            setImportDialogOpen(true);
        }
    };

    const handleImport = async () => {
        if (!importFile) return;
        setImporting(true);
        const formData = new FormData();
        formData.append('file', importFile);
        try {
            const res = await apiClient.post('/api/v1/mechanism-energy/import', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const { count } = res.data;
            setSnackbar({ open: true, msg: `机制电量提取成功，本次共提取 ${count} 个月份`, severity: 'success' });
            setImportDialogOpen(false);
            setImportFile(null);
            await fetchMonths();

            // 选完月份清空一下 file input 的 value，允许重新选择相同文件
            const fileInput = document.getElementById('mechanism-file-upload') as HTMLInputElement;
            if (fileInput) fileInput.value = '';

        } catch (e: any) {
            setSnackbar({ open: true, msg: e.response?.data?.detail || e.message || '导入失败', severity: 'error' });
        } finally {
            setImporting(false);
        }
    };

    // 生成表头 1..48
    const renderTableHeaders = () => {
        const headers = [];
        for (let i = 1; i <= 48; i++) {
            headers.push(
                <TableCell key={`hdr-${i}`} align="right" sx={{ minWidth: 60, whiteSpace: 'nowrap' }}>
                    {i}
                </TableCell>
            );
        }
        return headers;
    };

    return (
        <Box>
            {/* 工具栏 */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" fontWeight={600}>机制电量分配明细</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button variant="contained" startIcon={<UploadFileIcon />} component="label">
                    导入机制电量数据文件
                    <input id="mechanism-file-upload" type="file" hidden accept=".xlsx,.xls" onChange={handleFileChange} />
                </Button>
            </Paper>

            {loadingList && <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {!loadingList && months.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>暂无机制电量明细数据，请点击导入。</Alert>
            )}

            {/* 机制电量全量表格展示 */}
            {!loadingList && months.length > 0 && (
                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                    <TableContainer sx={{ overflowX: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
                        <Table stickyHeader size="small" sx={{
                            '& .MuiTableCell-root': { fontSize: { xs: '0.75rem', sm: '0.875rem' }, px: 1, py: 1.5, borderRight: '1px solid #eee' }
                        }}>
                            <TableHead>
                                <TableRow sx={{ '& th': { bgcolor: 'action.hover' } }}>
                                    <TableCell sx={{ minWidth: 100, fontWeight: 600 }}>年月</TableCell>
                                    {renderTableHeaders()}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {months.map(m => (
                                    <TableRow key={m._id} hover>
                                        <TableCell sx={{ fontWeight: 600, position: 'sticky', left: 0, bgcolor: 'background.paper', borderRight: '2px solid #ddd' }}>
                                            {m.month}
                                        </TableCell>
                                        {(m.period_values || []).map((val, idx) => (
                                            <TableCell key={`col-${idx}`} align="right">
                                                {val?.toFixed(3) ?? '—'}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            )}

            {/* 导入确认对话框 */}
            <Dialog open={importDialogOpen} onClose={() => !importing && setImportDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>确认导入数据</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        即将从 <strong>{importFile?.name}</strong> 中导入机制电量数据。
                        <br /><br />
                        <em>注意：文件如包含多月数据将一并导入，如果月份相同将会覆盖已有数据。</em>
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setImportDialogOpen(false)} disabled={importing}>取消</Button>
                    <Button onClick={handleImport} variant="contained" disabled={importing} startIcon={importing ? <CircularProgress size={16} /> : undefined}>
                        {importing ? '导入中...' : '确认导入'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default MechanismEnergyTab;
