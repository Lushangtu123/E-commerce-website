import axios, { type AxiosRequestConfig } from 'axios';
import { useAuthStore, type User } from '@/store/useAuthStore';
import { clearAdminSession } from '@/lib/admin-session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

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
  // Invalid credentials are form errors. These exact entry routes neither use
  // an existing session nor invalidate one when a sign-in attempt fails.
  if (config.method?.toLowerCase() === 'post' && ['/users/login', '/users/register', '/admin/login'].includes(path)) return null;
  // Categories are a public read shared by the storefront and admin editor.
  // Keep this exception exact and read-only; protected customer calls still
  // require their hydrated identity to match browser storage.
  if (path === '/products/categories' && config.method?.toLowerCase() === 'get') return null;
  if ((path === '/payments/settings' || path === '/users/password/capabilities') && config.method?.toLowerCase() === 'get') return null;
  if ((path === '/users/password/forgot' || path === '/users/password/reset') && config.method?.toLowerCase() === 'post') return null;
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
        try {
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
            if (isAdmin) {
              if (!clearAdminSession(currentToken)) return Promise.reject(error);
            } else {
              localStorage.removeItem(tokenKey);
              localStorage.removeItem('user');
            }
            window.location.href = isAdmin ? '/admin/login' : '/login';
          }
        } catch {
          // Preserve the HTTP error if storage is unavailable; do not clear a
          // session whose current token cannot be compared with this request.
          return Promise.reject(error);
        }
      }
    }
    return Promise.reject(error);
  }
);

// 用户相关API
export interface UserStats {
  totalOrders: number;
  pendingOrders: number;
  totalCoupons: number;
  availableCoupons: number;
  favoriteCount: number;
}

export interface ProfileInput {
  username: string;
  phone: string | null;
  avatar_url: string | null;
}

export const userApi = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post('/users/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/users/login', data),
  getProfile: () => api.get<unknown, { user: User }>('/users/profile'),
  getStats: () => api.get<unknown, { stats: UserStats }>('/users/stats'),
  updateProfile: (data: ProfileInput) => api.put<unknown, { message: string; user: User }>('/users/profile', data),
  passwordCapabilities: () => api.get<unknown, { passwordResetAvailable: boolean; passwordMinLength: number; passwordMaxBytes: number }>('/users/password/capabilities'),
  forgotPassword: (email: string) => api.post<unknown, { message: string }>('/users/password/forgot', { email }),
  resetPassword: (data: { token: string; newPassword: string }) => api.post('/users/password/reset', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) => api.put('/users/password', data),
};

// 商品相关API
export const productApi = {
  list: (params?: object) => api.get('/products', { params }),
  getDetail: (id: number) => api.get(`/products/${id}`),
  getHotProducts: (limit?: number) => api.get('/products/hot', { params: { limit } }),
};

export interface AdminSKU {
  sku_id: number;
  product_id: number;
  sku_code: string;
  specs: Record<string, string | number | boolean>;
  price: number | string;
  original_price?: number | string | null;
  stock: number;
  image?: string | null;
  status: 0 | 1;
}
export interface AdminSKUInput {
  sku_code: string;
  specs: Record<string, string | number | boolean>;
  price: number;
  original_price: number | null;
  stock: number;
  image: string | null;
  status: 0 | 1;
}
export interface AdminSKUList {
  product: { product_id: number; title: string; status: number };
  skus: AdminSKU[];
}
export const adminSKUApi = {
  list: (productId: number) => api.get<unknown, AdminSKUList>(`/admin/products/${productId}/skus`),
  create: (productId: number, data: AdminSKUInput) => api.post<unknown, { sku_id: number }>(`/admin/products/${productId}/skus`, data),
  update: (productId: number, skuId: number, data: Partial<AdminSKUInput>) => api.put(`/admin/products/${productId}/skus/${skuId}`, data),
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
  list: () => api.get<unknown, { addresses: ShippingAddress[] }>('/addresses'),
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
  preview: (data: OrderInput) => api.post<unknown, OrderPreview>('/orders/preview', data),
  create: (data: OrderCreateInput) => api.post('/orders', data),
  list: (params?: object) => api.get('/orders', { params }),
  getDetail: (id: number) => api.get(`/orders/${id}`),
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

// 评论相关API
export interface PurchaseReview {
  review_id: number;
  product_id: number;
  order_id: number;
  user_id: number;
  rating: number;
  content?: string | null;
  created_at?: string;
}

export const reviewApi = {
  create: (data: { product_id: number; order_id: number; rating: number; content?: string; images?: string[] }) =>
    api.post<unknown, { review_id: number; message: string }>('/reviews', data),
  listByProduct: (productId: number, params?: object) =>
    api.get(`/reviews/product/${productId}`, { params }),
  listByUser: (params?: { page?: number; limit?: number; order_id?: number }) =>
    api.get<unknown, { reviews: PurchaseReview[]; totalPages: number }>('/reviews/my', { params }),
};

// 收藏相关API
export const favoriteApi = {
  add: (productId: number) => api.post('/favorites', { product_id: productId }),
  remove: (productId: number) => api.delete(`/favorites/${productId}`),
  toggle: (productId: number) => api.post('/favorites/toggle', { product_id: productId }),
  check: (productId: number) => api.get(`/favorites/check/${productId}`),
  checkMultiple: (productIds: number[]) => api.post('/favorites/check-multiple', { product_ids: productIds }),
  list: (params?: object) => api.get('/favorites/my', { params }),
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
  getHistory: (params?: object) => api.get('/browse/history', { params }),
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
