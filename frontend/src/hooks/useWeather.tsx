import { useState, useEffect } from 'react';
import { getWeatherActualsSummary, DailyWeatherSummary } from '../api/weather';
import { format } from 'date-fns';

const DEFAULT_LOCATION_ID = 'nanchang';

export const useWeather = (date: Date | null, locationId: string = DEFAULT_LOCATION_ID) => {
    const [weatherData, setWeatherData] = useState<DailyWeatherSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const fetchWeather = async () => {
            if (!date) return;
            setLoading(true);
            setError(null);
            try {
                const dateStr = format(date, 'yyyy-MM-dd');
                const data = await getWeatherActualsSummary(locationId, dateStr);
                setWeatherData(data);
            } catch (err) {
                console.error('Failed to fetch weather data:', err);
                setWeatherData(null);
                setError(err instanceof Error ? err : new Error('Unknown error'));
            } finally {
                setLoading(false);
            }
        };

        fetchWeather();
    }, [date, locationId]);

    return { weatherData, loading, error };
};
