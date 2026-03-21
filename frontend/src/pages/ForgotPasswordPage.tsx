import React, { useState } from 'react';
import { AxiosError } from 'axios';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Container,
    Link,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined';
import { resetForgottenPassword, sendForgotPasswordCode } from '../api/forgotPassword';

const ForgotPasswordPage: React.FC = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [codeSent, setCodeSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const handleSendCode = async () => {
        setError('');
        setMessage('');
        if (!username.trim() || !email.trim()) {
            setError('请输入账户和绑定邮箱');
            return;
        }

        setLoading(true);
        try {
            const result = await sendForgotPasswordCode(username.trim(), email.trim());
            setCodeSent(true);
            setMessage(result.message || '如果账户与邮箱匹配，验证码已发送');
        } catch (err) {
            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            setError(typeof detail === 'string' ? detail : '验证码发送失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async () => {
        setError('');
        setMessage('');
        if (!username.trim() || !email.trim() || !code.trim() || !newPassword || !confirmPassword) {
            setError('请完整填写账户、邮箱、验证码和新密码');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('两次输入的新密码不一致');
            return;
        }

        setLoading(true);
        try {
            const result = await resetForgottenPassword({
                username: username.trim(),
                email: email.trim(),
                code: code.trim(),
                new_password: newPassword,
            });
            setMessage(result.message || '密码重置成功，请重新登录');
            window.setTimeout(() => navigate('/login', { replace: true }), 1200);
        } catch (err) {
            const detail = err instanceof AxiosError ? err.response?.data?.detail : '';
            setError(typeof detail === 'string' ? detail : '密码重置失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container component="main" maxWidth="xs">
            <Paper elevation={6} sx={{ marginTop: 8, padding: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <LockResetOutlinedIcon sx={{ fontSize: 40, mb: 1 }} color="primary" />
                <Typography component="h1" variant="h5">
                    忘记密码
                </Typography>
                <Typography component="h2" variant="subtitle1" sx={{ mb: 2 }}>
                    通过账户与绑定邮箱重置密码
                </Typography>

                <Stack spacing={2} sx={{ width: '100%' }}>
                    <TextField
                        label="账户"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        fullWidth
                        disabled={loading}
                    />
                    <TextField
                        label="绑定邮箱"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        fullWidth
                        disabled={loading}
                    />
                    <Typography variant="caption" color="text.secondary">
                        请输入账户当前绑定且已验证的邮箱地址，用于接收重置密码验证码。
                    </Typography>

                    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
                    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}

                    <Button
                        variant="outlined"
                        startIcon={<EmailOutlinedIcon />}
                        onClick={handleSendCode}
                        disabled={loading}
                    >
                        {loading && !codeSent ? <CircularProgress size={20} color="inherit" /> : '发送验证码'}
                    </Button>

                    {codeSent && (
                        <>
                            <TextField
                                label="邮箱验证码"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                fullWidth
                                disabled={loading}
                            />
                            <TextField
                                label="新密码"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                autoComplete="new-password"
                                fullWidth
                                disabled={loading}
                            />
                            <TextField
                                label="确认新密码"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                autoComplete="new-password"
                                fullWidth
                                disabled={loading}
                            />
                            <Typography variant="caption" color="text.secondary">
                                新密码至少 8 位，且需满足大写字母、小写字母、数字、特殊字符四类中的至少三类。
                            </Typography>
                            <Button
                                variant="contained"
                                onClick={handleResetPassword}
                                disabled={loading}
                            >
                                {loading ? <CircularProgress size={20} color="inherit" /> : '重置密码'}
                            </Button>
                        </>
                    )}

                    <Box textAlign="center">
                        <Link component={RouterLink} to="/login" underline="hover">
                            返回登录
                        </Link>
                    </Box>
                </Stack>
            </Paper>
        </Container>
    );
};

export default ForgotPasswordPage;
