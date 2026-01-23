import apiClient from './client';

export interface ImportResult {
    success: boolean;
    message: string;
    total_records?: number;
    inserted: number;
    updated: number;
    skipped: number;
    parse_errors?: string[];
    errors?: string[];
}

/**
 * 导入电表数据 (Excel)
 */
export const importMeterData = async (file: File, overwrite: boolean = false): Promise<{ data: ImportResult }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('overwrite', overwrite.toString());
    return apiClient.post('/api/v1/load-data/import/meter', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
};

/**
 * 导入计量点数据 (Excel)
 */
export const importMpData = async (file: File, overwrite: boolean = false): Promise<{ data: ImportResult }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('overwrite', overwrite.toString());
    return apiClient.post('/api/v1/load-data/import/mp', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
};

/**
 * 重新聚合数据
 */
export const reaggregateLoadData = async (
    dataType: 'all' | 'mp' | 'meter' = 'all',
    params?: {
        customer_id?: string;
        start_date?: string;
        end_date?: string;
        mode?: 'incremental' | 'full';
    }
): Promise<{ data: any }> => {
    return apiClient.post('/api/v1/load-data/reaggregate', null, {
        params: {
            data_type: dataType,
            ...params
        }
    });
};

export const previewCalibration = async (customerId: string, startDate: string, endDate: string) => {
    return apiClient.post('/api/v1/load-data/calibration/preview', null, {
        params: { customer_id: customerId, start_date: startDate, end_date: endDate }
    });
};

export const calculateCalibration = async (customerId: string, startDate: string, endDate: string, accountNo?: string) => {
    return apiClient.post('/api/v1/load-data/calibration/calculate', null, {
        params: { customer_id: customerId, start_date: startDate, end_date: endDate, account_no: accountNo }
    });
};

export const applyCalibration = async (data: {
    customer_id: string;
    coefficients: { meter_id: string; value: number }[];
    update_history: boolean;
    history_range?: [string, string];
}) => {
    return apiClient.post('/api/v1/load-data/calibration/apply', data);
};

export const getCalibrationDetails = async (customerId: string, startDate: string, endDate: string) => {
    return apiClient.post('/api/v1/load-data/calibration/details', null, {
        params: { customer_id: customerId, start_date: startDate, end_date: endDate }
    });
};
