/**
 * 客户负荷总览 API 模块
 */
import apiClient from './client';

// ---- Types ----

export interface TouUsage {
    tip: number;
    peak: number;
    flat: number;
    valley: number;
    deep: number;
}

export interface OverviewKpi {
    signed_customers_count: number;
    signed_total_quantity: number;
    signed_quantity_yoy: number | null;
    actual_total_usage: number;
    actual_usage_yoy: number | null;
    avg_peak_valley_ratio: number;
    tou_breakdown: TouUsage;
}

export interface ContributionItem {
    customer_id: string;
    short_name: string;
    usage: number;
    percentage: number;
}

export interface ContributionData {
    top5: ContributionItem[];
    others: { usage: number; percentage: number };
    total: number;
}

export interface GrowthItem {
    customer_id: string;
    short_name: string;
    change: number;
    yoy_pct: number | null;
}

export interface GrowthRankingData {
    growth_top5: GrowthItem[];
    decline_top5: GrowthItem[];
}

export interface EfficiencyItem {
    customer_id: string;
    short_name: string;
    pv_ratio: number;
}

export interface EfficiencyRankingData {
    high_pv_ratio: EfficiencyItem[];
    low_pv_ratio: EfficiencyItem[];
}

export interface CustomerListItem {
    customer_id: string;
    customer_name: string;
    short_name: string;
    signed_quantity: number;
    signed_yoy: number | null;
    signed_yoy_warning: boolean;
    actual_usage: number;
    actual_yoy: number | null;
    peak_valley_ratio: number;
    tou_breakdown: TouUsage;
    contract_start_month: number;
    contract_end_month: number;
}

export interface CustomerListResponse {
    total: number;
    page: number;
    page_size: number;
    items: CustomerListItem[];
}

export interface RankingsData {
    growth: GrowthRankingData;
    efficiency: EfficiencyRankingData;
}

export interface DashboardData {
    kpi: OverviewKpi;
    contribution: ContributionData;
    rankings: RankingsData;
    customer_list: CustomerListResponse;
}

export type ViewMode = 'monthly' | 'ytd';

// ---- API Functions ----

export const customerLoadOverviewApi = {
    /**
     * 统一获取看板所有数据
     */
    getDashboardData: async (
        year: number,
        month: number,
        viewMode: ViewMode,
        options?: {
            search?: string;
            sort_field?: string;
            sort_order?: 'asc' | 'desc';
            page?: number;
            page_size?: number;
        }
    ): Promise<DashboardData> => {
        const response = await apiClient.get<DashboardData>('/api/v1/customer-load-overview/dashboard', {
            params: {
                year,
                month,
                view_mode: viewMode,
                ...options
            }
        });
        return response.data;
    }
};

export default customerLoadOverviewApi;
