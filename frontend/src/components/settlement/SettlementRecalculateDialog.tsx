import React from 'react';
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    FormGroup,
    LinearProgress,
    Typography,
} from '@mui/material';

export interface SettlementRecalculateOptions {
    wholesalePreliminary: boolean;
    wholesalePlatform: boolean;
    retailPreliminary: boolean;
    retailPlatform: boolean;
}

interface SettlementRecalculateDialogProps {
    open: boolean;
    title: string;
    options: SettlementRecalculateOptions;
    onClose: () => void;
    onChange: (options: SettlementRecalculateOptions) => void;
    onConfirm: () => void;
    disabled?: boolean;
    processing?: boolean;
    progress?: {
        current: number;
        total: number;
        currentDate: string;
    };
    statusText?: string;
    onStop?: () => void;
}

const SettlementRecalculateDialog: React.FC<SettlementRecalculateDialogProps> = ({
    open,
    title,
    options,
    onClose,
    onChange,
    onConfirm,
    disabled = false,
    processing = false,
    progress,
    statusText,
    onStop,
}) => {
    const updateOption = (key: keyof SettlementRecalculateOptions, checked: boolean) => {
        onChange({
            ...options,
            [key]: checked,
        });
    };

    const hasSelection = Object.values(options).some(Boolean);

    return (
        <Dialog open={open} onClose={() => !disabled && !processing && onClose()} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    请选择需要重新执行的结算任务。零售侧仅重算 `daily` 预结算记录，所选版本表示其依赖的批发侧版本。
                </Typography>
                <FormGroup>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={options.wholesalePreliminary}
                                onChange={(e) => updateOption('wholesalePreliminary', e.target.checked)}
                                disabled={processing}
                            />
                        }
                        label="批发侧结算 (PRELIMINARY)"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={options.wholesalePlatform}
                                onChange={(e) => updateOption('wholesalePlatform', e.target.checked)}
                                disabled={processing}
                            />
                        }
                        label="批发侧结算 (PLATFORM_DAILY)"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={options.retailPreliminary}
                                onChange={(e) => updateOption('retailPreliminary', e.target.checked)}
                                disabled={processing}
                            />
                        }
                        label="零售侧日结预结算 (依赖 PRELIMINARY)"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={options.retailPlatform}
                                onChange={(e) => updateOption('retailPlatform', e.target.checked)}
                                disabled={processing}
                            />
                        }
                        label="零售侧日结预结算 (依赖 PLATFORM_DAILY)"
                    />
                </FormGroup>

                {processing && progress && progress.total > 0 ? (
                    <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold' }}>
                            {statusText || '正在执行...'}
                        </Typography>
                        <LinearProgress
                            variant="determinate"
                            value={(progress.current / progress.total) * 100}
                            sx={{ height: 8, borderRadius: 999 }}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            {progress.currentDate}
                            {` (${progress.current}/${progress.total})`}
                        </Typography>
                    </Box>
                ) : null}
            </DialogContent>
            <DialogActions>
                {processing ? (
                    <Button onClick={onStop} color="warning" variant="outlined" disabled={!onStop}>
                        中断执行
                    </Button>
                ) : (
                    <Button onClick={onClose} color="inherit" disabled={disabled}>
                        取消
                    </Button>
                )}
                <Button onClick={onConfirm} variant="contained" disabled={disabled || processing || !hasSelection}>
                    开始执行
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SettlementRecalculateDialog;
