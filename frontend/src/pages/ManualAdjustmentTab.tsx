import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Paper, Typography, Grid, Button, ButtonGroup, TextField, InputAdornment, IconButton, Alert, Snackbar, ToggleButton, ToggleButtonGroup, CircularProgress } from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { format, addDays, subDays, parseISO } from 'date-fns';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import FlashOnIcon from '@mui/icons-material/FlashOn'; // For quick actions
import { LoadForecastData, loadForecastApi } from '../api/loadForecast';
import { manualAdjustmentApi } from '../api/manualAdjustment';
import { customerAnalysisApi } from '../api/customerAnalysis';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useTouPeriodBackground } from '../hooks/useTouPeriodBackground';
import { useAuth } from '../contexts/AuthContext';

interface ManualAdjustmentTabProps {
    targetDate: string;
    forecastDate: string;
    customerId: string;
    initialData: LoadForecastData | null;
    onSaveSuccess: () => void;
    onDateShift?: (days: number) => void;
}

export const ManualAdjustmentTab: React.FC<ManualAdjustmentTabProps> = ({
    targetDate,
    forecastDate,
    customerId,
    initialData,
    onSaveSuccess,
    onDateShift
}) => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:forecast_short_term_load:edit');
    // --- State ---
    const [values, setValues] = useState<number[]>(new Array(48).fill(0));
    const [originalValues, setOriginalValues] = useState<number[]>(new Array(48).fill(0));
    const [isModified, setIsModified] = useState(false);
    const [saving, setSaving] = useState(false);

    const chartRef = useRef<HTMLDivElement>(null);

    const { isFullscreen, FullscreenEnterButton, FullscreenExitButton, FullscreenTitle, NavigationButtons } = useChartFullscreen({
        chartRef,
        title: `手工调整 - ${customerId} (${targetDate})`,
        onPrevious: onDateShift ? () => onDateShift(-1) : undefined,
        onNext: onDateShift ? () => onDateShift(1) : undefined
    });

    // Reference Data
    const [refType, setRefType] = useState<string | null>(null);
    const [refData, setRefData] = useState<number[] | null>(null);
    const [loadingRef, setLoadingRef] = useState(false);

    // Brush State
    const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
    const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
    const [selection, setSelection] = useState<{ start: number, end: number } | null>(null);

    // Bulk Action
    const [bulkValue, setBulkValue] = useState<string>('');

    // --- Initialization ---
    useEffect(() => {
        if (initialData) {
            setValues([...initialData.values]);
            // If already manually adjusted, original_values should be in separate field (not yet in LoadForecastData type definition, but valid at runtime if backend sends it)
            // For now, we assume initialData.values IS the current state.
            // We need to fetch original values if we want to show "Original Algorithm" line distinct from current manual.
            // But if initialData has 'manual_adjustment' object, we use it.
            const manualAdj = initialData.manual_adjustment;
            if (manualAdj && manualAdj.is_modified && manualAdj.original_values) {
                setOriginalValues(manualAdj.original_values);
                setIsModified(true);
            } else {
                setOriginalValues([...initialData.values]);
                setIsModified(false);
            }
        }
    }, [initialData]);

    // --- Load Reference Data ---
    useEffect(() => {
        if (!refType || !customerId) {
            setRefData(null);
            return;
        }

        const fetchRef = async () => {
            setLoadingRef(true);
            try {
                let dateStr = '';
                const target = parseISO(targetDate);

                if (refType === 'T-1') dateStr = format(subDays(target, 1), 'yyyy-MM-dd');
                else if (refType === 'D-7') dateStr = format(subDays(target, 7), 'yyyy-MM-dd');
                else if (refType === 'Y-1') dateStr = format(subDays(target, 365), 'yyyy-MM-dd'); // Simple approximation

                if (dateStr) {
                    // Try fetch actual load first (reliable for history)
                    try {
                        const res = await customerAnalysisApi.fetchDailyView(customerId, dateStr);
                        if (res.data.main_curve && res.data.main_curve.length > 0) {
                            // Map to array of numbers, handle nulls
                            // Optimization: Check if we have ANY valid data points (not just all 0s/nulls)
                            const hasValidData = res.data.main_curve.some(p => p.current != null && p.current > 0);

                            if (hasValidData) {
                                const actuals = res.data.main_curve.map(p => p.current ?? 0);
                                setRefData(actuals);
                                return;
                            } else {
                                console.warn('Fetched actual load but it is empty/zero, falling back to forecast records.');
                            }
                        }
                    } catch (ignore) {
                        console.warn('Failed to fetch actual load for reference, falling back to forecast records.');
                    }

                    // Fallback to old logic (Forecast Records) if actuals fail or empty
                    const versions = await loadForecastApi.getVersions(dateStr);
                    if (versions.data.length > 0) {
                        const v = versions.data[0];
                        const res = await loadForecastApi.getForecastData(dateStr, v.forecast_date, customerId);
                        if (res.data.actual_values) {
                            setRefData(res.data.actual_values);
                        } else {
                            setRefData(res.data.values);
                        }
                    } else {
                        setRefData(null);
                    }
                }
            } catch (e) {
                console.error(e);
                setRefData(null);
            } finally {
                setLoadingRef(false);
            }
        };
        fetchRef();
    }, [refType, targetDate, customerId]);


    // --- Chart Data Preparation ---
    const chartData = useMemo(() => {
        return values.map((v, i) => {
            const minutes = (i + 1) * 30;
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            const time = minutes >= 1440 ? "24:00" : `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

            return {
                time,
                index: i, // important for brush axis
                current: v, // Adjusted Forecast
                original: originalValues[i], // Algorithm Forecast
                reference: refData?.[i],
                period_type: initialData?.period_types?.[i] || '平段'
            };
        });
    }, [values, originalValues, refData, initialData]);

    const { TouPeriodAreas } = useTouPeriodBackground(chartData, '24:00');

    // --- Interaction Handlers ---
    const handleUpdateValue = (index: number, newValue: number) => {
        const newValues = [...values];
        newValues[index] = newValue;
        setValues(newValues);
        setIsModified(true);
    };

    const handleSave = async () => {
        if (!canEdit) return;
        setSaving(true);
        try {
            await manualAdjustmentApi.save(targetDate, forecastDate, customerId, values);
            onSaveSuccess();
            // Refetch or rely on parent update
        } catch (e) {
            window.alert('保存失败');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!canEdit) return;
        if (!window.confirm('确定重置为算法原始值吗？')) return;

        // Check if server actually has modifications
        const hasServerMod = initialData?.manual_adjustment?.is_modified;

        if (hasServerMod) {
            setSaving(true);
            try {
                await manualAdjustmentApi.reset(targetDate, forecastDate, customerId);
                onSaveSuccess();
            } catch (e) {
                window.alert('重置失败');
            } finally {
                setSaving(false);
            }
        } else {
            // Local reset only
            setValues([...originalValues]);
            setIsModified(false);
        }
    };

    // Brush Logic
    const onMouseDown = (e: any) => {
        if (e && e.activeLabel) setRefAreaLeft(e.activeLabel);
    };

    const onMouseMove = (e: any) => {
        if (refAreaLeft && e && e.activeLabel) setRefAreaRight(e.activeLabel);
    };

    const onMouseUp = (e: any) => {
        if (refAreaLeft && refAreaRight) {
            // Find indices
            const leftIndex = chartData.findIndex(d => d.time === refAreaLeft);
            const rightIndex = chartData.findIndex(d => d.time === refAreaRight);

            if (leftIndex !== -1 && rightIndex !== -1) {
                const start = Math.min(leftIndex, rightIndex);
                const end = Math.max(leftIndex, rightIndex);
                setSelection({ start, end });
            }
        }
        setRefAreaLeft(null);
        setRefAreaRight(null);
    };

    const clearSelection = () => setSelection(null);

    const applyBulk = (mode: 'set' | 'percent' | 'add') => {
        if (!selection || !bulkValue) return;
        const val = parseFloat(bulkValue);
        if (isNaN(val)) return;

        const newValues = [...values];
        const { start, end } = selection;

        for (let i = start; i <= end; i++) {
            if (mode === 'set') newValues[i] = val;
            if (mode === 'percent') newValues[i] = newValues[i] * (1 + val / 100);
            if (mode === 'add') newValues[i] = newValues[i] + val;
        }
        setValues(newValues);
        setIsModified(true);
        setBulkValue('');
    };

    // DataGrid Columns
    const columns: GridColDef[] = [
        { field: 'time', headerName: '时间', flex: 1 },
        {
            field: 'current',
            headerName: '预测值',
            flex: 1,
            editable: true,
            type: 'number',
            renderCell: (params: GridRenderCellParams) => {
                const isDiff = Math.abs(params.value - params.row.original) > 0.01;
                return (
                    <Typography color={isDiff ? 'warning.main' : 'inherit'} fontWeight={isDiff ? 'bold' : 'normal'}>
                        {params.value?.toFixed(2)}
                    </Typography>
                );
            }
        },
        { field: 'original', headerName: '原始值', flex: 1, type: 'number', valueFormatter: (params: any) => params?.toFixed(2) }
    ];

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            height: '100%',
            gap: 2,
            pb: { xs: 2, md: 0 }, // Add padding bottom for mobile scrolling
            overflowY: { xs: 'auto', md: 'hidden' } // Allow scrolling on mobile
        }}>
            {/* Left: Chart & Ref Toolbar */}
            <Paper variant="outlined" sx={{
                flex: { xs: 'none', md: '0 0 60%' },
                height: { xs: 400, md: 'auto' }, // Fixed height on mobile
                p: 2,
                display: 'flex',
                flexDirection: 'column'
            }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle2" fontWeight="bold">交互调整 (框选区域以批量操作)</Typography>
                    <ToggleButtonGroup
                        value={refType}
                        exclusive
                        onChange={(e, v) => setRefType(v)}
                        size="small"
                        aria-label="reference curve"
                    >
                        <ToggleButton value="T-1">T-1</ToggleButton>
                        <ToggleButton value="D-7">D-7</ToggleButton>
                        <ToggleButton value="Y-1">Y-1</ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                <Box ref={chartRef} sx={{
                    flex: 1,
                    minHeight: 0,
                    position: 'relative',
                    userSelect: 'none',
                    ...(isFullscreen && {
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 1300,
                        backgroundColor: 'background.paper',
                        p: 2
                    })
                }}>
                    <FullscreenEnterButton />
                    <FullscreenExitButton />
                    <FullscreenTitle />
                    <NavigationButtons />
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                            data={chartData}
                            onMouseDown={onMouseDown}
                            onMouseMove={onMouseMove}
                            onMouseUp={onMouseUp}
                            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                        >
                            {isFullscreen && TouPeriodAreas}
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                            <XAxis
                                dataKey="time"
                                interval={5}
                                allowDataOverflow
                                tick={{ fontSize: 11, fill: '#888' }}
                                tickLine={{ stroke: '#ccc' }}
                                axisLine={{ stroke: '#ccc' }}
                            />
                            <YAxis
                                domain={['auto', 'auto']}
                                tick={{ fontSize: 11, fill: '#888' }}
                                tickLine={{ stroke: '#ccc' }}
                                axisLine={{ stroke: '#ccc' }}
                                width={40}
                            />
                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        return (
                                            <Paper sx={{ p: 1.5, boxShadow: 3 }}>
                                                <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>{label}</Typography>
                                                {payload.map((entry: any, index: number) => (
                                                    <Typography key={index} variant="body2" sx={{ color: entry.color }}>
                                                        {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value} MW
                                                    </Typography>
                                                ))}
                                            </Paper>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Legend />
                            <Line name="当前预测" dataKey="current" stroke="#2196f3" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line name="原始算法" dataKey="original" stroke="#999" strokeDasharray="5 5" dot={false} strokeWidth={1} />
                            {refType && <Line name={`参考 ${refType}`} dataKey="reference" stroke="#ff9800" dot={false} strokeWidth={1} />}

                            {/* Brush Selection Highlight */}
                            {selection && (
                                <ReferenceArea x1={chartData[selection.start].time} x2={chartData[selection.end].time} strokeOpacity={0.3} fill="#2196f3" fillOpacity={0.1} />
                            )}
                            {/* Dragging Preview */}
                            {refAreaLeft && refAreaRight && (
                                <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#999" fillOpacity={0.3} />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                    {loadingRef && <CircularProgress size={24} sx={{ position: 'absolute', top: 10, right: 10 }} />}
                </Box>
            </Paper>

            {/* Right: Controls & Grid */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Bulk Action Panel */}
                <Paper variant="outlined" sx={{ p: 2, bgcolor: selection ? 'primary.50' : 'background.paper', transition: 'background-color 0.3s' }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle2" color={selection ? 'primary.main' : 'text.secondary'}>
                            {selection
                                ? `已选: ${chartData[selection.start].time} ~ ${chartData[selection.end].time}`
                                : '未选择区域 (请在左图框选)'}
                        </Typography>
                        {selection && <Button size="small" onClick={clearSelection}>取消</Button>}
                    </Box>

                    <Box display="flex" gap={1} mt={1} alignItems="center">
                        <TextField
                            size="small"
                            placeholder="数值"
                            value={bulkValue}
                            onChange={(e) => setBulkValue(e.target.value)}
                            disabled={!selection || !canEdit}
                            fullWidth
                        />
                        <ButtonGroup size="small" disabled={!selection || !bulkValue || !canEdit} variant="contained" disableElevation>
                            <Button onClick={() => applyBulk('percent')}>%</Button>
                            <Button onClick={() => applyBulk('set')}>=</Button>
                            <Button onClick={() => applyBulk('add')}>+</Button>
                        </ButtonGroup>
                    </Box>
                </Paper>

                {/* Data Grid */}
                <Paper variant="outlined" sx={{ flex: 1, minHeight: 0 }}>
                    <DataGrid
                        rows={chartData}
                        columns={columns}
                        getRowId={(row) => row.time}
                        hideFooter
                        density="compact"
                        processRowUpdate={(newRow, oldRow) => {
                            if (!canEdit) return oldRow;
                            const val = Number(newRow.current);
                            if (!isNaN(val)) {
                                handleUpdateValue(newRow.index, val);
                                return { ...newRow, current: val };
                            }
                            return oldRow;
                        }}
                    />
                </Paper>

                {/* Save Actions */}
                <Box display="flex" gap={1}>
                    <Button
                        variant="contained"
                        fullWidth
                        sx={{ flex: 1 }}
                        startIcon={<SaveIcon />}
                        onClick={handleSave}
                        disabled={!isModified || saving || !canEdit}
                    >
                        保存调整
                    </Button>
                    <Button
                        variant="outlined"
                        fullWidth
                        sx={{ flex: 1 }}
                        color="error"
                        startIcon={<RestoreIcon />}
                        onClick={handleReset}
                        disabled={saving || !isModified || !canEdit}
                    >
                        重置
                    </Button>
                </Box>
            </Box>
        </Box>
    );
};
