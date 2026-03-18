import React, { useRef, useState } from 'react';
import {
    Alert,
    Box,
    CircularProgress,
    Divider,
    Grid,
    Paper,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    Tooltip as MuiTooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import {
    Bar,
    Cell,
    ComposedChart,
    CartesianGrid,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    ReferenceLine,
    XAxis,
    YAxis,
} from 'recharts';
import { useChartFullscreen } from '../../hooks/useChartFullscreen';
import { IntentRetailSimulationDetail } from '../../api/intentCustomerDiagnosis';

const TEXT = {
    selectMonth: '\u8bf7\u9009\u62e9\u6708\u4efd\u67e5\u770b\u96f6\u552e\u7ed3\u7b97\u8be6\u60c5',
    baseInfo: '\u7ed3\u7b97\u57fa\u51c6',
    retailPackage: '\u96f6\u552e\u5957\u9910',
    priceCheck: '\u7ed3\u7b97\u4ef7\u683c\u4e0e\u6bd4\u4f8b\u6821\u6838',
    finalPrices: '\u5c01\u9876\u6821\u6838\u4e0e\u7ed3\u7b97\u4ef7\u683c',
    stageTitle: '\u6708\u5ea6\u7ed3\u7b97\u9636\u6bb5',
    periodDetail: '\u0034\u0038\u65f6\u6bb5\u7ed3\u7b97\u660e\u7ec6',
    chartAnalysis: '\u56fe\u8868\u5206\u6790',
    dataTable: '\u6570\u636e\u660e\u7ec6',
    dailyDetail: '\u6708\u5ea6\u65e5\u5ea6\u7ed3\u7b97\u660e\u7ec6',
    cappedYes: '\u5df2\u89e6\u53d1\u5c01\u9876',
    cappedNo: '\u672a\u89e6\u53d1',
    nominalPrice: '\u540d\u4e49\u5747\u4ef7',
    capPrice: '\u5c01\u9876\u5747\u4ef7',
    stage1: '\u9636\u6bb5\u4e00\uff1a48\u65f6\u6bb5\u6570\u636e\u7ed3\u7b97',
    stage2: '\u8c03\u5e73\u7535\u8d39',
    stage3: '\u9636\u6bb5\u4e8c\uff1a\u7533\u62a5\u6570\u636e\u7ed3\u7b97',
    stage4: '\u8fd4\u8fd8\u91d1\u989d',
    stage5: '\u9636\u6bb5\u4e09\uff1a\u6700\u7ec8\u7ed3\u7b97',
    energy: '\u7ed3\u7b97\u7535\u91cf',
    retailUnitPrice: '\u7ed3\u7b97\u5355\u4ef7(\u5143/MWh)',
    retailFee: '\u7ed3\u7b97\u7535\u8d39(\u5143)',
    wholesaleUnitPrice: '\u6279\u53d1\u5355\u4ef7(\u5143/MWh)',
    wholesaleFee: '\u6279\u53d1\u91d1\u989d(\u5143)',
    grossProfit: '\u6708\u6bdb\u5229(\u5143)',
    spread: '\u6279\u96f6\u4ef7\u5dee(\u5143/MWh)',
    profitMargin: '\u5229\u6da6\u7387',
    balancingEnergy: '\u8c03\u5e73\u7535\u91cf',
    balancingWholesalePrice: '\u8c03\u5e73\u5355\u4ef7',
    balancingRetailFee: '\u8c03\u5e73\u96f6\u552e\u7535\u8d39',
    refundThreshold: '\u8fd4\u8fd8\u9608\u503c',
    refundUnitPrice: '\u8fd4\u8fd8\u5355\u4ef7',
    refundFee: '\u8fd4\u8fd8\u91d1\u989d',
    calibrationStatus: '\u6821\u6838\u72b6\u6001',
    ratioAdjustedApplied: '\u6bd4\u4f8b\u8c03\u6574\u5df2\u5e94\u7528',
    normalStatus: '\u6b63\u5e38',
    nominalShort: '\u540d\u4e49',
    basisShort: '\u57fa\u51c6',
    noDaily: '\u6682\u65e0\u65e5\u5ea6\u7ed3\u7b97\u660e\u7ec6',
    mixed: '\u6df7\u5408',
    mixedTip: '\u8be5\u65f6\u6bb5\u5b58\u5728\u591a\u79cd\u5cf0\u8c37\u7c7b\u578b',
    period: '\u65f6\u6bb5',
    periodType: '\u7c7b\u578b',
    day: '\u65e5\u671f',
    dayEnergy: '\u65e5\u7535\u91cf(MWh)',
};

const formatYuan = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMwh = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const formatPrice = (val: number): string => val.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const profitColor = (val: number): string => (val >= 0 ? '#4caf50' : '#f44336');
const UNIT_YUAN = '\u5143';
const UNIT_YUAN_PER_MWH = '\u5143/MWh';

const PERIOD_TYPE_COLORS: Record<string, string> = {
    '\u5c16\u5cf0': '#ff5252',
    '\u9ad8\u5cf0': '#ff9800',
    '\u5e73\u6bb5': '#4caf50',
    '\u4f4e\u8c37': '#2196f3',
    '\u6df1\u8c37': '#3f51b5',
    period_type_mix: '#9e9e9e',
};

const PERIOD_TYPE_SHORT: Record<string, string> = {
    '\u5c16\u5cf0': '\u5c16',
    '\u9ad8\u5cf0': '\u5cf0',
    '\u5e73\u6bb5': '\u5e73',
    '\u4f4e\u8c37': '\u8c37',
    '\u6df1\u8c37': '\u6df1',
};

const STAGE_COLORS = {
    pre: '#1976d2',
    balancing: '#ef6c00',
    post: '#2e7d32',
    refund: '#d32f2f',
    final: '#7b1fa2',
};

const MODEL_LABELS: Record<string, string> = {
    price_spread_simple_price_time: '\u4ef7\u5dee\u5206\u6210-\u5206\u65f6',
    price_spread_simple_price_non_time: '\u4ef7\u5dee\u5206\u6210-\u975e\u5206\u65f6',
    fixed_linked_price_time: '\u56fa\u5b9a\u4ef7\u8054\u52a8-\u5206\u65f6',
    fixed_linked_price_non_time: '\u56fa\u5b9a\u4ef7\u8054\u52a8-\u975e\u5206\u65f6',
    reference_linked_price_time: '\u53c2\u8003\u4ef7\u8054\u52a8-\u5206\u65f6',
    reference_linked_price_non_time: '\u53c2\u8003\u4ef7\u8054\u52a8-\u975e\u5206\u65f6',
    single_comprehensive_fixed_time: '\u5355\u4e00\u7efc\u5408\u4ef7\u56fa\u5b9a-\u5206\u65f6',
    single_comprehensive_reference_time: '\u5355\u4e00\u7efc\u5408\u4ef7\u53c2\u8003-\u5206\u65f6',
};

const StatRow: React.FC<{ label: string; value: number; unit?: string; bold?: boolean }> = ({ label, value, unit, bold }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.2 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="caption" fontWeight={bold ? 700 : 500}>
            {unit === 'MWh' ? formatMwh(value) : unit === 'YPM' ? formatPrice(value) : formatYuan(value)}
            {unit ? <Box component="span" sx={{ ml: 0.4, fontSize: '0.7rem', color: 'text.disabled' }}>{unit === 'YPM' ? UNIT_YUAN_PER_MWH : unit}</Box> : null}
        </Typography>
    </Box>
);

const PriceGrid: React.FC<{ prices: Record<string, number> }> = ({ prices }) => (
    <Grid container spacing={0.5}>
        {[
            { cn: '\u5c16\u5cf0', key: 'tip' },
            { cn: '\u9ad8\u5cf0', key: 'peak' },
            { cn: '\u5e73\u6bb5', key: 'flat' },
            { cn: '\u4f4e\u8c37', key: 'valley' },
            { cn: '\u6df1\u8c37', key: 'deep' },
        ].map((item) => (
            <Grid key={item.key} size={2.4}>
                <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ color: PERIOD_TYPE_COLORS[item.cn], fontWeight: 700, display: 'block', lineHeight: 1 }}>
                        {PERIOD_TYPE_SHORT[item.cn]}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
                        {((prices[item.key] || 0) * 1000).toFixed(2)}
                    </Typography>
                </Box>
            </Grid>
        ))}
    </Grid>
);

