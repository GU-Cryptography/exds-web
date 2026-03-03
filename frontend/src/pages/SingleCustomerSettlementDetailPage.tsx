import React, { useState, useEffect, useRef } from 'react';
import {
    Box, Grid, Paper, Typography, CircularProgress, Alert, IconButton,
    Tabs, Tab, Button, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    useTheme, useMediaQuery
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import {
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

// ====== 图标组件导入 ======
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import MonetizationOnOutlinedIcon from '@mui/icons-material/MonetizationOnOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import PriceChangeOutlinedIcon from '@mui/icons-material/PriceChangeOutlined';
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';

import {
    ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, Cell
} from 'recharts';

// ====== StatCard ======
const StatCard: React.FC<{
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color?: string;
    valueColor?: string;
}> = ({ title, value, subtitle, icon, color = 'primary.main', valueColor }) => (
    <Paper sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', alignItems: 'center', height: '100%' }} elevation={2}>
        <Box sx={{ fontSize: { xs: 30, sm: 40 }, color, mr: { xs: 1, sm: 2 }, display: 'flex', alignItems: 'center' }}>
            {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap>{title}</Typography>
            <Typography
                variant="h6" component="div" fontWeight="bold" noWrap
                sx={{ fontSize: { xs: '1rem', sm: '1.25rem' }, color: valueColor || 'text.primary' }}
            >
                {value}
            </Typography>
            {subtitle && (
                <Typography variant="caption" color="text.secondary" noWrap>{subtitle}</Typography>
            )}
        </Box>
    </Paper>
);

const formatYuan = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const profitColor = (val: number): string => val >= 0 ? '#4caf50' : '#f44336';

// ====== 时段类型颜色映射 ======
const PERIOD_TYPE_COLORS: Record<string, string> = {
    '尖峰': '#ff5252', '高峰': '#ff9800', '平段': '#4caf50', '低谷': '#2196f3', '深谷': '#3f51b5'
};
const PERIOD_TYPE_SHORT: Record<string, string> = {
    '尖峰': '尖', '高峰': '峰', '平段': '平', '低谷': '谷', '深谷': '深'
};

interface SingleCustomerDetailProps {
    initialDate?: string;
    initialVersion?: string;
    initialCustomerId?: string;
    initialCustomerName?: string;
}

const SingleCustomerSettlementDetailPage: React.FC<SingleCustomerDetailProps> = ({
    initialDate,
    initialVersion,
    initialCustomerId,
    initialCustomerName
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const [searchParams] = useSearchParams();

    const resolvedDate = initialDate || searchParams.get('date') || format(new Date(), 'yyyy-MM-dd');
    const resolvedVersion = initialVersion || searchParams.get('version') || 'PRELIMINARY';
    const resolvedCustomerId = initialCustomerId || searchParams.get('customer_id') || '';
    const resolvedCustomerName = initialCustomerName || searchParams.get('customer_name') || '';

    const [dateStr, setDateStr] = useState(resolvedDate);
    const [version, setVersion] = useState(resolvedVersion);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const chartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef: chartRef,
        title: `客户时段结算明细 (${dateStr})`
    });

    const fetchData = async () => {
        const currentCustomerId = initialCustomerId || searchParams.get('customer_id') || '';
        if (!currentCustomerId) return;

        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.get('/api/v1/settlement/customer-detail', {
                params: { date: dateStr, version, customer_id: currentCustomerId }
            });
            if (res.data.code === 200) {
                setData(res.data.data);
            } else {
                setError(res.data.message || '加载失败');
            }
        } catch (err: any) {
            setError(err.response?.data?.detail || err.message || '请求失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const currentCustomerId = initialCustomerId || searchParams.get('customer_id') || '';
        if (currentCustomerId) {
            fetchData();
        }
    }, [dateStr, version, initialCustomerId, searchParams]);

    const handleShiftDate = (days: number) => {
        const d = new Date(dateStr);
        setDateStr(format(addDays(d, days), 'yyyy-MM-dd'));
    };

    // 计算封顶前名义价格 (用于 Region 2 展示: 封顶前的校核后价格)
    const nominalPrices = React.useMemo(() => {
        if (!data) return {};
        const isCapped = data.is_capped || false;
        const capPrice = data.cap_price || 0;
        const nominalAvgPrice = data.nominal_avg_price || 0;
        const finalPrices = data.final_prices || {};

        if (!isCapped || !capPrice || !nominalAvgPrice) return finalPrices;
        const k = capPrice / nominalAvgPrice;
        if (Math.abs(k - 1) < 1e-4) return finalPrices;
        const result: Record<string, number> = {};
        Object.keys(finalPrices).forEach(key => {
            result[key] = (finalPrices[key] || 0) / k;
        });
        return result;
    }, [data]);

    if (loading && !data) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularProgress /></Box>;
    if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;

    const currentCustomerId = initialCustomerId || searchParams.get('customer_id') || '';
    if (!currentCustomerId) return <Alert severity="info" sx={{ m: 2 }}>无客户ID</Alert>;

    if (!data) return <Alert severity="info" sx={{ m: 2 }}>暂无数据</Alert>;

    const cd = data;
    const totalLoad = cd.total_load_mwh || 0;
    const totalFee = cd.total_fee || 0;
    const avgPrice = cd.avg_price || 0;
    const allocatedCost = cd.allocated_cost || cd.total_allocated_cost || 0;
    const grossProfit = cd.daily_profit || cd.gross_profit || 0;
    const capPrice = cd.cap_price || 0;
    const isCapped = cd.is_capped || false;
    const avgWholesalePrice = totalLoad > 0 ? allocatedCost / totalLoad : 0;
    const priceSpread = avgPrice - avgWholesalePrice;
    const profitMargin = totalFee !== 0 ? (grossProfit / totalFee) * 100 : 0;

    // 定价配置与参考价
    const pricingConfig = cd.pricing_config || {};
    const refPrice = cd.reference_price || null;
    const modelLabels: Record<string, string> = {
        'price_spread_simple_price_time': '价差分成-分时',
        'price_spread_simple_price_non_time': '价差分成-非分时',
        'fixed_linked_price_time': '固定价联动-分时',
        'fixed_linked_price_non_time': '固定价联动-非分时',
        'reference_linked_price_time': '参考价联动-分时',
        'reference_linked_price_non_time': '参考价联动-非分时',
        'single_comprehensive_fixed_time': '单一综合价-固定-分时',
        'single_comprehensive_reference_time': '单一综合价-参考-分时',
    };
    const refTypeLabel: Record<string, string> = {
        'market_monthly_avg': '市场月度均价',
        'upper_limit_price': '上限价',
        'market_annual_avg': '市场年度均价',
        'retailer_monthly_avg': '售电公司月度均价'
    };

    // 联动配置
    const linkedCfg = cd.linked_config || null;
    const linkedTargetLabel: Record<string, string> = {
        'real_time_avg': '实时市场均价', 'day_ahead_avg': '日前市场均价',
        'grid_agency_price': '电网代理购电价',
    };

    // 最终分时价格
    const finalPrices = cd.final_prices || {};
    const touSummary = cd.tou_summary || {};

    // 图表数据
    const chartData = (cd.period_details || []).map((p: any) => ({
        period: p.period,
        periodType: p.period_type || '',
        load: p.load_mwh || 0,
        unitPrice: p.unit_price || 0,
        wholesalePrice: (p.wholesale_price || 0),
        fee: p.fee || 0,
        allocatedCost: p.allocated_cost || 0,
    }));

    const renderInfoCard = (title: string, children: React.ReactNode, borderColor: string = 'primary.main') => (
        <Box
            sx={{
                bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200',
                borderRadius: 1, boxShadow: '0 1px 2px rgba(0,0,0,0.02)', mb: 0.8,
                borderLeft: `4px solid`, borderLeftColor: borderColor,
                minHeight: '100px', // 最终极致压缩，目标高度 100px
                display: 'flex', flexDirection: 'column'
            }}
        >
            <Box sx={{ p: '2px 8px', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.65rem', display: 'block', mb: 0.1 }}>{title}</Typography>
                {children}
            </Box>
        </Box>
    );

    const PriceGrid = ({ prices, colors }: { prices: Record<string, number>, colors?: Record<string, string> }) => (
        <Grid container spacing={0.5} sx={{ mt: 0 }}>
            {['尖峰', '高峰', '平段', '低谷', '深谷'].map(item => {
                const key = ({ '尖峰': 'tip', '高峰': 'peak', '平段': 'flat', '低谷': 'valley', '深谷': 'deep' } as any)[item];
                const val = prices[key];
                return (
                    <Grid key={item} size={2.4}>
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: colors?.[item] || PERIOD_TYPE_COLORS[item], fontWeight: 'bold', display: 'block', lineHeight: 1 }}>{PERIOD_TYPE_SHORT[item]}</Typography>
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.1 }}>{(val || 0).toFixed(2)}</Typography>
                        </Box>
                    </Grid>
                );
            })}
        </Grid>
    );

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ p: { xs: 1, sm: 2 } }}>
                {/* 顶部控制栏 */}
                <Paper variant="outlined" sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton size="small" onClick={() => handleShiftDate(-1)} disabled={loading}><ArrowLeftIcon /></IconButton>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{dateStr}</Typography>
                        <IconButton size="small" onClick={() => handleShiftDate(1)} disabled={loading}><ArrowRightIcon /></IconButton>
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                            {version === 'PRELIMINARY' ? '预结算' : '确权版'}
                        </Typography>
                    </Box>
                    <Button size="small" startIcon={<RefreshIcon />} onClick={fetchData} disabled={loading}>刷新</Button>
                </Paper>

                {/* 第一层：6 个 Summary Cards */}
                <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: 2 }}>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="日总电量" value={`${totalLoad.toFixed(3)}`} subtitle="MWh"
                            icon={<BarChartOutlinedIcon />} color="#1976d2" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="零售电费 (元)" value={`${formatYuan(totalFee)}`}
                            icon={<MonetizationOnOutlinedIcon />} color="#2e7d32" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="采购成本 (元)" value={`${formatYuan(allocatedCost)}`}
                            icon={<AccountBalanceWalletOutlinedIcon />} color="#ef6c00" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="日毛利 (元)" value={`${formatYuan(grossProfit)}`}
                            subtitle={`利润率 ${profitMargin.toFixed(2)}%`}
                            icon={<TrendingUpOutlinedIcon />}
                            color={profitColor(grossProfit)} valueColor={profitColor(grossProfit)} />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="零售单价 (元/MWh)" value={`${avgPrice.toFixed(2)}`}
                            icon={<PriceChangeOutlinedIcon />} color="#1565c0" />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                        <StatCard title="采购单价 (元/MWh)" value={`${avgWholesalePrice.toFixed(2)}`}
                            subtitle={`价差 ${priceSpread.toFixed(2)}`}
                            icon={<CompareArrowsOutlinedIcon />}
                            color="#7b1fa2" />
                    </Grid>
                </Grid>

                {/* 第二层 */}
                <Grid container spacing={{ xs: 1, sm: 2 }}>
                    {/* 左侧：结算基准 */}
                    <Grid size={{ xs: 12, md: 4 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                                <Typography variant="subtitle1" fontWeight="bold">结算基准</Typography>
                            </Box>

                            {/* 区域一：零售套餐详情 */}
                            {renderInfoCard('零售套餐', (
                                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    {/* 第二行：名称与模型 */}
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', mr: 1 }}>{cd.package_name || '-'}</Typography>
                                        <Box sx={{ px: 0.8, py: 0.1, bgcolor: 'primary.50', color: 'primary.dark', border: '1px solid', borderColor: 'primary.100', borderRadius: 0.5, fontSize: '10px', whiteSpace: 'nowrap' }}>
                                            {modelLabels[cd.model_code] || cd.model_code || '-'}
                                        </Box>
                                    </Box>

                                    {/* 三行：模型参数 */}
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'center', mb: 0.1 }}>
                                        {cd.model_code?.startsWith('price_spread') ? (
                                            <>
                                                {refPrice && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        基准: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{(refPrice.base_value * 1000).toFixed(2)}</Box>
                                                    </Typography>
                                                )}
                                                {pricingConfig.sharing_ratio !== undefined && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        分成: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{pricingConfig.sharing_ratio}%</Box>
                                                    </Typography>
                                                )}
                                                {pricingConfig.agreed_price_spread !== undefined && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        价差: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{(parseFloat(pricingConfig.agreed_price_spread) * 1000).toFixed(1)}</Box>
                                                    </Typography>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                {pricingConfig.linked_ratio !== undefined && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        比例: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{(pricingConfig.linked_ratio || pricingConfig.ratio || 0)}%</Box>
                                                    </Typography>
                                                )}
                                                {(pricingConfig.linked_target || (linkedCfg && linkedCfg.target)) && (
                                                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                        标的: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                                                            {linkedTargetLabel[pricingConfig.linked_target || linkedCfg?.target] || pricingConfig.linked_target || linkedCfg?.target || '-'}
                                                        </Box>
                                                    </Typography>
                                                )}
                                            </>
                                        )}
                                        {(pricingConfig.floating_price !== undefined || pricingConfig.floating_fee !== undefined) && (
                                            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                                                浮动: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                                                    {((parseFloat(pricingConfig.floating_price || 0) + parseFloat(pricingConfig.floating_fee || 0)) * 1000).toFixed(1)}
                                                </Box>
                                            </Typography>
                                        )}
                                    </Box>

                                    <Divider sx={{ mt: 0, mb: 0.4 }} />

                                    {/* 第五-六行：基础价格矩阵 */}
                                    <Box>
                                        {cd.model_code?.startsWith('price_spread') ? (
                                            <PriceGrid prices={(() => {
                                                const base = (refPrice?.base_value || 0) * 1000;
                                                return {
                                                    tip: base * 1.8,
                                                    peak: base * 1.6,
                                                    flat: base * 1.0,
                                                    valley: base * 0.4,
                                                    deep: base * 0.3
                                                };
                                            })()} />
                                        ) : (
                                            <PriceGrid prices={cd.fixed_prices || {}} />
                                        )}
                                    </Box>
                                </Box>
                            ), 'primary.main')}

                            {/* 区域二：结算价格与比例校核 */}
                            {renderInfoCard('结算价格与比例校核', (
                                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    {/* 第二行：状态 */}
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.1 }}>
                                        <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>校核状态:</Typography>
                                        {cd.price_ratio_adjusted ? (
                                            <Box sx={{ px: 0.6, py: 0.1, bgcolor: 'warning.50', color: 'warning.dark', borderRadius: 0.5, border: '1px solid', borderColor: 'warning.100', fontSize: '10px', fontWeight: 'bold' }}>
                                                比例调节已应用
                                            </Box>
                                        ) : (
                                            <Typography variant="caption" sx={{ fontSize: '10px', color: 'success.main', fontWeight: 'bold' }}>正常</Typography>
                                        )}
                                    </Box>

                                    <Divider sx={{ mt: 0, mb: 0.4 }} />

                                    {/* 第四-五行：调整后单价矩阵 */}
                                    <Box>
                                        <PriceGrid prices={nominalPrices} />
                                    </Box>
                                </Box>
                            ), 'warning.main')}

                            {/* 区域三：封顶校核与结算价格 */}
                            {renderInfoCard('封顶校核与结算价格', (
                                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                    {/* 第二行：封顶信息 */}
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Typography variant="caption" sx={{ fontSize: '10px', fontWeight: 'bold', color: cd.is_capped ? 'error.main' : 'success.main' }}>
                                                {cd.is_capped ? '封顶已触发' : '未触发'}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 1 }}>
                                            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>
                                                名义: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{(cd.nominal_avg_price || 0).toFixed(2)}</Box>
                                            </Typography>
                                            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>
                                                基准: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{(cd.cap_price || 0).toFixed(2)}</Box>
                                            </Typography>
                                        </Box>
                                    </Box>

                                    <Divider sx={{ mt: 0, mb: 0.4 }} />

                                    {/* 第四-五行：最终价格矩阵 */}
                                    <Box>
                                        <PriceGrid prices={finalPrices} />
                                    </Box>
                                </Box>
                            ), 'error.main')}
                        </Paper>
                    </Grid>

                    {/* 右侧：图表 */}
                    <Grid size={{ xs: 12, md: 8 }}>
                        <Paper variant="outlined" sx={{ p: 1.5, height: '100%', position: 'relative' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                                    <Typography variant="subtitle1" fontWeight="bold">48 时段结算明细图</Typography>
                                </Box>
                                <FullscreenEnterButton />
                            </Box>

                            <Box ref={chartRef} sx={{
                                height: { xs: 300, sm: 360 }, position: 'relative',
                                bgcolor: isFullscreen ? 'background.paper' : 'transparent',
                                p: isFullscreen ? 2 : 0,
                                ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }),
                                '& .recharts-wrapper:focus': { outline: 'none' }
                            }}>
                                <FullscreenExitButton /><FullscreenTitle />
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={isFullscreen ? 1 : 3} />
                                        <YAxis yAxisId="left" label={{ value: '负荷 (MWh)', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                        <YAxis yAxisId="right" orientation="right" label={{ value: '价格 (元/MWh)', angle: 90, position: 'insideRight', style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                        <Tooltip content={({ active, payload, label }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <Paper sx={{ p: 1, border: '1px solid', borderColor: 'grey.300', boxShadow: 3 }}>
                                                        <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>时段: {label}</Typography>
                                                        {payload.map((entry: any, idx: number) => (
                                                            <Box key={idx} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                                                                <Typography variant="caption" sx={{ color: entry.color }}>{entry.name}:</Typography>
                                                                <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                                                                    {entry.dataKey === 'load' ? entry.value.toFixed(3) : entry.value.toFixed(2)}
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Paper>
                                                );
                                            }
                                            return null;
                                        }} />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="load" name="用电负荷" barSize={20}>
                                            {chartData.map((entry: any, index: number) => (
                                                <Cell key={`cell-${index}`} fill={(PERIOD_TYPE_COLORS[entry.periodType] || '#ccc') + '88'} /> // 增加透明度，使配色变浅
                                            ))}
                                        </Bar>
                                        <Line yAxisId="right" type="monotone" dataKey="unitPrice" name="零售单价" stroke="#2e7d32" strokeWidth={2} dot={false} />
                                        <Line yAxisId="right" type="monotone" dataKey="wholesalePrice" name="批发单价" stroke="#1565c0" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>

                {/* 第三层：明细表格 */}
                <Paper variant="outlined" sx={{ p: isMobile ? 1 : 2, mt: 2 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>48 时段结算明细表</Typography>
                    {isMobile ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {chartData.map((p: any, index: number) => (
                                <Paper key={p.period} variant="outlined" sx={{ p: 1.5, borderColor: 'divider' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography variant="subtitle2" fontWeight="bold">时段: {p.period}</Typography>
                                        <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: PERIOD_TYPE_COLORS[p.periodType] + '22', color: PERIOD_TYPE_COLORS[p.periodType], fontSize: '0.75rem', fontWeight: 'bold' }}>
                                            {p.periodType}
                                        </Box>
                                    </Box>
                                    <Divider sx={{ mb: 1 }} />
                                    <Grid container spacing={1}>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption" color="text.secondary">负荷 (MWh)</Typography>
                                            <Typography variant="body2" fontWeight="bold">{p.load.toFixed(3)}</Typography>
                                        </Grid>
                                        {linkedCfg && (
                                            <Grid size={{ xs: 6 }}>
                                                <Typography variant="caption" color="text.secondary">现货标的</Typography>
                                                <Typography variant="body2" sx={{ color: 'warning.dark', fontWeight: 'bold' }}>
                                                    {(linkedCfg.target_prices_48?.[index] || 0).toFixed(2)}
                                                </Typography>
                                            </Grid>
                                        )}
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption" color="text.secondary">结算单价</Typography>
                                            <Typography variant="body2" sx={{ color: 'success.dark', fontWeight: 'bold' }}>{p.unitPrice.toFixed(2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption" color="text.secondary">采购单价</Typography>
                                            <Typography variant="body2" sx={{ color: 'primary.dark', fontWeight: 'bold' }}>{p.wholesalePrice.toFixed(2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption" color="text.secondary">零售电费 (元)</Typography>
                                            <Typography variant="body2" sx={{ color: 'success.dark', fontWeight: 'bold' }}>{p.fee.toFixed(2)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption" color="text.secondary">采购成本 (元)</Typography>
                                            <Typography variant="body2" sx={{ color: 'primary.dark', fontWeight: 'bold' }}>{p.allocatedCost.toFixed(2)}</Typography>
                                        </Grid>
                                    </Grid>
                                </Paper>
                            ))}
                            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50', borderColor: 'divider' }}>
                                <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>合计</Typography>
                                <Divider sx={{ mb: 1 }} />
                                <Grid container spacing={1}>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">总负荷 (MWh)</Typography>
                                        <Typography variant="body2" fontWeight="bold">{totalLoad.toFixed(3)}</Typography>
                                    </Grid>
                                    {linkedCfg && (
                                        <Grid size={{ xs: 6 }}>
                                            <Typography variant="caption" color="text.secondary">现货标的</Typography>
                                            <Typography variant="body2" sx={{ color: 'warning.dark', fontWeight: 'bold' }}>-</Typography>
                                        </Grid>
                                    )}
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">平均结算价</Typography>
                                        <Typography variant="body2" sx={{ color: 'success.dark', fontWeight: 'bold' }}>{avgPrice.toFixed(2)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">平均采购价</Typography>
                                        <Typography variant="body2" sx={{ color: 'primary.dark', fontWeight: 'bold' }}>{avgWholesalePrice.toFixed(2)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">总零售电费 (元)</Typography>
                                        <Typography variant="body2" sx={{ color: 'success.dark', fontWeight: 'bold' }}>{formatYuan(totalFee)}</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary">总采购成本 (元)</Typography>
                                        <Typography variant="body2" sx={{ color: 'primary.dark', fontWeight: 'bold' }}>{formatYuan(allocatedCost)}</Typography>
                                    </Grid>
                                </Grid>
                            </Paper>
                        </Box>
                    ) : (
                        <TableContainer sx={{ maxHeight: 600 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>时段</TableCell>
                                        <TableCell>类型</TableCell>
                                        <TableCell align="right">负荷(MWh)</TableCell>
                                        <TableCell align="right" sx={{ color: 'success.dark' }}>结算单价<br />(元/MWh)</TableCell>
                                        {linkedCfg && <TableCell align="right" sx={{ color: 'warning.dark' }}>现货标的<br />(元/MWh)</TableCell>}
                                        <TableCell align="right" sx={{ color: 'success.dark' }}>零售电费(元)</TableCell>
                                        <TableCell align="right" sx={{ color: 'primary.dark' }}>采购单价<br />(元/MWh)</TableCell>
                                        <TableCell align="right" sx={{ color: 'primary.dark' }}>采购成本(元)</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {chartData.map((p: any, index: number) => (
                                        <TableRow key={p.period} hover>
                                            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' }}>{p.period}</TableCell>
                                            <TableCell>
                                                <Box sx={{ px: 1, borderRadius: 1, bgcolor: PERIOD_TYPE_COLORS[p.periodType] + '22', color: PERIOD_TYPE_COLORS[p.periodType], fontSize: '0.75rem', textAlign: 'center' }}>
                                                    {p.periodType}
                                                </Box>
                                            </TableCell>
                                            <TableCell align="right">{p.load.toFixed(3)}</TableCell>
                                            <TableCell align="right">{p.unitPrice.toFixed(2)}</TableCell>
                                            {linkedCfg && (
                                                <TableCell align="right">
                                                    {(linkedCfg.target_prices_48?.[index] || 0).toFixed(2)}
                                                </TableCell>
                                            )}
                                            <TableCell align="right">{p.fee.toFixed(2)}</TableCell>
                                            <TableCell align="right">{p.wholesalePrice.toFixed(2)}</TableCell>
                                            <TableCell align="right">{p.allocatedCost.toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                    <TableRow sx={{ bgcolor: 'grey.100', '& .MuiTableCell-root': { fontWeight: 'bold' } }}>
                                        <TableCell align="right">合计</TableCell>
                                        <TableCell>-</TableCell>
                                        <TableCell align="right">{totalLoad.toFixed(3)}</TableCell>
                                        <TableCell align="right">{avgPrice.toFixed(2)} (均)</TableCell>
                                        {linkedCfg && <TableCell align="right">-</TableCell>}
                                        <TableCell align="right">{formatYuan(totalFee)}</TableCell>
                                        <TableCell align="right">{avgWholesalePrice.toFixed(2)} (均)</TableCell>
                                        <TableCell align="right">{formatYuan(allocatedCost)}</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </Paper>
            </Box>
        </LocalizationProvider>
    );
};

export default SingleCustomerSettlementDetailPage;
