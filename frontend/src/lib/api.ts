import axios, { type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/useAuthStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const getRequestIdentity = (config: AxiosRequestConfig) => {
  const requestUrl = new URL(axios.getUri(config), window.location.origin);
  const apiUrl = new URL(API_URL, window.location.origin);
  if (requestUrl.origin !== apiUrl.origin) return null;

  const pathname = requestUrl.pathname;
  const apiPath = apiUrl.pathname.replace(/\/$/, '');
  const path = pathname.startsWith(`${apiPath}/`) ? pathname.slice(apiPath.length) : pathname;
  return path === '/admin' || path.startsWith('/admin/') ? 'admin' : 'customer';
};

// 请求拦截器 - 添加token
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const identity = getRequestIdentity(config);
      const token = identity ? localStorage.getItem(identity === 'admin' ? 'admin_token' : 'token') : null;
      if (identity === 'customer') {
        const auth = useAuthStore.getState();
        if (auth.isHydrated && auth.token !== token) throw new Error('登录状态已变化，请刷新后重试');
      }
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers.delete('Authorization');
      }
    }
    return config;
  },
  (error) => {
    throw error;
  },
  { synchronous: true }
);

// 响应拦截器 - 处理错误
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // token过期或未登录
      if (typeof window !== 'undefined') {
        const config = error.config || error.response.config || {};
        const identity = getRequestIdentity(config);
        if (identity) {
          const isAdmin = identity === 'admin';
          const tokenKey = isAdmin ? 'admin_token' : 'token';
          const currentToken = localStorage.getItem(tokenKey);
          const requestAuthorization = axios.AxiosHeaders.from(config.headers).get('Authorization');
          if (currentToken && requestAuthorization !== `Bearer ${currentToken}`) {
            return Promise.reject(error);
          }
          localStorage.removeItem(tokenKey);
          localStorage.removeItem(isAdmin ? 'admin_user' : 'user');
          window.location.href = isAdmin ? '/admin/login' : '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// 用户相关API
export const userApi = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post('/users/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/users/login', data),
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data: any) => api.put('/users/profile', data),
};

// 商品相关API
export const productApi = {
  list: (params?: any) => api.get('/products', { params }),
  getDetail: (id: number) => api.get(`/products/${id}`),
  getHotProducts: (limit?: number) => api.get('/products/hot', { params: { limit } }),
};

// 购物车相关API
export interface CartInput {
  product_id: number;
  quantity: number;
  sku_id?: number;
}

export const cartApi = {
  list: () => api.get('/cart'),
  add: (data: CartInput) => api.post('/cart', data),
  updateQuantity: (data: CartInput) => api.put('/cart', data),
  remove: (productId: number, skuId?: number | null) =>
    api.delete(`/cart/${productId}`, { params: skuId == null ? undefined : { sku_id: skuId } }),
  clear: () => api.delete('/cart'),
};

// 订单相关API
export interface AddressInput {
  receiver_name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail_address: string;
  is_default?: boolean;
}

export interface ShippingAddress extends Omit<AddressInput, 'is_default' | 'province' | 'city' | 'district' | 'detail_address'> {
  address_id: number;
  is_default?: boolean | 0 | 1;
  province: string | null;
  city: string | null;
  district: string | null;
  detail_address: string | null;
}

export const addressApi = {
  list: () => api.get<any, { addresses: ShippingAddress[] }>('/addresses'),
  create: (data: AddressInput) => api.post('/addresses', data),
  update: (addressId: number, data: AddressInput) => api.put(`/addresses/${addressId}`, data),
  remove: (addressId: number) => api.delete(`/addresses/${addressId}`),
};

export interface OrderInput {
  items: CartInput[];
  user_coupon_id?: number;
}

export interface OrderCreateInput extends OrderInput {
  shipping_address_id: number;
}

export interface OrderPreview {
  original_amount: number;
  discount_amount: number;
  total_amount: number;
  coupon: { user_coupon_id: number; name: string; code: string } | null;
  available_coupons: { user_coupon_id: number; name: string; code: string; discount_amount: number }[];
}

