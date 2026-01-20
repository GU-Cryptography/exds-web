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
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { useTabContext } from '../contexts/TabContext';

const drawerWidth = 260;

/**
 * 移动端单页布局组件
 * 支持TabContext动态Tab渲染（与桌面端一致）
 */
export const MobileSimpleLayout: React.FC = () => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const { openTabs, activeTabKey, setActiveTab, removeTab } = useTabContext();

    const handleDrawerToggle = () => {
        setMobileOpen(!mobileOpen);
    };

    // 获取当前激活的Tab
    const activeTab = openTabs.find(tab => tab.key === activeTabKey);

    // 关闭当前Tab并返回
    const handleCloseTab = () => {
        if (activeTabKey) {
            removeTab(activeTabKey);
        }
    };

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
                    {activeTab ? (
                        // 有Tab时显示返回按钮
                        <IconButton
                            color="inherit"
                            edge="start"
                            onClick={handleCloseTab}
                            sx={{ mr: 1 }}
                        >
                            <ArrowBackIcon />
                        </IconButton>
                    ) : (
                        // 无Tab时显示菜单按钮
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
                    <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
                        {activeTab ? activeTab.title : '电力交易辅助分析系统'}
                    </Typography>
                    {activeTab && (
                        <IconButton color="inherit" onClick={handleCloseTab}>
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
                    <Sidebar isMobile={true} />
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
                    <Sidebar isMobile={true} />
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
