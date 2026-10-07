import type { CartItem } from '@/store/useCartStore';
import api from './client';
import type { Money } from './catalog';

// 购物车相关API
export interface CartInput {
  product_id: number;
  quantity: number;
  sku_id?: number;
}

export const cartApi = {
  list: () => api.get<unknown, { items: CartItem[] }>('/cart'),
  add: (data: CartInput) => api.post('/cart', data),
  updateQuantity: (data: CartInput) => api.put('/cart', data),
  remove: (productId: number, skuId?: number | null) =>
    api.delete(`/cart/${productId}`, { params: skuId == null ? undefined : { sku_id: skuId } }),
  clear: () => api.delete('/cart'),
};

// 订单相关API
export interface OrderInput {
  items: CartInput[];
  user_coupon_id?: number;
}

export interface OrderCreateInput extends OrderInput {
  shipping_address_id: number;
  checkout_key: string;
}

export interface OrderPreview {
  original_amount: number;
  discount_amount: number;
  total_amount: number;
  coupon: { user_coupon_id: number; name: string; code: string } | null;
  available_coupons: { user_coupon_id: number; name: string; code: string; discount_amount: number }[];
}

export interface AddressSnapshot {
  receiver_name: string;
  phone: string;
  province: string | null;
  city: string | null;
  district: string | null;
  detail_address: string | null;
}

export interface Order {
  order_id: number;
  order_no: string;
  total_amount: Money;
  original_amount?: Money | null;
  discount_amount?: Money | null;
  user_coupon_id?: number | null;
  coupon_name?: string | null;
  coupon_code?: string | null;
  status: number;
  payment_method?: string | null;
  shipping_company?: string | null;
  tracking_number?: string | null;
  shipping_address_snapshot?: AddressSnapshot | null;
  created_at: string;
  paid_at?: string | null;
  shipped_at?: string | null;
  completed_at?: string | null;
}

export interface OrderItem {
  item_id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  product_image?: string | null;
  sku_id?: number | null;
  sku_code?: string | null;
  sku_specs?: Record<string, string | number | boolean> | null;
  quantity: number;
  price: Money;
}

export const orderApi = {
  preview: (data: OrderInput) => api.post<unknown, OrderPreview>('/orders/preview', data),
  create: (data: OrderCreateInput) => api.post<unknown, { message: string; order_id: number }>('/orders', data),
  list: (params?: object) => api.get<unknown, { orders: Order[]; total: number; page: number; limit: number; totalPages: number }>('/orders', { params }),
  getDetail: (id: number) => api.get<unknown, { order: Order; items: OrderItem[] }>(`/orders/${id}`),
  cancel: (id: number) => api.post(`/orders/${id}/cancel`),
  pay: (id: number) => api.post(`/orders/${id}/pay`),
  confirm: (id: number) => api.post(`/orders/${id}/confirm`),
};

export interface PaymentSettings { mode: 'disabled' | 'demo'; canPay: boolean; isDemo: boolean }
export const paymentApi = { getSettings: () => api.get<unknown, PaymentSettings>('/payments/settings') };

export interface AfterSalesRequest {
  request_id: number; order_id: number; order_no?: string; username?: string;
  type: 'refund' | 'return'; reason: string; status: 'requested' | 'approved' | 'rejected' | 'withdrawn';
  review_note?: string | null; created_at?: string; reviewed_at?: string | null;
}
export const afterSalesApi = {
  get: (orderId: number) => api.get<unknown, { after_sales: AfterSalesRequest | null }>(`/orders/${orderId}/after-sales`),
  create: (orderId: number, data: { type: 'refund' | 'return'; reason: string }) => api.post<unknown, { after_sales: AfterSalesRequest }>(`/orders/${orderId}/after-sales`, data),
  withdraw: (orderId: number) => api.post<unknown, { after_sales: AfterSalesRequest }>(`/orders/${orderId}/after-sales/withdraw`),
  list: (params: { page: number; limit: number; status?: string }) => api.get<unknown, { requests: AfterSalesRequest[]; pagination: { total: number; totalPages: number } }>('/admin/after-sales', { params }),
  review: (id: number, data: { status: 'approved' | 'rejected'; note: string }) => api.post(`/admin/after-sales/${id}/review`, data),
};

// 订单超时相关API
export const orderTimeoutApi = {
  // 获取订单剩余支付时间
  getRemainingTime: (orderId: number) =>
    api.get<unknown, { remaining_minutes: number; timeout_at?: string; message?: string }>(`/orders/${orderId}/remaining-time`),
};

// 优惠券相关API
export const couponApi = {
  // 获取可领取的优惠券列表
  getAvailable: (page = 1, pageSize = 20) =>
    api.get('/coupons/available', { params: { page, page_size: pageSize } }),
  
  // 领取优惠券
  receive: (code: string) =>
    api.post('/coupons/receive', { code }),
  
  // 获取我的优惠券
  getMyCoupons: (status?: number) =>
    api.get('/coupons/my/list', { params: { status } }),
  
  // 获取订单可用优惠券
  getAvailableForOrder: (amount: number) =>
    api.get('/coupons/my/available-for-order', { params: { amount } }),
  
  // 计算优惠金额
  calculateDiscount: (userCouponId: number, orderAmount: number) =>
    api.post('/coupons/calculate', { user_coupon_id: userCouponId, order_amount: orderAmount }),
};
