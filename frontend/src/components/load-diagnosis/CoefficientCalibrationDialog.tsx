import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Grid,
    Paper,
    Typography,
    Box,
    Alert,
    CircularProgress,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Tooltip,
    Stack,
    IconButton,
    Collapse
} from '@mui/material';
import { format } from 'date-fns';
import CalculateIcon from '@mui/icons-material/Calculate';
import InfoIcon from '@mui/icons-material/Info';
import TableChartIcon from '@mui/icons-material/TableChart';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
    previewCalibration,
    calculateCalibration,
    applyCalibration
} from '../../api/load-data';

interface CoefficientCalibrationDialogProps {
    open: boolean;
    onClose: () => void;
    customerId: string;
    customerName?: string;
    startDate: Date;
    endDate: Date;
    onSuccess?: () => void;
    canEdit?: boolean;
}

interface MeterInfo {
    meter_id: string;
    multiplier?: number;
    allocation_ratio?: number;
}

interface BreakdownItem {
    id: string;
    total: number;
    ratio?: number;
    has_data: boolean;
}

interface AccountPreview {
    account_no: string;
    meters?: MeterInfo[];
    mp_count?: number;
    status: 'balanced' | 'imbalanced' | 'missing_config' | 'missing_data';
    mp_total: number;
    meter_total: number;
    diff_rate: number;
    message: string;
    mps_breakdown?: BreakdownItem[];
    meters_breakdown?: BreakdownItem[];
}

interface CalibrationResult {
    sample_days: number;
    sample_points: number;
    residual_rate: number;
    confidence: 'High' | 'Medium' | 'Low';
    matched_count?: number;
    unmatched_count?: number;
    meter_results: {
        meter_id: string;
        recommended_value: number;
        match_type?: string;
        matched_mp?: string;
    }[];
    data_summary: {
        mp_total: number;
        est_total: number;
    };
}

