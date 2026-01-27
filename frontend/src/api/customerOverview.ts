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

export type ViewMode = 'monthly' | 'ytd';

// ---- API Functions ----

export const customerOverviewApi = {
    /**
     * 获取KPI卡片数据
     */
    getKpi: async (year: number, month: number, viewMode: ViewMode): Promise<OverviewKpi> => {
        const response = await apiClient.get<OverviewKpi>('/api/v1/customer/overview/kpi', {
            params: { year, month, view_mode: viewMode }
        });
        return response.data;
    },

    /**
     * 获取电量贡献构成图表数据
     */
    getContribution: async (year: number, month: number, viewMode: ViewMode): Promise<ContributionData> => {
        const response = await apiClient.get<ContributionData>('/api/v1/customer/overview/contribution', {
            params: { year, month, view_mode: viewMode }
        });
        return response.data;
    },

    /**
     * 获取涨跌龙虎榜数据
     */
    getGrowthRanking: async (year: number, month: number, viewMode: ViewMode): Promise<GrowthRankingData> => {
        const response = await apiClient.get<GrowthRankingData>('/api/v1/customer/overview/growth-ranking', {
            params: { year, month, view_mode: viewMode }
        });
        return response.data;
    },

    /**
     * 获取峰谷比极值榜数据
     */
    getEfficiencyRanking: async (year: number, month: number, viewMode: ViewMode): Promise<EfficiencyRankingData> => {
        const response = await apiClient.get<EfficiencyRankingData>('/api/v1/customer/overview/efficiency-ranking', {
            params: { year, month, view_mode: viewMode }
        });
        return response.data;
    },

    /**
     * 获取客户资产明细列表
     */
    getCustomerList: async (
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
    ): Promise<CustomerListResponse> => {
        const response = await apiClient.get<CustomerListResponse>('/api/v1/customer/overview/customers', {
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

export default customerOverviewApi;