interface Props {
    detail: IntentRetailSimulationDetail | null;
    loading: boolean;
    error?: string | null;
}

const IntentRetailSimulationDetailPanel: React.FC<Props> = ({ detail, loading, error }) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const chartRef = useRef<HTMLDivElement>(null);
    const [tabValue, setTabValue] = useState(0);
    const [dailyTabValue, setDailyTabValue] = useState(0);
    const dailyLeftChartRef = useRef<HTMLDivElement>(null);
    const dailyRightChartRef = useRef<HTMLDivElement>(null);
    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle } = useChartFullscreen({
        chartRef,
        title: detail ? `\u7535\u91cf\u4e0e\u4ef7\u683c\u65f6\u6bb5\u5206\u5e03\u56fe (${detail.settlement_month})` : '\u7535\u91cf\u4e0e\u4ef7\u683c\u65f6\u6bb5\u5206\u5e03\u56fe',
    });
    const {
        isFullscreen: isDailyLeftFullscreen,
        FullscreenEnterButton: DailyLeftFullscreenEnterButton,
        FullscreenExitButton: DailyLeftFullscreenExitButton,
        FullscreenTitle: DailyLeftFullscreenTitle,
    } = useChartFullscreen({
        chartRef: dailyLeftChartRef,
        title: detail ? `\u65e5\u5ea6\u4ef7\u683c\u8d70\u52bf (${detail.settlement_month})` : '\u65e5\u5ea6\u4ef7\u683c\u8d70\u52bf',
    });
    const {
        isFullscreen: isDailyRightFullscreen,
        FullscreenEnterButton: DailyRightFullscreenEnterButton,
        FullscreenExitButton: DailyRightFullscreenExitButton,
        FullscreenTitle: DailyRightFullscreenTitle,
    } = useChartFullscreen({
        chartRef: dailyRightChartRef,
        title: detail ? `\u65e5\u6279\u96f6\u4ef7\u5dee\u8d70\u52bf (${detail.settlement_month})` : '\u65e5\u6279\u96f6\u4ef7\u5dee\u8d70\u52bf',
    });

    if (loading && !detail) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;
    }
    if (error) {
        return <Alert severity="error">{error}</Alert>;
    }
    if (!detail) {
        return <Alert severity="info">{TEXT.selectMonth}</Alert>;
    }

    const pm = detail.price_model || {};
    const finalPrices = pm.final_prices || {};
    const nominalPrices = (() => {
        const isCapped = Boolean(pm.is_capped);
        const capPrice = Number(pm.cap_price || 0);
        const nominalAvgPrice = Number(pm.nominal_avg_price || 0);

        if (!isCapped || !capPrice || !nominalAvgPrice) {
            return finalPrices;
        }

        const ratio = capPrice / nominalAvgPrice;
        if (Math.abs(ratio - 1) < 1e-6) {
            return finalPrices;
        }

        const result: Record<string, number> = {};
        Object.keys(finalPrices).forEach((key) => {
            result[key] = Number(finalPrices[key] || 0) / ratio;
        });
        return result;
    })();

    const chartData = (detail.period_details || []).map((item) => ({
        period: item.period,
        periodType: item.period_type || '',
        load: item.load_mwh || 0,
        unitPrice: (item.unit_price || 0) * 1000,
        wholesalePrice: item.wholesale_price || 0,
        fee: item.fee || 0,
        allocatedCost: item.allocated_cost || 0,
        grossProfit: item.gross_profit || 0,
        spread: item.spread_yuan_per_mwh || 0,
    }));

    const finalEnergy = detail.final_energy_mwh || 0;
    const finalRetailFee = detail.final_retail_fee || 0;
    const finalWholesaleFee = detail.final_wholesale_fee || 0;
    const finalGrossProfit = detail.final_gross_profit || 0;
    const finalRetailUnitPrice = detail.final_retail_unit_price || 0;
    const finalWholesaleUnitPrice = detail.final_wholesale_unit_price || 0;
    const finalPriceSpread = detail.final_price_spread_per_mwh || 0;
    const profitMargin = finalRetailFee !== 0 ? (finalGrossProfit / finalRetailFee) * 100 : 0;

    let runningEnergy = 0;
    let runningGrossProfit = 0;
    const dailyChartData = (detail.daily_details || []).map((item) => {
        const load = Number(item.total_load_mwh || 0);
        const grossProfit = Number(item.gross_profit || 0);
        runningEnergy += load;
        runningGrossProfit += grossProfit;
        return {
            date: item.date || '',
            wholesaleAvgPrice: item.wholesale_avg_price || 0,
            retailAvgPrice: item.retail_avg_price || item.avg_price || 0,
            grossProfit,
            spread: item.price_spread_per_mwh || 0,
            cumulativeAvgSpread: runningEnergy > 0 ? runningGrossProfit / runningEnergy : 0,
        };
    });

    const renderInfoCard = (title: string, children: React.ReactNode, borderColor: string) => (
        <Box sx={{ bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200', borderRadius: 1, borderLeft: `4px solid ${borderColor}`, minHeight: 100 }}>
            <Box sx={{ p: '6px 10px' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.2 }}>{title}</Typography>
                {children}
            </Box>
        </Box>
    );

    return (
        <Box>
            <Grid container spacing={{ xs: 1, sm: 2 }}>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Paper variant="outlined" sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                            <Typography variant="subtitle1" fontWeight="bold">{TEXT.baseInfo}</Typography>
                        </Box>

                        {renderInfoCard(TEXT.retailPackage, <>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                <Typography variant="body2" sx={{ fontWeight: 700 }}>{detail.package_name || '-'}</Typography>
                                <Box sx={{ px: 0.8, py: 0.1, bgcolor: 'primary.50', color: 'primary.dark', borderRadius: 0.5, border: '1px solid', borderColor: 'primary.100', fontSize: '10px' }}>
                                    {MODEL_LABELS[detail.model_code || ''] || detail.model_code || '-'}
                                </Box>
                            </Box>
                            <Divider sx={{ mb: 0.8 }} />
                            <PriceGrid prices={pm.final_prices || {}} />
                        </>, 'primary.main')}

                        {renderInfoCard(TEXT.priceCheck, <>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.2 }}>
                                <Typography variant="caption" color="text.secondary">{'校核状态'}</Typography>
                                {pm.price_ratio_adjusted ? (
                                    <Box sx={{ px: 0.6, py: 0.1, bgcolor: 'warning.50', color: 'warning.dark', borderRadius: 0.5, border: '1px solid', borderColor: 'warning.100', fontSize: '12px', fontWeight: 700 }}>
                                        {'比例调整已应用'}
                                    </Box>
                                ) : (
                                    <Typography variant="caption" sx={{ fontSize: '12px', color: 'success.main', fontWeight: 700 }}>
                                        {'正常'}
                                    </Typography>
                                )}
                            </Box>
                            <Divider sx={{ mb: 0.8 }} />
                            <PriceGrid prices={nominalPrices} />
                        </>, 'warning.main')}

                        {renderInfoCard(TEXT.finalPrices, <>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.2, gap: 1 }}>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: pm.is_capped ? 'error.main' : 'success.main' }}>
                                    {pm.is_capped ? TEXT.cappedYes : TEXT.cappedNo}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                        {TEXT.nominalShort}: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{((pm.nominal_avg_price || 0) * 1000).toFixed(2)}</Box>
                                    </Typography>
                                    <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                        {TEXT.basisShort}: <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>{((pm.cap_price || 0) * 1000).toFixed(2)}</Box>
                                    </Typography>
                                </Box>
                            </Box>
                            <Divider sx={{ mb: 0.8 }} />
                            <PriceGrid prices={finalPrices} />
                        </>, 'error.main')}
                    </Paper>
                </Grid>

                <Grid size={{ xs: 12, md: 8 }}>
                    <Paper variant="outlined" sx={{ p: 1.5, height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Box sx={{ width: 4, height: 16, bgcolor: STAGE_COLORS.final, borderRadius: 1, mr: 1 }} />
                            <Typography variant="subtitle1" fontWeight="bold">{TEXT.stageTitle}</Typography>
                        </Box>

                        <Grid container spacing={1}>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Box sx={{ height: '100%', p: '6px 10px', bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200', borderLeft: `4px solid ${STAGE_COLORS.pre}`, borderRadius: 1 }}>
                                    <Typography variant="caption" sx={{ color: STAGE_COLORS.pre, fontWeight: 700 }}>{TEXT.stage1}</Typography>
                                    <StatRow label={TEXT.energy} value={detail.pre_energy_mwh || detail.pre_stage.energy_mwh || 0} unit="MWh" />
                                    <StatRow label={TEXT.retailUnitPrice} value={detail.pre_retail_unit_price || detail.pre_stage.retail_unit_price || 0} unit="YPM" />
                                    <StatRow label={TEXT.retailFee} value={detail.pre_retail_fee || detail.pre_stage.retail_fee || 0} bold />
                                </Box>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Box sx={{ height: '100%', p: '6px 10px', bgcolor: '#fff9f0', border: '1px solid', borderColor: '#ffe0b2', borderLeft: `4px solid ${STAGE_COLORS.balancing}`, borderRadius: 1 }}>
                                    <Typography variant="caption" sx={{ color: STAGE_COLORS.balancing, fontWeight: 700 }}>{TEXT.stage2}</Typography>
                                    <StatRow label={TEXT.balancingEnergy} value={detail.sttl_balancing_energy_mwh || 0} unit="MWh" />
                                    <StatRow label={TEXT.balancingWholesalePrice} value={detail.sttl_stage.balancing_reference_price || 0} unit="YPM" />
                                    <StatRow label={TEXT.balancingRetailFee} value={detail.sttl_balancing_retail_fee || 0} bold />
                                </Box>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Box sx={{ height: '100%', p: '6px 10px', bgcolor: 'grey.50', border: '1px solid', borderColor: 'grey.200', borderLeft: `4px solid ${STAGE_COLORS.post}`, borderRadius: 1 }}>
                                    <Typography variant="caption" sx={{ color: STAGE_COLORS.post, fontWeight: 700 }}>{TEXT.stage3}</Typography>
                                    <StatRow label={TEXT.energy} value={detail.sttl_energy_mwh || detail.sttl_stage.energy_mwh || 0} unit="MWh" />
                                    <StatRow label={TEXT.retailUnitPrice} value={detail.sttl_retail_unit_price || detail.sttl_stage.retail_unit_price || 0} unit="YPM" />
                                    <StatRow label={TEXT.retailFee} value={detail.sttl_retail_fee || detail.sttl_stage.retail_fee || 0} bold />
                                </Box>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Box sx={{ height: '100%', p: '6px 10px', bgcolor: '#fff5f5', border: '1px solid', borderColor: '#ffcdd2', borderLeft: `4px solid ${STAGE_COLORS.refund}`, borderRadius: 1 }}>
                                    <Typography variant="caption" sx={{ color: STAGE_COLORS.refund, fontWeight: 700 }}>{TEXT.stage4}</Typography>
                                    <StatRow label={TEXT.refundThreshold} value={detail.refund_context.excess_profit_threshold_per_mwh || 0} unit="YPM" />
                                    <StatRow label={TEXT.refundUnitPrice} value={detail.refund_context.excess_profit_per_mwh || 0} unit="YPM" />
                                    <StatRow label={TEXT.refundFee} value={detail.final_excess_refund_fee || 0} bold />
                                </Box>
                            </Grid>
                        </Grid>

                        <Box sx={{ p: '8px 10px', bgcolor: '#f3e5f5', border: '1px solid', borderColor: '#ce93d8', borderLeft: `4px solid ${STAGE_COLORS.final}`, borderRadius: 1 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, color: STAGE_COLORS.final }}>{TEXT.stage5}</Typography>
                            <Grid container spacing={0.8} sx={{ mt: 0.2 }}>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.energy}</Typography><Typography variant="body2" fontWeight={700}>{formatMwh(finalEnergy)} MWh</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.retailUnitPrice}</Typography><Typography variant="body2" fontWeight={700} color="success.dark">{formatPrice(finalRetailUnitPrice)} {UNIT_YUAN_PER_MWH}</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.retailFee}</Typography><Typography variant="body2" fontWeight={700} color="success.dark">{formatYuan(finalRetailFee)} {UNIT_YUAN}</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.wholesaleUnitPrice}</Typography><Typography variant="body2" fontWeight={700} color="primary.dark">{formatPrice(finalWholesaleUnitPrice)} {UNIT_YUAN_PER_MWH}</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.wholesaleFee}</Typography><Typography variant="body2" fontWeight={700} color="primary.dark">{formatYuan(finalWholesaleFee)} {UNIT_YUAN}</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.grossProfit}</Typography><Typography variant="body2" fontWeight={800} color={profitColor(finalGrossProfit)}>{formatYuan(finalGrossProfit)} {UNIT_YUAN}</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.spread}</Typography><Typography variant="body2" fontWeight={800} color={profitColor(finalPriceSpread)}>{formatPrice(finalPriceSpread)} {UNIT_YUAN_PER_MWH}</Typography></Grid>
                                <Grid size={{ xs: 6, sm: 3 }}><Typography variant="caption" color="text.secondary">{TEXT.profitMargin}</Typography><Typography variant="body2" fontWeight={800} color={profitColor(profitMargin)}>{profitMargin.toFixed(2)}%</Typography></Grid>
                            </Grid>
                        </Box>
                    </Paper>
                </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 3 }, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                            <Typography variant="subtitle1" fontWeight="bold">{TEXT.periodDetail}</Typography>
                        </Box>
                        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                            <Tab label={TEXT.chartAnalysis} sx={{ minHeight: 'unset', py: 0.5 }} />
                            <Tab label={TEXT.dataTable} sx={{ minHeight: 'unset', py: 0.5 }} />
                        </Tabs>
                    </Box>
                    {tabValue === 0 ? <FullscreenEnterButton /> : null}
                </Box>

                <Box sx={{ height: { xs: 350, sm: 400 }, position: 'relative', display: tabValue === 0 ? 'block' : 'none' }}>
                    <Box ref={chartRef} sx={{ height: '100%', width: '100%', position: 'relative', bgcolor: isFullscreen ? 'background.paper' : 'transparent', p: isFullscreen ? 2 : 0, ...(isFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }) }}>
                        <FullscreenExitButton />
                        <FullscreenTitle />
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={isFullscreen ? 1 : 3} />
                                <YAxis yAxisId="left" label={{ value: 'MWh', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                <YAxis yAxisId="right" orientation="right" label={{ value: UNIT_YUAN_PER_MWH, angle: 90, position: 'insideRight', style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Legend />
                                <Bar yAxisId="left" dataKey="load" name={TEXT.energy} barSize={20}>
                                    {chartData.map((entry, index) => <Cell key={`${entry.period}-${index}`} fill={(PERIOD_TYPE_COLORS[entry.periodType] || '#ccc') + '88'} />)}
                                </Bar>
                                <Line yAxisId="right" type="monotone" dataKey="unitPrice" name={TEXT.retailUnitPrice} stroke="#2e7d32" strokeWidth={2} dot={false} />
                                <Line yAxisId="right" type="monotone" dataKey="wholesalePrice" name={TEXT.wholesaleUnitPrice} stroke="#1565c0" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </Box>
                </Box>

                <Box sx={{ display: tabValue === 1 ? 'block' : 'none', maxHeight: 420, overflowY: 'auto', p: isMobile ? 1 : 0 }}>
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{TEXT.period}</TableCell>
                                    <TableCell>{TEXT.periodType}</TableCell>
                                    <TableCell align="right">\u7535\u91cf(MWh)</TableCell>
                                    <TableCell align="right">{TEXT.retailUnitPrice}</TableCell>
                                    <TableCell align="right">{TEXT.retailFee}</TableCell>
                                    <TableCell align="right">{TEXT.wholesaleUnitPrice}</TableCell>
                                    <TableCell align="right">{TEXT.wholesaleFee}</TableCell>
                                    <TableCell align="right">{TEXT.grossProfit}</TableCell>
                                    <TableCell align="right">{TEXT.spread}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {chartData.map((item) => (
                                    <TableRow key={item.period} hover>
                                        <TableCell>{item.period}</TableCell>
                                        <TableCell>
                                            {item.periodType === 'period_type_mix' ? (
                                                <MuiTooltip title={TEXT.mixedTip}><Box sx={{ px: 1, borderRadius: 1, bgcolor: '#f5f5f5', color: '#666', fontSize: '0.75rem', textAlign: 'center' }}>{TEXT.mixed}</Box></MuiTooltip>
                                            ) : (
                                                <Box sx={{ px: 1, borderRadius: 1, bgcolor: (PERIOD_TYPE_COLORS[item.periodType] || '#ccc') + '22', color: PERIOD_TYPE_COLORS[item.periodType] || '#666', fontSize: '0.75rem', textAlign: 'center' }}>{item.periodType}</Box>
                                            )}
                                        </TableCell>
                                        <TableCell align="right">{item.load.toFixed(3)}</TableCell>
                                        <TableCell align="right">{item.unitPrice.toFixed(3)}</TableCell>
                                        <TableCell align="right">{item.fee.toFixed(2)}</TableCell>
                                        <TableCell align="right">{item.wholesalePrice.toFixed(3)}</TableCell>
                                        <TableCell align="right">{item.allocatedCost.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ color: profitColor(item.grossProfit), fontWeight: 700 }}>{item.grossProfit.toFixed(2)}</TableCell>
                                        <TableCell align="right" sx={{ color: profitColor(item.spread), fontWeight: 700 }}>{item.spread.toFixed(3)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            </Paper>

            <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 3 }, flexWrap: 'wrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1, mr: 1 }} />
                            <Typography variant="subtitle1" fontWeight="bold">{TEXT.dailyDetail}</Typography>
                        </Box>
                        <Tabs value={dailyTabValue} onChange={(_, v) => setDailyTabValue(v)}>
                            <Tab label={TEXT.chartAnalysis} sx={{ minHeight: 'unset', py: 0.5 }} />
                            <Tab label={TEXT.dataTable} sx={{ minHeight: 'unset', py: 0.5 }} />
                        </Tabs>
                    </Box>
                </Box>

                <Box sx={{ display: dailyTabValue === 0 ? 'block' : 'none', p: { xs: 1, sm: 2 } }}>
                    {dailyChartData.length === 0 ? (
                        <Box sx={{ height: { xs: 320, sm: 360 }, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography variant="body2" color="text.secondary">{TEXT.noDaily}</Typography>
                        </Box>
                    ) : (
                        <Grid container spacing={{ xs: 1, sm: 2 }}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Box ref={dailyLeftChartRef} sx={{ height: { xs: 300, sm: 340 }, position: 'relative', bgcolor: isDailyLeftFullscreen ? 'background.paper' : 'transparent', p: isDailyLeftFullscreen ? 2 : 0, ...(isDailyLeftFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }) }}>
                                    <DailyLeftFullscreenEnterButton />
                                    <DailyLeftFullscreenExitButton />
                                    <DailyLeftFullscreenTitle />
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={dailyChartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={isDailyLeftFullscreen ? 1 : 2} />
                                            <YAxis tick={{ fontSize: 10 }} label={{ value: UNIT_YUAN_PER_MWH, angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                                            <Tooltip />
                                            <Legend />
                                            <Line type="monotone" dataKey="wholesaleAvgPrice" name={TEXT.wholesaleUnitPrice} stroke="#1565c0" strokeWidth={2} dot={{ r: 2 }} />
                                            <Line type="monotone" dataKey="retailAvgPrice" name={TEXT.retailUnitPrice} stroke="#2e7d32" strokeWidth={2} dot={{ r: 2 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Box ref={dailyRightChartRef} sx={{ height: { xs: 300, sm: 340 }, position: 'relative', bgcolor: isDailyRightFullscreen ? 'background.paper' : 'transparent', p: isDailyRightFullscreen ? 2 : 0, ...(isDailyRightFullscreen && { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400 }) }}>
                                    <DailyRightFullscreenEnterButton />
                                    <DailyRightFullscreenExitButton />
                                    <DailyRightFullscreenTitle />
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={dailyChartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={isDailyRightFullscreen ? 1 : 2} />
                                            <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: UNIT_YUAN_PER_MWH, angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} label={{ value: '\u7d2f\u8ba1\u5747\u4ef7\u5dee', angle: 90, position: 'insideRight', style: { fontSize: 10 } }} />
                                            <Tooltip />
                                            <Legend />
                                            <ReferenceLine yAxisId="left" y={0} stroke="#999" strokeDasharray="3 3" />
                                            <Bar yAxisId="left" dataKey="spread" name={TEXT.spread}>
                                                {dailyChartData.map((entry, index) => (
                                                    <Cell key={`daily-spread-${index}`} fill={entry.spread >= 0 ? '#4caf50' : '#f44336'} />
                                                ))}
                                            </Bar>
                                            <Line yAxisId="right" type="monotone" dataKey="cumulativeAvgSpread" name={'\u7d2f\u8ba1\u5747\u4ef7\u5dee'} stroke="#ff9800" strokeWidth={2} dot={{ r: 2 }} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </Box>
                            </Grid>
                        </Grid>
                    )}
                </Box>

                <Box sx={{ display: dailyTabValue === 1 ? 'block' : 'none', maxHeight: 420, overflowY: 'auto', p: isMobile ? 1 : 0 }}>
                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{TEXT.day}</TableCell>
                                    <TableCell align="right">{TEXT.dayEnergy}</TableCell>
                                    <TableCell align="right">{TEXT.wholesaleUnitPrice}</TableCell>
                                    <TableCell align="right">{TEXT.retailUnitPrice}</TableCell>
                                    <TableCell align="right">{TEXT.wholesaleFee}</TableCell>
                                    <TableCell align="right">{TEXT.retailFee}</TableCell>
                                    <TableCell align="right">{TEXT.grossProfit}</TableCell>
                                    <TableCell align="right">{TEXT.spread}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {detail.daily_details.length > 0 ? detail.daily_details.map((item) => (
                                    <TableRow key={item.date} hover>
                                        <TableCell>{item.date}</TableCell>
                                        <TableCell align="right">{formatMwh(item.total_load_mwh || 0)}</TableCell>
                                        <TableCell align="right">{formatPrice(item.wholesale_avg_price || 0)}</TableCell>
                                        <TableCell align="right">{formatPrice(item.retail_avg_price || item.avg_price || 0)}</TableCell>
                                        <TableCell align="right">{formatYuan(item.total_allocated_cost || 0)}</TableCell>
                                        <TableCell align="right">{formatYuan(item.total_fee || 0)}</TableCell>
                                        <TableCell align="right" sx={{ color: profitColor(item.gross_profit || 0), fontWeight: 700 }}>{formatYuan(item.gross_profit || 0)}</TableCell>
                                        <TableCell align="right" sx={{ color: profitColor(item.price_spread_per_mwh || 0), fontWeight: 700 }}>{formatPrice(item.price_spread_per_mwh || 0)}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={8} align="center" sx={{ py: 3 }}>
                                            <Typography variant="body2" color="text.secondary">{TEXT.noDaily}</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            </Paper>
        </Box>
    );
};

export default IntentRetailSimulationDetailPanel;
