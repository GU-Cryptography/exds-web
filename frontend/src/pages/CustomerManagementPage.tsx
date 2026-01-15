/**
 * 客户档案管理页面 (v2 - 与零售合同管理风格一致)
 * 桌面端：表格布局
 * 移动端：卡片布局 + 可折叠筛选
 */
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
    TableSortLabel,
    Menu,
    MenuItem
} from '@mui/material';
import {
    Edit as EditIcon,
    Delete as DeleteIcon,
    ArrowBack as ArrowBackIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    FilterList as FilterListIcon,
    Visibility as VisibilityIcon,
    Sync as SyncIcon,
    Sort as SortIcon
} from '@mui/icons-material';
import { useParams, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { Customer, CustomerListItem, CustomerListParams, PaginatedResponse, Tag, SyncCandidate, getSyncPreview } from '../api/customer';
import { CustomerEditorDialog } from '../components/CustomerEditorDialog';
import { CustomerDetailsDialog } from '../components/CustomerDetailsDialog';
import { TagFilter, DeleteConfirmDialog } from '../components/customer';
import { SyncConfirmDialog } from '../components/SyncConfirmDialog';
import customerApi from '../api/customer';

export const CustomerManagementPage: React.FC = () => {
    // 路由参数和导航
    const params = useParams<{ customerId?: string }>();
    const navigate = useNavigate();
    const location = useLocation();

    // 响应式设计
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // 使用 matchPath 解析当前路由状态
    const createMatch = matchPath('/customer/profiles/create', location.pathname);
    const viewMatch = matchPath('/customer/profiles/view/:customerId', location.pathname);
    const editMatch = matchPath('/customer/profiles/edit/:customerId', location.pathname);

    // 根据当前路由确定状态
    const isCreateView = !!createMatch;
    const isDetailView = !!viewMatch;
    const isEditView = !!editMatch;
    const currentCustomerId = params.customerId;

    // 列表数据状态
    const [customers, setCustomers] = useState<CustomerListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 分页状态
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);

    // 查询区域折叠状态
    const [isFilterExpanded, setIsFilterExpanded] = useState(false);

    // 查询参数状态 (v2 结构)
    const [filters, setFilters] = useState<CustomerListParams>({
        keyword: '',
        tags: []
    });

    // 排序状态
    const [orderBy, setOrderBy] = useState<string>('created_at');
    const [order, setOrder] = useState<'asc' | 'desc'>('desc');
    const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);

    // 检查是否有活跃的筛选条件
    const hasActiveFilters = Boolean(
        filters.keyword ||
        (filters.tags && filters.tags.length > 0)
    );

    // 编辑对话框状态 (仅桌面端使用)
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');

    // 移动端客户详情状态
    const [mobileCustomerData, setMobileCustomerData] = useState<Customer | null>(null);
    const [mobileCustomerLoading, setMobileCustomerLoading] = useState(false);
    const [mobileCustomerError, setMobileCustomerError] = useState<string | null>(null);

    // 删除确认对话框状态
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [customerToDelete, setCustomerToDelete] = useState<CustomerListItem | null>(null);

    // 同步对话框状态
    const [syncDialogOpen, setSyncDialogOpen] = useState(false);
    const [syncCandidates, setSyncCandidates] = useState<SyncCandidate[]>([]);

    // Snackbar状态
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info' | 'warning';
    }>({
        open: false,
        message: '',
        severity: 'success'
    });

    // Snackbar辅助函数
    const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'success') => {
        setSnackbar({ open: true, message, severity });
    };

    const handleSnackbarClose = () => {
        setSnackbar(prev => ({ ...prev, open: false }));
    };

    // 加载客户列表
    const fetchCustomers = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await customerApi.getCustomers({
                keyword: filters.keyword,
                tags: filters.tags,
                page: page + 1,
                page_size: pageSize,
                sort_field: orderBy,
                sort_order: order
            });
            const data: PaginatedResponse<CustomerListItem> = response.data;

            setCustomers(data.items);
            setTotal(data.total);
        } catch (err: any) {
            console.error('加载客户列表失败:', err);
            const errorMessage = err.response?.data?.detail || err.message || '加载客户列表失败';
            setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
            showSnackbar(errorMessage, 'error');
            setCustomers([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    };

    // 加载移动端客户详情数据
    const loadMobileCustomerData = async (customerId: string) => {
        setMobileCustomerLoading(true);
        setMobileCustomerError(null);
        try {
            const response = await customerApi.getCustomer(customerId);
            setMobileCustomerData(response.data);
        } catch (err: any) {
            console.error('加载客户详情失败:', err);
            setMobileCustomerError(err.response?.data?.detail || err.message || '加载客户详情失败');
            setMobileCustomerData(null);
        } finally {
            setMobileCustomerLoading(false);
        }
    };

    // 根据路由参数加载移动端客户数据
    useEffect(() => {
        if (currentCustomerId && (isDetailView || isEditView)) {
            loadMobileCustomerData(currentCustomerId);
        } else {
            setMobileCustomerData(null);
            setMobileCustomerError(null);
        }
    }, [currentCustomerId, isDetailView, isEditView]);

    // 监听搜索参数变化自动重新加载
    useEffect(() => {
        fetchCustomers();
    }, [filters, page, pageSize, orderBy, order]);

    // 监听location.state变化，处理移动端返回后的刷新
    useEffect(() => {
        if ((location.state as any)?.refresh) {
            fetchCustomers();
            navigate('/customer/profiles', { replace: true, state: {} });
        }
    }, [location.state]);

    // 移动端返回列表
    const handleBackToList = () => {
        navigate('/customer/profiles');
    };

    // 操作处理
    const handleCreate = () => {
        if (isMobile) {
            navigate('/customer/profiles/create');
        } else {
            setSelectedCustomer(null);
            setEditorMode('create');
            setIsEditorOpen(true);
        }
    };

    const handleView = (customer: CustomerListItem) => {
        if (isMobile) {
            navigate(`/customer/profiles/view/${customer.id}`);
        } else {
            setSelectedCustomerId(customer.id);
            setIsDetailsDialogOpen(true);
        }
    };

    const handleEdit = async (customer: CustomerListItem) => {
        if (isMobile) {
            navigate(`/customer/profiles/edit/${customer.id}`);
        } else {
            try {
                const response = await customerApi.getCustomer(customer.id);
                setSelectedCustomer(response.data);
                setEditorMode('edit');
                setIsEditorOpen(true);
            } catch (err: any) {
                console.error('加载客户详情失败:', err);
                showSnackbar(err.response?.data?.detail || err.message || '加载客户详情失败', 'error');
            }
        }
    };

    const handleDeleteClick = (customer: CustomerListItem) => {
        setCustomerToDelete(customer);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async (password: string) => {
        if (!customerToDelete) return;

        await customerApi.deleteCustomer(customerToDelete.id, password);
        setDeleteDialogOpen(false);
        setCustomerToDelete(null);
        fetchCustomers();
        showSnackbar('客户删除成功', 'success');
    };

    // Note: handleSearch is technically redundant due to useEffect, removed for clarity in this version or could call setPage(0)
    // Actually needed if we want manual triggering, but the filter effect handles it.
    // Keeping utility functions for resetting.
    const handleReset = () => {
        setFilters({ keyword: '', tags: [] });
        setPage(0);
    };

    // 标签筛选变化处理
    const handleTagsChange = (tags: string[]) => {
        setFilters(prev => ({ ...prev, tags }));
        setPage(0);
    };

    // 详情对话框处理函数
    const handleCloseDetailsDialog = () => {
        setIsDetailsDialogOpen(false);
        setSelectedCustomerId(null);
    };

    // 从详情对话框处理编辑
    const handleEditFromDetails = (customerId: string) => {
        if (isMobile) {
            navigate(`/customer/profiles/edit/${customerId}`);
        } else {
            setIsDetailsDialogOpen(false);
            setSelectedCustomerId(null);

            customerApi.getCustomer(customerId)
                .then(response => {
                    setSelectedCustomer(response.data);
                    setEditorMode('edit');
                    setIsEditorOpen(true);
                })
                .catch(err => {
                    console.error('获取客户详情失败:', err);
                    showSnackbar(err.response?.data?.detail || err.message || '获取客户详情失败', 'error');
                });
        }
    };

    // 保存成功后的回调
    const handleSaveSuccess = () => {
        if (isMobile && isCreateView) {
            navigate('/customer/profiles', { state: { refresh: true } });
        } else if (isMobile && isEditView) {
            if (currentCustomerId) {
                navigate(`/customer/profiles/view/${currentCustomerId}`);
            } else {
                navigate('/customer/profiles');
            }
        } else {
            setIsEditorOpen(false);
            setSelectedCustomer(null);
            fetchCustomers();
            showSnackbar(
                editorMode === 'create' ? '客户创建成功' : '客户更新成功',
                'success'
            );
        }
    };

    // 获取标签颜色
    const getTagColor = (tag: Tag) => {
        return tag.source === 'AUTO' ? 'secondary' : 'primary';
    };

    // 渲染标签列表 (最多显示3个)
    const renderTags = (tags: Tag[]) => {
        const maxDisplay = 3;
        const displayTags = tags.slice(0, maxDisplay);
        const remaining = tags.length - maxDisplay;

        return (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {displayTags.map((tag, index) => (
                    <Chip
                        key={index}
                        label={tag.name}
                        size="small"
                        color={getTagColor(tag)}
                        variant="filled"
                    />
                ))}
                {remaining > 0 && (
                    <Chip
                        label={`+${remaining}`}
                        size="small"
                        variant="outlined"
                    />
                )}
            </Box>
        );
    };

    // 同步处理
    const handleOpenSync = async () => {
        setLoading(true);
        try {
            const response = await getSyncPreview();
            setSyncCandidates(response.data);
            setSyncDialogOpen(true);
        } catch (err: any) {
            console.error('Failed to get sync preview:', err);
            showSnackbar(err.response?.data?.detail || '获取同步数据失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleSyncSuccess = (created: number, updated: number) => {
        showSnackbar(`同步成功: 新增 ${created} 条, 更新 ${updated} 条`, 'success');
        fetchCustomers();
    };


    // ========== 排序处理 ==========
    const handleRequestSort = (property: string) => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
        setPage(0);
    };

    const handleMobileSortClick = (event: React.MouseEvent<HTMLElement>) => {
        setSortAnchorEl(event.currentTarget);
    };

    const handleMobileSortClose = () => {
        setSortAnchorEl(null);
    };

    const handleMobileSortSelect = (property: string, sortOrder: 'asc' | 'desc') => {
        setOrderBy(property);
        setOrder(sortOrder);
        setPage(0);
        handleMobileSortClose();
    };

    // ========== 移动端卡片布局 ==========
    const renderMobileCards = () => (
        <Box>
            {customers.map((customer) => (
                <Paper key={customer.id} variant="outlined" sx={{ p: 2, mb: 2 }}>
                    {/* 客户名称（作为卡片标题，可点击） */}
                    <Typography
                        variant="h6"
                        gutterBottom
                        sx={{
                            cursor: 'pointer',
                            color: 'primary.main',
                            '&:hover': { textDecoration: 'underline' },
                            fontWeight: 'bold',
                            fontSize: '1.1rem',
                            mb: 2
                        }}
                        onClick={() => handleView(customer)}
                    >
                        {customer.user_name || '未命名客户'}
                    </Typography>

                    {/* 信息行1：简称和气象区域 */}
                    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" color="text.secondary">客户简称:</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
                                {customer.short_name || '-'}
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" color="text.secondary">位置:</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
                                {customer.location || '-'}
                            </Typography>
                        </Box>
                    </Box>

                    {/* 信息行2：资产统计和标签 */}
                    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                户:{customer.account_count} 表:{customer.meter_count} 点:{customer.mp_count}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>当年签约(万度):</Typography>
                            <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                {customer.current_year_contract_amount || '-'}
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" color="text.secondary">标签:</Typography>
                            {renderTags(customer.tags || [])}
                        </Box>
                    </Box>

                    {/* 操作按钮区域 */}
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                        <Tooltip title="查看">
                            <IconButton size="small" onClick={() => handleView(customer)}>
                                <VisibilityIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="编辑">
                            <IconButton size="small" onClick={() => handleEdit(customer)}>
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="删除">
                            <IconButton size="small" onClick={() => handleDeleteClick(customer)} color="error">
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Paper>
            ))}
        </Box>
    );

    // ========== 桌面端表格操作按钮 ==========
    const renderTableActions = (customer: CustomerListItem) => (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Tooltip title="查看">
                <IconButton size="small" onClick={() => handleView(customer)}>
                    <VisibilityIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title="编辑">
                <IconButton size="small" onClick={() => handleEdit(customer)}>
                    <EditIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title="删除">
                <IconButton size="small" onClick={() => handleDeleteClick(customer)}>
                    <DeleteIcon fontSize="small" color="error" />
                </IconButton>
            </Tooltip>
        </Box>
    );

    // ========== 移动端路由视图 ==========

    // 移动端：渲染新增页面
    if (isMobile && isCreateView) {
        return (
            <Box sx={{ width: '100%' }}>
                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton onClick={handleBackToList} size="small">
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography variant="h6">新增客户</Typography>
                    </Box>
                </Paper>

                <CustomerEditorDialog
                    open={true}
                    mode="create"
                    customer={null}
                    onClose={handleBackToList}
                    onSave={handleSaveSuccess}
                />
            </Box>
        );
    }

    // 移动端：渲染详情页面
    if (isMobile && isDetailView) {
        return (
            <Box sx={{ width: '100%' }}>
                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton onClick={handleBackToList} size="small">
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography variant="h6">客户详情</Typography>
                    </Box>
                </Paper>

                {mobileCustomerLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                        <Typography variant="body2" sx={{ ml: 2 }}>正在加载客户详情...</Typography>
                    </Box>
                ) : mobileCustomerError ? (
                    <Alert severity="error">{mobileCustomerError}</Alert>
                ) : mobileCustomerData ? (
                    <CustomerDetailsDialog
                        open={true}
                        customerId={currentCustomerId || null}
                        onClose={handleBackToList}
                        onEdit={(customerId) => navigate(`/customer/profiles/edit/${customerId}`)}
                    />
                ) : currentCustomerId ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                        <Typography variant="body2" sx={{ ml: 2 }}>正在加载客户数据...</Typography>
                    </Box>
                ) : (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <Typography variant="body2" color="text.secondary">
                            未找到客户信息
                        </Typography>
                    </Box>
                )}
            </Box>
        );
    }

    // 移动端：渲染编辑页面
    if (isMobile && isEditView) {
        return (
            <Box sx={{ width: '100%' }}>
                <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton onClick={handleBackToList} size="small">
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography variant="h6">编辑客户</Typography>
                    </Box>
                </Paper>

                {mobileCustomerLoading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : mobileCustomerError ? (
                    <Alert severity="error">{mobileCustomerError}</Alert>
                ) : mobileCustomerData ? (
                    <CustomerEditorDialog
                        open={true}
                        mode="edit"
                        customer={mobileCustomerData}
                        onClose={handleBackToList}
                        onSave={handleSaveSuccess}
                    />
                ) : null}
            </Box>
        );
    }

    // ========== 主列表视图 ==========
    return (
        <Box sx={{ width: '100%' }}>
            {/* 移动端面包屑标题 */}
            {isTablet && (
                <Typography
                    variant="subtitle1"
                    sx={{
                        mb: 2,
                        fontWeight: 'bold',
                        color: 'text.primary'
                    }}
                >
                    客户管理 / 客户档案管理
                </Typography>
            )}

            {/* 查询区域 */}
            <Paper variant="outlined" sx={{ mb: 2 }}>
                {/* 移动端折叠标题栏 */}
                {isMobile ? (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            p: 1.5,
                        }}
                    >
                        <Box
                            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', flex: 1 }}
                            onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                        >
                            <FilterListIcon sx={{ color: 'primary.main' }} />
                            <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
                                筛选条件
                            </Typography>
                            {hasActiveFilters && (
                                <Chip
                                    size="small"
                                    label="已筛选"
                                    color="primary"
                                    variant="outlined"
                                />
                            )}
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Button
                                size="small"
                                startIcon={<SortIcon />}
                                onClick={handleMobileSortClick}
                                variant="outlined"
                                sx={{ mr: 1 }}
                            >
                                排序
                            </Button>
                            {isFilterExpanded ? (
                                <ExpandLessIcon sx={{ color: 'text.secondary' }} onClick={() => setIsFilterExpanded(false)} />
                            ) : (
                                <ExpandMoreIcon sx={{ color: 'text.secondary' }} onClick={() => setIsFilterExpanded(true)} />
                            )}
                        </Box>

                        {/* 移动端排序菜单 */}
                        <Menu
                            anchorEl={sortAnchorEl}
                            open={Boolean(sortAnchorEl)}
                            onClose={handleMobileSortClose}
                        >
                            <MenuItem onClick={() => handleMobileSortSelect('created_at', 'desc')}>创建时间: 降序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('created_at', 'asc')}>创建时间: 升序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('user_name', 'asc')}>客户名称: 升序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('user_name', 'desc')}>客户名称: 降序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('location', 'asc')}>位置: 升序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('location', 'desc')}>位置: 降序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('current_year_contract_amount', 'asc')}>签约电量: 升序</MenuItem>
                            <MenuItem onClick={() => handleMobileSortSelect('current_year_contract_amount', 'desc')}>签约电量: 降序</MenuItem>
                        </Menu>
                    </Box>
                ) : null}

                {/* 桌面端始终显示，移动端展开时显示 */}
                {(!isMobile || isFilterExpanded) && (
                    <Box sx={{ p: { xs: isMobile ? 1 : 2, sm: 2 } }}>
                        <Box sx={{
                            display: 'flex',
                            gap: 2,
                            flexWrap: 'wrap',
                            alignItems: isMobile ? 'stretch' : 'center',
                            flexDirection: isMobile ? 'column' : 'row'
                        }}>
                            {/* 搜索字段 */}
                            <Box sx={{
                                display: 'flex',
                                gap: 2,
                                flexWrap: 'wrap',
                                width: isMobile ? '100%' : 'auto'
                            }}>
                                <TextField
                                    label="客户名称/户号"
                                    variant="outlined"
                                    size="small"
                                    value={filters.keyword || ''}
                                    onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                                    sx={{ width: { xs: '100%', sm: '200px' } }}
                                    placeholder="输入关键词搜索"
                                />

                                {/* 标签筛选 */}
                                <TagFilter
                                    selectedTags={filters.tags || []}
                                    onChange={handleTagsChange}
                                    onReset={() => setFilters(prev => ({ ...prev, tags: [] }))}
                                />
                            </Box>

                            {/* 操作按钮 */}
                            <Box sx={{
                                display: 'flex',
                                gap: 1,
                                justifyContent: isMobile ? 'stretch' : 'flex-start',
                                width: isMobile ? '100%' : 'auto',
                                mt: isMobile ? 1 : 0
                            }}>
                                <Button
                                    variant="outlined"
                                    onClick={handleReset}
                                    sx={{ width: isMobile ? '100%' : 'auto' }}
                                >
                                    重置
                                </Button>
                            </Box>
                        </Box>

                        {/* 移动端展开时添加关闭按钮 */}
                        {isMobile && (
                            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                                <Button
                                    variant="text"
                                    onClick={() => setIsFilterExpanded(false)}
                                    startIcon={<ExpandLessIcon />}
                                    sx={{ color: 'text.secondary' }}
                                >
                                    收起筛选
                                </Button>
                            </Box>
                        )}
                    </Box>
                )}
            </Paper>

            {/* 列表区域 */}
            <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
                {/* 工具栏 */}
                <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleCreate}
                    >
                        + 新增
                    </Button>
                    <Tooltip title="同步交易平台48点测量点数据里的客户档案信息">
                        <Button
                            variant="outlined"
                            startIcon={<SyncIcon />}
                            onClick={handleOpenSync}
                            disabled={loading}
                        >
                            同步数据
                        </Button>
                    </Tooltip>
                </Box>

                {/* 根据设备类型显示不同的布局 */}
                {isMobile ? (
                    // 移动端卡片布局
                    <Box>
                        {loading ? (
                            <Box display="flex" justifyContent="center" alignItems="center" py={4}>
                                <CircularProgress />
                            </Box>
                        ) : customers.length === 0 ? (
                            <Box display="flex" justifyContent="center" alignItems="center" py={4}>
                                <Typography color="text.secondary">
                                    暂无数据
                                </Typography>
                            </Box>
                        ) : (
                            <>
                                {renderMobileCards()}
                                {/* 移动端分页 */}
                                <TablePagination
                                    rowsPerPageOptions={[10, 20]}
                                    component="div"
                                    count={total}
                                    rowsPerPage={pageSize}
                                    page={page}
                                    onPageChange={(e, newPage) => setPage(newPage)}
                                    onRowsPerPageChange={(e) => {
                                        const newSize = parseInt(e.target.value, 10);
                                        setPageSize(newSize);
                                        setPage(0);
                                    }}
                                    labelRowsPerPage="行数:"
                                    labelDisplayedRows={({ from, to, count }) => `${from}-${to}/${count}`}
                                    sx={{
                                        '& .MuiTablePagination-toolbar': {
                                            paddingLeft: { xs: 1, sm: 2 },
                                            paddingRight: { xs: 1, sm: 2 },
                                        },
                                        '& .MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
                                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                        },
                                        '& .MuiTablePagination-input': {
                                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                        }
                                    }}
                                />
                            </>
                        )}
                    </Box>
                ) : (
                    // 桌面端表格布局
                    <>
                        {loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                                <CircularProgress />
                            </Box>
                        ) : error ? (
                            <Alert severity="error">{error}</Alert>
                        ) : (
                            <>
                                <TableContainer sx={{ overflowX: 'auto' }}>
                                    <Table sx={{
                                        '& .MuiTableCell-root': {
                                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                            px: { xs: 0.5, sm: 2 },
                                        }
                                    }}>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>
                                                    <TableSortLabel
                                                        active={orderBy === 'user_name'}
                                                        direction={orderBy === 'user_name' ? order : 'asc'}
                                                        onClick={() => handleRequestSort('user_name')}
                                                    >
                                                        客户名称
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell>
                                                    <TableSortLabel
                                                        active={orderBy === 'location'}
                                                        direction={orderBy === 'location' ? order : 'asc'}
                                                        onClick={() => handleRequestSort('location')}
                                                    >
                                                        位置
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell>标签</TableCell>
                                                <TableCell>资产统计</TableCell>
                                                <TableCell>
                                                    <TableSortLabel
                                                        active={orderBy === 'current_year_contract_amount'}
                                                        direction={orderBy === 'current_year_contract_amount' ? order : 'asc'}
                                                        onClick={() => handleRequestSort('current_year_contract_amount')}
                                                    >
                                                        当年签约电量(万度)
                                                    </TableSortLabel>
                                                </TableCell>
                                                <TableCell align="right">操作</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {customers.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={5} sx={{ textAlign: 'center', py: 3 }}>
                                                        <Typography variant="body2" color="text.secondary">暂无数据</Typography>
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                customers.map((customer) => (
                                                    <TableRow key={customer.id}>
                                                        <TableCell>
                                                            <Typography
                                                                sx={{
                                                                    cursor: 'pointer',
                                                                    color: 'primary.main',
                                                                    '&:hover': { textDecoration: 'underline' }
                                                                }}
                                                                onClick={() => handleView(customer)}
                                                            >
                                                                {customer.user_name || '未命名客户'}
                                                            </Typography>
                                                            {customer.short_name && (
                                                                <Typography variant="caption" color="text.secondary" display="block">
                                                                    ({customer.short_name})
                                                                </Typography>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>{customer.location || '-'}</TableCell>
                                                        <TableCell>{renderTags(customer.tags || [])}</TableCell>
                                                        <TableCell>
                                                            户:{customer.account_count} 表:{customer.meter_count} 点:{customer.mp_count}
                                                        </TableCell>
                                                        <TableCell>{customer.current_year_contract_amount || '-'}</TableCell>
                                                        <TableCell align="right" sx={{ pr: 1 }}>{renderTableActions(customer)}</TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </TableContainer>

                                {/* 分页 */}
                                <TablePagination
                                    component="div"
                                    count={total}
                                    page={page}
                                    onPageChange={(e, newPage) => setPage(newPage)}
                                    rowsPerPage={pageSize}
                                    onRowsPerPageChange={(e) => {
                                        setPageSize(parseInt(e.target.value, 10));
                                        setPage(0);
                                    }}
                                    rowsPerPageOptions={[10, 25, 50]}
                                    labelRowsPerPage="每页行数:"
                                />
                            </>
                        )}
                    </>
                )}
            </Paper>

            {/* 桌面端对话框 */}
            <CustomerEditorDialog
                open={isEditorOpen}
                mode={editorMode}
                customer={selectedCustomer}
                onClose={() => {
                    setIsEditorOpen(false);
                    setSelectedCustomer(null);
                }}
                onSave={handleSaveSuccess}
            />

            <CustomerDetailsDialog
                open={isDetailsDialogOpen}
                customerId={selectedCustomerId}
                onClose={handleCloseDetailsDialog}
                onEdit={handleEditFromDetails}
            />

            <DeleteConfirmDialog
                open={deleteDialogOpen}
                customerName={customerToDelete?.user_name}
                onClose={() => {
                    setDeleteDialogOpen(false);
                    setCustomerToDelete(null);
                }}
                onConfirm={handleDeleteConfirm}
            />

            <SyncConfirmDialog
                open={syncDialogOpen}
                candidates={syncCandidates}
                onClose={() => setSyncDialogOpen(false)}
                onSyncSuccess={handleSyncSuccess}
            />

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={handleSnackbarClose}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default CustomerManagementPage;