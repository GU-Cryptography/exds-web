/**
 * 标签管理对话框组件
 * 支持查看、编辑和删除系统标签
 */
import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    TextField,
    IconButton,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    CircularProgress,
    Alert,
    Divider,
    useTheme,
    useMediaQuery,
    Menu,
    MenuItem,
    Tooltip,
    Snackbar
} from '@mui/material';
import {
    Edit as EditIcon,
    Delete as DeleteIcon,
    Add as AddIcon,
    Close as CloseIcon,
    ArrowBack as ArrowBackIcon,
    MoreVert as MoreVertIcon,
    Search as SearchIcon
} from '@mui/icons-material';
import {
    CustomerTag,
    getCustomerTags,
    createCustomerTag,
    updateCustomerTag,
    deleteCustomerTag
} from '../../api/customer';

interface TagManagementDialogProps {
    open: boolean;
    onClose: () => void;
    onTagsChanged?: () => void;  // 标签变更后的回调
}

export const TagManagementDialog: React.FC<TagManagementDialogProps> = ({
    open,
    onClose,
    onTagsChanged
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // 状态
    const [tags, setTags] = useState<CustomerTag[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchKeyword, setSearchKeyword] = useState('');

    // 编辑状态
    const [editingTag, setEditingTag] = useState<CustomerTag | null>(null);
    const [editName, setEditName] = useState('');
    const [editCategory, setEditCategory] = useState('');

    // 新增状态
    const [isAdding, setIsAdding] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagCategory, setNewTagCategory] = useState('');

    // 删除确认状态
    const [deleteConfirmTag, setDeleteConfirmTag] = useState<CustomerTag | null>(null);
    const [deleting, setDeleting] = useState(false);

    // 移动端操作菜单
    const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
    const [menuTag, setMenuTag] = useState<CustomerTag | null>(null);

    // Snackbar
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
        open: false,
        message: '',
        severity: 'success'
    });

    // 加载标签列表
    const loadTags = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await getCustomerTags();
            setTags(response.data);
        } catch (err: any) {
            console.error('加载标签失败:', err);
            setError(err.response?.data?.detail || '加载标签失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadTags();
        }
    }, [open]);

    // 过滤标签
    const filteredTags = tags.filter(tag =>
        tag.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        (tag.category && tag.category.toLowerCase().includes(searchKeyword.toLowerCase()))
    );

    // 开始编辑
    const handleStartEdit = (tag: CustomerTag) => {
        setEditingTag(tag);
        setEditName(tag.name);
        setEditCategory(tag.category || '');
        handleCloseMenu();
    };

    // 保存编辑
    const handleSaveEdit = async () => {
        if (!editingTag || !editingTag._id) return;

        try {
            await updateCustomerTag(editingTag._id, {
                name: editName,
                category: editCategory || undefined
            });
            setSnackbar({ open: true, message: '标签更新成功', severity: 'success' });
            setEditingTag(null);
            loadTags();
            onTagsChanged?.();
        } catch (err: any) {
            console.error('更新标签失败:', err);
            setSnackbar({
                open: true,
                message: err.response?.data?.detail || '更新标签失败',
                severity: 'error'
            });
        }
    };

    // 取消编辑
    const handleCancelEdit = () => {
        setEditingTag(null);
        setEditName('');
        setEditCategory('');
    };

    // 开始删除确认
    const handleStartDelete = (tag: CustomerTag) => {
        setDeleteConfirmTag(tag);
        handleCloseMenu();
    };

    // 确认删除
    const handleConfirmDelete = async () => {
        if (!deleteConfirmTag || !deleteConfirmTag._id) return;

        setDeleting(true);
        try {
            const response = await deleteCustomerTag(deleteConfirmTag._id);
            setSnackbar({
                open: true,
                message: `标签 "${deleteConfirmTag.name}" 已删除，影响 ${response.data.affected_customers_count} 个客户`,
                severity: 'success'
            });
            setDeleteConfirmTag(null);
            loadTags();
            onTagsChanged?.();
        } catch (err: any) {
            console.error('删除标签失败:', err);
            setSnackbar({
                open: true,
                message: err.response?.data?.detail || '删除标签失败',
                severity: 'error'
            });
        } finally {
            setDeleting(false);
        }
    };

    // 新增标签
    const handleAddTag = async () => {
        if (!newTagName.trim()) return;

        try {
            await createCustomerTag({
                name: newTagName.trim(),
                category: newTagCategory.trim() || undefined
            });
            setSnackbar({ open: true, message: '标签创建成功', severity: 'success' });
            setIsAdding(false);
            setNewTagName('');
            setNewTagCategory('');
            loadTags();
            onTagsChanged?.();
        } catch (err: any) {
            console.error('创建标签失败:', err);
            setSnackbar({
                open: true,
                message: err.response?.data?.detail || '创建标签失败',
                severity: 'error'
            });
        }
    };

    // 移动端菜单操作
    const handleOpenMenu = (event: React.MouseEvent<HTMLElement>, tag: CustomerTag) => {
        setMenuAnchorEl(event.currentTarget);
        setMenuTag(tag);
    };

    const handleCloseMenu = () => {
        setMenuAnchorEl(null);
        setMenuTag(null);
    };

    // 渲染标签列表项
    const renderTagItem = (tag: CustomerTag) => {
        const isEditing = editingTag?._id === tag._id;

        if (isEditing) {
            return (
                <ListItem key={tag._id} sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, py: 2 }}>
                    <TextField
                        label="标签名称"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        size="small"
                        fullWidth
                        autoFocus
                    />
                    <TextField
                        label="分类 (可选)"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        size="small"
                        fullWidth
                    />
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        <Button size="small" onClick={handleCancelEdit}>取消</Button>
                        <Button size="small" variant="contained" onClick={handleSaveEdit} disabled={!editName.trim()}>
                            保存
                        </Button>
                    </Box>
                </ListItem>
            );
        }

        return (
            <ListItem key={tag._id} sx={{ py: 1.5 }}>
                <ListItemText
                    primary={tag.name}
                    secondary={tag.category ? `分类: ${tag.category}` : undefined}
                    primaryTypographyProps={{ fontWeight: 'medium' }}
                />
                <ListItemSecondaryAction>
                    {isMobile ? (
                        <IconButton edge="end" onClick={(e) => handleOpenMenu(e, tag)}>
                            <MoreVertIcon />
                        </IconButton>
                    ) : (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Tooltip title="编辑">
                                <IconButton size="small" onClick={() => handleStartEdit(tag)}>
                                    <EditIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="删除">
                                <IconButton size="small" onClick={() => handleStartDelete(tag)} color="error">
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    )}
                </ListItemSecondaryAction>
            </ListItem>
        );
    };

    return (
        <>
            <Dialog
                open={open}
                onClose={onClose}
                fullScreen={isMobile}
                fullWidth
                maxWidth="sm"
            >
                {/* 标题栏 */}
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isMobile && (
                        <IconButton edge="start" onClick={onClose} size="small">
                            <ArrowBackIcon />
                        </IconButton>
                    )}
                    <Typography variant="h6" sx={{ flex: 1 }}>标签管理</Typography>
                    {!isMobile && (
                        <IconButton edge="end" onClick={onClose} size="small">
                            <CloseIcon />
                        </IconButton>
                    )}
                </DialogTitle>

                <DialogContent dividers>
                    {/* 搜索框 */}
                    <TextField
                        placeholder="搜索标签..."
                        value={searchKeyword}
                        onChange={(e) => setSearchKeyword(e.target.value)}
                        size="small"
                        fullWidth
                        sx={{ mb: 2 }}
                        InputProps={{
                            startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />
                        }}
                    />

                    {/* 加载状态 */}
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : error ? (
                        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
                    ) : (
                        <>
                            {/* 标签列表 */}
                            <List disablePadding>
                                {filteredTags.length === 0 ? (
                                    <ListItem>
                                        <ListItemText
                                            primary="暂无标签"
                                            secondary={searchKeyword ? '没有匹配的标签' : '点击下方按钮创建第一个标签'}
                                            sx={{ textAlign: 'center' }}
                                        />
                                    </ListItem>
                                ) : (
                                    filteredTags.map((tag, index) => (
                                        <React.Fragment key={tag._id}>
                                            {renderTagItem(tag)}
                                            {index < filteredTags.length - 1 && <Divider />}
                                        </React.Fragment>
                                    ))
                                )}
                            </List>

                            {/* 新增标签表单 */}
                            {isAdding && (
                                <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                                    <Typography variant="subtitle2" gutterBottom>新增标签</Typography>
                                    <TextField
                                        label="标签名称"
                                        value={newTagName}
                                        onChange={(e) => setNewTagName(e.target.value)}
                                        size="small"
                                        fullWidth
                                        autoFocus
                                        sx={{ mb: 1 }}
                                    />
                                    <TextField
                                        label="分类 (可选)"
                                        value={newTagCategory}
                                        onChange={(e) => setNewTagCategory(e.target.value)}
                                        size="small"
                                        fullWidth
                                        sx={{ mb: 1 }}
                                    />
                                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                        <Button size="small" onClick={() => setIsAdding(false)}>取消</Button>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            onClick={handleAddTag}
                                            disabled={!newTagName.trim()}
                                        >
                                            创建
                                        </Button>
                                    </Box>
                                </Box>
                            )}
                        </>
                    )}
                </DialogContent>

                <DialogActions sx={{ justifyContent: 'space-between', px: 2 }}>
                    {!isAdding && (
                        <Button
                            startIcon={<AddIcon />}
                            onClick={() => setIsAdding(true)}
                            disabled={loading}
                        >
                            新增标签
                        </Button>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Button onClick={onClose}>关闭</Button>
                </DialogActions>
            </Dialog>

            {/* 移动端操作菜单 */}
            <Menu
                anchorEl={menuAnchorEl}
                open={Boolean(menuAnchorEl)}
                onClose={handleCloseMenu}
            >
                <MenuItem onClick={() => menuTag && handleStartEdit(menuTag)}>
                    <EditIcon fontSize="small" sx={{ mr: 1 }} /> 编辑
                </MenuItem>
                <MenuItem onClick={() => menuTag && handleStartDelete(menuTag)} sx={{ color: 'error.main' }}>
                    <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> 删除
                </MenuItem>
            </Menu>

            {/* 删除确认对话框 */}
            <Dialog open={Boolean(deleteConfirmTag)} onClose={() => setDeleteConfirmTag(null)}>
                <DialogTitle>确认删除</DialogTitle>
                <DialogContent>
                    <Typography>
                        确定要删除标签 <strong>"{deleteConfirmTag?.name}"</strong> 吗？
                    </Typography>
                    <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
                        删除后，所有使用该标签的客户将自动移除此标签。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteConfirmTag(null)} disabled={deleting}>取消</Button>
                    <Button
                        onClick={handleConfirmDelete}
                        color="error"
                        variant="contained"
                        disabled={deleting}
                    >
                        {deleting ? '删除中...' : '确认删除'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert
                    onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                    severity={snackbar.severity}
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </>
    );
};

export default TagManagementDialog;
