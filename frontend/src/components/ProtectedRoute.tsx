import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { useAuth } from '../contexts/AuthContext';
import { getRequiredViewPermissionForRoute } from '../auth/permissionPrecheck';

const ProtectedRoute: React.FC = () => {
    const location = useLocation();
    const { isAuthenticated, isPermissionLoaded, hasPermission, isSuperAdmin } = useAuth();

    if (isAuthenticated && !isPermissionLoaded) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
                <CircularProgress />
            </Box>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    const requiredViewPermission = getRequiredViewPermissionForRoute(location.pathname);
    const hasViewPermission = !requiredViewPermission || isSuperAdmin || hasPermission(requiredViewPermission);
    if (!hasViewPermission) {
        return (
            <Box
                display="flex"
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
                minHeight="100vh"
                p={4}
                textAlign="center"
            >
                <BlockIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h5" color="text.primary" gutterBottom>
                    无权访问该页面
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    缺少权限：{requiredViewPermission}
                </Typography>
            </Box>
        );
    }

    return <Outlet />;
};

export default ProtectedRoute;
