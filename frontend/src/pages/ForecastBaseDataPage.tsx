import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    IconButton,
    Tabs,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Checkbox,
    Button,
    CircularProgress,
    Alert,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import ArrowLeftIcon from '@mui/icons-material/ArrowLeft';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import { addDays, format, differenceInDays } from 'date-fns';
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import apiClient from '../api/client';
import { useChartFullscreen } from '../hooks/useChartFullscreen';

// ============ 类型定义 ============
interface TimeSeriesDataPoint {
    time: string;
    value: number;
    timestamp: string;
}

interface CurveData {
    data_item_id: number;
    data_item_name: string;
    date: string;
    data: TimeSeriesDataPoint[];
    total_points: number;
    completeness: number;
}

interface DataAvailabilityCell {
    data_item_id: number;
    date: string;
    is_available: boolean;
    sample_timestamp: string | null;
}

interface DataAvailabilityResponse {
    base_date: string;
    date_range: string[];
    availability_matrix: DataAvailabilityCell[][];
}

// ============ 数据项配置 ============
const DATA_ITEMS_CONFIG = {
    weekly: [
        { id: 1, name: '次周系统负荷预测', shortName: '周负荷' },
        { id: 3, name: '次周风电预测', shortName: '周风电' },
        { id: 2, name: '次周光伏预测', shortName: '周光伏' },
        { id: 4, name: '次周水电(含抽蓄)预测', shortName: '周水电' },
        { id: 5, name: '次周联络线可用容量', shortName: '周联络' },
    ],
    daily: [
        { id: 6, name: '短期系统负荷预测', shortName: '日负荷', desktopName: '短期系统负荷预测' },
        { id: 8, name: '短期风电预测', shortName: '日风电' },
        { id: 7, name: '短期光伏预测', shortName: '日光伏' },
        { id: 9, name: '非市场化机组预测', shortName: '日非市', desktopName: '非市场化机组预测' },
        { id: 10, name: '联络线总计划', shortName: '日联络' },
    ],
    realtime: [
        { id: 11, name: '实际全网总出力', shortName: '实全网', desktopName: '实际全网总出力' },
        { id: 12, name: '实际风电出力', shortName: '实风电', desktopName: '实际风电出力' },
        { id: 13, name: '实际光伏出力', shortName: '实光伏', desktopName: '实际光伏出力' },
        { id: 14, name: '实际水电(含抽蓄)出力', shortName: '实水电', desktopName: '实际水电(含抽蓄)出力' },
        { id: 15, name: '联络线总计划', shortName: '实联络', desktopName: '联络线总计划' },
    ],
};

// 图表颜色
const CHART_COLORS = [
    '#8884d8',
    '#82ca9d',
    '#ffc658',
    '#ff7300',
    '#0088fe',
    '#00c49f',
    '#ffbb28',
    '#ff8042',
    '#a4de6c',
    '#d0ed57',
];

// ============ 独立的图表组件（使用 React.memo 避免不必要的重新渲染）============
interface ChartComponentProps {
    chartRef: React.RefObject<HTMLDivElement | null>;
    chartData: any[];
    curvesData: CurveData[];
    loadingCurves: boolean;
    isMobile: boolean;
    isFullscreen: boolean;
    FullscreenEnterButton: React.ComponentType;
    FullscreenExitButton: React.ComponentType;
    FullscreenTitle: React.ComponentType;
    NavigationButtons: React.ComponentType;
    getDataItemName: (dataItemId: number) => string;
}

