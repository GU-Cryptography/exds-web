/**
 * 价格预测 API 客户端
 */
import apiClient from './client';

// ============ 类型定义 ============

/** 预测版本信息 */
export interface ForecastVersion {
    forecast_id: string;
    forecast_type: string;
    model_version: string;
    model_type: string;
    created_at: string;
}

/** 图表数据点 */
export interface ChartDataPoint {
    time: string;                    // "00:15" ~ "24:00"
    predicted_price: number | null;
    actual_price: number | null;
    confidence_80_lower?: number | null;
    confidence_80_upper?: number | null;
}

/** 准确度数据 */
export interface AccuracyData {
    forecast_id: string;
    forecast_type: string;
    target_date: string;
    model_type: string;
    model_version: string;
    wmape_accuracy: number;
    mape?: number;
    mae: number;
    rmse: number;
    r2: number;
    direction_accuracy: number;
    period_accuracy: Record<string, number>;
    stats: {
        min_value: number;
        max_value: number;
        mean_value: number;
        has_negative: boolean;
    };
    rate_90_pass: boolean;
    rate_85_pass: boolean;
    calculated_at: string;
}

// ============ API 调用 ============

export const priceForecastApi = {
    /**
     * 获取预测版本列表
     */
    fetchVersions: (params: { target_date: string; forecast_type?: string }) => {
        return apiClient.get<ForecastVersion[]>('/api/v1/price-forecast/versions', { params });
    },

    /**
     * 获取图表数据（预测曲线 + 实际曲线）
     */
    fetchChartData: (params: { forecast_id: string; target_date: string }) => {
        return apiClient.get<ChartDataPoint[]>('/api/v1/price-forecast/data', { params });
    },

    /**
     * 获取准确度评估数据
     */
    fetchAccuracy: (params: { forecast_id: string }) => {
        return apiClient.get<AccuracyData | null>('/api/v1/price-forecast/accuracy', { params });
    },
};
