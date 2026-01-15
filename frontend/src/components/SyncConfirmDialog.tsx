import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Checkbox,
    Alert,
    CircularProgress,
    Typography,
    Box
} from '@mui/material';
import { Sync as SyncIcon } from '@mui/icons-material';
import { SyncCandidate, syncCustomers } from '../api/customer';

interface SyncConfirmDialogProps {
    open: boolean;
    candidates: SyncCandidate[];
    onClose: () => void;
    onSyncSuccess: (created: number, updated: number) => void;
}

export const SyncConfirmDialog: React.FC<SyncConfirmDialogProps> = ({
    open,
    candidates,
    onClose,
    onSyncSuccess
}) => {
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initialize selection when candidates change
    useEffect(() => {
        if (open && candidates.length > 0) {
            setSelected(candidates.map(c => c.mp_no));
        }
    }, [open, candidates]);

    const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.checked) {
            setSelected(candidates.map(c => c.mp_no));
        } else {
            setSelected([]);
        }
    };

    const handleSelectOne = (event: React.ChangeEvent<HTMLInputElement>, mp_no: string) => {
        if (event.target.checked) {
            setSelected(prev => [...prev, mp_no]);
        } else {
            setSelected(prev => prev.filter(id => id !== mp_no));
        }
    };

    const handleSync = async () => {
        if (selected.length === 0) return;

        setLoading(true);
        setError(null);

        try {
            const selectedCandidates = candidates.filter(c => selected.includes(c.mp_no));
            const result = await syncCustomers(selectedCandidates);
            onSyncSuccess(result.data.created, result.data.updated);
            onClose();
        } catch (err: any) {
            console.error('Sync failed:', err);
            setError(err.response?.data?.detail || '同步失败，请重试');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="md" fullWidth>
            <DialogTitle>同步客户数据</DialogTitle>
            <DialogContent dividers>
                {candidates.length === 0 ? (
                    <Box display="flex" justifyContent="center" p={3}>
                        <Typography color="text.secondary">暂无需要同步的缺失数据</Typography>
                    </Box>
                ) : (
                    <>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            检测到 {candidates.length} 条原始数据中的计量点在客户档案中缺失。请确认需要同步的条目。
                            <br />
                            系统将自动创建新客户或合并到现有客户。
                        </Alert>

                        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                        <TableContainer sx={{ maxHeight: 400 }}>
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell padding="checkbox">
                                            <Checkbox
                                                indeterminate={selected.length > 0 && selected.length < candidates.length}
                                                checked={candidates.length > 0 && selected.length === candidates.length}
                                                onChange={handleSelectAll}
                                                disabled={loading}
                                            />
                                        </TableCell>
                                        <TableCell>客户名称</TableCell>
                                        <TableCell>户号</TableCell>
                                        <TableCell>计量点编号</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {candidates.map((candidate) => (
                                        <TableRow key={candidate.mp_no} hover role="checkbox">
                                            <TableCell padding="checkbox">
                                                <Checkbox
                                                    checked={selected.indexOf(candidate.mp_no) !== -1}
                                                    onChange={(e) => handleSelectOne(e, candidate.mp_no)}
                                                    disabled={loading}
                                                />
                                            </TableCell>
                                            <TableCell>{candidate.customer_name}</TableCell>
                                            <TableCell>{candidate.account_id}</TableCell>
                                            <TableCell>{candidate.mp_no}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={loading}>取消</Button>
                <Button
                    onClick={handleSync}
                    variant="contained"
                    disabled={loading || selected.length === 0 || candidates.length === 0}
                    startIcon={loading ? <CircularProgress size={20} /> : <SyncIcon />}
                >
                    同步选中 ({selected.length})
                </Button>
            </DialogActions>
        </Dialog>
    );
};
