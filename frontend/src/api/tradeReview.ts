import apiClient from './client';
import {
    OperationDetailResponse,
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
    fetchOperationDetail: (tradeDate: string, deliveryDate: string, operationId: string) =>
        apiClient.get<OperationDetailResponse>('/api/v1/trade-review/operation-detail', {
            params: { trade_date: tradeDate, delivery_date: deliveryDate, operation_id: operationId },
        }),
};
