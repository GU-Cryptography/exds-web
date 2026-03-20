import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Paper, Typography, Button, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, CircularProgress,
    Alert, Dialog, DialogTitle, DialogContent, DialogContentText,
    DialogActions, IconButton, Select, MenuItem, FormControl,
    InputLabel, SelectChangeEvent, Snackbar, useTheme, useMediaQuery,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import apiClient from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

// 类型定义
interface RegularPrice {
    price_type: string;
    price_type_key: string;
    value: number | null;
    definition: string;
}

interface PeriodPrice {
    period: number;
    period_type: string;
    float_ratio: number;
    upper_limit_price: number | null;
    market_monthly_avg: number | null;
    market_annual_avg: number | null;
    market_avg: number | null;
    market_monthly_on_grid: number | null;
    retailer_monthly_avg: number | null;
    retailer_annual_avg: number | null;
    retailer_avg: number | null;
    real_time_avg: number | null;
    day_ahead_avg: number | null;
    genside_annual_bilateral: number | null;
    grid_agency_price: number | null;
}

interface MonthMeta {
    _id: string;
    month: string;
    price_date_type?: 'regular' | 'holiday';
    imported_at: string | null;
    imported_by: string | null;
}

interface PriceDocument {
    _id: string;
    month: string;
    imported_at: string | null;
    imported_by: string | null;
    regular_prices: RegularPrice[];
    period_prices: PeriodPrice[];
}

// 时段类型颜色
const PERIOD_TYPE_COLORS: Record<string, 'default' | 'error' | 'warning' | 'success' | 'info'> = {
    '尖峰': 'error',
    '高峰': 'warning',
    '平段': 'info',
    '低谷': 'success',
};

// 分时价格列定义
const PERIOD_PRICE_COLS: Array<{ key: keyof PeriodPrice; label: string }> = [
    { key: 'upper_limit_price', label: '上限价' },
    { key: 'market_monthly_avg', label: '中长期市场\n月度均价' },
    { key: 'market_annual_avg', label: '中长期市场\n年度均价' },
    { key: 'market_avg', label: '中长期市场\n交易均价' },
    { key: 'market_monthly_on_grid', label: '当月平均\n上网电价' },
    { key: 'retailer_monthly_avg', label: '售电公司\n月度均价' },
    { key: 'retailer_annual_avg', label: '售电公司\n年度均价' },
    { key: 'retailer_avg', label: '售电公司\n交易均价' },
    { key: 'real_time_avg', label: '实时市场均价' },
    { key: 'day_ahead_avg', label: '日前市场均价' },
    { key: 'genside_annual_bilateral', label: '发电侧火电\n年度双边价' },
    { key: 'grid_agency_price', label: '电网代理\n购电价格' },
];

const fmt = (v: number | null, digits = 3) => (v == null ? '-' : v.toFixed(digits));