export const orderApi = {
  preview: (data: OrderInput) => api.post<any, OrderPreview>('/orders/preview', data),
  create: (data: OrderCreateInput) => api.post('/orders', data),
  list: (params?: any) => api.get('/orders', { params }),
  getDetail: (id: number) => api.get(`/orders/${id}`),
  cancel: (id: number) => api.post(`/orders/${id}/cancel`),
  pay: (id: number) => api.post(`/orders/${id}/pay`),
  confirm: (id: number) => api.post(`/orders/${id}/confirm`),
};

// 评论相关API
export const reviewApi = {
  create: (data: any) => api.post('/reviews', data),
  listByProduct: (productId: number, params?: any) =>
    api.get(`/reviews/product/${productId}`, { params }),
  listByUser: (params?: any) => api.get('/reviews/my', { params }),
};

// 收藏相关API
export const favoriteApi = {
  add: (productId: number) => api.post('/favorites', { product_id: productId }),
  remove: (productId: number) => api.delete(`/favorites/${productId}`),
  toggle: (productId: number) => api.post('/favorites/toggle', { product_id: productId }),
  check: (productId: number) => api.get(`/favorites/check/${productId}`),
  checkMultiple: (productIds: number[]) => api.post('/favorites/check-multiple', { product_ids: productIds }),
  list: (params?: any) => api.get('/favorites/my', { params }),
  getCount: () => api.get('/favorites/count'),
};

// 搜索相关API
export const searchApi = {
  record: (keyword: string, resultCount?: number) => api.post('/search/record', { keyword, result_count: resultCount }),
  getHistory: (limit?: number) => api.get('/search/history', { params: { limit } }),
  getHot: (days?: number, limit?: number) => api.get('/search/hot', { params: { days, limit } }),
  getSuggestions: (keyword: string, limit?: number) => api.get('/search/suggestions', { params: { keyword, limit } }),
  clearHistory: () => api.delete('/search/history'),
  deleteKeyword: (keyword: string) => api.delete(`/search/history/${encodeURIComponent(keyword)}`),
};

// 浏览历史相关API
export const browseApi = {
  record: (productId: number) => api.post('/browse/record', { product_id: productId }),
  getHistory: (params?: any) => api.get('/browse/history', { params }),
  clearHistory: () => api.delete('/browse/history'),
  deleteRecord: (productId: number) => api.delete(`/browse/history/${productId}`),
};

// 推荐相关API
export const recommendationApi = {
  // 个性化推荐（需要登录）
  getPersonalized: (limit?: number) => 
    api.get('/recommendations/personalized', { params: { limit } }),
  
  // 相关商品推荐
  getRelated: (productId: number, limit?: number) => 
    api.get(`/recommendations/related/${productId}`, { params: { limit } }),
  
  // 猜你喜欢（可选登录）
  getGuessYouLike: (limit?: number) => 
    api.get('/recommendations/guess-you-like', { params: { limit } }),
};

// 订单超时相关API
export const orderTimeoutApi = {
  // 获取订单剩余支付时间
  getRemainingTime: (orderId: number) => 
    api.get(`/orders/${orderId}/remaining-time`),
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

// 管理员优惠券API
export const adminCouponApi = {
  // 创建优惠券
  create: (data: {
    code: string;
    name: string;
    description?: string;
    type: number;
    discount_value: number;
    min_amount?: number;
    max_discount?: number;
    total_quantity: number;
    per_user_limit?: number;
    start_time: string;
    end_time: string;
  }) => api.post('/admin/coupons', data),
  
  // 获取优惠券列表
  getList: (page = 1, pageSize = 20, status?: number) =>
    api.get('/admin/coupons', { params: { page, page_size: pageSize, status } }),
  
  // 获取优惠券详情
  getDetail: (id: number) =>
    api.get(`/admin/coupons/${id}`),
  
  // 更新优惠券状态
  updateStatus: (id: number, status: number) =>
    api.put(`/admin/coupons/${id}/status`, { status }),
};

export default api;
