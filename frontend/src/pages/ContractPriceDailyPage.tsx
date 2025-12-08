/**
 * 中长期日内分析页面
 * 
 * 结构参考 MarketPriceAnalysisPage
 */
import React, { useState, useEffect } from 'react';
import { Box, Tabs, Tab, Typography, Paper, useMediaQuery, useTheme, IconButton } from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { addDays, format } from 'date-fns';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { DailySummaryTab } from '../components/contract-price/DailySummaryTab';
import { CurveCompareTab } from '../components/contract-price/CurveCompareTab';
import { contractPriceApi, DailySummaryResponse } from '../api/contractPrice';

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
            id={`contract-tabpanel-${index}`}
            aria-labelledby={`contract-tab-${index}`}
            {...other}
        >
            <Box sx={{ pt: 3 }}>
                {children}
            </Box>
        </div>
    );
}

export const ContractPriceDailyPage: React.FC = () => {
    const [tabIndex, setTabIndex] = useState(0);
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), -1));
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // Tab1 数据状态
    const [summaryData, setSummaryData] = useState<DailySummaryResponse | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    // 基准价格选择状态
    const [selectedBenchmark, setSelectedBenchmark] = useState<'day_ahead' | 'real_time'>('day_ahead');

    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // 加载 Tab1 数据
    const fetchSummaryData = async () => {
        if (!selectedDate) return;

        setSummaryLoading(true);
        setSummaryError(null);

        try {
            const response = await contractPriceApi.fetchDailySummary(dateStr, '全市场', selectedBenchmark);
            setSummaryData(response.data);
        } catch (err: any) {
            console.error('Error fetching summary:', err);
            setSummaryError(err.response?.data?.detail || err.message || '获取数据失败');
            setSummaryData(null);
        } finally {
            setSummaryLoading(false);
        }
    };

    // 日期变化时加载数据
    useEffect(() => {
        if (tabIndex === 0) {
            fetchSummaryData();
        }
    }, [selectedDate, tabIndex, selectedBenchmark]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    const handleShiftDate = (days: number) => {
        if (!selectedDate) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
    };

    // Tab 配置
    const tabsConfig = [
        { icon: <DashboardIcon />, label: '价格总览', mobileLabel: '总览' },
        { icon: <ShowChartIcon />, label: '曲线对比', mobileLabel: '曲线' },
        { icon: <BarChartIcon />, label: '电量结构', mobileLabel: '电量' },
        { icon: <CompareArrowsIcon />, label: '与现货对比', mobileLabel: '对比' },
    ];

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
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
                        价格分析 / 中长期日内分析
                    </Typography>
                )}

                {/* 日期选择器 */}
                <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <IconButton onClick={() => handleShiftDate(-1)} size="small" disabled={summaryLoading}>
                        <ArrowLeftIcon />
                    </IconButton>
                    <DatePicker
                        label="选择日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={summaryLoading}
                        slotProps={{
                            textField: {
                                size: "small",
                                sx: { width: { xs: '150px', sm: '200px' } }
                            }
                        }}
                    />
                    <IconButton onClick={() => handleShiftDate(1)} size="small" disabled={summaryLoading}>
                        <ArrowRightIcon />
                    </IconButton>
                </Paper>

                <Paper variant="outlined" sx={{ borderColor: 'divider' }}>
                    <Tabs
                        value={tabIndex}
                        onChange={handleTabChange}
                        aria-label="contract price analysis tabs"
                        variant="scrollable"
                        scrollButtons="auto"
                        allowScrollButtonsMobile
                        sx={{
                            '& .MuiTabs-scrollButtons': {
                                '&.Mui-disabled': { opacity: 0.3 }
                            },
                            '& .MuiTab-root': {
                                minWidth: { xs: 70, sm: 120 },
                                maxWidth: { xs: 'none', sm: 'none' },
                                fontSize: { xs: '0.75rem', sm: '0.9375rem' },
                                px: { xs: 0.5, sm: 2 },
                                minHeight: { xs: 64, sm: 48 },
                            }
                        }}
                    >
                        {tabsConfig.map((tab, index) => (
                            <Tab
                                key={index}
                                icon={tab.icon}
                                iconPosition="top"
                                label={isMobile ? tab.mobileLabel : tab.label}
                                id={`contract-tab-${index}`}
                                aria-controls={`contract-tabpanel-${index}`}
                            />
                        ))}
                    </Tabs>
                </Paper>

                <TabPanel value={tabIndex} index={0}>
                    <DailySummaryTab
                        data={summaryData}
                        loading={summaryLoading}
                        error={summaryError}
                        dateStr={dateStr}
                        selectedBenchmark={selectedBenchmark}
                        onBenchmarkChange={setSelectedBenchmark}
                    />
                </TabPanel>

                <TabPanel value={tabIndex} index={1}>
                    <CurveCompareTab
                        data={summaryData}
                        loading={summaryLoading}
                        error={summaryError}
                        dateStr={dateStr}
                        selectedBenchmark={selectedBenchmark}
                    />
                </TabPanel>
                <TabPanel value={tabIndex} index={2}>
                    <Box sx={{ p: 3, textAlign: 'center' }}>电量结构 (开发中)</Box>
                </TabPanel>
                <TabPanel value={tabIndex} index={3}>
                    <Box sx={{ p: 3, textAlign: 'center' }}>与现货对比 (开发中)</Box>
                </TabPanel>
            </Box>
        </LocalizationProvider>
    );
};
