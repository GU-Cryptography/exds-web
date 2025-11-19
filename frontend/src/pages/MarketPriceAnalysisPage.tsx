
import React, { useState } from 'react';
import { Box, Tabs, Tab, Typography, Paper, useMediaQuery, useTheme } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TodayIcon from '@mui/icons-material/Today';
import TimelineIcon from '@mui/icons-material/Timeline';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import { MarketDashboardTab } from '../components/MarketDashboardTab';
import { DayAheadAnalysisTab } from '../components/DayAheadAnalysisTab'; // 导入新组件
import { RealTimeAnalysisTab } from '../components/RealTimeAnalysisTab'; // 导入新组件
import { SpreadAnalysisTab } from '../components/SpreadAnalysisTab'; // 导入新组件
import { PriceCurveComparisonTab } from '../components/PriceCurveComparisonTab';
import { TimeslotAnalysisTab } from '../components/TimeslotAnalysisTab';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`analysis-tabpanel-${index}`}
            aria-labelledby={`analysis-tab-${index}`}
            {...other}
        >
            {/* 移除条件渲染，让Tab内容常驻，仅通过CSS显隐 */}
            <Box sx={{ pt: 3 }}>
                {children}
            </Box>
        </div>
    );
}

export const MarketPriceAnalysisPage: React.FC = () => {
    const [tabIndex, setTabIndex] = useState(0);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    // Tab 配置：图标 + 完整标题 + 移动端简化标题
    const tabsConfig = [
        { icon: <DashboardIcon />, label: '现货价格总览', mobileLabel: '总览' },
        { icon: <TodayIcon />, label: '日前现货分析', mobileLabel: '日前' },
        { icon: <TimelineIcon />, label: '实时现货复盘', mobileLabel: '实时' },
        { icon: <CompareArrowsIcon />, label: '价差归因分析', mobileLabel: '价差' },
    ];

    return (
        <Box sx={{ width: '100%' }}>
            <Paper variant="outlined" sx={{ borderColor: 'divider' }}>
                <Tabs
                    value={tabIndex}
                    onChange={handleTabChange}
                    aria-label="market price analysis tabs"
                    variant="scrollable"
                    scrollButtons="auto"
                    allowScrollButtonsMobile
                    sx={{
                        '& .MuiTabs-scrollButtons': {
                            '&.Mui-disabled': { opacity: 0.3 }
                        },
                        '& .MuiTab-root': {
                            minWidth: { xs: 70, sm: 120 }, // 移动端缩小最小宽度以容纳4个Tab
                            maxWidth: { xs: 'none', sm: 'none' },
                            fontSize: { xs: '0.75rem', sm: '0.9375rem' },
                            px: { xs: 0.5, sm: 2 }, // 移动端进一步减少内边距
                            minHeight: { xs: 64, sm: 48 }, // 移动端增加高度以容纳图标+文字
                        }
                    }}
                >
                    {tabsConfig.map((tab, index) => (
                        <Tab
                            key={index}
                            icon={tab.icon}
                            iconPosition="top"
                            label={isMobile ? tab.mobileLabel : tab.label}
                            id={`analysis-tab-${index}`}
                            aria-controls={`analysis-tabpanel-${index}`}
                        />
                    ))}
                </Tabs>
            </Paper>
            <TabPanel value={tabIndex} index={0}>
                <MarketDashboardTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={1}>
               <DayAheadAnalysisTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={2}>
                <RealTimeAnalysisTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={3}>
                <SpreadAnalysisTab />
            </TabPanel>
            {/* <TabPanel value={tabIndex} index={4}>
                <TimeslotAnalysisTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={5}>
                <PriceCurveComparisonTab />
            </TabPanel> */}
        </Box>
    );
};
