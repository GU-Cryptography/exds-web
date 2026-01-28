import React, { useState } from 'react';
import {
    Box,
    Typography,
    Grid,
    useTheme,
    useMediaQuery,
} from '@mui/material';
import { format, addDays } from 'date-fns';
import {
    MonthlyConsumptionChart,
    DailyConsumptionChart,
    IntradayCurveChart,
    LoadStatisticsPanel,
} from '../components/total-load';

/**
 * 整体负荷分析页面
 * 
 * 布局：
 * - 第一行左侧：月度电量柱状图
 * - 第一行右侧：日电量柱状图
 * - 第二行左侧：日内电量曲线
 * - 第二行右侧：统计面板
 */
export const LoadAnalysisPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // 状态管理
    const [selectedMonth, setSelectedMonth] = useState<string>(
        format(addDays(new Date(), -1), 'yyyy-MM')
    );
    const [selectedDate, setSelectedDate] = useState<string>(
        format(addDays(new Date(), -1), 'yyyy-MM-dd')
    );

    // 月份选择时更新日期为该月第一天（或最近一天）
    const handleMonthSelect = React.useCallback((month: string) => {
        setSelectedMonth(month);
        // 如果选择的是当前月份，默认选昨天；否则选月初
        const today = new Date();
        const currentMonth = format(today, 'yyyy-MM');
        if (month === currentMonth) {
            setSelectedDate(format(addDays(today, -1), 'yyyy-MM-dd'));
        } else {
            setSelectedDate(`${month}-01`);
        }
    }, [setSelectedMonth, setSelectedDate]);

    // 日期选择
    const handleDaySelect = React.useCallback((date: string) => {
        setSelectedDate(date);
        // 同步更新月份
        const month = date.substring(0, 7);
        if (month !== selectedMonth) {
            setSelectedMonth(month);
        }
    }, [selectedMonth, setSelectedDate, setSelectedMonth]);

    // 日期变化（来自日内曲线组件）
    const handleDateChange = React.useCallback((date: string) => {
        setSelectedDate(date);
        const month = date.substring(0, 7);
        if (month !== selectedMonth) {
            setSelectedMonth(month);
        }
    }, [selectedMonth, setSelectedDate, setSelectedMonth]);

    return (
        <Box sx={{ width: '100%' }}>
            {/* 移动端面包屑标题 */}
            {isMobile && (
                <Typography
                    variant="subtitle1"
                    sx={{ mb: 2, fontWeight: 'bold', color: 'text.primary' }}
                >
                    负荷预测 / 整体负荷分析
                </Typography>
            )}

            {/* 两行四区块布局 */}
            <Grid container spacing={{ xs: 1, sm: 2 }}>
                {/* 第一行：月度 + 日电量 */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <MonthlyConsumptionChart
                        selectedMonth={selectedMonth}
                        onMonthSelect={handleMonthSelect}
                    />
                </Grid>
                <Grid size={{ xs: 12, md: 8 }}>
                    <DailyConsumptionChart
                        month={selectedMonth}
                        onMonthChange={setSelectedMonth}
                        selectedDate={selectedDate}
                        onDaySelect={handleDaySelect}
                    />
                </Grid>

                {/* 第二行：日内曲线 + 统计面板 */}
                <Grid size={{ xs: 12, md: 8 }} sx={{ display: 'flex', flexDirection: 'column' }}>
                    <IntradayCurveChart
                        selectedDate={selectedDate}
                        onDateChange={handleDateChange}
                    />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }} sx={{ display: 'flex', flexDirection: 'column' }}>
                    <LoadStatisticsPanel selectedDate={selectedDate} />
                </Grid>
            </Grid>
        </Box>
    );
};

export default LoadAnalysisPage;
