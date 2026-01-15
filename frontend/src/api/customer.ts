import apiClient from './client';

/**
 * 客户档案管理 API 接口定义 (v2)
 * 对应后端 webapp/models/customer.py
 */

// ==================== 标签相关类型 ====================

export interface Tag {
  name: string;
  source: 'AUTO' | 'MANUAL';
  expire?: string | null;  // ISO日期字符串
  reason?: string | null;
}

// ==================== 户号与资产类型 (v2 结构) ====================

export interface Meter {
  meter_id: string;
  multiplier: number;
  allocation_ratio?: number | null;  // 0-1.0，空表示未校验
}

export interface MeteringPoint {
  mp_no: string;
  mp_name?: string | null;
}

export interface Account {
  account_id: string;
  meters: Meter[];
  metering_points: MeteringPoint[];
}

// 兼容旧代码的别名
export type UtilityAccount = Account;

// ==================== 地理位置类型 ====================

export interface GeoLocation {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

// ==================== 客户类型 (v2) ====================

export interface Customer {
  id: string;
  user_name: string;
  short_name: string;
  location?: string | null;  // 气象区域名称
  source?: string | null;    // 客户来源
  manager?: string | null;   // 客户经理
  accounts: Account[];
  tags: Tag[];
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface CustomerCreate {
  user_name: string;
  short_name: string;
  location?: string | null;
  source?: string | null;
  manager?: string | null;
  accounts?: Account[];
  tags?: Tag[];
}

export interface CustomerUpdate {
  user_name?: string;
  short_name?: string;
  location?: string | null;
  source?: string | null;
  manager?: string | null;
  accounts?: Account[];
  tags?: Tag[];
}

// ==================== 列表与响应类型 ====================

export interface CustomerListItem {
  id: string;
  user_name: string;
  short_name?: string | null;
  location?: string | null;
  tags: Tag[];
  account_count: number;
  meter_count: number;
  mp_count: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerListParams {
  keyword?: string;
  tags?: string[];  // 按标签筛选 (OR逻辑)
  page?: number;
  page_size?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ==================== API 函数 ====================

/**
 * 获取客户列表
 */
export const getCustomers = (params?: CustomerListParams) => {
  return apiClient.get<PaginatedResponse<CustomerListItem>>('/api/v1/customers', { params });
};

/**
 * 获取客户详情
 */
export const getCustomer = (customerId: string) => {
  return apiClient.get<Customer>(`/api/v1/customers/${customerId}`);
};

/**
 * 创建新客户
 */
export const createCustomer = (customerData: CustomerCreate) => {
  return apiClient.post<Customer>('/api/v1/customers', customerData);
};

/**
 * 更新客户信息
 */
export const updateCustomer = (customerId: string, customerData: CustomerUpdate) => {
  return apiClient.put<Customer>(`/api/v1/customers/${customerId}`, customerData);
};

/**
 * 删除客户 (需密码确认)
 */
export const deleteCustomer = (customerId: string, password: string) => {
  return apiClient.delete(`/api/v1/customers/${customerId}`, {
    data: { password }
  });
};

// ==================== 标签管理 API ====================

export interface CustomerTag {
  _id?: string;
  name: string;
  category?: string;  // 标签分类: 风险、用电特性、客户管理等
  description?: string;
}

/**
 * 获取所有可用标签 (从 customer_tags 集合)
 */
export const getCustomerTags = () => {
  return apiClient.get<CustomerTag[]>('/api/v1/customer-tags');
};

/**
 * 创建新标签
 */
export const createCustomerTag = (tag: { name: string; category?: string }) => {
  return apiClient.post<CustomerTag>('/api/v1/customer-tags', tag);
};

// ==================== 气象区域 API (复用 weather 模块) ====================

export interface WeatherLocation {
  _id?: string;
  name: string;
  code: string;
  latitude: number;
  longitude: number;
  enabled: boolean;
}

/**
 * 获取所有气象区域
 */
export const getWeatherLocations = () => {
  return apiClient.get<WeatherLocation[]>('/api/v1/weather/locations');
};

// ==================== 关联合同查询 ====================

export interface RetailContract {
  _id: string;
  contract_name: string;
  package_name?: string;
  start_date: string;
  end_date: string;
  contracted_quantity?: number;  // 签约电量 (kWh)
}

/**
 * 获取客户关联的零售合同
 */
export const getCustomerContracts = (customerId: string) => {
  return apiClient.get<RetailContract[]>(`/api/v1/customers/${customerId}/contracts`);
};

// ==================== 数据同步 API ====================

export interface SyncCandidate {
  mp_no: string;
  customer_name: string;
  account_id: string;
}

export interface SyncRequest {
  candidates: SyncCandidate[];
}

/**
 * 预览待同步数据
 */
export const getSyncPreview = () => {
  return apiClient.get<SyncCandidate[]>('/api/v1/customers/sync-preview');
};

/**
 * 批量同步客户数据
 */
export const syncCustomers = (candidates: SyncCandidate[]) => {
  return apiClient.post<{ created: number; updated: number }>('/api/v1/customers/sync', { candidates });
};

// ==================== 客户来源选项 ====================

export const CUSTOMER_SOURCES = [
  '自营开发',
  '居间代理A',
  '居间代理B',
  '居间代理C',
  '其他'
];

// ==================== 导出 ====================

export default {
  // 基础CRUD
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,

  // 标签管理
  getCustomerTags,
  createCustomerTag,

  // 气象区域
  getWeatherLocations,

  // 关联合同
  getCustomerContracts,

  // 数据同步
  getSyncPreview,
  syncCustomers,

  // 常量
  CUSTOMER_SOURCES
};