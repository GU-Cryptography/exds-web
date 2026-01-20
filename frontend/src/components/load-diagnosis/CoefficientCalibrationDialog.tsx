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
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    CircularProgress,
    Divider,
    RadioGroup,
    FormControlLabel,
    Radio,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import apiClient from '../../api/client';

interface CoefficientCalibrationDialogProps {
    open: boolean;
    onClose: () => void;
    customerId: string;
    customerName?: string;
    onSuccess?: () => void;
}

interface CalibrationResult {
    success: boolean;
    sample_days: number;
    sample_points: number;
    residual_rate: number;
    confidence: 'High' | 'Medium' | 'Low';
    meter_results: {
        meter_id: string;
        recommended_value: number;
    }[];
    data_summary: {
        mp_total: number;
        est_total: number;
    };
    message?: string;
}

export const CoefficientCalibrationDialog: React.FC<CoefficientCalibrationDialogProps> = ({
    open,
    onClose,
    customerId,
    customerName,
    onSuccess
}) => {
    // Stage: 'config' | 'calculating' | 'result' | 'applying'
    const [stage, setStage] = useState<'config' | 'calculating' | 'result' | 'applying'>('config');

    // Config State
    const [startDate, setStartDate] = useState<Date | null>(subDays(new Date(), 1)); // Default: Yesterday (1 day)
    const [endDate, setEndDate] = useState<Date | null>(subDays(new Date(), 1));   // Default: Yesterday
    const [algoModel, setAlgoModel] = useState('lsq_constrained');
    const [sampleStrategy, setSampleStrategy] = useState('last_1_day');

    // Result State
    const [result, setResult] = useState<CalibrationResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Apply State
    const [applyMode, setApplyMode] = useState<'archive_only' | 'recalculate'>('archive_only');

    useEffect(() => {
        if (open) {
            setStage('config');
            setResult(null);
            setError(null);
            // Reset dates on open? Optional.
        }
    }, [open]);

    const handleCalculate = async () => {
        if (!startDate || !endDate) return;

        setStage('calculating');
        setError(null);

        try {
            const resp = await apiClient.post('/api/v1/load-data/calibration/calculate', null, {
                params: {
                    customer_id: customerId,
                    start_date: format(startDate, 'yyyy-MM-dd'),
                    end_date: format(endDate, 'yyyy-MM-dd')
                }
            });

            const data = resp.data;
            if (data.success) {
                setResult(data);
                setStage('result');
            } else {
                setError(data.message || '计算失败');
                setStage('config'); // Go back to config on error
            }
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.detail || '计算请求失败');
            setStage('config');
        }
    };

    const handleApply = async () => {
        if (!result) return;

        setStage('applying');
        setError(null);

        try {
            const payload = {
                customer_id: customerId,
                coefficients: result.meter_results.map(r => ({
                    meter_id: r.meter_id,
                    value: r.recommended_value
                })),
                update_history: applyMode === 'recalculate',
                history_range: applyMode === 'recalculate' && startDate && endDate
                    ? [format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')]
                    : undefined
            };

            await apiClient.post('/api/v1/load-data/calibration/apply', payload);

            if (onSuccess) onSuccess();
            onClose();
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.detail || '应用配置失败');
            setStage('result'); // Go back to result on error
        }
    };

    const handleStrategyChange = (val: string) => {
        setSampleStrategy(val);
        const today = new Date();
        if (val === 'last_1_day') {
            setEndDate(subDays(today, 1));
            setStartDate(subDays(today, 1)); // Just yesterday
        } else if (val === 'last_7_days') {
            setEndDate(subDays(today, 1));
            setStartDate(subDays(today, 7)); // 7 days ending yesterday
        } else if (val === 'last_30_days') {
            setEndDate(subDays(today, 1));
            setStartDate(subDays(today, 30));
        } else if (val === 'current_month') {
            setStartDate(startOfMonth(today));
            setEndDate(subDays(today, 1));
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                系数智能推荐 {customerName ? ` - ${customerName}` : ''}
            </DialogTitle>

            <DialogContent dividers>
                {/* 1. Configuration Section */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                        1. 分析配置 (Configuration)
                    </Typography>

                    <Grid container spacing={2} sx={{ mb: 2 }}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>算法模型</InputLabel>
                                <Select
                                    value={algoModel}
                                    label="算法模型"
                                    onChange={(e) => setAlgoModel(e.target.value)}
                                    disabled={stage !== 'config'}
                                >
                                    <MenuItem value="lsq_constrained">约束最小二乘法 (Constrained Least Squares)</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>样本策略</InputLabel>
                                <Select
                                    value={sampleStrategy}
                                    label="样本策略"
                                    onChange={(e) => handleStrategyChange(e.target.value)}
                                    disabled={stage !== 'config'}
                                >
                                    <MenuItem value="last_1_day">单日 (推荐)</MenuItem>
                                    <MenuItem value="last_7_days">连续 7 天</MenuItem>
                                    <MenuItem value="last_30_days">近 30 天</MenuItem>
                                    <MenuItem value="current_month">本月至今</MenuItem>
                                    <MenuItem value="custom">自定义范围</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>

                    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 6 }}>
                                <DatePicker
                                    label="开始日期"
                                    value={startDate}
                                    onChange={(v) => { setStartDate(v); setSampleStrategy('custom'); }}
                                    disabled={stage !== 'config'}
                                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <DatePicker
                                    label="结束日期"
                                    value={endDate}
                                    onChange={(v) => { setEndDate(v); setSampleStrategy('custom'); }}
                                    disabled={stage !== 'config'}
                                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                />
                            </Grid>
                        </Grid>
                    </LocalizationProvider>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                {/* 2. Calculating State */}
                {stage === 'calculating' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
                        <CircularProgress size={40} sx={{ mb: 2 }} />
                        <Typography color="text.secondary">正在执行最小二乘优化计算...</Typography>
                    </Box>
                )}

                {/* 3. Result Section (Only show if result exists) */}
                {result && (stage === 'result' || stage === 'applying') && (
                    <>
                        <Divider sx={{ my: 2 }} />

                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                                2. 拟合分析 (Fitting Analysis)
                            </Typography>

                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                                <Grid container spacing={2} alignItems="center">
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <Typography variant="body2">拟合置信度:</Typography>
                                            <Chip
                                                label={result.confidence === 'High' ? '高 (High)' : result.confidence === 'Medium' ? '中 (Medium)' : '低 (Low)'}
                                                color={result.confidence === 'High' ? 'success' : result.confidence === 'Medium' ? 'warning' : 'error'}
                                                size="small"
                                            />
                                        </Box>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <Typography variant="body2">
                                            残差 (Residual): <strong>{(result.residual_rate * 100).toFixed(2)}%</strong>
                                        </Typography>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 4 }}>
                                        <Typography variant="body2">
                                            有效样本: {result.sample_days} 天 (双边数据完整的重叠天数)
                                        </Typography>
                                    </Grid>

                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary" display="block">MP Total (True)</Typography>
                                        <Typography variant="h6">{result.data_summary.mp_total.toLocaleString()} kWh</Typography>
                                    </Grid>
                                    <Grid size={{ xs: 6 }}>
                                        <Typography variant="caption" color="text.secondary" display="block">Meter Total (Est)</Typography>
                                        <Typography variant="h6">{result.data_summary.est_total.toLocaleString()} kWh</Typography>
                                    </Grid>
                                </Grid>
                            </Paper>
                        </Box>

                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                                3. 推荐结果 (Optimization Result)
                            </Typography>

                            <TableContainer component={Paper} variant="outlined">
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={{ bgcolor: 'grey.100' }}>
                                            <TableCell>目标电表</TableCell>
                                            <TableCell align="right">当前系数</TableCell>
                                            <TableCell align="center">{">>>"}</TableCell>
                                            <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>🔥 推荐系数</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {result.meter_results.map((row) => (
                                            <TableRow key={row.meter_id}>
                                                <TableCell>{row.meter_id}</TableCell>
                                                <TableCell align="right">1.0000</TableCell> {/* TODO: Fetch current if needed, or assume 1.0/Unknown */}
                                                <TableCell align="center">{">>>"}</TableCell>
                                                <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                                    {row.recommended_value.toFixed(4)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>

                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                                4. 生效操作 (Action)
                            </Typography>
                            <FormControl component="fieldset">
                                <RadioGroup
                                    value={applyMode}
                                    onChange={(e) => setApplyMode(e.target.value as any)}
                                >
                                    <FormControlLabel
                                        value="archive_only"
                                        control={<Radio />}
                                        label={
                                            <Box>
                                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>仅更新档案 (Update Archive)</Typography>
                                                <Typography variant="caption" color="text.secondary">从 [今天] 开始生效 (仅影响未来聚合)</Typography>
                                            </Box>
                                        }
                                        sx={{ mb: 1 }}
                                    />
                                    <FormControlLabel
                                        value="recalculate"
                                        control={<Radio />}
                                        label={
                                            <Box>
                                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>更新并重算历史 (Update & Recalculate)</Typography>
                                                <Typography variant="caption" color="text.secondary">从 [参考时段开始 ({startDate ? format(startDate, 'MM-dd') : ''})] 重算至 [昨天]</Typography>
                                                <Typography variant="caption" display="block" color="error.main">[!] 注意: 历史数据将发生变更</Typography>
                                            </Box>
                                        }
                                    />
                                </RadioGroup>
                            </FormControl>
                        </Box>
                    </>
                )}

                {stage === 'applying' && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={24} sx={{ mr: 2 }} />
                        <Typography>正在保存并应用...</Typography>
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={stage === 'calculating' || stage === 'applying'}>
                    取消
                </Button>

                {stage === 'config' && (
                    <Button
                        onClick={handleCalculate}
                        variant="contained"
                        color="primary"
                        disabled={!startDate || !endDate}
                    >
                        ⚡ 开始计算
                    </Button>
                )}

                {(stage === 'result' || stage === 'applying') && (
                    <Button
                        onClick={handleApply}
                        variant="contained"
                        color="success"
                        disabled={stage === 'applying'}
                    >
                        应用配置
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
