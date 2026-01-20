import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    TextField,
    CircularProgress,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    IconButton,
    Chip,
    Tooltip,
    Snackbar,
    useTheme,
    useMediaQuery,
    Card,
    CardContent,
    InputAdornment,
    FormControl,
    InputLabel,
    Select,
    MenuItem
} from '@mui/material';
import {
    Search as SearchIcon,
    Refresh as RefreshIcon,
    Upload as UploadIcon,
    Visibility as VisibilityIcon,
    People as PeopleIcon,
    Sync as SyncIcon,
    CheckCircle as CheckCircleIcon,
    Warning as WarningIcon,
    Error as ErrorIcon,
    InfoOutlined as InfoOutlinedIcon,
} from '@mui/icons-material';
import Grid from '@mui/material/Grid';
import apiClient from '../api/client';
import { LoadDataImportDialog } from '../components/load-diagnosis/LoadDataImportDialog';
import { LoadDataAggregationDialog } from '../components/load-diagnosis/LoadDataAggregationDialog';
import { useTabContext } from '../contexts/TabContext';
import { LoadDataDiagnosisWorkbench } from './LoadDataDiagnosisWorkbench';

// 统计数据类型
interface SummaryData {
    total_customers: number;
    pending_mp_customers: number;
    pending_meter_customers: number;
    integrity_anomaly_count: number;
    reliability_anomaly_count: number;
    accuracy_anomaly_count: number;
}

// 客户列表项类型
interface CustomerItem {
    customer_id: string;
    customer_name: string;
    contract_days: number; // Keep for backward compatibility if needed, or remove? API sends string now. Let's make it optional or remove.
    cycle_range?: string;
    data_days?: number;
    integrity_rate: number;
    reliability_issue_days: number;
    accuracy_rate: number;
    status: 'normal' | 'pending' | 'warning' | 'critical';
    data_distribution: {
        mp: number;
        meter: number;
    };
}

// 筛选状态类型
type FilterStatus = 'all' | 'abnormal' | 'error_limit' | 'pending_compare' | 'reliability' | 'pending_meter';

