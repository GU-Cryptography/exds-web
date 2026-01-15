/**
 * 客户详情弹窗 (v2 - 重构版本)
 * 只读展示客户信息 + 关联合同
 */
import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    CircularProgress,
    Paper,
    Typography,
    Grid,
    Chip,
    useMediaQuery,
    useTheme,
    Alert,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Tooltip
} from '@mui/material';
import {
    Edit as EditIcon,
    Close as CloseIcon,
    ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Customer, RetailContract, Tag } from '../api/customer';
import customerApi from '../api/customer';

interface CustomerDetailsDialogProps {
    open: boolean;
    customerId: string | null;
    onClose: () => void;
    onEdit?: (id: string) => void;
}

export const CustomerDetailsDialog: React.FC<CustomerDetailsDialogProps> = ({
    open,
    customerId,
    onClose,
    onEdit
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const [data, setData] = useState<Customer | null>(null);
    const [contracts, setContracts] = useState<RetailContract[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 加载客户详情和关联合同
    const loadCustomerDetails = async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            const [customerResponse, contractsResponse] = await Promise.all([
                customerApi.getCustomer(id),
                customerApi.getCustomerContracts(id).catch(() => ({ data: [] }))
            ]);
            setData(customerResponse.data);
            setContracts(contractsResponse.data || []);
        } catch (err: any) {
            console.error('加载客户详情失败:', err);
            setError(err.response?.data?.detail || err.message || '加载客户详情失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open && customerId) {
            loadCustomerDetails(customerId);
        } else if (!open) {
            setData(null);
            setContracts([]);
            setError(null);
        }
    }, [open, customerId]);

    const handleClose = (event: {}, reason: "backdropClick" | "escapeKeyDown") => {
        if (reason && reason === "backdropClick") {
            return;
        }
        onClose();
    };

    const handleEdit = () => {
        if (customerId && onEdit) {
            onClose();
            onEdit(customerId);
        }
    };

    // 获取标签颜色
    const getTagColor = (tag: Tag) => {
        return tag.source === 'AUTO' ? 'secondary' : 'primary';
    };

    // 渲染基本信息
    const renderBasicInfo = () => (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
            <Typography variant="h6" gutterBottom>基本信息</Typography>
            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">客户全称</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 'medium' }}>
                        {data?.user_name || '-'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">客户简称</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5, fontWeight: 'medium' }}>
                        {data?.short_name || '-'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">位置</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                        {data?.location || '-'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">客户经理</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                        {data?.manager || '-'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">客户来源</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                        {data?.source || '-'}
                    </Typography>
                </Grid>
            </Grid>
        </Paper>
    );

    // 渲染标签
    const renderTags = () => (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
            <Typography variant="h6" gutterBottom>标签</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {data?.tags && data.tags.length > 0 ? (
                    data.tags.map((tag, index) => (
                        <Tooltip
                            key={index}
                            title={`来源: ${tag.source === 'AUTO' ? '算法' : '人工'}${tag.reason ? ` | ${tag.reason}` : ''}`}
                        >
                            <Chip
                                label={tag.name}
                                size="small"
                                color={getTagColor(tag)}
                            />
                        </Tooltip>
                    ))
                ) : (
                    <Typography variant="body2" color="text.secondary">暂无标签</Typography>
                )}
            </Box>
        </Paper>
    );

    // 渲染户号与资产
    const renderAccounts = () => (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
            <Typography variant="h6" gutterBottom>户号与资产</Typography>
            {data?.accounts && data.accounts.length > 0 ? (
                data.accounts.map((account, index) => (
                    <Accordion key={index} defaultExpanded={index === 0} variant="outlined" sx={{ mb: 1 }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography variant="subtitle2">
                                户号: {account.account_id}
                            </Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            {/* 电表列表 */}
                            {account.meters.length > 0 && (
                                <Box sx={{ mb: 2 }}>
                                    <Typography variant="body2" color="text.secondary" gutterBottom>
                                        电表 ({account.meters.length})
                                    </Typography>
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>资产号</TableCell>
                                                    <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>倍率</TableCell>
                                                    <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>系数</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {account.meters.map((meter, mIdx) => (
                                                    <TableRow key={mIdx}>
                                                        <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>
                                                            {meter.meter_id}
                                                        </TableCell>
                                                        <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>{meter.multiplier}</TableCell>
                                                        <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>
                                                            {meter.allocation_ratio != null
                                                                ? `${(meter.allocation_ratio * 100).toFixed(0)}%`
                                                                : '-'}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </Box>
                            )}

                            {/* 计量点列表 */}
                            {account.metering_points.length > 0 && (
                                <Box>
                                    <Typography variant="body2" color="text.secondary" gutterBottom>
                                        计量点 ({account.metering_points.length})
                                    </Typography>
                                    <TableContainer>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>编号</TableCell>
                                                    <TableCell>名称</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {account.metering_points.map((mp, mpIdx) => (
                                                    <TableRow key={mpIdx}>
                                                        <TableCell>{mp.mp_no}</TableCell>
                                                        <TableCell>{mp.mp_name || '-'}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </Box>
                            )}

                            {account.meters.length === 0 && account.metering_points.length === 0 && (
                                <Typography variant="body2" color="text.secondary">
                                    暂无关联资产
                                </Typography>
                            )}
                        </AccordionDetails>
                    </Accordion>
                ))
            ) : (
                <Typography variant="body2" color="text.secondary">暂无户号信息</Typography>
            )}
        </Paper>
    );

    // 渲染关联合同
    const renderContracts = () => (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }}>
            <Typography variant="h6" gutterBottom>关联零售合同</Typography>
            {contracts.length > 0 ? (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>合同名称</TableCell>
                                <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>套餐</TableCell>
                                <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>购电区间</TableCell>
                                <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>签约电量</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {contracts.map((contract, index) => (
                                <TableRow key={index}>
                                    <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>{contract.contract_name}</TableCell>
                                    <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>{contract.package_name || '-'}</TableCell>
                                    <TableCell sx={{ fontSize: '0.75rem', px: 1 }}>
                                        {contract.start_date && contract.end_date
                                            ? `${format(new Date(contract.start_date), 'yyyy-MM', { locale: zhCN })} ~ ${format(new Date(contract.end_date), 'yyyy-MM', { locale: zhCN })}`
                                            : '-'}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontSize: '0.75rem', px: 1 }}>
                                        {contract.contracted_quantity
                                            ? `${(contract.contracted_quantity / 10000).toFixed(0)}万kWh`
                                            : '-'}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            ) : (
                <Typography variant="body2" color="text.secondary">暂无关联合同</Typography>
            )}
        </Paper>
    );

    // 渲染系统信息
    const renderSystemInfo = () => (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
            <Typography variant="h6" gutterBottom>系统信息</Typography>
            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">创建时间</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                        {data?.created_at
                            ? format(new Date(data.created_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })
                            : '-'}
                    </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="body2" color="text.secondary">更新时间</Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                        {data?.updated_at
                            ? format(new Date(data.updated_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })
                            : '-'}
                    </Typography>
                </Grid>
            </Grid>
        </Paper>
    );

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            fullScreen={isMobile}
        >
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                    客户详情: {data?.user_name || ''}
                </Typography>
                <IconButton onClick={onClose} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                {loading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : data ? (
                    <Box>
                        {renderBasicInfo()}
                        {renderTags()}
                        {renderAccounts()}
                        {renderContracts()}
                        {renderSystemInfo()}
                    </Box>
                ) : null}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>关闭</Button>
                {onEdit && (
                    <Button
                        variant="contained"
                        startIcon={<EditIcon />}
                        onClick={handleEdit}
                    >
                        编辑
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default CustomerDetailsDialog;