import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Grid,
    Paper,
    Typography,
    CircularProgress,
    Alert,
    List,
    ListItemButton,
    ListItemText,
    ListItemIcon,
    IconButton,
    Button,
    Tabs,
    Tab,
    useMediaQuery,
    useTheme,
    FormControl,
    Select,
    MenuItem,
    Divider,
    Chip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Switch,
    FormControlLabel,
    Tooltip
} from '@mui/material';
import {
    LocationOn as LocationIcon,
    Add as AddIcon,
    Settings as SettingsIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    ArrowLeft as ArrowLeftIcon,
    ArrowRight as ArrowRightIcon
} from '@mui/icons-material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { zhCN } from 'date-fns/locale';
import { format, addDays, subDays } from 'date-fns';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer
} from 'recharts';
import {
    getWeatherLocations,
    getWeatherActuals,
    getWeatherActualsSummary,
    getWeatherForecasts,
    getWeatherForecastsSummary,
    getAvailableForecastDates,
    createWeatherLocation,
    updateWeatherLocation,
    deleteWeatherLocation,
    getWeatherType,
    calculateAccuracy,
    WeatherLocation,
    WeatherHourlyData,
    DailyWeatherSummary
} from '../api/weather';
import { useChartFullscreen } from '../hooks/useChartFullscreen';
import { useAuth } from '../contexts/AuthContext';

// 鏇茬嚎閰嶇疆
const CURVE_CONFIG = [
    { key: 'apparent_temperature', label: '温度', icon: 'T', color: '#ff7300', unit: '°C' },
    { key: 'shortwave_radiation', label: '辐射', icon: 'R', color: '#ffc658', unit: 'W/m²' },
    { key: 'wind_speed_100m', label: '风速', icon: 'W', color: '#8884d8', unit: 'km/h' },
    { key: 'cloud_cover', label: '云量', icon: 'C', color: '#82ca9d', unit: '%' },
    { key: 'relative_humidity_2m', label: '湿度', icon: 'H', color: '#00bcd4', unit: '%' },
];

// 鏄熸湡绠€鍐?
const getWeekdayName = (date: Date): string => {
    const weekdays = ['鍛ㄦ棩', '鍛ㄤ竴', '鍛ㄤ簩', '鍛ㄤ笁', '鍛ㄥ洓', '鍛ㄤ簲', '鍛ㄥ叚'];
    return weekdays[date.getDay()];
};

// SVG 澶╂皵鍥炬爣缁勪欢锛堢畝娲侀鏍硷紝鍙傝€冨浘鐗囨牱寮忥級
const WeatherIcon: React.FC<{ type: string; size?: number }> = ({ type, size = 40 }) => {
    return (
        <Box
            sx={{
                width: size,
                height: size,
                borderRadius: '50%',
                bgcolor: 'action.hover',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: Math.max(12, Math.floor(size / 3)),
                color: 'text.secondary'
            }}
        >
            {(type || '-').slice(0, 1)}
        </Box>
    );
};

// 鏇茬嚎閫夋嫨鎸夐挳缁勪欢锛堝崟閫夋ā寮忥級
const CurveSelectorSingle: React.FC<{
    selectedCurve: string;
    onSelect: (key: string) => void;
}> = ({ selectedCurve, onSelect }) => (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {CURVE_CONFIG.map(curve => (
            <Chip
                key={curve.key}
                label={`${curve.icon} ${curve.label}`}
                onClick={() => onSelect(curve.key)}
                color={selectedCurve === curve.key ? 'primary' : 'default'}
                variant={selectedCurve === curve.key ? 'filled' : 'outlined'}
                sx={{ cursor: 'pointer' }}
            />
        ))}
    </Box>
);

// 鏇茬嚎閫夋嫨鎸夐挳缁勪欢锛堝閫夋ā寮忥紝鐢ㄤ簬澶╂皵棰勬祴锛?
const CurveSelector: React.FC<{
    selectedCurves: string[];
    onToggle: (key: string) => void;
}> = ({ selectedCurves, onToggle }) => (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {CURVE_CONFIG.map(curve => (
            <Chip
                key={curve.key}
                label={`${curve.icon} ${curve.label}`}
                onClick={() => onToggle(curve.key)}
                color={selectedCurves.includes(curve.key) ? 'primary' : 'default'}
                variant={selectedCurves.includes(curve.key) ? 'filled' : 'outlined'}
                sx={{ cursor: 'pointer' }}
            />
        ))}
    </Box>
);

