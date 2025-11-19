import React, { useState } from 'react';
import { Box, Tabs, Tab, Typography, Paper, useMediaQuery, useTheme } from '@mui/material';
import TimelineIcon from '@mui/icons-material/Timeline';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import WarningIcon from '@mui/icons-material/Warning';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import { PriceTrendTab } from '../components/trend-analysis/PriceTrendTab';

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
            id={`trend-tabpanel-${index}`}
            aria-labelledby={`trend-tab-${index}`}
            {...other}
        >
            <Box sx={{ pt: 3 }}>
                {children}
            </Box>
        </div>
    );
}

export const SpotTrendAnalysisPage: React.FC = () => {
    const [tabIndex, setTabIndex] = useState(0);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    // Tab 配置
    const tabsConfig = [
        { icon: <TimelineIcon />, label: '价格走势', mobileLabel: '走势' },
        { icon: <CalendarMonthIcon />, label: '周内特性', mobileLabel: '周内' },
        { icon: <ShowChartIcon />, label: '波动分析', mobileLabel: '波动' },
        { icon: <CompareArrowsIcon />, label: '储能套利', mobileLabel: '套利' },
        { icon: <WarningIcon />, label: '异常分析', mobileLabel: '异常' },
    ];

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
                    价格分析 / 现货趋势分析
                </Typography>
            )}

            <Paper variant="outlined" sx={{ borderColor: 'divider' }}>
                <Tabs
                    value={tabIndex}
                    onChange={handleTabChange}
                    aria-label="spot trend analysis tabs"
                    variant="scrollable"
                    scrollButtons="auto"
                    allowScrollButtonsMobile
                    sx={{
                        '& .MuiTabs-scrollButtons': {
                            '&.Mui-disabled': { opacity: 0.3 }
                        },
                        '& .MuiTab-root': {
                            minWidth: { xs: 60, sm: 120 }, // 移动端适中宽度,容纳约5个图标
                            maxWidth: { xs: 'none', sm: 'none' },
                            fontSize: { xs: '0.75rem', sm: '0.9375rem' },
                            px: { xs: 0.5, sm: 2 }, // 移动端保留少量内边距
                            minHeight: { xs: 60, sm: 48 }, // 移动端高度
                            py: { xs: 1, sm: 1.5 }
                        }
                    }}
                >
                    {tabsConfig.map((tab, index) => (
                        <Tab
                            key={index}
                            icon={tab.icon}
                            iconPosition="top"
                            label={isMobile ? tab.mobileLabel : tab.label}
                            id={`trend-tab-${index}`}
                            aria-controls={`trend-tabpanel-${index}`}
                        />
                    ))}
                </Tabs>
            </Paper>

            <TabPanel value={tabIndex} index={0}>
                <PriceTrendTab />
            </TabPanel>
            <TabPanel value={tabIndex} index={1}>
                <Box sx={{ p: 3, textAlign: 'center' }}>周内特性分析 (开发中)</Box>
            </TabPanel>
            <TabPanel value={tabIndex} index={2}>
                <Box sx={{ p: 3, textAlign: 'center' }}>波动性分析 (开发中)</Box>
            </TabPanel>
            <TabPanel value={tabIndex} index={3}>
                <Box sx={{ p: 3, textAlign: 'center' }}>储能套利分析 (开发中)</Box>
            </TabPanel>
            <TabPanel value={tabIndex} index={4}>
                <Box sx={{ p: 3, textAlign: 'center' }}>价格异常分析 (开发中)</Box>
            </TabPanel>
        </Box>
    );
};
