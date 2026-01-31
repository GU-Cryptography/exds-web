import apiClient from './client';

// Types definition matching Backend Pydantic models

export interface TagItem {
    name: string;
    category: string;
    confidence?: number;
    source?: string;
}

export interface LongTermMetrics {
    data_start: string;
    data_end: string;
    avg_daily_load: number;
    total_annual_load: number;
    trend_slope: number;
    recent_3m_growth?: number;
    cv: number;
    zero_days: number;
    weekend_ratio?: number;
    summer_avg?: number;
    winter_avg?: number;
    spring_autumn_avg?: number;
}

export interface ShortTermMetrics {
    data_start: string;
    data_end: string;
    avg_curve: number[];
    std_curve?: number[];
    avg_load_rate: number;
    min_max_ratio: number;
    peak_hour?: number;
    valley_hour?: number;
    day_night_ratio?: number;
    weekend_ratio?: number;
    curve_similarity?: number;
    cv?: number;
    tip_ratio?: number;
    peak_ratio?: number;
    flat_ratio?: number;
    valley_ratio?: number;
    deep_ratio?: number;
}

export interface CustomerCharacteristics {
    customer_id: string;
    customer_name: string;
    updated_at: string;
    long_term?: LongTermMetrics;
    short_term?: ShortTermMetrics;
    tags: TagItem[];
    regularity_score?: number;
    quality_rating?: string;
    baseline_curve?: number[];
}

export interface AnomalyRecord {
    customer_id: string;
    customer_name: string;
    anomaly_type: 'shape_drift' | 'scale_drift' | 'peak_shift' | 'stability_decay';
    severity: 'high' | 'medium' | 'low';
    detected_at: string;
    observation_start: string;
    observation_end: string;
    metrics: Record<string, any>;
    diagnosis?: string;
    baseline_curve?: number[];
    observation_curve?: number[];
    status: 'pending' | 'confirmed' | 'ignored';
}

// Response Types
export interface OverviewKpi {
    coverage_rate: number;
    coverage_count: number;
    total_customers: number;
    dominant_tag?: string;
    dominant_tag_percentage: number;
    anomaly_count_today: number;
    avg_regularity_score: number;
}

export interface TagDistributionItem {
    name: string;
    value: number;
    percentage: number;
}

export interface TagDistribution {
    by_shift: TagDistributionItem[];
    by_facility: TagDistributionItem[];
}

export interface AnomalySummaryItem {
    id: string;
    customer_id: string;
    customer_name: string;
    severity: string;
    type: string;
    description: string;
    time: string;
}

export interface CharacteristicsOverview {
    kpi: OverviewKpi;
    distribution: TagDistribution;
    anomalies: AnomalySummaryItem[];
}

export interface CustomerListResponse {
    total: number;
    page: number;
    page_size: number;
    items: CustomerCharacteristics[];
}

// --- 新增类型 ---

export interface TagCategoryDistribution {
    category: string;
    category_name: string;
    items: TagDistributionItem[];
}

export interface EnhancedTagDistribution {
    categories: TagCategoryDistribution[];
}

export interface TagChangeItem {
    customer_id: string;
    customer_name: string;
    added_tags: string[];
    removed_tags: string[];
}

export interface TagChangesResponse {
    date: string;
    total_added: number;
    total_removed: number;
    changes: TagChangeItem[];
}

export interface ScatterDataItem {
    customer_id: string;
    customer_name: string;
    avg_daily_load: number;
    cv: number;
    regularity_score?: number;
    tags: string[];
}

export interface ScatterDataResponse {
    items: ScatterDataItem[];
}

export interface AnalysisHistoryItem {
    date: string;
    execution_time: string;
    tags: string[];
    rule_ids: string[];
}

export interface AnalysisHistoryResponse {
    customer_id: string;
    items: AnalysisHistoryItem[];
}

export interface AnomalyAlertItem {
    id: string;
    customer_id: string;
    customer_name: string;
    alert_date: string;
    alert_type: string;
    severity: string;
    confidence: number;
    reason: string;
    metrics?: Record<string, any>;
    acknowledged: boolean;
    acknowledged_by?: string;
    acknowledged_at?: string;
    notes?: string;
}

export interface AnomalyAlertListResponse {
    total: number;
    items: AnomalyAlertItem[];
}

// API Methods

export const loadCharacteristicsApi = {
    getOverview: () => {
        return apiClient.get<CharacteristicsOverview>('/api/v1/load-characteristics/overview');
    },

    getDistribution: () => {
        return apiClient.get<EnhancedTagDistribution>('/api/v1/load-characteristics/overview/distribution');
    },

    getTagChanges: (date?: string) => {
        return apiClient.get<TagChangesResponse>('/api/v1/load-characteristics/overview/tag-changes', {
            params: date ? { date } : {}
        });
    },

    getScatterData: () => {
        return apiClient.get<ScatterDataResponse>('/api/v1/load-characteristics/overview/scatter-data');
    },

    listCustomers: (page: number = 1, pageSize: number = 10, search?: string, tag?: string) => {
        return apiClient.get<CustomerListResponse>('/api/v1/load-characteristics/customers', {
            params: { page, page_size: pageSize, search, tag }
        });
    },

    getCustomerDetail: (customerId: string) => {
        return apiClient.get<CustomerCharacteristics>(`/api/v1/load-characteristics/customer/${customerId}`);
    },

    getCustomerHistory: (customerId: string, limit: number = 30) => {
        return apiClient.get<AnalysisHistoryResponse>(`/api/v1/load-characteristics/customer/${customerId}/history`, {
            params: { limit }
        });
    },

    getCustomerAlerts: (customerId: string, limit: number = 50) => {
        return apiClient.get<AnomalyAlertListResponse>(`/api/v1/load-characteristics/customer/${customerId}/alerts`, {
            params: { limit }
        });
    },

    acknowledgeAlert: (alertId: string, notes?: string) => {
        return apiClient.post(`/api/v1/load-characteristics/alerts/${alertId}/acknowledge`, { notes });
    },

    getDailyTrend: (customerId: string, startDate: string, endDate: string) => {
        return apiClient.get<any[]>(`/api/v1/load-characteristics/customer/${customerId}/daily-trend`, {
            params: { start_date: startDate, end_date: endDate }
        });
    },

    getMonthlyEnergy: (customerId: string, startMonth: string, endMonth: string) => {
        return apiClient.get<any[]>(`/api/v1/load-characteristics/customer/${customerId}/monthly-energy`, {
            params: { start_month: startMonth, end_month: endMonth }
        });
    }
};

