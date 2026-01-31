import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Grid, Paper, Typography, Chip, Tabs, Tab, CircularProgress, Alert, IconButton, Button
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, BarChart, Bar
} from 'recharts';
import { loadCharacteristicsApi, CustomerCharacteristics } from '../api/loadCharacteristics';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

// Component for Long Term Analysis Tab
const LongTermAnalysisTab: React.FC<{ data: CustomerCharacteristics }> = ({ data }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef,
        title: "长周期负荷趋势"
    });

    const [dailyData, setDailyData] = useState<any[]>([]);
    const [monthlyData, setMonthlyData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!data) return;
        setLoading(true);
        // Default range: Last 12 months
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1);

        const endStr = endDate.toISOString().split('T')[0];
        const startStr = startDate.toISOString().split('T')[0];

        const startMonth = startStr.substring(0, 7);
        const endMonth = endStr.substring(0, 7);

        Promise.all([
            loadCharacteristicsApi.getDailyTrend(data.customer_id, startStr, endStr),
            loadCharacteristicsApi.getMonthlyEnergy(data.customer_id, startMonth, endMonth)
        ]).then(([dailyRes, monthlyRes]) => {
            setDailyData(dailyRes.data);
            setMonthlyData(monthlyRes.data);
        }).catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, [data]);

    const metrics = data.long_term;
    if (!metrics) return <Alert severity="info">暂无长周期分析数据</Alert>;

    return (
        <Grid container spacing={2}>
            {/* Top Metrics Grid */}
            <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 6, sm: 3 }}>
                            <Typography variant="caption" color="text.secondary">日均电量</Typography>
                            <Typography variant="h6">{metrics.avg_daily_load} kWh</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                            <Typography variant="caption" color="text.secondary">年累计电量</Typography>
                            <Typography variant="h6">{(metrics.total_annual_load / 10000).toFixed(2)} 万kWh</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                            <Typography variant="caption" color="text.secondary">变异系数(CV)</Typography>
                            <Typography variant="h6">{metrics.cv}</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 3 }}>
                            <Typography variant="caption" color="text.secondary">近3月增长</Typography>
                            <Typography variant="h6" color={metrics.recent_3m_growth && metrics.recent_3m_growth > 0 ? "success.main" : "error.main"}>
                                {metrics.recent_3m_growth ? `${(metrics.recent_3m_growth * 100).toFixed(1)}%` : '-'}
                            </Typography>
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>

            {/* Analysis Text */}
            <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: '#f5f7fa' }}>
                    <Typography variant="subtitle2" gutterBottom>智能诊断：</Typography>
                    <Typography variant="body2" paragraph>
                        该客户日均用电 {metrics.avg_daily_load} kWh，整体波动{metrics.cv < 0.2 ? "较小" : metrics.cv > 0.5 ? "剧烈" : "适中"}。
                        近3个月呈现{metrics.recent_3m_growth && metrics.recent_3m_growth > 0 ? "增长" : "下降"}趋势。
                        {metrics.summer_avg && metrics.spring_autumn_avg && metrics.summer_avg > metrics.spring_autumn_avg * 1.3 && "夏季用电明显高于春秋季，具备典型降温负荷特征。"}
                        {metrics.weekend_ratio && metrics.weekend_ratio < 0.8 && "周末用电显著下降，符合标准工作制特征。"}
                    </Typography>
                </Paper>
            </Grid>

            {/* A1. Daily Trend Chart */}
            <Grid size={{ xs: 12 }}>
                <Paper sx={{ p: 2, height: 400 }}>
                    <Typography variant="subtitle2" gutterBottom>日电量趋势 (近1年)</Typography>
                    {loading ? <CircularProgress size={20} /> : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dailyData}>
                                <defs>
                                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} interval={30} />
                                <YAxis />
                                <CartesianGrid strokeDasharray="3 3" />
                                <Tooltip labelFormatter={(v) => v} />
                                <Area type="monotone" dataKey="total" stroke="#8884d8" fillOpacity={1} fill="url(#colorTotal)" name="日电量" />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </Paper>
            </Grid>

            {/* A2. Monthly Energy Chart */}
            <Grid size={{ xs: 12 }}>
                <Paper sx={{ p: 2, height: 350 }}>
                    <Typography variant="subtitle2" gutterBottom>月度电量</Typography>
                    {loading ? <CircularProgress size={20} /> : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthlyData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey="total" fill="#82ca9d" name="月电量" barSize={30} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Paper>
            </Grid>

            {/* Weekly Comparison */}
            <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 2, height: 350 }}>
                    <Typography variant="subtitle2" gutterBottom>周中/周末对比</Typography>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={[
                            { name: '工作日', value: 1.0 }, // Normalized base
                            { name: '周末', value: metrics.weekend_ratio },
                        ]}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" />
                            <Tooltip />
                            <Bar dataKey="value" fill="#ffc658" barSize={30} label={{ position: 'right', formatter: (v: any) => `${(v * 100).toFixed(0)}%` }} />
                        </BarChart>
                    </ResponsiveContainer>
                </Paper>
            </Grid>
        </Grid>
    );
};

