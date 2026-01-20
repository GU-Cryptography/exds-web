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
export const importMeterData = async (file: File): Promise<{ data: ImportResult }> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/api/v1/load-data/import/meter', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
};

/**
 * 导入计量点数据 (Excel)
 */
export const importMpData = async (file: File): Promise<{ data: ImportResult }> => {
    const formData = new FormData();
    formData.append('file', file);
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