// 主组件
const RetailSettlementPriceTab: React.FC = () => {
    const theme = useTheme();
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:basic_monthly_manual_import:edit');

    const [months, setMonths] = useState<MonthMeta[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string>('');
    const [priceDoc, setPriceDoc] = useState<PriceDocument | null>(null);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 导入对话框相关
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importDateType, setImportDateType] = useState<'regular' | 'holiday'>('regular');
    const [importing, setImporting] = useState(false);
    const [importExistsWarning, setImportExistsWarning] = useState(false);

    // 删除确认
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // 反馈
    const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
        open: false, msg: '', severity: 'success'
    });

    // 加载月份列表
    const fetchMonths = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await apiClient.get('/api/v1/prices/retail-settlement');
            const list: MonthMeta[] = res.data.months || [];
            setMonths(list);
            if (list.length > 0 && !selectedMonth) {
                setSelectedMonth(list[0]._id);
            }
        } catch (e: any) {
            setError(e.response?.data?.detail || e.message || '加载失败');
        } finally {
            setLoadingList(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { fetchMonths(); }, [fetchMonths]);

    // 加载月份详情
    useEffect(() => {
        if (!selectedMonth) return;
        setLoadingDetail(true);
        setError(null);
        apiClient.get(`/api/v1/prices/retail-settlement/${selectedMonth}`)
            .then(res => setPriceDoc(res.data))
            .catch(e => setError(e.response?.data?.detail || e.message || '加载详情失败'))
            .finally(() => setLoadingDetail(false));
    }, [selectedMonth]);

    // 导入
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!canEdit) return;
        const f = e.target.files?.[0] || null;
        setImportFile(f);
        if (f) {
            // 尝试从文件名解析月份，例如 2026-01，并做初步检查
            const match = f.name.match(/(\d{4}-\d{2})/);
            if (match) {
                const filledMonth = match[1];
                // 默认根据文件名是否包含“节假日/深谷”预设日期类型
                const isHolidayFile = f.name.includes('节假日') || f.name.includes('深谷');
                const type = isHolidayFile ? 'holiday' : 'regular';
                setImportDateType(type);

                const targetId = type === 'regular' ? filledMonth : `${filledMonth}-holiday`;
                setImportExistsWarning(months.some(m => m._id === targetId));
            } else {
                setImportExistsWarning(false);
                setImportDateType('regular');
            }
            setImportDialogOpen(true);
        }
    };

    // 监听导入类型变化，更新覆盖预警
    useEffect(() => {
        if (!importFile) return;
        const match = importFile.name.match(/(\d{4}-\d{2})/);
        if (match) {
            const filledMonth = match[1];
            const targetId = importDateType === 'regular' ? filledMonth : `${filledMonth}-holiday`;
            setImportExistsWarning(months.some(m => m._id === targetId));
        }
    }, [importDateType, importFile, months]);

    const handleImport = async () => {
        if (!canEdit) return;
        if (!importFile) return;
        setImporting(true);
        const formData = new FormData();
        formData.append('file', importFile);
        try {
            const res = await apiClient.post(`/api/v1/prices/retail-settlement/import?price_date_type=${importDateType}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const { month } = res.data;
            const targetId = importDateType === 'regular' ? month : `${month}-holiday`;
            setSnackbar({ open: true, msg: `${month} (${importDateType}) 价格数据导入成功`, severity: 'success' });
            setImportDialogOpen(false);
            setImportFile(null);
            await fetchMonths();
            setSelectedMonth(targetId);
        } catch (e: any) {
            setSnackbar({ open: true, msg: e.response?.data?.detail || e.message || '导入失败', severity: 'error' });
        } finally {
            setImporting(false);
        }
    };

    // 删除
    const handleDelete = async () => {
        if (!canEdit) return;
        if (!selectedMonth) return;
        setDeleting(true);
        try {
            await apiClient.delete(`/api/v1/prices/retail-settlement/${selectedMonth}`);
            setSnackbar({ open: true, msg: `月份 ${selectedMonth} 数据已删除`, severity: 'success' });
            setDeleteDialogOpen(false);
            setPriceDoc(null);
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
            {/* 移动端面包屑标题 */}
            {isTablet && (
                <Typography
                    variant="subtitle1"
                    sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
                >
                    基础数据 / 零售结算价格
                </Typography>
            )}

            {/* 顶部工具栏 */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* 月份选择，放在最左侧 */}
                {months.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>选择月份</InputLabel>
                        <Select
                            value={selectedMonth}
                            label="选择月份"
                            onChange={(e: SelectChangeEvent) => setSelectedMonth(e.target.value)}
                        >
                            {months.map(m => (
                                <MenuItem key={m._id} value={m._id}>
                                    {m.month}{m.price_date_type === 'holiday' ? ' (节假日)' : ''}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                <Box sx={{ flexGrow: 1 }} />

                {/* 导入按钮 */}
                <Button
                    variant="contained"
                    startIcon={<UploadFileIcon />}
                    component="label"
                    disabled={!canEdit}
                >
                    导入结算参考价格文件
                    <input type="file" hidden accept=".xlsx,.xls" onChange={handleFileChange} />
                </Button>

                {/* 删除按钮 */}
                {selectedMonth && (
                    <IconButton
                        color="error"
                        size="small"
                        onClick={() => setDeleteDialogOpen(true)}
                        disabled={!canEdit}
                        title="删除数据"
                    >
                        <DeleteOutlineIcon />
                    </IconButton>
                )}
            </Paper>

            {/* 加载 / 错误 / 空状态 */}
            {loadingList && <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {!loadingList && months.length === 0 && (
                <Alert severity="info">暂无价格数据，请点击“导入结算参考价格文件”上传 Excel 文件。</Alert>
            )}

            {/* 价格内容 */}
            {selectedMonth && !loadingList && (
                loadingDetail
                    ? <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
                    : priceDoc && (
                        <>
                            {/* 常规价格表 */}
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2 }}>
                                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                    常规价格（不分时）
                                </Typography>
                                <TableContainer sx={{ overflowX: 'auto' }}>
                                    <Table size="small" sx={{
                                        '& .MuiTableCell-root': {
                                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                            px: { xs: 1, sm: 2 },
                                        }
                                    }}>
                                        <TableHead>
                                            <TableRow sx={{ bgcolor: 'action.hover' }}>
                                                <TableCell sx={{ width: { xs: '120px', sm: '320px' } }}>价格类型</TableCell>
                                                <TableCell align="right" sx={{ width: '120px' }}>价格(元/MWh)</TableCell>
                                                <TableCell>价格定义</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {priceDoc.regular_prices.map((p, idx) => (
                                                <TableRow key={idx} hover>
                                                    <TableCell>
                                                        <Box>
                                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>{p.price_type}</Typography>
                                                            <Typography variant="caption" color="text.secondary"
                                                                sx={{ fontFamily: 'monospace', display: 'block' }}>
                                                                {p.price_type_key}
                                                            </Typography>
                                                        </Box>
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Typography variant="body2" fontWeight={600} color="primary.main">
                                                            {p.value != null ? p.value.toFixed(3) : '-'}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        {p.definition ? (
                                                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                                                                <InfoOutlinedIcon sx={{ fontSize: 16, color: 'info.main', mt: 0.3, flexShrink: 0 }} />
                                                                <Typography variant="body2" color="text.secondary" sx={{ lineBreak: 'anywhere' }}>
                                                                    {p.definition}
                                                                </Typography>
                                                            </Box>
                                                        ) : '-'}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </Paper>

                            {/* 分时价格表 */}
                            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                    分时价格（48时段，元/MWh）
                                </Typography>
                                <TableContainer sx={{ overflowX: 'auto' }}>
                                    <Table size="small" sx={{
                                        '& .MuiTableCell-root': {
                                            fontSize: { xs: '0.7rem', sm: '0.8rem' },
                                            px: { xs: 0.5, sm: 1 },
                                            py: 0.5,
                                            whiteSpace: 'nowrap',
                                        }
                                    }}>
                                        <TableHead>
                                            <TableRow sx={{ bgcolor: 'action.hover' }}>
                                                <TableCell align="center">时段</TableCell>
                                                <TableCell align="center">类型</TableCell>
                                                <TableCell align="center">浮动比例</TableCell>
                                                {PERIOD_PRICE_COLS.map(c => (
                                                    <TableCell key={c.key} align="right" sx={{ whiteSpace: 'pre-line !important' }}>
                                                        {c.label}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {priceDoc.period_prices.map((p) => (
                                                <TableRow key={p.period} hover>
                                                    <TableCell align="center">{p.period}</TableCell>
                                                    <TableCell align="center">
                                                        <Chip
                                                            size="small"
                                                            label={p.period_type}
                                                            color={PERIOD_TYPE_COLORS[p.period_type] || 'default'}
                                                            sx={{ fontSize: '0.7rem', height: 20 }}
                                                        />
                                                    </TableCell>
                                                    <TableCell align="center">{p.float_ratio}</TableCell>
                                                    {PERIOD_PRICE_COLS.map(c => (
                                                        <TableCell key={c.key} align="right">
                                                            {fmt(p[c.key] as number | null)}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </Paper>
                        </>
                    )
            )}

            {/* 导入确认对话框 */}
            <Dialog open={importDialogOpen} onClose={() => !importing && setImportDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>确认导入价格数据</DialogTitle>
                <DialogContent>
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" gutterBottom>
                            即将导入文件：<strong>{importFile?.name}</strong>
                        </Typography>
                    </Box>

                    <FormControl fullWidth size="small" sx={{ mt: 1, mb: 2 }}>
                        <InputLabel>适用日期类型</InputLabel>
                        <Select
                            value={importDateType}
                            label="适用日期类型"
                            onChange={(e) => setImportDateType(e.target.value as any)}
                        >
                            <MenuItem value="regular">常规/默认（工作日及单文件月份）</MenuItem>
                            <MenuItem value="holiday">节假日/深谷（仅价格差异部分）</MenuItem>
                        </Select>
                    </FormControl>

                    {importExistsWarning && (
                        <Alert severity="warning">
                            检测到该月份 <strong>({importDateType === 'holiday' ? '节假日' : '常规'})</strong> 的价格数据已存在，导入将覆盖现有数据。
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setImportDialogOpen(false)} disabled={importing}>取消</Button>
                    <Button onClick={handleImport} variant="contained" disabled={importing || !canEdit}
                        startIcon={importing ? <CircularProgress size={16} /> : undefined}>
                        {importing ? '导入中...' : '确认导入'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 删除确认对话框 */}
            <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
                <DialogTitle>删除确认</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        确定删除月份 <strong>{selectedMonth}</strong> 的价格数据？此操作不可撤销。
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>取消</Button>
                    <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting || !canEdit}
                        startIcon={deleting ? <CircularProgress size={16} /> : undefined}>
                        {deleting ? '删除中...' : '确认删除'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar 反馈 */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
                    {snackbar.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default RetailSettlementPriceTab;