// Component for Short Term Analysis Tab
const ShortTermAnalysisTab: React.FC<{ data: CustomerCharacteristics }> = ({ data }) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef,
        title: "典型日负荷曲线 (48点)"
    });

    const metrics = data.short_term;
    if (!metrics) return <Alert severity="info">暂无短周期分析数据</Alert>;

    // Prepare chart data (Average Curve + Range)
    const chartData = metrics.avg_curve.map((val, idx) => {
        const std = metrics.std_curve ? metrics.std_curve[idx] : 0;
        return {
            time: `${Math.floor(idx / 2)}:${idx % 2 === 0 ? '00' : '30'}`,
            avg: val,
            upper: val + std,
            lower: Math.max(0, val - std)
        };
    });

    return (
        <Grid container spacing={2}>
            {/* Key Metrics */}
            <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 4, sm: 2 }}>
                            <Typography variant="caption" color="text.secondary">平均负荷率</Typography>
                            <Typography variant="h6">{(metrics.avg_load_rate * 100).toFixed(1)}%</Typography>
                        </Grid>
                        <Grid size={{ xs: 4, sm: 2 }}>
                            <Typography variant="caption" color="text.secondary">峰谷比</Typography>
                            <Typography variant="h6">{metrics.min_max_ratio.toFixed(2)}</Typography>
                        </Grid>
                        <Grid size={{ xs: 4, sm: 2 }}>
                            <Typography variant="caption" color="text.secondary">规律性相似度</Typography>
                            <Typography variant="h6">{metrics.curve_similarity ? (metrics.curve_similarity * 100).toFixed(1) : '-'}</Typography>
                        </Grid>
                        <Grid size={{ xs: 4, sm: 2 }}>
                            <Typography variant="caption" color="text.secondary">峰值时刻</Typography>
                            <Typography variant="h6">{metrics.peak_hour ? `${Math.floor(metrics.peak_hour / 2)}:${metrics.peak_hour % 2 === 0 ? '00' : '30'}` : '-'}</Typography>
                        </Grid>
                        <Grid size={{ xs: 4, sm: 2 }}>
                            <Typography variant="caption" color="text.secondary">尖峰占比</Typography>
                            <Typography variant="h6">{metrics.tip_ratio ? (metrics.tip_ratio * 100).toFixed(1) : '-'}%</Typography>
                        </Grid>
                        <Grid size={{ xs: 4, sm: 2 }}>
                            <Typography variant="caption" color="text.secondary">低谷占比</Typography>
                            <Typography variant="h6">{metrics.valley_ratio ? (metrics.valley_ratio * 100).toFixed(1) : '-'}%</Typography>
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>

            {/* Chart */}
            <Grid size={{ xs: 12 }}>
                <Box
                    ref={chartRef}
                    sx={{
                        height: { xs: 350, sm: 400 },
                        position: 'relative',
                        bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                        p: isFullscreen ? 2 : 0,
                        ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 })
                    }}
                >
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <FullscreenTitle />

                    <Paper sx={{ height: '100%', p: 1 }}>
                        <Typography variant="subtitle2" align="center">典型日负荷曲线 (近30天均值 ±1σ)</Typography>
                        <ResponsiveContainer width="100%" height="90%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" interval={3} tick={{ fontSize: 10 }} />
                                <YAxis />
                                <CartesianGrid strokeDasharray="3 3" />
                                <Tooltip />
                                {/* Range Area (Simulated by stacking or separate areas? Recharts doesn't strictly support Range Area easily without trickery. 
                                    Using simplified approach: Avg line + Error Bars or separate lines. 
                                    Better: Main Line for Avg, dashed lines for upper/lower.
                                */}
                                <Area type="monotone" dataKey="avg" stroke="#8884d8" fillOpacity={1} fill="url(#colorAvg)" name="平均负荷" />
                                <Area type="monotone" dataKey="upper" stroke="#82ca9d" fill="none" strokeDasharray="3 3" name="波动上限" />
                                <Area type="monotone" dataKey="lower" stroke="#82ca9d" fill="none" strokeDasharray="3 3" name="波动下限" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </Paper>
                </Box>
            </Grid>
        </Grid>
    );
};

