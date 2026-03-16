import apiClient from './client';
import {
    BatchDetailResponse,
    TradeDateListResponse,
    TradeDetailResponse,
    TradeOverviewResponse,
} from '../types/tradeReview';

export const tradeReviewApi = {
    fetchTradeDates: () => apiClient.get<TradeDateListResponse>('/api/v1/trade-review/trade-dates'),
    fetchTradeOverview: (tradeDate: string) =>
        apiClient.get<TradeOverviewResponse>('/api/v1/trade-review/overview', {
            params: { trade_date: tradeDate },
        }),
    fetchTradeDetail: (tradeDate: string, deliveryDate: string) =>
        apiClient.get<TradeDetailResponse>('/api/v1/trade-review/detail', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate },
        }),
    fetchBatchDetail: (tradeDate: string, deliveryDate: string, batchId: string) =>
        apiClient.get<BatchDetailResponse>('/api/v1/trade-review/batch-detail', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate, batch_id: batchId },
        }),
};
