import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { format, parseISO, getDay, isValid } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// Tooltip从Recharts接收的属性类型
interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    unit?: string; // 允许传入单位
    unitMap?: Record<string, string>; // 新增：允许传入一个单位映射表
}

const getWeekday = (label: string) => {
    try {
        if (!label || label.length !== 10) return ''; // Only process YYYY-MM-DD
        const date = parseISO(label);
        if (isValid(date)) {
            const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            return ` (${days[getDay(date)]})`;
        }
    } catch (e) {
        // ignore
    }
    return '';
};

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, unit = '', unitMap = {} }) => {
    if (active && payload && payload.length) {
        // 从数据点中获取时段类型
        const periodType = payload[0].payload.period_type;
        const weekdayStr = getWeekday(label || '');

        return (
            <Paper
                elevation={3}
                sx={{
                    p: 1.5,
                    backgroundColor: '#fff',
                    border: '1px solid #eee',
                    borderRadius: '4px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                }}
            >
                <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1, color: '#333' }}>
                    {`${label}${weekdayStr}`}{periodType ? ` (${periodType})` : ''}
                </Typography>
                {payload.map((pld, index) => {
                    // 检查value是否存在且为数字
                    // 优先从 payload 中获取数值，增强 LineChart 兼容性
                    const val = pld.value !== undefined ? pld.value : (pld.payload && pld.payload[pld.dataKey]);
                    const valueIsValid = val !== null && val !== undefined && !isNaN(Number(val));
                    const displayValue = valueIsValid ? Number(val).toFixed(2) : 'N/A';

                    // 决定单位：优先使用unitMap，然后回退到unit
                    const displayUnit = (valueIsValid && unit) ? (unitMap[pld.dataKey] || unit) : '';

                    // 统一颜色逻辑：线图优先用 stroke，柱图优先用 fill
                    const color = pld.stroke || pld.fill || pld.color || '#333';

                    return (
                        <Box key={index} sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                            <Box sx={{ width: 8, height: 8, backgroundColor: color, mr: 1, borderRadius: '2px' }} />
                            <Typography variant="body2" sx={{ color: color, fontSize: '0.85rem' }}>
                                {`${pld.name}: `}
                                <Box component="span" sx={{ fontWeight: 'bold', ml: 0.5 }}>
                                    {displayValue} {displayUnit}
                                </Box>
                            </Typography>
                        </Box>
                    );
                })}
            </Paper>
        );
    }

    return null;
};