interface LoadCharacteristicsDetailPageProps {
    customerId?: string;
}

const LoadCharacteristicsDetailPage: React.FC<LoadCharacteristicsDetailPageProps> = (props) => {
    const params = useParams<{ customerId: string }>();
    const customerId = props.customerId || params.customerId;
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(0);
    const [data, setData] = useState<CustomerCharacteristics | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!customerId) return;
        setLoading(true);
        loadCharacteristicsApi.getCustomerDetail(customerId)
            .then(res => setData(res.data))
            .catch(err => {
                console.error(err);
                setError("获取客户详情失败");
            })
            .finally(() => setLoading(false));
    }, [customerId]);

    if (loading) return <Box p={4} display="flex" justifyContent="center"><CircularProgress /></Box>;
    if (error) return <Alert severity="error">{error}</Alert>;
    if (!data) return <Alert severity="warning">未找到该客户数据</Alert>;

    return (
        <Box sx={{ p: { xs: 1, sm: 2 } }}>
            {/* Header */}
            <Box display="flex" alignItems="center" mb={2}>
                <IconButton onClick={() => navigate('/customer/load-characteristics')}>
                    <ArrowBackIcon />
                </IconButton>
                <Box ml={1}>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>{data.customer_name}</Typography>
                    <Box display="flex" gap={1} mt={0.5}>
                        <Chip label={`评级: ${data.quality_rating || 'N/A'}`} size="small" color="primary" />
                        <Chip label={`规律分: ${data.regularity_score}`} size="small" variant="outlined" />
                    </Box>
                </Box>
            </Box>

            {/* Tags Banner */}
            <Paper sx={{ p: 2, mb: 2, bgcolor: '#e3f2fd' }}>
                <Typography variant="subtitle2" gutterBottom color="primary">特征标签</Typography>
                <Box display="flex" gap={1} flexWrap="wrap">
                    {data.tags.map((tag, idx) => (
                        <Chip key={idx} label={tag.name} color="primary" variant="filled" size="small" />
                    ))}
                    {data.tags.length === 0 && <Typography variant="caption">暂无标签</Typography>}
                </Box>
            </Paper>

            {/* Tabs */}
            <Paper sx={{ mb: 2 }}>
                <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} variant="fullWidth">
                    <Tab label="长周期特征 (近1年)" />
                    <Tab label="短周期特征 (近30天)" />
                </Tabs>
            </Paper>

            {/* Content */}
            <Box>
                {activeTab === 0 && <LongTermAnalysisTab data={data} />}
                {activeTab === 1 && <ShortTermAnalysisTab data={data} />}
            </Box>
        </Box>
    );
};

export default LoadCharacteristicsDetailPage;
