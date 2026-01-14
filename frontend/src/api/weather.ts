import apiClient from './client';

// 站点数据结构
export interface WeatherLocation {
    location_id: string;
    name: string;
    latitude: number;
    longitude: number;
    enabled: boolean;
}

// 天气数据（小时级）
export interface WeatherHourlyData {
    timestamp: string;
    apparent_temperature: number;
    shortwave_radiation: number;
    wind_speed_10m: number;
    wind_speed_100m: number;
    relative_humidity_2m: number;
    precipitation: number;
    cloud_cover: number;
}

// 每日天气概览
export interface DailyWeatherSummary {
    date: string;
    weather_type: string;
    weather_icon: string;
    min_temp: number;
    max_temp: number;
    avg_precipitation: number;
    avg_cloud_cover: number;
}

// 预测天气数据
export interface WeatherForecastData extends WeatherHourlyData {
    forecast_date: string;
    target_timestamp: string;
}

// 获取站点列表
export const getWeatherLocations = async (): Promise<WeatherLocation[]> => {
    const response = await apiClient.get('/api/v1/weather/locations');
    return response.data;
};

// 创建站点
export const createWeatherLocation = async (location: Omit<WeatherLocation, 'location_id'> & { location_id: string }): Promise<WeatherLocation> => {
    const response = await apiClient.post('/api/v1/weather/locations', location);
    return response.data;
};

// 更新站点
export const updateWeatherLocation = async (locationId: string, location: Partial<WeatherLocation>): Promise<WeatherLocation> => {
    const response = await apiClient.put(`/api/v1/weather/locations/${locationId}`, location);
    return response.data;
};

// 删除站点
export const deleteWeatherLocation = async (locationId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/weather/locations/${locationId}`);
};

// 获取历史天气数据（单日24点）
export const getWeatherActuals = async (locationId: string, date: string): Promise<WeatherHourlyData[]> => {
    const response = await apiClient.get('/api/v1/weather/actuals', {
        params: { location_id: locationId, date }
    });
    return response.data;
};

// 获取历史天气概览
export const getWeatherActualsSummary = async (locationId: string, date: string): Promise<DailyWeatherSummary> => {
    const response = await apiClient.get('/api/v1/weather/actuals/summary', {
        params: { location_id: locationId, date }
    });
    return response.data;
};

// 获取预测天气数据（单日24点）
export const getWeatherForecasts = async (locationId: string, forecastDate: string, targetDate: string): Promise<WeatherHourlyData[]> => {
    const response = await apiClient.get('/api/v1/weather/forecasts', {
        params: { location_id: locationId, forecast_date: forecastDate, target_date: targetDate }
    });
    return response.data;
};

// 获取预测天气概览（未来N天）
export const getWeatherForecastsSummary = async (locationId: string, forecastDate: string): Promise<DailyWeatherSummary[]> => {
    const response = await apiClient.get('/api/v1/weather/forecasts/summary', {
        params: { location_id: locationId, forecast_date: forecastDate }
    });
    return response.data;
};

// 获取可用的预测发布日期
export const getAvailableForecastDates = async (locationId: string, targetDate?: string): Promise<string[]> => {
    const response = await apiClient.get('/api/v1/weather/forecast-dates', {
        params: { location_id: locationId, target_date: targetDate }
    });
    return response.data;
};

// 天气类型判断工具函数
export const getWeatherType = (precipitation: number, cloudCover: number, temperature: number): { icon: string; text: string } => {
    // 有降水
    if (precipitation > 0) {
        if (temperature < 0) {
            if (precipitation > 5) return { icon: "❄️", text: "大雪" };
            return { icon: "🌨️", text: "小雪" };
        }
        if (temperature <= 2) return { icon: "🌨️", text: "雨夹雪" };
        if (precipitation > 8) return { icon: "🌧️", text: "大雨" };
        if (precipitation > 2.5) return { icon: "🌧️", text: "中雨" };
        return { icon: "🌦️", text: "小雨" };
    }
    // 无降水
    if (cloudCover < 20) return { icon: "☀️", text: "晴" };
    if (cloudCover < 50) return { icon: "🌤️", text: "少云" };
    if (cloudCover < 80) return { icon: "⛅", text: "多云" };
    return { icon: "☁️", text: "阴" };
};

// 计算预测准确率（WMAPE）
export const calculateAccuracy = (actual: number[], predicted: number[]): number => {
    if (actual.length === 0 || actual.length !== predicted.length) return 0;
    const sumAbsDiff = actual.reduce((sum, a, i) => sum + Math.abs(a - predicted[i]), 0);
    const sumActual = actual.reduce((sum, a) => sum + Math.abs(a), 0);
    if (sumActual === 0) return 100;
    const wmape = (sumAbsDiff / sumActual) * 100;
    return Math.max(0, Math.round((100 - wmape) * 10) / 10);
};
