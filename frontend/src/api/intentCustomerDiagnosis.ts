import apiClient from './client';

export interface IntentCustomerSummary {
    id: string;
    customer_name: string;
    created_at: string;
    updated_at: string;
    last_imported_at?: string | null;
    last_aggregated_at?: string | null;
    coverage_start?: string | null;
    coverage_end?: string | null;
    coverage_days: number;
    missing_days: number;
    completeness: number;
    avg_daily_load: number;
    max_daily_load: number;
    min_daily_load: number;
    missing_meter_days: number;
    interpolated_days: number;
    dirty_days: number;
    meter_count: number;
}

export interface IntentPreviewFileItem {
    filename: string;
    meter_id: string;
    account_id: string;
    extracted_customer_name?: string | null;
    start_date: string;
    end_date: string;
    record_count: number;
    default_multiplier: number;
    parse_errors: string[];
}

export interface IntentPreviewResponse {
    suggested_customer_name?: string | null;
    files: IntentPreviewFileItem[];
    validation: {
        can_import: boolean;
        errors: string[];
        warnings: string[];
    };
}

export interface IntentLoadDataResponse {
    customer: IntentCustomerSummary;
    month_data: Array<{ date: string; label: string; totalLoad: number; isMissing: boolean }>;
    intraday_data: Array<{ time: string; load: number }>;
    selected_day_total: number;
}

export interface IntentImportConfig {
    filename: string;
    meter_id: string;
    account_id: string;
    multiplier: number;
}

export const listIntentCustomers = async () => {
    const response = await apiClient.get<{ items: IntentCustomerSummary[] }>('/api/v1/intent-customer-diagnosis/customers');
    return response.data.items;
};

export const previewIntentCustomerFiles = async (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const response = await apiClient.post<IntentPreviewResponse>('/api/v1/intent-customer-diagnosis/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

export const importIntentCustomerFiles = async (
    configs: IntentImportConfig[],
    files: File[]
) => {
    const formData = new FormData();
    formData.append('meter_configs_json', JSON.stringify(configs));
    files.forEach((file) => formData.append('files', file));
    const response = await apiClient.post('/api/v1/intent-customer-diagnosis/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

export const getIntentCustomerLoadData = async (customerId: string, month: string, date: string) => {
    const response = await apiClient.get<IntentLoadDataResponse>(
        `/api/v1/intent-customer-diagnosis/customers/${customerId}/load-data`,
        { params: { month, date } }
    );
    return response.data;
};

export const deleteIntentCustomer = async (customerId: string, password: string) => {
    await apiClient.delete(`/api/v1/intent-customer-diagnosis/customers/${customerId}`, {
        data: { password }
    });
};