const ChartComponent = React.memo<ChartComponentProps>(({
    chartRef,
    chartData,
    curvesData,
    loadingCurves,
    isMobile,
    isFullscreen,
    FullscreenEnterButton,
    FullscreenExitButton,
    FullscreenTitle,
    NavigationButtons,
    getDataItemName,
}) => {
    return (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 }, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
                96点数据对比分析
            </Typography>

            <Box
                ref={chartRef}
                sx={{
                    height: { xs: 350, sm: 400 },
                    position: 'relative',
                    backgroundColor: isFullscreen ? 'background.paper' : 'transparent',
                    p: isFullscreen ? 2 : 0,
                    ...(isFullscreen && {
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        zIndex: 1400,
                    }),
                }}
            >
                <FullscreenEnterButton />
                <FullscreenExitButton />
                <FullscreenTitle />
                <NavigationButtons />

                {loadingCurves && (
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            zIndex: 1000,
                        }}
                    >
                        <CircularProgress />
                    </Box>
                )}

                {curvesData.length === 0 ? (
                    <Box
                        sx={{
                            display: 'flex',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Typography color="text.secondary">
                            请在上方表格中选择数据项进行对比分析
                        </Typography>
                    </Box>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="time"
                                tick={{ fontSize: isMobile ? 10 : 12 }}
                                interval={isMobile ? 11 : 7}
                            />
                            <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} />
                            <Tooltip
                                labelFormatter={(label) => `时间: ${label}`}
                                formatter={(value: number, name: string) => {
                                    const idx = parseInt(name.split('_')[1], 10);
                                    const curve = curvesData[idx];
                                    const curveName = curve
                                        ? `${getDataItemName(curve.data_item_id)}(${curve.date.substring(5)})`
                                        : name;
                                    return [`${value.toFixed(2)} MW`, curveName];
                                }}
                            />
                            <Legend
                                formatter={(value: string) => {
                                    const idx = parseInt(value.split('_')[1], 10);
                                    const curve = curvesData[idx];
                                    if (curve) {
                                        return `${getDataItemName(curve.data_item_id)}(${curve.date.substring(5)})`;
                                    }
                                    return value;
                                }}
                            />
                            {curvesData.map((_, idx) => (
                                <Line
                                    key={idx}
                                    type="monotone"
                                    dataKey={`curve_${idx}`}
                                    stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                                    strokeWidth={2}
                                    dot={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </Box>
        </Paper>
    );
});

export const ForecastBaseDataPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));

    // 日期状态
    const [selectedDate, setSelectedDate] = useState<Date | null>(addDays(new Date(), -1));

    // 移动端日期范围类型 (桌面端固定为 desktop_full_range)
    const [dateRangeType, setDateRangeType] = useState<string>('recent_3');

    // 数据类型状态 (0: 周预测, 1: 日预测, 2: 实际数据)
    const [dataType, setDataType] = useState<number>(0);

    // Loading和错误状态
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingCurves, setLoadingCurves] = useState(false);

    // 数据状态
    const [availabilityData, setAvailabilityData] = useState<DataAvailabilityResponse | null>(null);
    // 使用相对偏移量作为key（如 "1_-7" 表示数据项1的D-7）
    const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
    const [curvesData, setCurvesData] = useState<CurveData[]>([]);

    // 图表引用
    const chartRef = useRef<HTMLDivElement>(null);
    
    const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';

    // 全屏 Hook
    const {
        isFullscreen,
        FullscreenEnterButton,
        FullscreenExitButton,
        FullscreenTitle,
        NavigationButtons,
    } = useChartFullscreen({
        chartRef,
        title: `96点数据对比分析 (${dateStr})`,
        onPrevious: () => handleShiftDate(-1),
        onNext: () => handleShiftDate(1),
    });

    // ============ 辅助函数 ============
    // 根据基准日期和偏移量计算实际日期
    const getActualDate = (baseDate: Date | null, offset: number): string => {
        if (!baseDate) return '';
        return format(addDays(baseDate, offset), 'yyyy-MM-dd');
    };

    // 根据基准日期和具体日期计算偏移量
    const getDateOffset = (baseDate: Date | null, actualDate: string): number => {
        if (!baseDate) return 0;
        const baseDateStr = format(baseDate, 'yyyy-MM-dd');
        return differenceInDays(new Date(actualDate), new Date(baseDateStr));
    };

    // 格式化相对日期标签 (D-10, D-1, D, D+1, D+2)
    const formatRelativeDate = (offset: number): string => {
        if (offset === 0) return 'D';
        if (offset > 0) return `D+${offset}`;
        return `D${offset}`; // 负数自带负号
    };

    // ============ API调用 ============
    const fetchAvailability = async (date: Date | null) => {
        if (!date) return;

        setLoading(true);
        setError(null);

        try {
            // 桌面端使用固定的13天范围 (D-10到D+2)
            const rangeType = isMobile ? dateRangeType : 'desktop_full_range';

            const response = await apiClient.get<DataAvailabilityResponse>(
                '/api/v1/forecast-base-data/availability',
                {
                    params: {
                        base_date: format(date, 'yyyy-MM-dd'),
                        date_range: rangeType,
                    },
                }
            );
            setAvailabilityData(response.data);
        } catch (err: any) {
            const errorMessage =
                err.response?.data?.detail || err.message || '加载数据可用性失败';
            setError(errorMessage);
            console.error('加载数据可用性失败:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchCurves = async (baseDate: Date | null) => {
        if (!baseDate) return;

        const selectedKeys = Object.keys(selectedItems).filter((key) => selectedItems[key]);

        if (selectedKeys.length === 0) {
            setCurvesData([]);
            return;
        }

        setLoadingCurves(true);

        try {
            // 将相对偏移量转换为实际日期
            const requests = selectedKeys.map((key) => {
                const [dataItemId, offsetStr] = key.split('_');
                const offset = parseInt(offsetStr, 10);
                const actualDate = getActualDate(baseDate, offset);
                return { data_item_id: parseInt(dataItemId, 10), date: actualDate };
            });

            const response = await apiClient.post('/api/v1/forecast-base-data/curves', requests);
            setCurvesData(response.data.curves);
        } catch (err: any) {
            console.error('加载曲线数据失败:', err);
        } finally {
            setLoadingCurves(false);
        }
    };

    // ============ 副作用 ============
    useEffect(() => {
        fetchAvailability(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, dateRangeType, isMobile]);

    useEffect(() => {
        fetchCurves(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedItems, selectedDate]);

    // ============ 事件处理 ============
    const handleShiftDate = (days: number) => {
        if (!selectedDate || loading) return;
        const newDate = addDays(selectedDate, days);
        setSelectedDate(newDate);
        // 注意：selectedItems 使用相对偏移量，不需要更新
    };

    const handleCheckboxToggle = (dataItemId: number, offset: number) => {
        const key = `${dataItemId}_${offset}`;
        setSelectedItems((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleClearSelection = () => {
        setSelectedItems({});
    };

    const handleDataTypeChange = (_: React.SyntheticEvent, newValue: number) => {
        setDataType(newValue);
    };

    // ============ 辅助函数 ============
    const getDataItemsForType = (type: number) => {
        switch (type) {
            case 0:
                return DATA_ITEMS_CONFIG.weekly;
            case 1:
                return DATA_ITEMS_CONFIG.daily;
            case 2:
                return DATA_ITEMS_CONFIG.realtime;
            default:
                return DATA_ITEMS_CONFIG.weekly;
        }
    };

    const getDataItemName = (dataItemId: number): string => {
        const allItems = [
            ...DATA_ITEMS_CONFIG.weekly,
            ...DATA_ITEMS_CONFIG.daily,
            ...DATA_ITEMS_CONFIG.realtime,
        ];
        const item = allItems.find((i) => i.id === dataItemId);
        if (!item) return `数据项${dataItemId}`;

        // 移动端使用shortName，桌面端优先使用desktopName（如果有），否则使用name
        if (isMobile) return item.shortName;
        return (item as any).desktopName || item.name;
    };

    const getSelectedCount = (): number => {
        return Object.values(selectedItems).filter(Boolean).length;
    };

    // 准备图表数据 - 使用 useMemo 避免不必要的重新计算
    const chartData = useMemo(() => {
        if (curvesData.length === 0) return [];

        const timeMap: Record<string, any> = {};

        curvesData.forEach((curve, idx) => {
            curve.data.forEach((point) => {
                if (!timeMap[point.time]) {
                    timeMap[point.time] = { time: point.time };
                }
                timeMap[point.time][`curve_${idx}`] = point.value;
            });
        });

        // 排序，确保24:00在最后
        return Object.values(timeMap).sort((a, b) => {
            const timeA = a.time === '24:00' ? '23:59:59' : a.time;
            const timeB = b.time === '24:00' ? '23:59:59' : b.time;
            return timeA.localeCompare(timeB);
        });
    }, [curvesData]);

    // ============ 渲染函数 ============
    const renderAvailabilityTable = () => {
        if (!availabilityData || !selectedDate) return null;

        const currentItems = getDataItemsForType(dataType);
        const dateRange = availabilityData.date_range;

        return (
            <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ overflowX: 'auto', mt: 2 }}
            >
                <Table
                    size="small"
                    sx={{
                        '& .MuiTableCell-root': {
                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                            px: { xs: 0.5, sm: 2 },
                            py: { xs: 0.5, sm: 1 },
                        },
                    }}
                >
                    <TableHead>
                        <TableRow>
                            <TableCell
                                sx={{
                                    position: 'sticky',
                                    left: 0,
                                    backgroundColor: 'action.hover',
                                    zIndex: 1,
                                    fontWeight: 'bold',
                                    width: { xs: 'auto', sm: 180 },
                                    minWidth: { xs: 80, sm: 180 },
                                }}
                            >
                                数据类型
                            </TableCell>
                            {dateRange.map((date) => {
                                const offset = getDateOffset(selectedDate, date);
                                const isCurrentDay = offset === 0;
                                return (
                                    <TableCell
                                        key={date}
                                        align="center"
                                        sx={{
                                            fontWeight: 'bold',
                                            minWidth: { xs: 60, sm: 80 },
                                            backgroundColor: isCurrentDay
                                                ? 'rgba(25, 118, 210, 0.08)'  // 更浅的蓝色
                                                : 'action.hover',
                                        }}
                                    >
                                        <Box>
                                            <Typography variant="caption" display="block" sx={{ fontWeight: 'bold' }}>
                                                {formatRelativeDate(offset)}
                                            </Typography>
                                            <Typography variant="caption" display="block" color="text.secondary">
                                                {date.substring(5)}
                                            </Typography>
                                        </Box>
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {currentItems.map((item) => {
                            // 找到该数据项在矩阵中的行
                            const rowData = availabilityData.availability_matrix[item.id - 1];

                            return (
                                <TableRow key={item.id}>
                                    <TableCell
                                        sx={{
                                            position: 'sticky',
                                            left: 0,
                                            backgroundColor: 'action.hover',
                                            zIndex: 1,
                                            fontWeight: 'bold',
                                            width: { xs: 'auto', sm: 180 },
                                            minWidth: { xs: 80, sm: 180 },
                                        }}
                                    >
                                        {isMobile ? item.shortName : ((item as any).desktopName || item.name)}
                                    </TableCell>
                                    {rowData.map((cell) => {
                                        const offset = getDateOffset(selectedDate, cell.date);
                                        const key = `${cell.data_item_id}_${offset}`;
                                        const isSelected = selectedItems[key] || false;
                                        const isCurrentDay = offset === 0;

                                        return (
                                            <TableCell
                                                key={cell.date}
                                                align="center"
                                                sx={{
                                                    backgroundColor: isSelected
                                                        ? 'action.selected'
                                                        : isCurrentDay
                                                        ? 'rgba(25, 118, 210, 0.08)'  // 更浅的蓝色
                                                        : 'inherit',
                                                    cursor: cell.is_available
                                                        ? 'pointer'
                                                        : 'default',
                                                    height: 48, // 固定高度，确保一致性
                                                }}
                                                onClick={() => {
                                                    if (cell.is_available) {
                                                        handleCheckboxToggle(
                                                            cell.data_item_id,
                                                            offset
                                                        );
                                                    }
                                                }}
                                            >
                                                {cell.is_available ? (
                                                    <Checkbox
                                                        size="small"
                                                        checked={isSelected}
                                                        onChange={() =>
                                                            handleCheckboxToggle(
                                                                cell.data_item_id,
                                                                offset
                                                            )
                                                        }
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <Typography
                                                        variant="caption"
                                                        color="text.disabled"
                                                    >
                                                        —
                                                    </Typography>
                                                )}
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        );
    };

    // ============ 主渲染 ============
    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{ width: '100%' }}>
                {/* 移动端面包屑标题 */}
                {isTablet && (
                    <Typography
                        variant="subtitle1"
                        sx={{
                            mb: 2,
                            fontWeight: 'bold',
                            color: 'text.primary'
                        }}
                    >
                        价格预测 / 预测基础数据
                    </Typography>
                )}

                {/* 日期选择器 */}
                <Paper
                    variant="outlined"
                    sx={{
                        p: 2,
                        display: 'flex',
                        gap: 1,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                    }}
                >
                    <IconButton onClick={() => handleShiftDate(-1)} disabled={loading}>
                        <ArrowLeftIcon />
                    </IconButton>

                    <DatePicker
                        label="基准日期"
                        value={selectedDate}
                        onChange={(date) => setSelectedDate(date)}
                        disabled={loading}
                        slotProps={{
                            textField: {
                                sx: { width: { xs: '150px', sm: '200px' } },
                            },
                        }}
                    />

                    <IconButton onClick={() => handleShiftDate(1)} disabled={loading}>
                        <ArrowRightIcon />
                    </IconButton>

                    {/* 桌面端清空按钮 */}
                    {!isMobile && (
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleClearSelection}
                            disabled={getSelectedCount() === 0}
                        >
                            清空选择
                        </Button>
                    )}
                </Paper>

                {/* 数据类型Tab（桌面端和移动端都显示） + 移动端日期范围切换 */}
                <Paper variant="outlined" sx={{ borderColor: 'divider', mt: 2 }}>
                    {/* 数据类型Tab */}
                    <Tabs
                        value={dataType}
                        onChange={handleDataTypeChange}
                        variant={isMobile ? 'fullWidth' : 'standard'}
                    >
                        <Tab label="周预测" />
                        <Tab label="日预测" />
                        <Tab label="实际数据" />
                    </Tabs>

                    {/* 移动端日期范围切换和清空按钮 */}
                    {isMobile && (
                        <>
                            <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
                                <Tabs
                                    value={dateRangeType}
                                    onChange={(_, newValue) => setDateRangeType(newValue)}
                                    variant="fullWidth"
                                >
                                    <Tab label="近3天" value="recent_3" />
                                    <Tab label="近7日" value="recent_7" />
                                    <Tab label="历史10日" value="historical_10" />
                                </Tabs>
                            </Box>
                            <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleClearSelection}
                                    disabled={getSelectedCount() === 0}
                                    fullWidth
                                >
                                    清空选择
                                </Button>
                            </Box>
                        </>
                    )}
                </Paper>

                {/* 数据可用性表格 */}
                {loading && !availabilityData ? (
                    <Box
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        minHeight="200px"
                    >
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                ) : availabilityData ? (
                    <Box sx={{ position: 'relative' }}>
                        {/* 数据刷新时的覆盖层 */}
                        {loading && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                    zIndex: 1000,
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}

                        {renderAvailabilityTable()}

                        {/* 图例说明 */}
                        <Box sx={{ mt: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Typography variant="caption" color="text.secondary">
                                ☑ 已选中
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                ☐ 可选择
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                — 无数据
                            </Typography>
                        </Box>

                        {/* 已选数量 */}
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            已选择 {getSelectedCount()} 项数据
                        </Typography>

                        {/* 96点曲线图 */}
                        <ChartComponent
                            chartRef={chartRef}
                            chartData={chartData}
                            curvesData={curvesData}
                            loadingCurves={loadingCurves}
                            isMobile={isMobile}
                            isFullscreen={isFullscreen}
                            FullscreenEnterButton={FullscreenEnterButton}
                            FullscreenExitButton={FullscreenExitButton}
                            FullscreenTitle={FullscreenTitle}
                            NavigationButtons={NavigationButtons}
                            getDataItemName={getDataItemName}
                        />
                    </Box>
                ) : null}
            </Box>
        </LocalizationProvider>
    );
};

export default ForecastBaseDataPage;
