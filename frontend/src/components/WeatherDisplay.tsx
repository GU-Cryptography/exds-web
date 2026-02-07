import React from 'react';
import { Box, Typography, Divider, CircularProgress } from '@mui/material';
import { DailyWeatherSummary } from '../api/weather';
import { WeatherIcon } from './WeatherIcon';

interface WeatherDisplayProps {
    weatherData: DailyWeatherSummary | null;
    loading: boolean;
    size?: 'small' | 'medium';
}

export const WeatherDisplay: React.FC<WeatherDisplayProps> = ({ weatherData, loading, size = 'small' }) => {
    const isSmall = size === 'small';
    const iconSize = isSmall ? 20 : 28;
    const fontSize = isSmall ? '0.75rem' : '0.875rem';

    if (loading) {
        return <CircularProgress size={iconSize} />;
    }

    if (!weatherData) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize }}>
                无天气数据
            </Typography>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WeatherIcon type={weatherData.weather_type} size={iconSize} />
            <Typography variant="body2" fontWeight="bold" sx={{ fontSize }}>
                {weatherData.weather_type}
            </Typography>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5, height: 12, my: 'auto' }} />
            <Typography variant="body2" sx={{ fontSize }}>
                🌡️ {weatherData.min_temp}~{weatherData.max_temp}°C
            </Typography>
        </Box>
    );
};
