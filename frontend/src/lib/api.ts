import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加token
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理错误
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // token过期或未登录
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
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
export const cartApi = {
  list: () => api.get('/cart'),
  add: (data: { product_id: number; quantity: number }) => api.post('/cart', data),
  updateQuantity: (data: { product_id: number; quantity: number }) => api.put('/cart', data),
  remove: (productId: number) => api.delete(`/cart/${productId}`),
  clear: () => api.delete('/cart'),
};

// 订单相关API
export const orderApi = {
  create: (data: any) => api.post('/orders', data),
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

