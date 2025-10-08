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

export default api;