export const LoadDataCalibrationPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { addTab } = useTabContext();

    // 状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<SummaryData | null>(null);
    const [customers, setCustomers] = useState<CustomerItem[]>([]);
    const [total, setTotal] = useState(0);

    // 分页
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);

    // 筛选
    const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
    const [searchKeyword, setSearchKeyword] = useState('');

    // 弹窗状态
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [aggregationDialogOpen, setAggregationDialogOpen] = useState(false);

    // Snackbar
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info' | 'warning';
    }>({
        open: false,
        message: '',
        severity: 'info'
    });

    const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        setSnackbar({ open: true, message, severity });
    };

    // 数据获取
    const fetchSummary = async () => {
        try {
            const response = await apiClient.get('/api/v1/load-data/summary');
            setSummary(response.data);
        } catch (err: any) {
            console.error('获取统计数据失败:', err);
        }
    };

    const fetchCustomers = async () => {
        setLoading(true);
        setError(null);
        try {
            const params: any = {
                page: page + 1,
                page_size: pageSize
            };
            if (filterStatus !== 'all') {
                if (filterStatus === 'abnormal') params.status = 'anomaly'; // Maps to integrity
                else if (filterStatus === 'error_limit') params.status = 'error'; // Maps to accuracy
                else if (filterStatus === 'pending_compare') params.status = 'pending'; // Maps to pending MP
                else if (filterStatus === 'reliability') params.status = 'reliability'; // Maps to reliability
                else if (filterStatus === 'pending_meter') params.status = 'pending_meter'; // Maps to pending meter
            }
            if (searchKeyword) {
                params.search = searchKeyword;
            }

            const response = await apiClient.get('/api/v1/load-data/customers', { params });
            // API V3 response structure
            setCustomers(response.data.customers || []);
            setTotal(response.data.total || 0);

        } catch (err: any) {
            console.error('获取客户列表失败:', err);
            setError(err.response?.data?.detail || err.message || '获取数据失败，请重试');
            setCustomers([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    };

    // 重新聚合
    const handleReaggregate = () => {
        setAggregationDialogOpen(true);
    };

    // 初始化加载
    useEffect(() => {
        fetchSummary();
    }, []);

    useEffect(() => {
        fetchCustomers();
    }, [page, pageSize, filterStatus, searchKeyword]); // Added dependencies back

    // 统计卡片点击
    const handleCardClick = (status: FilterStatus) => {
        setFilterStatus(status);
        setPage(0);
    };

    // 查看详情
    const handleViewDetail = (customerId: string, customerName: string) => {
        addTab({
            key: `load-diagnosis-${customerId}`,
            title: `诊断：${customerName}`,
            path: `/load-diagnosis/${customerId}`, // Add a virtual path
            component: <LoadDataDiagnosisWorkbench customerId={customerId} />
        });
    };

    // 获取状态颜色
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'normal': return 'success';
            case 'pending': return 'info';
            case 'warning': return 'warning';
            case 'critical': return 'error';
            default: return 'default';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'normal': return '正常';
            case 'pending': return '待聚合';
            case 'warning': return '警告';
            case 'critical': return '严重';
            default: return status;
        }
    };

    // 格式化百分比
    const formatPercent = (value: number | null, decimals: number = 1) => {
        if (value === null || value === undefined) return '-';
        return `${(value * 100).toFixed(decimals)}%`;
    };

    // 指标定义提示
    const metricDefinitions = {
        pending_mp: '待聚合(MP) = 原始计量点数据天数 > 已聚合天数的客户数',
        pending_meter: '待聚合(电表) = 原始电表数据天数 > 已聚合天数的客户数',
        integrity: '完整率 = 实际数据天数 ÷ (昨天 - 最早记录日期 + 1)',
        reliability: '可靠率异常 = 最近30天内存在计量点数据缺失的客户数',
        accuracy: '准确率 = 1 - 日电量误差率的平均值',
    };

    // 统计卡片组件
    const StatCard: React.FC<{
        title: string;
        value: number;
        icon: React.ReactNode;
        color: string;
        bgColor?: string;
        onClick?: () => void;
        isActive?: boolean;
        tooltip?: string;
    }> = ({ title, value, icon, color, bgColor, onClick, isActive, tooltip }) => (
        <Paper
            elevation={isActive ? 4 : 1}
            sx={{
                p: { xs: 1.5, sm: 2 },
                display: 'flex',
                alignItems: 'center',
                cursor: onClick ? 'pointer' : 'default',
                bgcolor: isActive ? bgColor || 'action.selected' : 'background.paper',
                border: isActive ? `2px solid ${color}` : '1px solid',
                borderColor: isActive ? color : 'divider',
                transition: 'all 0.2s ease-in-out',
                '&:hover': onClick ? {
                    transform: 'translateY(-2px)',
                    boxShadow: 4,
                    borderColor: color
                } : {}
            }}
            onClick={onClick}
        >
            <Box sx={{
                color: color,
                mr: { xs: 1, sm: 2 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: { xs: 40, sm: 48 },
                height: { xs: 40, sm: 48 },
                borderRadius: '50%',
                bgcolor: `${color}15`
            }}>
                {icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" color="text.secondary" noWrap>
                        {title}
                    </Typography>
                    {tooltip && (
                        <Tooltip title={tooltip} arrow placement="top">
                            <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                        </Tooltip>
                    )}
                </Box>
                <Typography variant="h5" fontWeight="bold" sx={{ color: color }}>
                    {value}
                </Typography>
            </Box>
        </Paper>
    );

    // 渲染统计卡片
    const renderSummaryCards = () => (
        <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, sm: 2 }}>
                <StatCard
                    title="签约客户"
                    value={summary?.total_customers || 0}
                    icon={<PeopleIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                    color="#1976d2"
                    onClick={() => handleCardClick('all')}
                    isActive={filterStatus === 'all'}
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
                <StatCard
                    title="待聚合(MP)"
                    value={summary?.pending_mp_customers || 0}
                    icon={<SyncIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                    color="#0288d1"
                    bgColor="#e3f2fd"
                    onClick={() => handleCardClick('pending_compare')}
                    isActive={filterStatus === 'pending_compare'}
                    tooltip={metricDefinitions.pending_mp}
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
                <StatCard
                    title="待聚合(电表)"
                    value={summary?.pending_meter_customers || 0}
                    icon={<SyncIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                    color="#5c6bc0"
                    bgColor="#e8eaf6"
                    onClick={() => handleCardClick('pending_meter')}
                    isActive={filterStatus === 'pending_meter'}
                    tooltip={metricDefinitions.pending_meter}
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
                <StatCard
                    title="完整率异常"
                    value={summary?.integrity_anomaly_count || 0}
                    icon={<WarningIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                    color="#ed6c02"
                    bgColor="#fff3e0"
                    onClick={() => handleCardClick('abnormal')}
                    isActive={filterStatus === 'abnormal'}
                    tooltip={metricDefinitions.integrity}
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
                <StatCard
                    title="可靠率异常"
                    value={summary?.reliability_anomaly_count || 0}
                    icon={<CheckCircleIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                    color="#9c27b0"
                    bgColor="#f3e5f5"
                    onClick={() => handleCardClick('reliability')}
                    isActive={filterStatus === 'reliability'}
                    tooltip={metricDefinitions.reliability}
                />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
                <StatCard
                    title="准确率异常"
                    value={summary?.accuracy_anomaly_count || 0}
                    icon={<ErrorIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                    color="#d32f2f"
                    bgColor="#ffebee"
                    onClick={() => handleCardClick('error_limit')}
                    isActive={filterStatus === 'error_limit'}
                    tooltip={metricDefinitions.accuracy}
                />
            </Grid>
        </Grid>
    );

    // 渲染移动端卡片
    const renderMobileCards = () => (
        <Box>
            {customers.map((customer) => (
                <Paper key={customer.customer_id} variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography
                            variant="subtitle1"
                            sx={{
                                cursor: 'pointer',
                                color: 'primary.main',
                                fontWeight: 'bold',
                                '&:hover': { textDecoration: 'underline' }
                            }}
                            onClick={() => handleViewDetail(customer.customer_id, customer.customer_name)}
                        >
                            {customer.customer_name}
                        </Typography>
                        <Chip
                            size="small"
                            label={getStatusLabel(customer.status)}
                            color={getStatusColor(customer.status) as any}
                        />
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                        <Typography variant="caption">
                            周期: {customer.contract_days}天
                        </Typography>
                        <Typography variant="caption">
                            MP: {customer.data_distribution?.mp} / M: {customer.data_distribution?.meter}
                        </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" display="block" color="text.secondary">完整率</Typography>
                            <Typography variant="body2">{formatPercent(customer.integrity_rate)}</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" display="block" color="text.secondary">可靠率</Typography>
                            <Typography variant="body2">{customer.reliability_issue_days}天异常</Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" display="block" color="text.secondary">准确率</Typography>
                            <Typography variant="body2">{formatPercent(customer.accuracy_rate)}</Typography>
                        </Box>
                    </Box>
                </Paper>
            ))}
        </Box>
    );

    // 渲染桌面端表格
    const renderTable = () => (
        <TableContainer>
            <Table sx={{
                '& .MuiTableCell-root': {
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    px: { xs: 0.5, sm: 2 }
                }
            }}>
                <TableHead>
                    <TableRow>
                        <TableCell>客户名称</TableCell>
                        <TableCell align="center">数据周期</TableCell>
                        <TableCell align="center">总天数</TableCell>
                        <TableCell align="center">数据分布(MP/Meter)</TableCell>
                        <TableCell align="center">完整率</TableCell>
                        <TableCell align="center">MP异常天数</TableCell>
                        <TableCell align="center">准确率</TableCell>
                        <TableCell align="center">状态</TableCell>
                        <TableCell align="center">操作</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {customers.map((customer) => (
                        <TableRow key={customer.customer_id} hover>
                            <TableCell>
                                <Typography
                                    sx={{
                                        cursor: 'pointer',
                                        color: 'primary.main',
                                        '&:hover': { textDecoration: 'underline' }
                                    }}
                                    onClick={() => handleViewDetail(customer.customer_id, customer.customer_name)}
                                >
                                    {customer.customer_name}
                                </Typography>
                            </TableCell>
                            <TableCell align="center">
                                {customer.cycle_range || '-'}
                            </TableCell>
                            <TableCell align="center">
                                {customer.data_days || 0} 天
                            </TableCell>
                            <TableCell align="center">
                                <Typography variant="caption">
                                    MP:{customer.data_distribution?.mp} / M:{customer.data_distribution?.meter}
                                </Typography>
                            </TableCell>
                            <TableCell align="center">
                                {formatPercent(customer.integrity_rate)}
                            </TableCell>
                            <TableCell align="center">
                                {customer.reliability_issue_days}天异常
                            </TableCell>
                            <TableCell align="center">
                                {formatPercent(customer.accuracy_rate)}
                            </TableCell>
                            <TableCell align="center">
                                <Chip
                                    size="small"
                                    label={getStatusLabel(customer.status)}
                                    color={getStatusColor(customer.status) as any}
                                />
                            </TableCell>
                            <TableCell align="center">
                                <Tooltip title="查看详情">
                                    <IconButton
                                        size="small"
                                        onClick={() => handleViewDetail(customer.customer_id, customer.customer_name)}
                                    >
                                        <VisibilityIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );

    return (
        <Box sx={{ width: '100%' }}>
            {/* 移动端显示的页面标题 (桌面端移除标题栏，直接显示内容) */}
            {isMobile && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Typography variant="h6">负荷数据诊断</Typography>
                </Paper>
            )}

            {/* 第一行: 统计卡片 */}
            {renderSummaryCards()}

            {/* 第二行: 筛选与工具栏 */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TextField
                            placeholder="搜索客户名称"
                            size="small"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon />
                                    </InputAdornment>
                                )
                            }}
                            sx={{ width: { xs: '100%', sm: '250px' } }}
                        />
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                            <InputLabel>状态筛选</InputLabel>
                            <Select
                                value={filterStatus}
                                label="状态筛选"
                                onChange={(e) => {
                                    setFilterStatus(e.target.value as FilterStatus);
                                    setPage(0);
                                }}
                            >
                                <MenuItem value="all">全部</MenuItem>
                                <MenuItem value="abnormal">数据异常</MenuItem>
                                <MenuItem value="error_limit">误差超限</MenuItem>
                                <MenuItem value="pending_compare">待对比</MenuItem>
                            </Select>
                        </FormControl>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="text"
                            startIcon={<UploadIcon />}
                            onClick={() => setImportDialogOpen(true)}
                        >
                            导入数据...
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<RefreshIcon />}
                            onClick={handleReaggregate}
                            disabled={loading}
                        >
                            执行数据聚合
                        </Button>
                    </Box>
                </Box>
            </Paper>

            {/* 第三行: 客户列表 */}
            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                {loading && !customers.length ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="300px">
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : customers.length === 0 ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
                        <Typography color="text.secondary">暂无数据</Typography>
                    </Box>
                ) : (
                    <>
                        {/* Loading 覆盖层 */}
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

                        {isMobile ? renderMobileCards() : renderTable()}

                        <TablePagination
                            component="div"
                            count={total}
                            page={page}
                            onPageChange={(_, newPage) => setPage(newPage)}
                            rowsPerPage={pageSize}
                            onRowsPerPageChange={(e) => {
                                setPageSize(parseInt(e.target.value, 10));
                                setPage(0);
                            }}
                            rowsPerPageOptions={[10, 20, 50]}
                            labelRowsPerPage={isMobile ? '' : '每页行数'}
                        />
                    </>
                )}
            </Paper>

            {/* 导入弹窗 */}
            <LoadDataImportDialog
                open={importDialogOpen}
                onClose={() => setImportDialogOpen(false)}
                onSuccess={() => {
                    // Refresh data after import, but keep dialog open or user decides to close?
                    // Typically user closes after seeing success.
                    // We can refresh the summary cards or list if needed.
                    fetchSummary();
                    fetchCustomers();
                }}
            />

            {/* 聚合弹窗 */}
            <LoadDataAggregationDialog
                open={aggregationDialogOpen}
                onClose={() => setAggregationDialogOpen(false)}
                onSuccess={() => {
                    fetchSummary();
                    fetchCustomers();
                }}
            />

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
            >
                <Alert
                    onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                    severity={snackbar.severity}
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default LoadDataCalibrationPage;