const Row = (props: {
    row: AccountPreview;
    onCalibrate: (accountNo: string) => void;
    getStatusLabel: (status: string) => string;
    getStatusColor: (status: string) => any;
    renderMetersInfo: (meters?: MeterInfo[]) => React.ReactNode;
    canEdit: boolean;
}) => {
    const { row, onCalibrate, getStatusLabel, getStatusColor, renderMetersInfo, canEdit } = props;
    const [open, setOpen] = React.useState(false);

    return (
        <React.Fragment>
            <TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
                <TableCell>
                    {row.account_no || <Typography color="text.secondary" variant="body2">(未配置户号)</Typography>}
                </TableCell>
                <TableCell>{row.mp_count ?? '-'}个</TableCell>
                <TableCell>{renderMetersInfo(row.meters)}</TableCell>
                <TableCell>
                    <Chip
                        label={getStatusLabel(row.status)}
                        color={getStatusColor(row.status)}
                        size="small"
                    />
                </TableCell>
                <TableCell align="right">{row.mp_total}</TableCell>
                <TableCell align="right">{row.meter_total}</TableCell>
                <TableCell align="right">{(row.diff_rate * 100).toFixed(2)}%</TableCell>
                <TableCell>{row.message}</TableCell>
                <TableCell align="center">
                    <Stack direction="row" spacing={1} justifyContent="center">
                        <IconButton
                            aria-label="expand row"
                            size="small"
                            onClick={() => setOpen(!open)}
                        >
                            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                        </IconButton>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<CalculateIcon />}
                            disabled={!canEdit || row.status === 'balanced' || row.status === 'missing_config' || row.status === 'missing_data'}
                            onClick={() => onCalibrate(row.account_no)}
                        >
                            校核
                        </Button>
                    </Stack>
                </TableCell>
            </TableRow>
            <TableRow>
                <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={9}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ margin: 1, mb: 2 }}>
                            <Typography variant="subtitle2" gutterBottom component="div" sx={{ fontWeight: 'bold' }}>
                                设备详情明细 (统计时段内)
                            </Typography>
                            <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.04)' }}>
                                            <TableCell>类型</TableCell>
                                            <TableCell>编号</TableCell>
                                            <TableCell align="right">阶段总电量</TableCell>
                                            <TableCell align="right">系数</TableCell>
                                            <TableCell align="center">状态</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {row.mps_breakdown?.map((mp, idx) => (
                                            <TableRow key={`mp-${mp.id}`}>
                                                <TableCell>{idx === 0 ? '计量点 (MP)' : ''}</TableCell>
                                                <TableCell>{mp.id}</TableCell>
                                                <TableCell align="right">{mp.total}</TableCell>
                                                <TableCell align="right">-</TableCell>
                                                <TableCell align="center">
                                                    {mp.has_data ? <Chip label="有数" size="small" color="success" variant="outlined" /> : <Chip label="无数" size="small" color="error" variant="outlined" />}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.03)' }}>
                                            <TableCell colSpan={2} align="right"><strong>MP 总计</strong></TableCell>
                                            <TableCell align="right"><strong>{row.mp_total}</strong></TableCell>
                                            <TableCell colSpan={2}></TableCell>
                                        </TableRow>
                                        {row.meters_breakdown?.map((meter, idx) => (
                                            <TableRow key={`meter-${meter.id}`}>
                                                <TableCell>{idx === 0 ? '电表 (Meter)' : ''}</TableCell>
                                                <TableCell>{meter.id}</TableCell>
                                                <TableCell align="right">{meter.total}</TableCell>
                                                <TableCell align="right">{meter.ratio}</TableCell>
                                                <TableCell align="center">
                                                    {meter.has_data ? <Chip label="有数" size="small" color="success" variant="outlined" /> : <Chip label="无数" size="small" color="error" variant="outlined" />}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.03)' }}>
                                            <TableCell colSpan={2} align="right"><strong>Meter 总计</strong></TableCell>
                                            <TableCell align="right"><strong>{row.meter_total}</strong></TableCell>
                                            <TableCell colSpan={2}></TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    </Collapse>
                </TableCell>
            </TableRow>
        </React.Fragment>
    );
};

export const CoefficientCalibrationDialog: React.FC<CoefficientCalibrationDialogProps> = ({
    open,
    onClose,
    customerId,
    customerName,
    startDate,
    endDate,
    onSuccess,
    canEdit = true
}) => {
    // Preview State
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewResult, setPreviewResult] = useState<AccountPreview[]>([]);
    const [previewError, setPreviewError] = useState<string | null>(null);

    // Calibration State (Single Account)
    const [calibDialogOpen, setCalibDialogOpen] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
    const [calibLoading, setCalibLoading] = useState(false);
    const [calibResult, setCalibResult] = useState<CalibrationResult | null>(null);
    const [calibError, setCalibError] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);

    const [sampleRange, setSampleRange] = useState<number>(0); // 0=Today, 1=+/-1, 3=+/-3

    // Initial Fetch (Reset range when dialog opens with new dates)
    useEffect(() => {
        if (open && customerId && startDate && endDate) {
            setSampleRange(0);
            handlePreview(0); // Pass explicit 0 to avoid closure staleness if we used state
        }
    }, [open, customerId, startDate, endDate]);

    // Re-fetch when range changes (triggered by user)
    const handleRangeChange = (newRange: number) => {
        setSampleRange(newRange);
        handlePreview(newRange);
    };

    const getEffectiveRange = (range: number) => {
        const s = new Date(startDate);
        const e = new Date(endDate);
        if (range > 0) {
            s.setDate(s.getDate() - range);
            e.setDate(e.getDate() + range);
        }
        return {
            sStr: format(s, 'yyyy-MM-dd'),
            eStr: format(e, 'yyyy-MM-dd')
        };
    };

    const handlePreview = async (currentRange: number = sampleRange) => {
        if (!startDate || !endDate) return;
        setPreviewLoading(true);
        setPreviewError(null);
        try {
            const { sStr, eStr } = getEffectiveRange(currentRange);
            const res = await previewCalibration(
                customerId,
                sStr,
                eStr
            );
            if (res.data.success) {
                setPreviewResult(res.data.accounts);
            } else {
                setPreviewError(res.data.message || '预览失败');
            }
        } catch (err: any) {
            setPreviewError(err.message || '预览请求失败');
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleOpenCalibrate = async (accountNo: string) => {
        if (!canEdit) return;
        setSelectedAccount(accountNo);
        setCalibDialogOpen(true);
        setCalibResult(null);
        setCalibLoading(true);
        setCalibError(null); // Reset error state for new calibration attempt

        try {
            const { sStr, eStr } = getEffectiveRange(sampleRange); // Use range-aware dates
            const res = await calculateCalibration(
                customerId,
                sStr,
                eStr,
                accountNo
            );
            if (res.data.success) {
                setCalibResult(res.data);
                // Refresh preview to update status after calibration calculation
                handlePreview();
            } else {
                setCalibError(res.data.message || '计算失败');
            }
        } catch (err: any) {
            setCalibError(err.message || '计算请求失败');
        } finally {
            setCalibLoading(false);
        }
    };

    const handleApply = async (updateHistory: boolean) => {
        if (!canEdit) return;
        if (!calibResult || !selectedAccount) return;
        setApplying(true);
        try {
            const res = await applyCalibration({
                customer_id: customerId,
                coefficients: calibResult.meter_results.map(m => ({
                    meter_id: m.meter_id,
                    value: m.recommended_value
                })),
                update_history: updateHistory,
                history_range: [format(startDate!, 'yyyy-MM-dd'), format(endDate!, 'yyyy-MM-dd')]
            });

            if (res.data.success) {
                setCalibDialogOpen(false);
                // Refresh preview
                handlePreview();
                if (onSuccess) onSuccess();
            } else {
                setCalibError(res.data.message || '应用失败');
            }
        } catch (err: any) {
            setCalibError(err.message || '应用请求失败');
        } finally {
            setApplying(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'balanced': return 'success';
            case 'imbalanced': return 'error';
            case 'missing_config': return 'warning';
            default: return 'default';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'balanced': return '平衡';
            case 'imbalanced': return '偏差';
            case 'missing_config': return '缺档案';
            case 'missing_data': return '缺数据';
            default: return status;
        }
    };

    const renderMetersInfo = (meters?: MeterInfo[]) => {
        if (!meters || meters.length === 0) return "-";

        const details = meters.map(m => (
            <div key={m.meter_id}>
                {m.meter_id} (系数: {m.allocation_ratio ?? '未配置'})
            </div>
        ));

        return (
            <Tooltip title={<Stack spacing={0.5}>{details}</Stack>} arrow>
                <Chip
                    label={`${meters.length}个电表`}
                    size="small"
                    variant="outlined"
                    icon={<InfoIcon />}
                    sx={{ cursor: 'help' }}
                />
            </Tooltip>
        );
    };

    const dateRangeStr = startDate && endDate
        ? (startDate.getTime() === endDate.getTime()
            ? format(startDate, 'yyyy-MM-dd')
            : `${format(startDate, 'yyyy-MM-dd')} ~ ${format(endDate, 'yyyy-MM-dd')}`)
        : '';

    return (
        <>
            <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
                <DialogTitle>
                    系数校核 - {customerName || customerId}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Alert severity="info" sx={{ flex: 1 }}>
                            系统将基于选定时间范围内的负荷曲线，利用最小二乘法自动推算各电表的分配系数。
                        </Alert>

                        <Paper variant="outlined" sx={{ p: 1, bgcolor: 'background.default' }}>
                            <Typography variant="caption" color="textSecondary" display="block" gutterBottom align="center">
                                样本范围扩展
                            </Typography>
                            <Stack direction="row" spacing={1}>
                                {[0, 1, 3].map((r) => (
                                    <Chip
                                        key={r}
                                        label={r === 0 ? "仅当日" : `±${r}天`}
                                        color={sampleRange === r ? "primary" : "default"}
                                        onClick={() => handleRangeChange(r)}
                                        disabled={previewLoading}
                                        size="small"
                                        variant={sampleRange === r ? "filled" : "outlined"}
                                        clickable
                                    />
                                ))}
                            </Stack>
                        </Paper>
                    </Box>

                    <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle1">
                            校核数据日期: <strong>{dateRangeStr}</strong>
                        </Typography>
                        <Box>
                            <Button
                                variant="outlined"
                                onClick={() => handlePreview()}
                                disabled={previewLoading}
                            >
                                {previewLoading ? '检查中...' : '刷新状态'}
                            </Button>
                        </Box>
                    </Box>

                    {previewError && <Alert severity="error" sx={{ mb: 2 }}>{previewError}</Alert>}

                    <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>户号</TableCell>
                                    <TableCell>计量点</TableCell>
                                    <TableCell>包含电表</TableCell>
                                    <TableCell>状态</TableCell>
                                    <TableCell align="right">计量点总电量</TableCell>
                                    <TableCell align="right">电表总电量</TableCell>
                                    <TableCell align="right">偏差率</TableCell>
                                    <TableCell>说明</TableCell>
                                    <TableCell align="center">操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {previewResult.length === 0 && !previewLoading && (
                                    <TableRow>
                                        <TableCell colSpan={9} align="center">暂无数据</TableCell>
                                    </TableRow>
                                )}
                                {previewResult.map((row) => (
                                    <Row
                                        key={row.account_no}
                                        row={row}
                                        onCalibrate={handleOpenCalibrate}
                                        getStatusLabel={getStatusLabel}
                                        getStatusColor={getStatusColor}
                                        renderMetersInfo={renderMetersInfo}
                                        canEdit={canEdit}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>关闭</Button>
                </DialogActions>
            </Dialog>

            {/* Calibration Result Dialog */}
            <Dialog open={calibDialogOpen} onClose={() => setCalibDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>推荐系数方案 (户号: {selectedAccount})</DialogTitle>
                <DialogContent>
                    {calibLoading && <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>}

                    {calibError && (
                        <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
                            {calibError}
                        </Alert>
                    )}

                    {calibResult && (
                        <Box sx={{ mt: 1 }}>
                            <Alert severity="info" sx={{ mb: 2 }}>
                                采样天数: {calibResult.sample_days} 天,
                                残差率: {(calibResult.residual_rate * 100).toFixed(2)}%
                                (置信度: {calibResult.confidence})
                                {calibResult.matched_count !== undefined && (
                                    <span> | 1:1匹配: {calibResult.matched_count}个, 计算: {calibResult.unmatched_count}个</span>
                                )}
                            </Alert>

                            <TableContainer component={Paper} variant="outlined">
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>电表ID</TableCell>
                                            <TableCell>匹配类型</TableCell>
                                            <TableCell align="right">推荐系数</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {calibResult.meter_results.map((m) => (
                                            <TableRow key={m.meter_id}>
                                                <TableCell>{m.meter_id}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={m.match_type || '计算'}
                                                        size="small"
                                                        color={m.match_type === '1:1匹配' ? 'success' : 'default'}
                                                    />
                                                    {m.matched_mp && <Typography variant="caption" display="block">MP: {m.matched_mp}</Typography>}
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Typography fontWeight="bold" color={m.recommended_value === 1.0 ? 'success.main' : 'primary'}>
                                                        {m.recommended_value.toFixed(4)}
                                                    </Typography>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <Box sx={{ mt: 2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    * 应用后将更新档案中的分配系数
                                </Typography>
                            </Box>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCalibDialogOpen(false)} disabled={applying}>取消</Button>
                    <Button
                        onClick={() => handleApply(false)}
                        variant="contained"
                        disabled={!canEdit || !calibResult || applying}
                    >
                        仅更新档案
                    </Button>
                    <Button
                        onClick={() => handleApply(true)}
                        variant="contained"
                        color="secondary"
                        disabled={!canEdit || !calibResult || applying}
                    >
                        更新并重算历史
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
