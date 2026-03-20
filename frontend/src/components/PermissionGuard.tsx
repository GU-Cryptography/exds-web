import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Box, Typography } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';

interface PermissionGuardProps {
    permission?: string;
    anyPermission?: string[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export const PermissionGuard: React.FC<PermissionGuardProps> = ({
    permission,
    anyPermission,
    children,
    fallback
}) => {
    const { hasPermission, isSuperAdmin, isPermissionLoaded } = useAuth();

    if (!isPermissionLoaded) {
        return null; // 等待权限加载完毕，由 ProtectedRoute 处理 loading 态
    }

    if (isSuperAdmin) {
        return <>{children}</>;
    }

    let isAllowed = false;

    if (permission) {
        isAllowed = hasPermission(permission);
    } else if (anyPermission && anyPermission.length > 0) {
        isAllowed = anyPermission.some(p => hasPermission(p));
    } else {
        // 无权限要求，直接放行
        isAllowed = true;
    }

    if (!isAllowed) {
        if (fallback !== undefined) {
            return <>{fallback}</>;
        }

        return (
            <Box
                display="flex"
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
                minHeight="300px"
                p={4}
                textAlign="center"
            >
                <BlockIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h5" color="text.primary" gutterBottom>
                    访问受限
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    您没有权限执行此操作或访问此页面。请联系系统管理员。
                </Typography>
            </Box>
        );
    }

    return <>{children}</>;
};

export default PermissionGuard;
