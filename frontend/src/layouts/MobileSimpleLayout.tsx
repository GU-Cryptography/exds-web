import React, { useState } from 'react';
import {
    Box,
    AppBar,
    Toolbar,
    Typography,
    Drawer,
    IconButton,
    Chip,
} from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { useTabContext } from '../contexts/TabContext';
import { routeConfigs } from '../config/routes';

const drawerWidth = 260;

/**
 * 移动端单页布局组件
 * 支持TabContext动态Tab渲染（与桌面端一致）
 */
export const MobileSimpleLayout: React.FC = () => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const { openTabs, activeTabKey, removeTab } = useTabContext();
    const location = useLocation();
    const navigate = useNavigate();

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    // 获取当前激活的Tab
    const activeTab = openTabs.find(tab => tab.key === activeTabKey);

    // 根据路径获取页面标题（当没有激活Tab时）
    const getPageTitle = () => {
        if (activeTab) return activeTab.title;
        const currentPath = location.pathname;
        if (currentPath === '/' || currentPath === '') return '电力交易辅助分析系统';

        // 尝试匹配路由配置中的标题
        const config = routeConfigs.find(c => {
            const pattern = c.path.replace(/:\w+/g, '.*');
            return new RegExp(`^${pattern}$`).test(currentPath);
        });
        return config ? config.title : '交易系统';
    };

    // 关闭当前Tab或返回上一页
    const handleBack = () => {
        if (activeTabKey) {
            removeTab(activeTabKey);
        } else {
            navigate(-1);
        }
    };

    const isRoot = location.pathname === '/' || location.pathname === '';
    const showBackButton = activeTab || !isRoot;

    return (
        <Box sx={{ display: 'flex', bgcolor: 'background.default', minHeight: '100vh' }}>
            {/* 顶部工具栏 */}
            <AppBar
                position="fixed"
                sx={{
                    zIndex: (theme) => theme.zIndex.drawer + 1,
                    boxShadow: 'none',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Toolbar>
                    {showBackButton ? (
                        // 有Tab或不在首页时显示返回按钮
                        <IconButton
                            color="inherit"
                            edge="start"
                            onClick={handleBack}
                            sx={{ mr: 1 }}
                        >
                            <ArrowBackIcon />
                        </IconButton>
                    ) : (
                        // 首页且无Tab时显示菜单按钮
                        <IconButton
                            color="inherit"
                            aria-label="open drawer"
                            edge="start"
                            onClick={handleDrawerToggle}
                            sx={{ mr: 2, display: { sm: 'none' } }}
                        >
                            <MenuIcon />
                        </IconButton>
                    )}
                    <InsightsIcon sx={{ mr: 1.5 }} />
                    <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1, fontSize: '1.1rem', fontWeight: 700 }}>
                        {getPageTitle()}
                    </Typography>
                    {activeTab && (
                        <IconButton color="inherit" onClick={handleBack}>
                            <CloseIcon />
                        </IconButton>
                    )}
                </Toolbar>
            </AppBar>

            {/* 侧边栏 */}
            <Box
                component="nav"
                sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
            >
                {/* 移动端抽屉 */}
                <Drawer
                    variant="temporary"
                    open={mobileOpen}
                    onClose={handleDrawerToggle}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        display: { xs: 'block', sm: 'none' },
                        '& .MuiDrawer-paper': {
                            boxSizing: 'border-box',
                            width: drawerWidth,
                            borderRight: 'none',
                        },
                    }}
                >
                    <Sidebar isMobile={true} onItemClick={handleDrawerToggle} />
                </Drawer>
                {/* 桌面端抽屉 */}
                <Drawer
                    variant="permanent"
                    sx={{
                        display: { xs: 'none', sm: 'block' },
                        '& .MuiDrawer-paper': {
                            boxSizing: 'border-box',
                            width: drawerWidth,
                            borderRight: 'none',
                        },
                    }}
                    open
                >
                    <Sidebar isMobile={true} onItemClick={handleDrawerToggle} />
                </Drawer>
            </Box>

            {/* 主内容区 */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    p: activeTab ? 0 : 3,  // Tab页面时无padding，让组件自己控制
                    width: { sm: `calc(100% - ${drawerWidth}px)` },
                }}
            >
                <Toolbar />
                {/* 如果有激活的Tab，显示Tab内容；否则显示路由内容 */}
                {activeTab ? (
                    <Box sx={{ p: 1 }}>
                        {activeTab.component}
                    </Box>
                ) : (
                    <Outlet />
                )}
            </Box>
        </Box>
    );
};
