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

export interface IntentWholesaleSummaryRow {
    settlement_month: string;
    total_energy_mwh: number;
    daily_cost_total: number;
    surplus_unit_price: number;
    surplus_cost: number;
    total_cost: number;
    unit_cost_yuan_per_mwh: number;
    unit_cost_yuan_per_kwh: number;
    status: string;
    message: string;
}

export interface IntentWholesalePeriodDetail {
    period: number;
    time_label: string;
    load_mwh: number;
    daily_cost_total: number;
    surplus_cost: number;
    total_cost: number;
    daily_cost_unit_price: number;
    final_unit_price: number;
}

export interface IntentWholesaleDailyDetail {
    date: string;
    total_energy_mwh: number;
    daily_cost_total: number;
    surplus_cost: number;
    total_cost: number;
    unit_cost_yuan_per_mwh: number;
}

export interface IntentWholesaleMonthDetail {
    settlement_month: string;
    summary: IntentWholesaleSummaryRow;
    period_details: IntentWholesalePeriodDetail[];
    daily_details: IntentWholesaleDailyDetail[];
}

export interface IntentWholesaleSimulationResponse {
    customer: IntentCustomerSummary;
    summary_rows: IntentWholesaleSummaryRow[];
    month_details: IntentWholesaleMonthDetail[];
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

export const calculateIntentCustomerWholesaleSimulation = async (customerId: string) => {
    const response = await apiClient.post<IntentWholesaleSimulationResponse>(
        `/api/v1/intent-customer-diagnosis/customers/${customerId}/wholesale-simulation`
    );
    return response.data;
};

export const getIntentCustomerWholesaleSimulation = async (customerId: string) => {
    const response = await apiClient.get<IntentWholesaleSimulationResponse>(
        `/api/v1/intent-customer-diagnosis/customers/${customerId}/wholesale-simulation`
    );
    return response.data;
};
