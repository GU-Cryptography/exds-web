import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Typography,
    Box,
    Alert,
    CircularProgress
} from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';

interface DeleteConfirmDialogProps {
    open: boolean;
    title?: string;
    message?: string;
    customerName?: string;
    onClose: () => void;
    onConfirm: (password: string) => Promise<void>;
}

/**
 * 删除确认对话框
 * 需要输入登录密码才能执行删除操作
 */
const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
    open,
    title = '确认删除',
    message,
    customerName,
    onClose,
    onConfirm
}) => {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirm = async () => {
        if (!password.trim()) {
            setError('请输入密码');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await onConfirm(password);
            handleClose();
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '删除失败');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setPassword('');
        setError(null);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                <WarningIcon />
                {title}
            </DialogTitle>

            <DialogContent>
                <Box sx={{ mb: 2 }}>
                    <Typography variant="body1" gutterBottom>
                        {message || `确定要删除客户 "${customerName || ''}" 吗？`}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        此操作不可撤销。请输入您的登录密码以确认。
                    </Typography>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <TextField
                    fullWidth
                    label="登录密码"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleConfirm();
                        }
                    }}
                    autoFocus
                    disabled={loading}
                    error={!!error}
                />
            </DialogContent>

            <DialogActions>
                <Button onClick={handleClose} disabled={loading}>
                    取消
                </Button>
                <Button
                    onClick={handleConfirm}
                    color="error"
                    variant="contained"
                    disabled={loading || !password.trim()}
                    startIcon={loading ? <CircularProgress size={16} /> : null}
                >
                    {loading ? '删除中...' : '确认删除'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DeleteConfirmDialog;
