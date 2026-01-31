import React, { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    CircularProgress,
    Stack,
    Card,
    CardContent,
    Grid,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import apiClient from '../../api/client';

interface StatisticsData {
    scope: string;
    total_consumption: number;
    total_consumption_wan: number;
    period_breakdown: Record<string, number>;
    period_percentage: Record<string, number>;
    peak_valley_ratio: number | null;
    yoy_change: number | null;
}

interface LoadStatisticsPanelProps {
    selectedDate: string;
}

// Colors from CustomerLoadAnalysisPage
const PERIOD_COLORS: Record<string, string> = {
    '尖峰': '#ff5252',
    '高峰': '#ff9800',
    '平段': '#4caf50',
    '低谷': '#2196f3',
    '深谷': '#3f51b5',
};

const PERIOD_LABELS: Record<string, string> = {
    '尖峰': '尖',
    '高峰': '峰',
    '平段': '平',
    '低谷': '谷',
    '深谷': '深',
};

// Distinct light colors for each scope's Peak-Valley Ratio
const SCOPE_PV_STYLES: Record<string, { bgcolor: string, color: string }> = {
    daily: {
        bgcolor: 'rgba(33, 150, 243, 0.08)', // Light Blue
        color: '#1565c0'
    },
    monthly: {
        bgcolor: 'rgba(76, 175, 80, 0.08)', // Light Green
        color: '#2e7d32'
    },
    yearly: {
        bgcolor: 'rgba(244, 67, 54, 0.08)', // Light Red
        color: '#c62828'
    },
};

export const LoadStatisticsPanel: React.FC<LoadStatisticsPanelProps> = ({
    selectedDate,
}) => {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<{
        daily: StatisticsData | null;
        monthly: StatisticsData | null;
        yearly: StatisticsData | null;
    }>({ daily: null, monthly: null, yearly: null });

    useEffect(() => {
        const fetchAll = async () => {
            if (!selectedDate) return;
            setLoading(true);
            try {
                const [dailyRes, monthlyRes, yearlyRes] = await Promise.all([
                    apiClient.get('/api/v1/total-load/statistics', { params: { date: selectedDate, scope: 'daily' } }),
                    apiClient.get('/api/v1/total-load/statistics', { params: { date: selectedDate, scope: 'monthly' } }),
                    apiClient.get('/api/v1/total-load/statistics', { params: { date: selectedDate, scope: 'yearly' } })
                ]);

                setStats({
                    daily: dailyRes.data,
                    monthly: monthlyRes.data,
                    yearly: yearlyRes.data
                });
            } catch (err) {
                console.error("Failed to fetch load statistics", err);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, [selectedDate]);

    const renderCard = (title: string, data: StatisticsData | null, scope: string) => {
        if (!data) return null;

        const pvStyle = SCOPE_PV_STYLES[scope] || SCOPE_PV_STYLES['daily'];

        return (
            <Card variant="outlined" sx={{ bgcolor: 'grey.50', flex: 1, minHeight: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'grey.200' }}>
                <CardContent sx={{ p: '8px 12px !important', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{title}</Typography>
                            <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', fontSize: '1.2rem', lineHeight: 1 }}>
                                {data.total_consumption.toFixed(2)} <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>MWh</Typography>
                            </Typography>
                        </Box>
                        {data.yoy_change !== null && (
                            <Box sx={{
                                display: 'flex',
                                alignItems: 'center',
                                color: data.yoy_change >= 0 ? 'error.main' : 'success.main',
                                bgcolor: data.yoy_change >= 0 ? 'error.lighter' : 'success.lighter',
                                px: 0.6,
                                py: 0.1,
                                borderRadius: 0.5
                            }}>
                                {data.yoy_change >= 0 ? <TrendingUpIcon sx={{ fontSize: '0.8rem' }} /> : <TrendingDownIcon sx={{ fontSize: '0.8rem' }} />}
                                <Typography variant="caption" sx={{ fontWeight: 'bold', fontSize: '0.75rem', ml: 0.3 }}>
                                    {Math.abs(data.yoy_change)}%
                                </Typography>
                            </Box>
                        )}
                    </Stack>

                    <Box sx={{ mt: 1, pt: 0.8, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Grid container spacing={0}>
                            {['尖峰', '高峰', '平段', '低谷', '深谷'].map((period) => {
                                const val = data.period_breakdown[period] || 0;
                                return (
                                    <Grid key={period} size={2.4}>
                                        <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary', display: 'block', textAlign: 'center', lineHeight: 1.2 }}>
                                            <span style={{ color: PERIOD_COLORS[period], fontWeight: 'bold' }}>{PERIOD_LABELS[period]}</span>
                                            <Box sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.primary' }}>{val.toFixed(2)}</Box>
                                        </Typography>
                                    </Grid>
                                );
                            })}
                            <Grid size={12} sx={{ mt: 0.8 }}>
                                <Box sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    bgcolor: pvStyle.bgcolor,
                                    px: 0.8,
                                    py: 0.3,
                                    borderRadius: 0.5
                                }}>
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: pvStyle.color, fontSize: '0.65rem' }}>峰谷比:</Typography>
                                    <Typography variant="caption" sx={{ fontWeight: 800, color: pvStyle.color, fontSize: '0.8rem' }}>{data.peak_valley_ratio?.toFixed(2) ?? '-'}</Typography>
                                </Box>
                            </Grid>
                        </Grid>
                    </Box>
                </CardContent>
            </Card>
        );
    };

    return (
        <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ height: 32, mb: 1, flexShrink: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
                        <Typography variant="h6" fontSize="0.95rem" fontWeight="bold">统计指标</Typography>
                    </Stack>
                </Stack>

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                        <CircularProgress size={30} />
                    </Box>
                ) : (
                    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
                        {renderCard("当日用电量", stats.daily, 'daily')}
                        {renderCard("当月用电量", stats.monthly, 'monthly')}
                        {renderCard("当年累计电量", stats.yearly, 'yearly')}
                    </Stack>
                )}
            </Box>
        </Paper>
    );
};

export default LoadStatisticsPanel;
