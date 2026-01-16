import React from 'react';
import { Typography } from '@mui/material';

/**
 * SVG 天气图标组件（简洁风格）
 * 复用自 WeatherDataPage，方便在其他页面使用
 */
export const WeatherIcon: React.FC<{ type: string; size?: number }> = ({ type, size = 40 }) => {
    const iconStyle = { width: size, height: size };

    switch (type) {
        case '晴':
            return (
                <svg viewBox="0 0 64 64" style={iconStyle}>
                    <circle cx="32" cy="32" r="14" fill="#FFB800" />
                    {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => (
                        <line key={angle} x1="32" y1="8" x2="32" y2="14" stroke="#FFB800" strokeWidth="3" strokeLinecap="round" transform={`rotate(${angle} 32 32)`} />
                    ))}
                </svg>
            );
        case '少云':
        case '多云':
            return (
                <svg viewBox="0 0 64 64" style={iconStyle}>
                    <circle cx="20" cy="24" r="10" fill="#FFB800" />
                    <ellipse cx="38" cy="40" rx="20" ry="12" fill="#B0BEC5" />
                    <ellipse cx="28" cy="38" rx="14" ry="10" fill="#CFD8DC" />
                </svg>
            );
        case '阴':
            return (
                <svg viewBox="0 0 64 64" style={iconStyle}>
                    <ellipse cx="32" cy="38" rx="24" ry="14" fill="#90A4AE" />
                    <ellipse cx="22" cy="36" rx="16" ry="12" fill="#B0BEC5" />
                </svg>
            );
        case '小雨':
        case '中雨':
        case '大雨':
            return (
                <svg viewBox="0 0 64 64" style={iconStyle}>
                    <ellipse cx="32" cy="28" rx="22" ry="12" fill="#78909C" />
                    <ellipse cx="22" cy="26" rx="14" ry="10" fill="#90A4AE" />
                    <line x1="24" y1="44" x2="20" y2="54" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" />
                    <line x1="36" y1="44" x2="32" y2="54" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" />
                    <line x1="48" y1="44" x2="44" y2="54" stroke="#42A5F5" strokeWidth="2" strokeLinecap="round" />
                </svg>
            );
        case '小雪':
        case '大雪':
        case '雨夹雪':
            return (
                <svg viewBox="0 0 64 64" style={iconStyle}>
                    <ellipse cx="32" cy="28" rx="22" ry="12" fill="#B0BEC5" />
                    <circle cx="22" cy="48" r="3" fill="#E3F2FD" />
                    <circle cx="32" cy="52" r="3" fill="#E3F2FD" />
                    <circle cx="42" cy="48" r="3" fill="#E3F2FD" />
                </svg>
            );
        default:
            return <Typography variant="h4">🌤️</Typography>;
    }
};

export default WeatherIcon;
