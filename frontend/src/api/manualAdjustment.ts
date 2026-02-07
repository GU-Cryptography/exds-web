import apiClient from './client';

export interface ManualAdjustment {
    is_modified: boolean;
    original_values: number[];
    logs: any[];
}

export const manualAdjustmentApi = {
    save: (target_date: string, forecast_date: string, customer_id: string, values: number[]) => {
        return apiClient.post('/api/v1/manual-adjustment/save', {
            target_date,
            forecast_date,
            customer_id,
            values
        });
    },

    reset: (target_date: string, forecast_date: string, customer_id: string) => {
        return apiClient.post('/api/v1/manual-adjustment/reset', {
            target_date,
            forecast_date,
            customer_id
        });
    }
};
