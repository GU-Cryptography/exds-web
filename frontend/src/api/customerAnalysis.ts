import apiClient from './client';
import { Tag } from './customer';

export interface HourlyDataPoint {
    time: string;
    current: number | null;
    last_day: number | null;
    benchmark: number | null;
    period_type: string;
}

export interface TouUsage {
    tip: number;
    peak: number;
    flat: number;
    valley: number;
    deep: number;
}

export interface AnalysisStats {
    annual_contract: number;
    annual_cumulative: number;
    day_total: number;
    yesterday_total: number;
    tou_usage: TouUsage;
    peak_valley_ratio: number;
}

export interface DailyViewResponse {
    main_curve: HourlyDataPoint[];
    stats: AnalysisStats;
}

export interface HistoryDataPoint {
    date: string;
    value: number;
}

export interface AutoTag {
    name: string;
    source: string;
    reason: string;
}

export interface AiDiagnoseResponse {
    auto_tags: AutoTag[];
    summary: string;
}

export const customerAnalysisApi = {
    // 获取日负荷分析视图
    fetchDailyView: (customerId: string, date: string) => {
        return apiClient.get<DailyViewResponse>(`/api/v1/customer-analysis/${customerId}/daily-view`, {
            params: { date }
        });
    },

    // 获取历史趋势
    fetchHistory: (customerId: string, type: 'daily' | 'monthly', endDate: string) => {
        return apiClient.get<HistoryDataPoint[]>(`/api/v1/customer-analysis/${customerId}/history`, {
            params: { type, end_date: endDate }
        });
    },

    // 触发AI诊断
    triggerAiDiagnose: (customerId: string, date: string) => {
        return apiClient.post<AiDiagnoseResponse>(`/api/v1/customer-analysis/${customerId}/ai-diagnose`, null, {
            params: { date }
        });
    },

    // 添加标签
    addTag: (customerId: string, tag: { name: string, source?: string, reason?: string }) => {
        return apiClient.post(`/api/v1/customer-analysis/${customerId}/tags`, tag);
    },

    // 删除标签
    removeTag: (customerId: string, tagName: string) => {
        return apiClient.delete(`/api/v1/customer-analysis/${customerId}/tags/${tagName}`);
    }
};
