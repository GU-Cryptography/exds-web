/**
 * 客户编辑弹窗 (v2 - 重构版本)
 * 单页长弹窗设计，包含：基础信息、标签管理、户号与资产
 */
import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    Typography,
    Box,
    Paper,
    CircularProgress,
    Alert,
    IconButton,
    Divider,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    useMediaQuery,
    useTheme,
    Tooltip,
    Autocomplete
} from '@mui/material';
import {
    Close as CloseIcon,
    Add as AddIcon,
    Delete as DeleteIcon,
    Edit as EditIcon,
    ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import {
    Customer,
    CustomerCreate,
    CustomerUpdate,
    Account,
    Meter,
    MeteringPoint,
    Tag,
    WeatherLocation,
    getFieldOptions
} from '../api/customer';
import customerApi from '../api/customer';
import TagSelector from './customer/TagSelector';

interface CustomerEditorDialogProps {
    open: boolean;
    mode: 'create' | 'edit';
    customer?: Customer | null;
    onClose: () => void;
    onSave: () => void;
}

// 空表单数据
const emptyFormData: CustomerCreate = {
    user_name: '',
    short_name: '',
    location: null,
    source: null,
    manager: null,
    accounts: [],
    tags: []
};

export const CustomerEditorDialog: React.FC<CustomerEditorDialogProps> = ({
    open,
    mode,
    customer,
    onClose,
    onSave
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isCreate = mode === 'create';

    // 表单状态
    const [formData, setFormData] = useState<CustomerCreate>(emptyFormData);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 气象区域列表
    const [weatherLocations, setWeatherLocations] = useState<WeatherLocation[]>([]);
    const [loadingLocations, setLoadingLocations] = useState(false);

    // 字段可选值 (来源、客户经理)
    const [fieldOptions, setFieldOptions] = useState<{ sources: string[]; managers: string[] }>({ sources: [], managers: [] });

    // 账户编辑临时状态
    const [editingAccountIndex, setEditingAccountIndex] = useState<number | null>(null);
    const [editingAccountId, setEditingAccountId] = useState('');

    // 电表编辑临时状态
    const [editingMeter, setEditingMeter] = useState<{ accountIndex: number, meterIndex: number | null } | null>(null);
    const [editingMeterData, setEditingMeterData] = useState<Meter>({ meter_id: '', multiplier: 1, allocation_ratio: null });

    // 计量点编辑临时状态
    const [editingMP, setEditingMP] = useState<{ accountIndex: number, mpIndex: number | null } | null>(null);
    const [editingMPData, setEditingMPData] = useState<MeteringPoint>({ mp_no: '', mp_name: null });

    // 加载气象区域列表和字段选项
    useEffect(() => {
        const loadWeatherLocations = async () => {
            setLoadingLocations(true);
            try {
                const response = await customerApi.getWeatherLocations();
                setWeatherLocations(response.data || []);
            } catch (err) {
                console.error('加载气象区域失败:', err);
            } finally {
                setLoadingLocations(false);
            }
        };

        const loadFieldOptions = async () => {
            try {
                const response = await getFieldOptions();
                setFieldOptions(response.data);
            } catch (err) {
                console.error('加载字段选项失败:', err);
            }
        };

        if (open) {
            loadWeatherLocations();
            loadFieldOptions();
        }
    }, [open]);

    // 初始化表单数据
    useEffect(() => {
        if (open && customer && mode === 'edit') {
            setFormData({
                user_name: customer.user_name,
                short_name: customer.short_name,
                location: customer.location || null,
                source: customer.source || null,
                manager: customer.manager || null,
                accounts: customer.accounts || [],
                tags: customer.tags || []
            });
        } else if (open && isCreate) {
            setFormData(emptyFormData);
        }
    }, [open, customer, mode, isCreate]);

    // 获取选中气象区域的经纬度
    const selectedLocation = weatherLocations.find(loc => loc.name === formData.location);

    // 表单字段变化处理
    const handleFieldChange = (field: keyof CustomerCreate, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // 标签变化处理
    const handleTagsChange = (tags: Tag[]) => {
        setFormData(prev => ({ ...prev, tags }));
    };

    // ==================== 户号管理 ====================

    const handleAddAccount = () => {
        setEditingAccountIndex(-1); // -1 表示新增
        setEditingAccountId('');
    };

    const handleEditAccount = (index: number) => {
        setEditingAccountIndex(index);
        setEditingAccountId(formData.accounts?.[index]?.account_id || '');
    };

    const handleSaveAccount = () => {
        if (!editingAccountId.trim()) return;

        const newAccounts = [...(formData.accounts || [])];
        if (editingAccountIndex === -1) {
            // 新增
            newAccounts.push({
                account_id: editingAccountId.trim(),
                meters: [],
                metering_points: []
            });
        } else if (editingAccountIndex !== null) {
            // 编辑
            newAccounts[editingAccountIndex] = {
                ...newAccounts[editingAccountIndex],
                account_id: editingAccountId.trim()
            };
        }
        setFormData(prev => ({ ...prev, accounts: newAccounts }));
        setEditingAccountIndex(null);
        setEditingAccountId('');
    };

    const handleDeleteAccount = (index: number) => {
        const newAccounts = [...(formData.accounts || [])];
        newAccounts.splice(index, 1);
        setFormData(prev => ({ ...prev, accounts: newAccounts }));
    };

    // ==================== 电表管理 ====================

    const handleAddMeter = (accountIndex: number) => {
        setEditingMeter({ accountIndex, meterIndex: null });
        setEditingMeterData({ meter_id: '', multiplier: 1, allocation_ratio: null });
    };

    const handleEditMeter = (accountIndex: number, meterIndex: number) => {
        const meter = formData.accounts?.[accountIndex]?.meters?.[meterIndex];
        if (meter) {
            setEditingMeter({ accountIndex, meterIndex });
            setEditingMeterData({ ...meter });
        }
    };

    const handleSaveMeter = () => {
        if (!editingMeter || !editingMeterData.meter_id.trim()) return;

        const newAccounts = [...(formData.accounts || [])];
        const account = newAccounts[editingMeter.accountIndex];
        if (!account) return;

        const newMeters = [...(account.meters || [])];
        if (editingMeter.meterIndex === null) {
            newMeters.push({ ...editingMeterData, meter_id: editingMeterData.meter_id.trim() });
        } else {
            newMeters[editingMeter.meterIndex] = { ...editingMeterData, meter_id: editingMeterData.meter_id.trim() };
        }
        newAccounts[editingMeter.accountIndex] = { ...account, meters: newMeters };
        setFormData(prev => ({ ...prev, accounts: newAccounts }));
        setEditingMeter(null);
    };

    const handleDeleteMeter = (accountIndex: number, meterIndex: number) => {
        const newAccounts = [...(formData.accounts || [])];
        const account = newAccounts[accountIndex];
        if (!account) return;

        const newMeters = [...(account.meters || [])];
        newMeters.splice(meterIndex, 1);
        newAccounts[accountIndex] = { ...account, meters: newMeters };
        setFormData(prev => ({ ...prev, accounts: newAccounts }));
    };

    // ==================== 计量点管理 ====================

    const handleAddMP = (accountIndex: number) => {
        setEditingMP({ accountIndex, mpIndex: null });
        setEditingMPData({ mp_no: '', mp_name: null });
    };

    const handleEditMP = (accountIndex: number, mpIndex: number) => {
        const mp = formData.accounts?.[accountIndex]?.metering_points?.[mpIndex];
        if (mp) {
            setEditingMP({ accountIndex, mpIndex });
            setEditingMPData({ ...mp });
        }
    };

    const handleSaveMP = () => {
        if (!editingMP || !editingMPData.mp_no.trim()) return;

        const newAccounts = [...(formData.accounts || [])];
        const account = newAccounts[editingMP.accountIndex];
        if (!account) return;

        const newMPs = [...(account.metering_points || [])];
        if (editingMP.mpIndex === null) {
            newMPs.push({ ...editingMPData, mp_no: editingMPData.mp_no.trim() });
        } else {
            newMPs[editingMP.mpIndex] = { ...editingMPData, mp_no: editingMPData.mp_no.trim() };
        }
        newAccounts[editingMP.accountIndex] = { ...account, metering_points: newMPs };
        setFormData(prev => ({ ...prev, accounts: newAccounts }));
        setEditingMP(null);
    };

    const handleDeleteMP = (accountIndex: number, mpIndex: number) => {
        const newAccounts = [...(formData.accounts || [])];
        const account = newAccounts[accountIndex];
        if (!account) return;

        const newMPs = [...(account.metering_points || [])];
        newMPs.splice(mpIndex, 1);
        newAccounts[accountIndex] = { ...account, metering_points: newMPs };
        setFormData(prev => ({ ...prev, accounts: newAccounts }));
    };

    // ==================== 保存客户 ====================

    const handleSaveCustomer = async () => {
        // 验证必填字段
        if (!formData.user_name?.trim()) {
            setError('请输入客户全称');
            return;
        }
        if (!formData.short_name?.trim()) {
            setError('请输入客户简称');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            if (isCreate) {
                await customerApi.createCustomer(formData);
            } else if (customer) {
                await customerApi.updateCustomer(customer.id, formData as CustomerUpdate);
            }
            onSave();
            handleClose();
        } catch (err: any) {
            console.error('保存客户失败:', err);
            setError(err.response?.data?.detail || err.message || '保存失败');
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        setFormData(emptyFormData);
        setError(null);
        setEditingAccountIndex(null);
        setEditingMeter(null);
        setEditingMP(null);
        onClose();
    };

    const handleDialogClose = (event: {}, reason: "backdropClick" | "escapeKeyDown") => {
        if (reason === "backdropClick") return;
        handleClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleDialogClose}
            maxWidth="md"
            fullWidth
            fullScreen={isMobile}
        >
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                    {isCreate ? '新增客户' : `编辑客户: ${customer?.user_name || ''}`}
                </Typography>
                <IconButton onClick={handleClose} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {/* 基础信息 */}
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="h6" gutterBottom>基础信息</Typography>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                required
                                label="客户全称"
                                value={formData.user_name || ''}
                                onChange={(e) => handleFieldChange('user_name', e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                required
                                label="客户简称"
                                value={formData.short_name || ''}
                                onChange={(e) => handleFieldChange('short_name', e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <FormControl fullWidth>
                                <InputLabel>位置</InputLabel>
                                <Select
                                    value={formData.location || ''}
                                    label="位置"
                                    onChange={(e) => handleFieldChange('location', e.target.value || null)}
                                >
                                    <MenuItem value="">
                                        <em>未选择</em>
                                    </MenuItem>
                                    {weatherLocations.map((loc) => (
                                        <MenuItem key={loc.code} value={loc.name}>
                                            {loc.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 6, md: 4 }}>
                            <TextField
                                fullWidth
                                label="经度"
                                value={selectedLocation?.longitude || ''}
                                InputProps={{ readOnly: true }}
                                disabled
                            />
                        </Grid>
                        <Grid size={{ xs: 6, md: 4 }}>
                            <TextField
                                fullWidth
                                label="纬度"
                                value={selectedLocation?.latitude || ''}
                                InputProps={{ readOnly: true }}
                                disabled
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Autocomplete
                                freeSolo
                                options={fieldOptions.sources}
                                value={formData.source || ''}
                                onChange={(_, value) => handleFieldChange('source', value || null)}
                                onInputChange={(_, value) => handleFieldChange('source', value || null)}
                                renderInput={(params) => (
                                    <TextField {...params} label="客户来源" />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Autocomplete
                                freeSolo
                                options={fieldOptions.managers}
                                value={formData.manager || ''}
                                onChange={(_, value) => handleFieldChange('manager', value || null)}
                                onInputChange={(_, value) => handleFieldChange('manager', value || null)}
                                renderInput={(params) => (
                                    <TextField {...params} label="客户经理" />
                                )}
                            />
                        </Grid>
                    </Grid>
                </Paper>

                {/* 标签管理 */}
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="h6" gutterBottom>标签管理</Typography>
                    <TagSelector
                        tags={formData.tags || []}
                        onChange={handleTagsChange}
                    />
                </Paper>

                {/* 户号与资产 */}
                <Paper variant="outlined" sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6">户号与资产</Typography>
                        <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={handleAddAccount}
                        >
                            添加户号
                        </Button>
                    </Box>

                    {/* 户号编辑行 */}
                    {editingAccountIndex !== null && (
                        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: 'action.hover' }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <TextField
                                    size="small"
                                    label="户号"
                                    value={editingAccountId}
                                    onChange={(e) => setEditingAccountId(e.target.value)}
                                    sx={{ flex: 1 }}
                                />
                                <Button size="small" onClick={handleSaveAccount}>保存</Button>
                                <Button size="small" onClick={() => setEditingAccountIndex(null)}>取消</Button>
                            </Box>
                        </Paper>
                    )}

                    {/* 户号列表 */}
                    {(formData.accounts || []).map((account, accountIndex) => (
                        <Accordion key={accountIndex} defaultExpanded variant="outlined" sx={{ mb: 1 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Typography variant="subtitle2">
                                        户号: {account.account_id}
                                    </Typography>
                                    <Box sx={{ ml: 'auto', mr: 2 }}>
                                        <IconButton
                                            size="small"
                                            onClick={(e) => { e.stopPropagation(); handleEditAccount(accountIndex); }}
                                        >
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                        <IconButton
                                            size="small"
                                            color="error"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteAccount(accountIndex); }}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Box>
                                </Box>
                            </AccordionSummary>
                            <AccordionDetails>
                                {/* 电表管理 */}
                                <Box sx={{ mb: 2 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography variant="body2" color="text.secondary">
                                            电表 ({account.meters?.length || 0})
                                        </Typography>
                                        <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddMeter(accountIndex)}>
                                            添加电表
                                        </Button>
                                    </Box>

                                    {/* 电表编辑行 */}
                                    {editingMeter?.accountIndex === accountIndex && (
                                        <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: 'action.hover' }}>
                                            <Grid container spacing={1} alignItems="center">
                                                <Grid size={{ xs: 4 }}>
                                                    <TextField
                                                        size="small"
                                                        fullWidth
                                                        label="资产号"
                                                        value={editingMeterData.meter_id}
                                                        onChange={(e) => setEditingMeterData(prev => ({ ...prev, meter_id: e.target.value }))}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 3 }}>
                                                    <TextField
                                                        size="small"
                                                        fullWidth
                                                        label="倍率"
                                                        type="number"
                                                        value={editingMeterData.multiplier}
                                                        onChange={(e) => setEditingMeterData(prev => ({ ...prev, multiplier: Number(e.target.value) }))}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 3 }}>
                                                    <TextField
                                                        size="small"
                                                        fullWidth
                                                        label="系数"
                                                        type="number"
                                                        inputProps={{ step: 0.01, min: 0, max: 1 }}
                                                        value={editingMeterData.allocation_ratio ?? ''}
                                                        onChange={(e) => setEditingMeterData(prev => ({
                                                            ...prev,
                                                            allocation_ratio: e.target.value ? Number(e.target.value) : null
                                                        }))}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 2 }}>
                                                    <Button size="small" onClick={handleSaveMeter}>保存</Button>
                                                    <Button size="small" onClick={() => setEditingMeter(null)}>取消</Button>
                                                </Grid>
                                            </Grid>
                                        </Paper>
                                    )}

                                    {account.meters && account.meters.length > 0 && (
                                        <TableContainer>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>资产号</TableCell>
                                                        <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>倍率</TableCell>
                                                        <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>系数</TableCell>
                                                        <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>操作</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {account.meters.map((meter, meterIndex) => (
                                                        <TableRow key={meterIndex}>
                                                            <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>
                                                                {meter.meter_id}
                                                            </TableCell>
                                                            <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>{meter.multiplier}</TableCell>
                                                            <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>
                                                                {meter.allocation_ratio != null ? `${(meter.allocation_ratio * 100).toFixed(0)}%` : '-'}
                                                            </TableCell>
                                                            <TableCell align="right" sx={{ px: 0 }}>
                                                                <IconButton size="small" onClick={() => handleEditMeter(accountIndex, meterIndex)}>
                                                                    <EditIcon fontSize="small" />
                                                                </IconButton>
                                                                <IconButton size="small" color="error" onClick={() => handleDeleteMeter(accountIndex, meterIndex)}>
                                                                    <DeleteIcon fontSize="small" />
                                                                </IconButton>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    )}
                                </Box>

                                <Divider sx={{ my: 1 }} />

                                {/* 计量点管理 */}
                                <Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography variant="body2" color="text.secondary">
                                            计量点 ({account.metering_points?.length || 0})
                                        </Typography>
                                        <Button size="small" startIcon={<AddIcon />} onClick={() => handleAddMP(accountIndex)}>
                                            添加计量点
                                        </Button>
                                    </Box>

                                    {/* 计量点编辑行 */}
                                    {editingMP?.accountIndex === accountIndex && (
                                        <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: 'action.hover' }}>
                                            <Grid container spacing={1} alignItems="center">
                                                <Grid size={{ xs: 5 }}>
                                                    <TextField
                                                        size="small"
                                                        fullWidth
                                                        label="计量点编号"
                                                        value={editingMPData.mp_no}
                                                        onChange={(e) => setEditingMPData(prev => ({ ...prev, mp_no: e.target.value }))}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 5 }}>
                                                    <TextField
                                                        size="small"
                                                        fullWidth
                                                        label="计量点名称"
                                                        value={editingMPData.mp_name || ''}
                                                        onChange={(e) => setEditingMPData(prev => ({ ...prev, mp_name: e.target.value || null }))}
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 2 }}>
                                                    <Button size="small" onClick={handleSaveMP}>保存</Button>
                                                    <Button size="small" onClick={() => setEditingMP(null)}>取消</Button>
                                                </Grid>
                                            </Grid>
                                        </Paper>
                                    )}

                                    {account.metering_points && account.metering_points.length > 0 && (
                                        <TableContainer>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell>编号</TableCell>
                                                        <TableCell>名称</TableCell>
                                                        <TableCell align="right">操作</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {account.metering_points.map((mp, mpIndex) => (
                                                        <TableRow key={mpIndex}>
                                                            <TableCell>{mp.mp_no}</TableCell>
                                                            <TableCell>{mp.mp_name || '-'}</TableCell>
                                                            <TableCell align="right">
                                                                <IconButton size="small" onClick={() => handleEditMP(accountIndex, mpIndex)}>
                                                                    <EditIcon fontSize="small" />
                                                                </IconButton>
                                                                <IconButton size="small" color="error" onClick={() => handleDeleteMP(accountIndex, mpIndex)}>
                                                                    <DeleteIcon fontSize="small" />
                                                                </IconButton>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    )}
                                </Box>
                            </AccordionDetails>
                        </Accordion>
                    ))}

                    {(!formData.accounts || formData.accounts.length === 0) && editingAccountIndex === null && (
                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                            暂无户号，点击"添加户号"开始添加
                        </Typography>
                    )}
                </Paper>
            </DialogContent>

            <DialogActions>
                <Button onClick={handleClose} disabled={saving}>取消</Button>
                <Button
                    variant="contained"
                    onClick={handleSaveCustomer}
                    disabled={saving}
                    startIcon={saving ? <CircularProgress size={16} /> : null}
                >
                    {saving ? '保存中...' : '保存'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CustomerEditorDialog;