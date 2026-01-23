import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Typography, Box, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Paper, Chip,
    Accordion, AccordionSummary, AccordionDetails,
    CircularProgress, Alert, IconButton, Tooltip
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
import { getCalibrationDetails } from '../../api/load-data';

interface CalibrationDetailsDialogProps {
    open: boolean;
    onClose: () => void;
    customerId: string;
    startDate: string;
    endDate: string;
}

interface MPItem {
    id: string;
    val: number;
    has_data: boolean;
}

interface MeterItem {
    id: string;
    val: number;
    ratio: number;
    has_data: boolean;
}

interface AccountDetail {
    account_no: string;
    status: 'balanced' | 'imbalanced' | 'missing_config' | 'missing_data';
    mp_sum: number;
    meter_sum: number;
    diff: number;
    diff_rate: number;
    mps: MPItem[];
    meters: MeterItem[];
}

interface DailyRecord {
    date: string;
    accounts: AccountDetail[];
}

export const CalibrationDetailsDialog: React.FC<CalibrationDetailsDialogProps> = ({
    open, onClose, customerId, startDate, endDate
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<DailyRecord[]>([]);

    useEffect(() => {
        if (open && customerId && startDate && endDate) {
            fetchDetails();
        }
    }, [open, customerId, startDate, endDate]);

    const fetchDetails = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getCalibrationDetails(customerId, startDate, endDate);
            if (res.data.success) {
                setData(res.data.data);
            } else {
                setError(res.data.message || '获取数据失败');
            }
        } catch (err: any) {
            setError(err.message || '网络请求失败');
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'balanced': return 'success';
            case 'imbalanced': return 'error';
            case 'missing_config': return 'warning';
            case 'missing_data': return 'default';
            default: return 'default';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'balanced': return '平衡';
            case 'imbalanced': return '偏差过大';
            case 'missing_config': return '缺档案';
            case 'missing_data': return '缺数据';
            default: return status;
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ m: 0, p: 2 }}>
                每日校核详情
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{
                        position: 'absolute',
                        right: 8,
                        top: 8,
                        color: (theme) => theme.palette.grey[500],
                    }}
                >
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {loading ? (
                    <Box display="flex" justifyContent="center" p={3}>
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : (
                    <Box sx={{ maxHeight: '600px', overflowY: 'auto' }}>
                        {data.map((record) => (
                            <Box key={record.date} mb={2}>
                                <Typography variant="h6" gutterBottom>{record.date}</Typography>
                                {record.accounts.map((acc) => (
                                    <Accordion key={acc.account_no} defaultExpanded>
                                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                            <Box display="flex" alignItems="center" width="100%" gap={2}>
                                                <Typography variant="subtitle1">户号: {acc.account_no}</Typography>
                                                <Chip
                                                    label={getStatusLabel(acc.status)}
                                                    color={getStatusColor(acc.status) as any}
                                                    size="small"
                                                />
                                                <Typography variant="body2" color="textSecondary">
                                                    偏差: {(acc.diff_rate * 100).toFixed(2)}% (差值: {acc.diff})
                                                </Typography>
                                            </Box>
                                        </AccordionSummary>
                                        <AccordionDetails>
                                            <TableContainer component={Paper} variant="outlined">
                                                <Table size="small">
                                                    <TableHead>
                                                        <TableRow>
                                                            <TableCell>类型</TableCell>
                                                            <TableCell>编号</TableCell>
                                                            <TableCell align="right">日电量</TableCell>
                                                            <TableCell align="right">系数</TableCell>
                                                            <TableCell align="center">状态</TableCell>
                                                        </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                        {acc.mps.map((mp, idx) => (
                                                            <TableRow key={`mp-${mp.id}`}>
                                                                <TableCell>{idx === 0 ? '计量点 (MP)' : ''}</TableCell>
                                                                <TableCell>{mp.id}</TableCell>
                                                                <TableCell align="right">{mp.val}</TableCell>
                                                                <TableCell align="right">-</TableCell>
                                                                <TableCell align="center">
                                                                    {mp.has_data ? <Chip label="有数" size="small" color="success" variant="outlined" /> : <Chip label="无数" size="small" color="error" variant="outlined" />}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                                                            <TableCell colSpan={2} align="right"><strong>MP 总计</strong></TableCell>
                                                            <TableCell align="right"><strong>{acc.mp_sum}</strong></TableCell>
                                                            <TableCell colSpan={2}></TableCell>
                                                        </TableRow>
                                                        {acc.meters.map((meter, idx) => (
                                                            <TableRow key={`meter-${meter.id}`}>
                                                                <TableCell>{idx === 0 ? '电表 (Meter)' : ''}</TableCell>
                                                                <TableCell>{meter.id}</TableCell>
                                                                <TableCell align="right">{meter.val}</TableCell>
                                                                <TableCell align="right">{meter.ratio}</TableCell>
                                                                <TableCell align="center">
                                                                    {meter.has_data ? <Chip label="有数" size="small" color="success" variant="outlined" /> : <Chip label="无数" size="small" color="error" variant="outlined" />}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                                                            <TableCell colSpan={2} align="right"><strong>Meter 总计</strong></TableCell>
                                                            <TableCell align="right"><strong>{acc.meter_sum}</strong></TableCell>
                                                            <TableCell colSpan={2}></TableCell>
                                                        </TableRow>
                                                    </TableBody>
                                                </Table>
                                            </TableContainer>
                                        </AccordionDetails>
                                    </Accordion>
                                ))}
                            </Box>
                        ))}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} variant="contained">关闭</Button>
            </DialogActions>
        </Dialog>
    );
};