// 澶╂皵鍗＄墖缁勪欢锛堝甫鏄熸湡鏄剧ず锛岀畝娲侀鏍硷級
const DailyWeatherCard: React.FC<{
    summary: DailyWeatherSummary;
    selected?: boolean;
    onClick?: () => void;
}> = ({ summary, selected, onClick }) => {
    const dateObj = new Date(summary.date);
    return (
        <Paper
            sx={{
                p: { xs: 1, sm: 1.5 },
                minWidth: { xs: 'auto', sm: 120 },
                width: '100%',
                textAlign: 'center',
                cursor: onClick ? 'pointer' : 'default',
                border: selected ? 2 : 1,
                borderColor: selected ? 'primary.main' : 'divider',
                backgroundColor: selected ? 'primary.light' : 'background.paper',
                color: selected ? 'primary.contrastText' : 'text.primary',
                '&:hover': onClick ? { borderColor: 'primary.main', backgroundColor: selected ? 'primary.light' : 'action.hover' } : {},
                transition: 'all 0.2s'
            }}
            elevation={selected ? 3 : 0}
            onClick={onClick}
        >
            <Typography variant="body2" fontWeight="bold" sx={{ color: selected ? 'inherit' : 'text.primary' }}>
                {format(dateObj, 'MM-dd')} {getWeekdayName(dateObj)}
            </Typography>
            <Box sx={{ my: 1, display: 'flex', justifyContent: 'center' }}>
                <WeatherIcon type={summary.weather_type} size={36} />
            </Box>
            <Typography variant="caption" sx={{ color: selected ? 'inherit' : 'text.secondary', display: 'block' }}>
                {summary.weather_type}
            </Typography>
            <Typography variant="body2" sx={{ color: selected ? 'inherit' : 'text.primary' }}>
                {summary.min_temp}~{summary.max_temp}掳C
            </Typography>
        </Paper>
    );
};

// 绔欑偣缂栬緫寮圭獥
const LocationFormModal: React.FC<{
    open: boolean;
    onClose: () => void;
    onSave: (location: WeatherLocation) => void;
    location?: WeatherLocation | null;
    readonly?: boolean;
}> = ({ open, onClose, onSave, location, readonly = false }) => {
    const [formData, setFormData] = useState<WeatherLocation>({
        location_id: '',
        name: '',
        latitude: 0,
        longitude: 0,
        enabled: true
    });

    useEffect(() => {
        if (location) {
            setFormData(location);
        } else {
            setFormData({ location_id: '', name: '', latitude: 0, longitude: 0, enabled: true });
        }
    }, [location, open]);

    const handleSubmit = () => {
        if (readonly) return;
        onSave(formData);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{location ? '缂栬緫绔欑偣' : '鏂板绔欑偣'}</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    <TextField
                        label="绔欑偣ID"
                        value={formData.location_id}
                        onChange={e => setFormData({ ...formData, location_id: e.target.value })}
                        disabled={!!location || readonly}
                        required
                        fullWidth
                    />
                    <TextField
                        label="绔欑偣鍚嶇О"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        disabled={readonly}
                        required
                        fullWidth
                    />
                    <TextField
                        label="绾害"
                        type="number"
                        value={formData.latitude}
                        onChange={e => setFormData({ ...formData, latitude: parseFloat(e.target.value) || 0 })}
                        disabled={readonly}
                        required
                        fullWidth
                    />
                    <TextField
                        label="缁忓害"
                        type="number"
                        value={formData.longitude}
                        onChange={e => setFormData({ ...formData, longitude: parseFloat(e.target.value) || 0 })}
                        disabled={readonly}
                        required
                        fullWidth
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={formData.enabled}
                                onChange={e => setFormData({ ...formData, enabled: e.target.checked })}
                                disabled={readonly}
                            />
                        }
                        label="鍚敤"
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>鍙栨秷</Button>
                <Button onClick={handleSubmit} variant="contained" disabled={readonly}>淇濆瓨</Button>
            </DialogActions>
        </Dialog>
    );
};

