import React, { useState, useRef, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Alert,
    CircularProgress,
    Table,
    TableHead,
    TableBody,
    TableRow,
    TableCell,
    TableContainer,
    Paper,
    Chip,
    IconButton,
    Tabs,
    Tab,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    LinearProgress,
    Tooltip,
    FormControlLabel,
    Checkbox
} from '@mui/material';
import {
    Download as DownloadIcon,
    Close as CloseIcon,
    Description as FileIcon,
    CheckCircle as CheckCircleIcon,
    Error as ErrorIcon,
    FolderOpen as FolderIcon,
    Delete as DeleteIcon,
    PlayArrow as PlayArrowIcon,
    History as HistoryIcon
} from '@mui/icons-material';
import { importMeterData, importMpData, ImportResult } from '../../api/load-data';

interface LoadDataImportDialogProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    canEdit?: boolean;
}

interface FileItem {
    id: string;
    file: File;
    status: 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
    message?: string;
    result?: ImportResult;
}

interface HistoryItem {
    name: string;
    size: number;
    lastModified: number;
    timestamp: number;
}

const HISTORY_KEY = 'load_data_import_history';

export const LoadDataImportDialog: React.FC<LoadDataImportDialogProps> = ({
    open,
    onClose,
    onSuccess,
    canEdit = true
}) => {
    const [importType, setImportType] = useState<'meter' | 'mp'>('meter');
    const [overwrite, setOverwrite] = useState(false);
    const [fileList, setFileList] = useState<FileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);

    // Stats
    const totalFiles = fileList.length;
    const successCount = fileList.filter(f => f.status === 'success').length;
    const errorCount = fileList.filter(f => f.status === 'error').length;
    const pendingCount = fileList.filter(f => f.status === 'pending').length;
    const skippedCount = fileList.filter(f => f.status === 'skipped').length;

    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const cancelRef = useRef<boolean>(false);

    // Load history on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(HISTORY_KEY);
            if (saved) {
                setHistory(JSON.parse(saved));
            }
        } catch (e) {
            console.error('Failed to load import history', e);
        }
    }, []);

    // Save history helper
    const saveHistory = (newItem: HistoryItem) => {
        setHistory(prev => {
            // Check if exists
            const exists = prev.some(h =>
                h.name === newItem.name &&
                h.size === newItem.size &&
                h.lastModified === newItem.lastModified
            );

            if (exists) return prev;

            const newHistory = [...prev, newItem];
            // Limit history size to prevent localStorage overflow (e.g., 5000 items)
            if (newHistory.length > 5000) {
                newHistory.shift();
            }

            localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
            return newHistory;
        });
    };

    const clearHistory = () => {
        localStorage.removeItem(HISTORY_KEY);
        setHistory([]);
        setGlobalError(null);
    };

    const isFileImported = (file: File) => {
        return history.some(h =>
            h.name === file.name &&
            h.size === file.size &&
            h.lastModified === file.lastModified
        );
    };

    // Reset state when import type changes
    const handleTabChange = (_: React.SyntheticEvent, newValue: 'meter' | 'mp') => {
        setImportType(newValue);
        setGlobalError(null);
        setFileList([]);
    };

    const handleClose = () => {
        setFileList([]);
        setGlobalError(null);
        setImportType('meter');
        onClose();
    };

    const addFiles = (files: FileList | null) => {
        if (!canEdit) return;
        if (!files) return;

        const validExtensions = ['.xlsx', '.xls'];
        const newItems: FileItem[] = [];
        let skippedCount = 0;

        Array.from(files).forEach(file => {
            const isExcel = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
            if (isExcel) {
                // Check if already in list
                const inList = fileList.some(existing => existing.file.name === file.name && existing.file.size === file.size);

                if (!inList) {
                    const alreadyImported = isFileImported(file);

                    newItems.push({
                        id: Math.random().toString(36).substring(2) + Date.now().toString(36),
                        file,
                        status: alreadyImported ? 'skipped' : 'pending',
                        message: alreadyImported ? '已在历史记录中，跳过' : undefined
                    });

                    if (alreadyImported) skippedCount++;
                }
            }
        });

        if (newItems.length > 0) {
            setFileList(prev => [...prev, ...newItems]);
            setGlobalError(null);

            if (skippedCount > 0) {
                setGlobalError(`已根据历史记录自动标记 ${skippedCount} 个文件为"已完成"`);
            }
        } else if (files.length > 0) {
            setGlobalError('未找到有效的 Excel 文件 (.xlsx, .xls)');
        }
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        addFiles(event.target.files);
        if (event.target) event.target.value = '';
    };

    const handleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        addFiles(event.target.files);
        if (event.target) event.target.value = '';
    };

    const handleRemoveFile = (id: string) => {
        setFileList(prev => prev.filter(item => item.id !== id));
    };

    const handleClearAll = () => {
        setFileList([]);
        setGlobalError(null);
    };

    const processQueue = async () => {
        if (!canEdit) return;
        const pendingFiles = fileList.filter(f => f.status === 'pending');
        if (pendingFiles.length === 0) return;

        setLoading(true);
        setGlobalError(null);
        cancelRef.current = false;

        // Process sequentially
        for (const item of pendingFiles) {
            // Check if cancelled
            if (cancelRef.current) {
                setGlobalError('已取消导入操作，剩余文件保持待处理状态');
                break;
            }

            // Update status to uploading
            setFileList(prev => prev.map(f => f.id === item.id ? { ...f, status: 'uploading' } : f));

            try {
                let response;
                if (importType === 'meter') {
                    response = await importMeterData(item.file, overwrite);
                } else {
                    response = await importMpData(item.file, overwrite);
                }

                const result = response.data;
                const isSuccess = result.success;

                setFileList(prev => prev.map(f => f.id === item.id ? {
                    ...f,
                    status: isSuccess ? 'success' : 'error',
                    result: result,
                    message: isSuccess ? '导入成功' : (result.message || '导入失败')
                } : f));

                if (isSuccess) {
                    saveHistory({
                        name: item.file.name,
                        size: item.file.size,
                        lastModified: item.file.lastModified,
                        timestamp: Date.now()
                    });
                }

            } catch (err: any) {
                const errMsg = err.response?.data?.detail || err.message || '网络错误';
                setFileList(prev => prev.map(f => f.id === item.id ? {
                    ...f,
                    status: 'error',
                    message: errMsg
                } : f));
            }
        }

        setLoading(false);
    };

    const handleCancel = () => {
        cancelRef.current = true;
    };

    const handleDragOver = (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const files = event.dataTransfer.files;
        addFiles(files);
    };


    const renderStatus = (item: FileItem) => {
        switch (item.status) {
            case 'pending':
                return <Chip size="small" label="待处理" variant="outlined" />;
            case 'uploading':
                return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={16} /> <Typography variant="caption">处理中...</Typography>
                </Box>;
            case 'success':
                return <Chip size="small" icon={<CheckCircleIcon />} label="成功" color="success" />;
            case 'skipped':
                return <Chip size="small" icon={<HistoryIcon />} label="已导入" color="default" />;
            case 'error':
                return <Tooltip title={item.message || "未知错误"}>
                    <Chip size="small" icon={<ErrorIcon />} label="失败" color="error" />
                </Tooltip>;
        }
    };

    return (
        <Dialog open={open} onClose={loading ? undefined : handleClose} maxWidth="md" fullWidth>
            <DialogTitle>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h6">批量导入负荷数据</Typography>
                    {!loading && (
                        <IconButton onClick={handleClose} size="small">
                            <CloseIcon />
                        </IconButton>
                    )}
                </Box>
            </DialogTitle>

            <DialogContent>
                <Tabs value={importType} onChange={handleTabChange} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <Tab label="导入电表数据 (Meter)" value="meter" disabled={loading || !canEdit} />
                    <Tab label="导入计量点数据 (MP)" value="mp" disabled={loading || !canEdit} />
                </Tabs>

                {globalError && (
                    <Alert severity="info" sx={{ mb: 2 }} onClose={() => setGlobalError(null)}>
                        {globalError}
                    </Alert>
                )}

                <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button
                        variant="outlined"
                        startIcon={<FileIcon />}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading || !canEdit}
                    >
                        选择文件
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<FolderIcon />}
                        onClick={() => folderInputRef.current?.click()}
                        disabled={loading || !canEdit}
                    >
                        选择文件夹
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />
                    {/* Directory Input */}
                    <input
                        ref={folderInputRef}
                        type="file"
                        // @ts-ignore
                        webkitdirectory=""
                        directory=""
                        onChange={handleFolderSelect}
                        style={{ display: 'none' }}
                    />

                    {history.length > 0 && (
                        <Tooltip title={`清除本地记录的 ${history.length} 条已成功导入文件历史`}>
                            <Button variant="text" size="small" onClick={clearHistory}>
                                清除历史记录
                            </Button>
                        </Tooltip>
                    )}

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={overwrite}
                                onChange={(e) => setOverwrite(e.target.checked)}
                                size="small"
                                disabled={loading || !canEdit}
                            />
                        }
                        label={<Typography variant="body2">覆盖已存在数据</Typography>}
                    />

                    <Box sx={{ flex: 1 }} />

                    {fileList.length > 0 && (
                        <Button color="error" onClick={handleClearAll} disabled={loading || !canEdit} size="small">
                            清空列表
                        </Button>
                    )}
                </Box>

                {/* Drop Zone if empty */}
                {fileList.length === 0 && (
                    <Box
                        sx={{
                            border: '2px dashed',
                            borderColor: 'grey.300',
                            borderRadius: 1,
                            p: 4,
                            textAlign: 'center',
                            cursor: 'pointer',
                            minHeight: 200,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' }
                        }}
                        onClick={() => {
                            if (!canEdit) return;
                            fileInputRef.current?.click();
                        }}
                        onDragOver={(event) => {
                            if (!canEdit) return;
                            handleDragOver(event);
                        }}
                        onDrop={(event) => {
                            if (!canEdit) return;
                            handleDrop(event);
                        }}
                    >
                        <DownloadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                        <Typography variant="body1" color="text.secondary">
                            点击选择文件，或拖拽文件/文件夹到此处
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                            支持 .xlsx, .xls 格式
                        </Typography>
                    </Box>
                )}

                {/* File List */}
                {fileList.length > 0 && (
                    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300, mb: 2 }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>文件名</TableCell>
                                    <TableCell width="120">大小</TableCell>
                                    <TableCell width="120">状态</TableCell>
                                    <TableCell width="100">操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {fileList.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <Typography variant="body2">{item.file.name}</Typography>
                                            {item.result && item.result.errors && item.result.errors.length > 0 && (
                                                <Typography variant="caption" color="error">
                                                    {item.result.errors.length} 个错误
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {(item.file.size / 1024).toFixed(1)} KB
                                        </TableCell>
                                        <TableCell>
                                            {renderStatus(item)}
                                        </TableCell>
                                        <TableCell>
                                            <IconButton
                                                size="small"
                                                disabled={loading || item.status === 'uploading'}
                                                onClick={() => handleRemoveFile(item.id)}
                                            >
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}

                {/* Summary Stats */}
                {fileList.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            总计: {totalFiles}
                        </Typography>
                        <Typography variant="body2" color="success.main">
                            成功: {successCount}
                        </Typography>
                        <Typography variant="body2" color="text.primary">
                            跳过: {skippedCount}
                        </Typography>
                        <Typography variant="body2" color="error">
                            失败: {errorCount}
                        </Typography>
                    </Box>
                )}

            </DialogContent>

            <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleClose} disabled={loading}>
                    {successCount > 0 ? '完成' : '关闭'}
                </Button>
                {pendingCount > 0 && (
                    <Button
                        onClick={processQueue}
                        variant="contained"
                        disabled={loading || !canEdit}
                        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                    >
                        {loading ? '处理中...' : `开始导入 (${pendingCount})`}
                    </Button>
                )}
                {loading && (
                    <Button
                        onClick={handleCancel}
                        variant="outlined"
                        color="warning"
                    >
                        取消
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
