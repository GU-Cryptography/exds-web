import React, { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    CircularProgress,
    Alert,
    Tabs,
    Tab,
    Divider,
    LinearProgress,
    Chip,
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

// 时段颜色配置
const PERIOD_COLORS: Record<string, string> = {
    '尖峰': '#D32F2F',
    '高峰': '#F57C00',
    '平段': '#9E9E9E',
    '低谷': '#1976D2',
    '深谷': '#00796B',
};

// 峰谷比评价颜色
const getPeakValleyColor = (ratio: number | null) => {
    if (ratio === null) return 'text.secondary';
    if (ratio < 1.5) return 'success.main';
    if (ratio <= 2.0) return 'warning.main';
    return 'error.main';
};

const getPeakValleyLabel = (ratio: number | null) => {
    if (ratio === null) return '-';
    if (ratio < 1.5) return '良好';
    if (ratio <= 2.0) return '一般';
    return '偏高';
};

export const LoadStatisticsPanel: React.FC<LoadStatisticsPanelProps> = ({
    selectedDate,
}) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<StatisticsData | null>(null);
    const [scope, setScope] = useState<'daily' | 'monthly' | 'yearly'>('daily');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await apiClient.get('/api/v1/total-load/statistics', {
                    params: {
                        date: selectedDate,
                        scope: scope,
                    },
                });
                setData(response.data);
            } catch (err: any) {
                console.error('Failed to fetch statistics:', err);
                setError(err.response?.data?.detail || err.message || '加载失败');
            } finally {
                setLoading(false);
            }
        };

        if (selectedDate) {
            fetchData();
        }
    }, [selectedDate, scope]);

    const handleScopeChange = (_: React.SyntheticEvent, newValue: 'daily' | 'monthly' | 'yearly') => {
        setScope(newValue);
    };



    const getScopeLabel = () => {
        switch (scope) {
            case 'daily': return '当日';
            case 'monthly': return '当月';
            case 'yearly': return '年度';
            default: return '';
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 1, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', mr: 1, borderRadius: 1 }} />
                <Typography variant="h6" fontSize="0.95rem" fontWeight="bold">
                    统计数据
                </Typography>
            </Box>

            {/* 范围切换 Tab */}
            <Tabs
                value={scope}
                onChange={handleScopeChange}
                variant="fullWidth"
                sx={{ mb: 1, minHeight: 32, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 32, py: 0.5, fontSize: '0.8rem' } }}
            >
                <Tab value="daily" label="当日" />
                <Tab value="monthly" label="当月" />
                <Tab value="yearly" label="年度" />
            </Tabs>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress size={30} />
                </Box>
            ) : error ? (
                <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>
            ) : data ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>

                    {/* 总电量卡片 */}
                    <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'primary.light', bgcolor: 'rgba(25, 118, 210, 0.04)' }}>
                        <Typography variant="caption" color="text.secondary" gutterBottom>
                            {getScopeLabel()}总电量
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="h5" fontWeight="bold" color="primary.main">
                                {data.total_consumption.toFixed(1)} <Typography component="span" variant="caption" color="text.secondary">MWh</Typography>
                            </Typography>
                            {data.yoy_change !== null && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {data.yoy_change >= 0 ? (
                                        <TrendingUpIcon sx={{ fontSize: 18, color: 'error.main' }} />
                                    ) : (
                                        <TrendingDownIcon sx={{ fontSize: 18, color: 'success.main' }} />
                                    )}
                                    <Typography
                                        variant="subtitle2"
                                        fontWeight="bold"
                                        sx={{ color: data.yoy_change >= 0 ? 'error.main' : 'success.main' }}
                                    >
                                        {data.yoy_change >= 0 ? '+' : ''}{data.yoy_change}%
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>

                    {/* 时段电量分解 - 横向布局 */}
                    <Box>
                        <Typography variant="caption" color="text.secondary" gutterBottom>
                            时段电量分解
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, p: 1, bgcolor: 'grey.50', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                            {['尖峰', '高峰', '平段', '低谷', '深谷'].map((period) => {
                                const value = data.period_breakdown[period] || 0;
                                const percentage = data.period_percentage[period] || 0;
                                return (
                                    <Box key={period} sx={{ flex: 1, textAlign: 'center' }}>
                                        <Typography variant="caption" sx={{ color: PERIOD_COLORS[period], fontWeight: 'bold', fontSize: '0.7rem' }}>
                                            {period}
                                        </Typography>
                                        <Typography variant="body2" fontWeight="bold" sx={{ my: 0.2, fontSize: '0.8rem' }}>
                                            {value.toFixed(1)}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                            {percentage}%
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>

                    {/* 峰谷比 */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, bgcolor: 'grey.50', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block">
                                综合峰谷比
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                (尖+峰) / (谷+深)
                            </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                            <Typography
                                variant="h6"
                                fontWeight="bold"
                                sx={{ color: getPeakValleyColor(data.peak_valley_ratio) }}
                            >
                                {data.peak_valley_ratio?.toFixed(2) ?? '-'}
                            </Typography>
                            <Chip
                                label={getPeakValleyLabel(data.peak_valley_ratio)}
                                size="small"
                                sx={{
                                    backgroundColor: getPeakValleyColor(data.peak_valley_ratio),
                                    color: 'white',
                                    height: 18,
                                    fontSize: '0.65rem',
                                    mt: 0
                                }}
                            />
                        </Box>
                    </Box>
                </Box>
            ) : (
                <Typography color="text.secondary" align="center" sx={{ mt: 4 }}>无数据</Typography>
            )}
        </Paper>
    );
};

export default LoadStatisticsPanel;
