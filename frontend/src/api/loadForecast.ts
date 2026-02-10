/**
 * 负荷预测 API 客户端
 */
import apiClient from './client';

export interface LoadForecastVersion {
    forecast_id: string;
    forecast_date: string; // 发布日期 YYYY-MM-DD
    gap: number;           // 提前天数
    created_at: string;
}

export interface LoadForecastData {
    customer_id: string;
    target_date: string;
    period_types?: string[]; // 96个点对应的时段类型
    forecast_date: string;
    gap: number;
    values: number[];    // 预测统计与时段 (V2 增加)
    actual_values?: number[];
    actual_energy?: number[];
    pred_sum?: number;      // 后端直接返回的预测电量，用于展示和列表排序
    accuracy?: {
        wmape_accuracy: number | null;
        pred_sum: number | null;
        mae: number | null;
        rmse: number | null;
    };
    confidence_90_lower?: number[];
    confidence_90_upper?: number[];
    manual_adjustment?: {
        is_modified: boolean;
        original_values?: number[];
        logs?: any[];
    };
}

export interface PerformanceOverview {
    avg_accuracy: number | null;
    count: number;
    history?: number[];
}

export interface LoadForecastCustomer {
    customer_id: string;
    short_name: string;
    tags?: string[];
    wmape: number | null;
    history_wmape: number | null;
    pred_sum: number | null;
    has_data: boolean;
    is_modified?: boolean;
}

export const loadForecastApi = {
    getVersions: (date: string) => apiClient.get<LoadForecastVersion[]>(`/api/v1/load-forecast/versions`, { params: { target_date: date } }),
    getForecastData: (target: string, forecast: string, customer: string = 'AGGREGATE') =>
        apiClient.get<LoadForecastData>(`/api/v1/load-forecast/data`, { params: { target_date: target, forecast_date: forecast, customer_id: customer } }),
    getCustomers: (target: string, forecast: string) =>
        apiClient.get<LoadForecastCustomer[]>(`/api/v1/load-forecast/customers`, { params: { target_date: target, forecast_date: forecast } }),
    getPerformanceOverview: (customer: string = 'AGGREGATE', gap?: number) =>
        apiClient.get<PerformanceOverview>(`/api/v1/load-forecast/performance-overview`, { params: { customer_id: customer, gap: gap } }),
};