export const WeatherDataPage: React.FC = () => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isTablet = useMediaQuery(theme.breakpoints.down('lg'));
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('module:forecast_weather_data:edit');

    // 鐘舵€?
    const [locations, setLocations] = useState<WeatherLocation[]>([]);
    const [selectedLocation, setSelectedLocation] = useState<WeatherLocation | null>(null);
    const [activeTab, setActiveTab] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 绔欑偣绠＄悊
    const [locationModalOpen, setLocationModalOpen] = useState(false);
    const [editingLocation, setEditingLocation] = useState<WeatherLocation | null>(null);
    const [managementOpen, setManagementOpen] = useState(false);
    const [locationPage, setLocationPage] = useState(0);
    const LOCATIONS_PER_PAGE = 10; // 姣忛〉鏄剧ず鐨勭珯鐐规暟

    // 澶╂皵棰勬祴 Tab 鐘舵€?
    const [forecastDate, setForecastDate] = useState<Date>(subDays(new Date(), 1));
    const [forecastSummaries, setForecastSummaries] = useState<DailyWeatherSummary[]>([]);
    const [selectedForecastDay, setSelectedForecastDay] = useState<string | null>(null);
    const [forecastHourlyData, setForecastHourlyData] = useState<WeatherHourlyData[]>([]);
    const [forecastCardPage, setForecastCardPage] = useState(0); // 澶╂皵鍗＄墖鍒嗛〉
    const CARDS_PER_PAGE = 3; // 绉诲姩绔瘡椤垫樉绀虹殑鍗＄墖鏁?

    // 鍘嗗彶澶╂皵 Tab 鐘舵€?
    const [actualsDate, setActualsDate] = useState<Date>(subDays(new Date(), 1));
    const [actualsSummary, setActualsSummary] = useState<DailyWeatherSummary | null>(null);
    const [actualsHourlyData, setActualsHourlyData] = useState<WeatherHourlyData[]>([]);
    const [forecastCompareDate, setForecastCompareDate] = useState<string>('');
    const [availableForecastDates, setAvailableForecastDates] = useState<string[]>([]);
    const [compareHourlyData, setCompareHourlyData] = useState<WeatherHourlyData[]>([]);
    const [accuracy, setAccuracy] = useState<{ [key: string]: number }>({});

    // 鏇茬嚎閫夋嫨锛堝ぉ姘旈娴嬪閫夛紝鍘嗗彶澶╂皵鍗曢€夛級
    const [selectedCurves, setSelectedCurves] = useState<string[]>(['apparent_temperature']);
    const [selectedActualsCurve, setSelectedActualsCurve] = useState<string>('apparent_temperature');

    // 鍥捐〃 ref
    const forecastChartRef = useRef<HTMLDivElement>(null);
    const actualsChartRef = useRef<HTMLDivElement>(null);

    const forecastFullscreen = useChartFullscreen({
        chartRef: forecastChartRef,
        title: `澶╂皵棰勬祴 - ${selectedLocation?.name || ''}`
    });

    const actualsFullscreen = useChartFullscreen({
        chartRef: actualsChartRef,
        title: `鍘嗗彶澶╂皵 - ${selectedLocation?.name || ''}`
    });

    // 鍔犺浇绔欑偣鍒楄〃
    useEffect(() => {
        const fetchLocations = async () => {
            try {
                setLoading(true);
                const data = await getWeatherLocations();
                setLocations(data);
                if (data.length > 0) {
                    setSelectedLocation(data.find(l => l.enabled) || data[0]);
                }
            } catch (err) {
                setError('鍔犺浇绔欑偣鍒楄〃澶辫触');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchLocations();
    }, []);

    // 鍔犺浇澶╂皵棰勬祴鏁版嵁
    useEffect(() => {
        if (!selectedLocation || activeTab !== 0) return;
        const fetchForecastData = async () => {
            try {
                const dateStr = format(forecastDate, 'yyyy-MM-dd');
                const summaries = await getWeatherForecastsSummary(selectedLocation.location_id, dateStr);
                setForecastSummaries(summaries);
                if (summaries.length > 0 && !selectedForecastDay) {
                    setSelectedForecastDay(summaries[0].date);
                }
            } catch (err) {
                console.error('鍔犺浇棰勬祴鏁版嵁澶辫触', err);
            }
        };
        fetchForecastData();
    }, [selectedLocation, forecastDate, activeTab]);

    // 鍔犺浇閫変腑鏃ユ湡鐨勯娴嬭鎯?
    useEffect(() => {
        if (!selectedLocation || !selectedForecastDay || activeTab !== 0) return;
        const fetchHourlyData = async () => {
            try {
                const forecastDateStr = format(forecastDate, 'yyyy-MM-dd');
                const data = await getWeatherForecasts(selectedLocation.location_id, forecastDateStr, selectedForecastDay);
                setForecastHourlyData(data);
            } catch (err) {
                console.error('鍔犺浇棰勬祴璇︽儏澶辫触', err);
            }
        };
        fetchHourlyData();
    }, [selectedLocation, forecastDate, selectedForecastDay, activeTab]);

    // 鍔犺浇鍘嗗彶澶╂皵鏁版嵁
    useEffect(() => {
        if (!selectedLocation || activeTab !== 1) return;
        const fetchActualsData = async () => {
            try {
                const dateStr = format(actualsDate, 'yyyy-MM-dd');
                const [summary, hourly, forecastDates] = await Promise.all([
                    getWeatherActualsSummary(selectedLocation.location_id, dateStr),
                    getWeatherActuals(selectedLocation.location_id, dateStr),
                    getAvailableForecastDates(selectedLocation.location_id, dateStr)
                ]);
                setActualsSummary(summary);
                setActualsHourlyData(hourly);
                setAvailableForecastDates(forecastDates);
                if (forecastDates.length > 0) {
                    setForecastCompareDate(forecastDates[0]);
                }
            } catch (err) {
                console.error('鍔犺浇鍘嗗彶鏁版嵁澶辫触', err);
            }
        };
        fetchActualsData();
    }, [selectedLocation, actualsDate, activeTab]);

    // 鍔犺浇瀵规瘮棰勬祴鏁版嵁
    useEffect(() => {
        if (!selectedLocation || !forecastCompareDate || activeTab !== 1) return;
        const fetchCompareData = async () => {
            try {
                const targetDateStr = format(actualsDate, 'yyyy-MM-dd');
                const data = await getWeatherForecasts(selectedLocation.location_id, forecastCompareDate, targetDateStr);
                setCompareHourlyData(data);

                // 璁＄畻鍑嗙‘鐜?
                if (actualsHourlyData.length > 0 && data.length > 0) {
                    const accuracyMap: { [key: string]: number } = {};
                    CURVE_CONFIG.forEach(curve => {
                        const actualValues = actualsHourlyData.map(d => (d as any)[curve.key]);
                        const predictedValues = data.map(d => (d as any)[curve.key]);
                        accuracyMap[curve.key] = calculateAccuracy(actualValues, predictedValues);
                    });
                    setAccuracy(accuracyMap);
                }
            } catch (err) {
                console.error('鍔犺浇瀵规瘮鏁版嵁澶辫触', err);
            }
        };
        fetchCompareData();
    }, [selectedLocation, forecastCompareDate, actualsDate, actualsHourlyData, activeTab]);

    const handleCurveToggle = (key: string) => {
        setSelectedCurves(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    };

    const handleSaveLocation = async (location: WeatherLocation) => {
        if (!canEdit) return;
        try {
            if (editingLocation) {
                await updateWeatherLocation(location.location_id, location);
            } else {
                await createWeatherLocation(location);
            }
            const data = await getWeatherLocations();
            setLocations(data);
        } catch (err) {
            console.error('淇濆瓨绔欑偣澶辫触', err);
        }
    };

    const handleDeleteLocation = async (locationId: string) => {
        if (!canEdit) return;
        if (!window.confirm('纭畾瑕佸垹闄よ绔欑偣鍚楋紵')) return;
        try {
            await deleteWeatherLocation(locationId);
            const data = await getWeatherLocations();
            setLocations(data);
            if (selectedLocation?.location_id === locationId) {
                setSelectedLocation(data[0] || null);
            }
        } catch (err) {
            console.error('鍒犻櫎绔欑偣澶辫触', err);
        }
    };

    // 娓叉煋绔欑偣鍒楄〃锛堝甫鍒嗛〉锛?
    const renderLocationSidebar = () => {
        const totalPages = Math.ceil(locations.length / LOCATIONS_PER_PAGE);
        const startIndex = locationPage * LOCATIONS_PER_PAGE;
        const displayedLocations = locations.slice(startIndex, startIndex + LOCATIONS_PER_PAGE);

        return (
            <Paper sx={{ height: '100%', minHeight: 500, display: 'flex', flexDirection: 'column' }} elevation={2}>
                <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">绔欑偣鍒楄〃</Typography>
                    <IconButton size="small" onClick={() => setManagementOpen(!managementOpen)}>
                        <SettingsIcon />
                    </IconButton>
                </Box>
                <Divider />
                <List sx={{ flexGrow: 1, overflow: 'hidden' }}>
                    {displayedLocations.map(location => (
                        <ListItemButton
                            key={location.location_id}
                            selected={selectedLocation?.location_id === location.location_id}
                            onClick={() => setSelectedLocation(location)}
                            sx={{ opacity: location.enabled ? 1 : 0.5, py: 1.5 }}
                        >
                            <ListItemIcon sx={{ minWidth: 36 }}>
                                <LocationIcon color={location.enabled ? 'primary' : 'disabled'} />
                            </ListItemIcon>
                            <ListItemText primary={location.name} />
                            {managementOpen && (
                                <Box>
                                    <IconButton size="small" onClick={e => { e.stopPropagation(); setEditingLocation(location); setLocationModalOpen(true); }} disabled={!canEdit}>
                                        <EditIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton size="small" onClick={e => { e.stopPropagation(); handleDeleteLocation(location.location_id); }} disabled={!canEdit}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            )}
                        </ListItemButton>
                    ))}
                </List>

                {/* 鍒嗛〉瀵艰埅 */}
                {totalPages > 1 && (
                    <>
                        <Divider />
                        <Box sx={{ p: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
                            <IconButton
                                size="small"
                                onClick={() => setLocationPage(p => Math.max(0, p - 1))}
                                disabled={locationPage === 0}
                            >
                                <ArrowLeftIcon />
                            </IconButton>
                            <Typography variant="caption" color="text.secondary">
                                {locationPage + 1} / {totalPages}
                            </Typography>
                            <IconButton
                                size="small"
                                onClick={() => setLocationPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={locationPage >= totalPages - 1}
                            >
                                <ArrowRightIcon />
                            </IconButton>
                        </Box>
                    </>
                )}

                <Divider />
                <Box sx={{ p: 1 }}>
                    <Button
                        fullWidth
                        startIcon={<AddIcon />}
                        disabled={!canEdit}
                        onClick={() => { setEditingLocation(null); setLocationModalOpen(true); }}
                    >
                        鏂板绔欑偣
                    </Button>
                </Box>
            </Paper>
        );
    };

    // 娓叉煋澶╂皵棰勬祴 Tab
    const renderForecastTab = () => (
        <Box>
            {/* 绔欑偣 + 棰勬祴鍙戝竷鏃ユ湡閫夋嫨锛堢Щ鍔ㄧ涓€琛屾樉绀猴級 */}
            <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 2 }, flexWrap: 'nowrap', justifyContent: 'center' }} variant="outlined">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    <LocationIcon color="primary" sx={{ fontSize: { xs: 18, sm: 24 } }} />
                    <Typography variant="body2" fontWeight="bold" sx={{ fontSize: { xs: '0.8rem', sm: '1rem' } }}>{selectedLocation?.name || '鏈€夋嫨'}</Typography>
                </Box>
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <IconButton size="small" onClick={() => setForecastDate(subDays(forecastDate, 1))} sx={{ p: { xs: 0.5, sm: 1 } }}>
                        <ArrowLeftIcon fontSize="small" />
                    </IconButton>
                    <DatePicker
                        value={forecastDate}
                        onChange={(date) => date && setForecastDate(date)}
                        slotProps={{ textField: { size: 'small', sx: { width: { xs: 100, sm: 150 }, '& input': { fontSize: { xs: '0.75rem', sm: '0.875rem' } } } } }}
                    />
                    <IconButton size="small" onClick={() => setForecastDate(addDays(forecastDate, 1))} sx={{ p: { xs: 0.5, sm: 1 } }}>
                        <ArrowRightIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Paper>

            {/* 鏈潵澶╂皵姒傝 */}
            <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, overflow: 'hidden' }} variant="outlined">
                <Typography variant="subtitle2" gutterBottom>鏈潵澶╂皵棰勬姤</Typography>
                {forecastSummaries.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">鏆傛棤棰勬祴鏁版嵁</Typography>
                ) : (
                    <Box
                        sx={{
                            display: 'flex',
                            gap: '6px',
                            overflowX: 'auto',
                            width: { xs: 'calc(100vw - 72px)', sm: '100%' },
                            pb: 1,
                            scrollSnapType: { xs: 'x mandatory', sm: 'none' },
                            WebkitOverflowScrolling: 'touch',
                            '&::-webkit-scrollbar': { display: 'none' },
                            scrollbarWidth: 'none',
                        }}
                    >
                        {forecastSummaries.map(summary => (
                            <Box
                                key={summary.date}
                                sx={{
                                    flexShrink: 0,
                                    width: { xs: 90, sm: 120 },
                                    scrollSnapAlign: { xs: 'start', sm: 'none' },
                                }}
                            >
                                <DailyWeatherCard
                                    summary={summary}
                                    selected={selectedForecastDay === summary.date}
                                    onClick={() => setSelectedForecastDay(summary.date)}
                                />
                            </Box>
                        ))}
                    </Box>
                )}
            </Paper>

            {/* 24灏忔椂棰勬祴鏇茬嚎 */}
            <Paper sx={{ p: 2 }} variant="outlined">
                <Typography variant="subtitle2" gutterBottom>
                    {selectedForecastDay ? `${selectedForecastDay} 24灏忔椂棰勬祴` : '閫夋嫨鏃ユ湡鏌ョ湅璇︽儏'}
                </Typography>
                <CurveSelector selectedCurves={selectedCurves} onToggle={handleCurveToggle} />
                <Box
                    ref={forecastChartRef}
                    sx={{
                        height: { xs: 300, sm: 350 },
                        position: 'relative',
                        backgroundColor: forecastFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                        p: forecastFullscreen.isFullscreen ? 2 : 0,
                        ...(forecastFullscreen.isFullscreen && {
                            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400
                        })
                    }}
                >
                    <forecastFullscreen.FullscreenEnterButton />
                    <forecastFullscreen.FullscreenExitButton />
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={forecastHourlyData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="timestamp" tickFormatter={(val) => val.substring(11, 16)} />
                            <YAxis />
                            <RechartsTooltip />
                            <Legend />
                            {CURVE_CONFIG.filter(c => selectedCurves.includes(c.key)).map(curve => (
                                <Line
                                    key={curve.key}
                                    type="monotone"
                                    dataKey={curve.key}
                                    name={`${curve.label} (${curve.unit})`}
                                    stroke={curve.color}
                                    strokeWidth={2}
                                    dot={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </Box>
            </Paper>
        </Box>
    );

    // 娓叉煋鍘嗗彶澶╂皵 Tab
    const renderActualsTab = () => (
        <Box>
            {/* 绔欑偣 + 鏃ユ湡閫夋嫨锛堢Щ鍔ㄧ涓€琛屾樉绀猴級 */}
            <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 2 }, flexWrap: 'nowrap', justifyContent: 'center' }} variant="outlined">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    <LocationIcon color="primary" sx={{ fontSize: { xs: 18, sm: 24 } }} />
                    <Typography variant="body2" fontWeight="bold" sx={{ fontSize: { xs: '0.8rem', sm: '1rem' } }}>{selectedLocation?.name || '鏈€夋嫨'}</Typography>
                </Box>
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    <IconButton size="small" onClick={() => setActualsDate(subDays(actualsDate, 1))} sx={{ p: { xs: 0.5, sm: 1 } }}>
                        <ArrowLeftIcon fontSize="small" />
                    </IconButton>
                    <DatePicker
                        value={actualsDate}
                        onChange={(date) => date && setActualsDate(date)}
                        slotProps={{ textField: { size: 'small', sx: { width: { xs: 100, sm: 150 }, '& input': { fontSize: { xs: '0.75rem', sm: '0.875rem' } } } } }}
                    />
                    <IconButton size="small" onClick={() => setActualsDate(addDays(actualsDate, 1))} sx={{ p: { xs: 0.5, sm: 1 } }}>
                        <ArrowRightIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Paper>

            {/* 姣忔棩姒傚喌锛堢Щ鍔ㄧ绠€鍖栵級 */}
            {actualsSummary && (
                <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, justifyContent: 'center' }} variant="outlined">
                    <WeatherIcon type={actualsSummary.weather_type} size={isMobile ? 36 : 48} />
                    <Typography variant={isMobile ? 'body1' : 'h6'} fontWeight="bold">{actualsSummary.weather_type}</Typography>
                    <Divider orientation="vertical" flexItem />
                    <Typography variant={isMobile ? 'body2' : 'body1'}>馃尅锔?{actualsSummary.min_temp}~{actualsSummary.max_temp}掳C</Typography>
                </Paper>
            )}

            {/* 鏇茬嚎閫夋嫨锛堝崟閫夛紝妯悜婊氬姩锛?*/}
            <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2 }} variant="outlined">
                <Box sx={{ overflowX: 'auto', pb: 1 }}>
                    <CurveSelectorSingle selectedCurve={selectedActualsCurve} onSelect={setSelectedActualsCurve} />
                </Box>

                {/* 24灏忔椂鏇茬嚎 */}
                <Box
                    ref={actualsChartRef}
                    sx={{
                        height: { xs: 300, sm: 350 },
                        position: 'relative',
                        backgroundColor: actualsFullscreen.isFullscreen ? 'background.paper' : 'transparent',
                        p: actualsFullscreen.isFullscreen ? 2 : 0,
                        ...(actualsFullscreen.isFullscreen && {
                            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 1400
                        })
                    }}
                >
                    <actualsFullscreen.FullscreenEnterButton />
                    <actualsFullscreen.FullscreenExitButton />
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={actualsHourlyData.map((actual, i) => ({
                            ...actual,
                            ...(compareHourlyData[i] ? Object.fromEntries(
                                CURVE_CONFIG.map(c => [`${c.key}_forecast`, compareHourlyData[i][c.key as keyof typeof compareHourlyData[0]]])
                            ) : {})
                        }))}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="timestamp" tickFormatter={(val) => val?.substring(11, 16) || ''} />
                            <YAxis />
                            <RechartsTooltip />
                            <Legend />
                            {CURVE_CONFIG.filter(c => c.key === selectedActualsCurve).map(curve => (
                                <React.Fragment key={curve.key}>
                                    <Line
                                        type="monotone"
                                        dataKey={curve.key}
                                        name={`${curve.label}瀹炲喌`}
                                        stroke={curve.color}
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                    {compareHourlyData.length > 0 && (
                                        <Line
                                            type="monotone"
                                            dataKey={`${curve.key}_forecast`}
                                            name={`${curve.label}棰勬祴`}
                                            stroke={curve.color}
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            dot={false}
                                        />
                                    )}
                                </React.Fragment>
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </Box>
            </Paper>

            {/* 棰勬祴瀵规瘮锛堢Щ鍔ㄧ浼樺寲锛?*/}
            <Paper sx={{ p: { xs: 1.5, sm: 2 } }} variant="outlined">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, flexWrap: 'wrap', mb: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: { xs: '100%', sm: 'auto' }, justifyContent: { xs: 'space-between', sm: 'flex-start' } }}>
                        <Typography variant="subtitle2">棰勬祴瀵规瘮:</Typography>
                        <FormControl size="small" sx={{ minWidth: { xs: 150, sm: 200 } }}>
                            <Select
                                value={forecastCompareDate}
                                onChange={(e) => setForecastCompareDate(e.target.value)}
                            >
                                {availableForecastDates.map(date => (
                                    <MenuItem key={date} value={date}>{date}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                    {Object.keys(accuracy).length > 0 && (
                        <Typography variant="body2" color="primary" fontWeight="bold">
                            缁煎悎鍑嗙‘鐜? {(Object.values(accuracy).reduce((a, b) => a + b, 0) / Object.values(accuracy).length).toFixed(1)}%
                        </Typography>
                    )}
                </Box>
                {Object.keys(accuracy).length > 0 && (
                    <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1 }, flexWrap: 'wrap' }}>
                        {CURVE_CONFIG.map(curve => (
                            <Chip
                                key={curve.key}
                                label={`${curve.icon}${isMobile ? '' : curve.label}: ${accuracy[curve.key]?.toFixed(1) || '-'}%`}
                                variant="outlined"
                                size="small"
                            />
                        ))}
                    </Box>
                )}
            </Paper>
        </Box>
    );

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return <Alert severity="error">{error}</Alert>;
    }

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={zhCN}>
            <Box sx={{
                width: '100%',
                maxWidth: '100vw',
                overflowX: 'hidden',
                boxSizing: 'border-box'
            }}>
                {/* 绉诲姩绔潰鍖呭睉 */}
                {isTablet && (
                    <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
                        鍩虹鏁版嵁 / 澶╂皵棰勬祴鏁版嵁
                    </Typography>
                )}

                <Grid container spacing={isMobile ? 0 : 2} sx={{ margin: 0, width: '100%' }}>
                    {/* 宸︿晶绔欑偣鍒楄〃 - 妗岄潰绔樉绀?*/}
                    {!isMobile && (
                        <Grid size={{ xs: 12, md: 3, lg: 2 }}>
                            {renderLocationSidebar()}
                        </Grid>
                    )}

                    {/* 鍙充晶鍐呭鍖?*/}
                    <Grid size={{ xs: 12, md: 9, lg: 10 }}>
                        {/* 绉诲姩绔珯鐐归€夋嫨 */}
                        {isMobile && (
                            <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 1, alignItems: 'center' }} variant="outlined">
                                <FormControl fullWidth size="small">
                                    <Select
                                        value={selectedLocation?.location_id ?? ''}
                                        onChange={(e) => {
                                            const loc = locations.find(l => l.location_id === e.target.value);
                                            if (loc) setSelectedLocation(loc);
                                        }}
                                        displayEmpty
                                        renderValue={(value) => {
                                            if (!value) return <em>閫夋嫨绔欑偣</em>;
                                            const loc = locations.find(l => l.location_id === value);
                                            return loc?.name || value;
                                        }}
                                    >
                                        {locations.filter(l => l.enabled).map(location => (
                                            <MenuItem key={location.location_id} value={location.location_id}>
                                                {location.name}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <IconButton size="small" onClick={() => { setEditingLocation(null); setLocationModalOpen(true); }} disabled={!canEdit}>
                                    <AddIcon />
                                </IconButton>
                            </Paper>
                        )}

                        {/* 绌虹珯鐐规彁绀?*/}
                        {locations.length === 0 ? (
                            <Paper sx={{ p: 4, textAlign: 'center' }} variant="outlined">
                                <Typography variant="h6" color="text.secondary" gutterBottom>
                                    鏆傛棤澶╂皵绔欑偣
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    璇峰厛娣诲姞澶╂皵绔欑偣浠ユ煡鐪嬪ぉ姘旀暟鎹?
                                </Typography>
                                <Button
                                    variant="contained"
                                    startIcon={<AddIcon />}
                                    disabled={!canEdit}
                                    onClick={() => { setEditingLocation(null); setLocationModalOpen(true); }}
                                >
                                    鏂板绔欑偣
                                </Button>
                            </Paper>
                        ) : (
                            <>
                                {/* Tab 鍒囨崲 */}
                                <Paper sx={{ mb: 2 }} variant="outlined">
                                    <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
                                        <Tab label="澶╂皵棰勬祴" />
                                        <Tab label="鍘嗗彶澶╂皵" />
                                    </Tabs>
                                </Paper>

                                {/* Tab 鍐呭 */}
                                {activeTab === 0 && renderForecastTab()}
                                {activeTab === 1 && renderActualsTab()}
                            </>
                        )}
                    </Grid>
                </Grid>

                {/* 绔欑偣缂栬緫寮圭獥 */}
                <LocationFormModal
                    open={locationModalOpen}
                    onClose={() => setLocationModalOpen(false)}
                    onSave={handleSaveLocation}
                    location={editingLocation}
                    readonly={!canEdit}
                />
            </Box>
        </LocalizationProvider>
    );
};

export default WeatherDataPage;


