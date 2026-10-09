import api from './client';
import type { Money, Product } from './catalog';
import type { Order, Coupon, CouponPagination } from './orders';
import type { SpecTranslations } from '@/lib/product-content';
import { adminSessionLogout, adminSignIn, type AdminAuthAttempt, type AdminAuthResult } from '@/lib/admin-auth-flow';

// 管理后台
export interface AdminSKU {
  sku_id: number;
  product_id: number;
  sku_code: string;
  specs: Record<string, string | number | boolean>;
  specs_en?: SpecTranslations | null;
  price: number | string;
  original_price?: number | string | null;
  stock: number;
  image?: string | null;
  status: 0 | 1;
}
export interface AdminSKUInput {
  sku_code: string;
  specs: Record<string, string | number | boolean>;
  specs_en?: SpecTranslations | null;
  price: number;
  original_price: number | null;
  stock: number;
  image: string | null;
  status: 0 | 1;
}
export interface AdminSKUList {
  product: { product_id: number; title: string; title_en?: string | null; status: number };
  skus: AdminSKU[];
}
export const adminApi = {
  login: (data: { username: string; password: string }, attempt: AdminAuthAttempt) => adminSignIn(async () => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/admin/login`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error('Administrator sign-in rejected'), { response: { status: response.status, data: result } });
    return result as AdminAuthResult;
  }, () => api.post('/admin/logout'), attempt),
  /** Clears the administrator's httpOnly session cookie; works after the session has expired too. */
  logout: () => adminSessionLogout(() => api.post('/admin/logout')),
};

export const adminSKUApi = {
  list: (productId: number) => api.get<unknown, AdminSKUList>(`/admin/products/${productId}/skus`),
  create: (productId: number, data: AdminSKUInput) => api.post<unknown, { sku_id: number }>(`/admin/products/${productId}/skus`, data),
  update: (productId: number, skuId: number, data: Partial<AdminSKUInput>) => api.put(`/admin/products/${productId}/skus/${skuId}`, data),
};

export interface AdminPage {
  pagination?: { page?: number; limit?: number; total?: number; totalPages?: number };
}
export interface Category { category_id: number; name: string }
export interface AdminProductRow extends Product { category_id: number | null; status: number }
export interface AdminOrderRow extends Order { username?: string | null; item_count?: number }
export interface AdminUserRow {
  user_id: number;
  username: string;
  email: string;
  phone?: string | null;
  status: number;
  created_at: string;
  updated_at?: string | null;
  order_count?: number;
  total_spent?: Money | null;
}
export interface AdminUserAddress {
  address_id: number;
  user_id?: number;
  receiver_name: string;
  phone: string;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  detail_address?: string | null;
  is_default?: boolean | 0 | 1;
}
export interface AdminUserDetail {
  user: AdminUserRow;
  recent_orders: RecentOrder[];
  addresses: AdminUserAddress[];
}
export interface AdminUserOrders extends AdminPage { orders: AdminOrderRow[] }
export const adminUserApi = {
  detail: (userId: number) => api.get<unknown, unknown>(`/admin/users/${userId}`),
  orders: (userId: number, page = 1) => api.get<unknown, unknown>(`/admin/users/${userId}/orders`, { params: { page, limit: 10 } }),
};
export interface AdminLog {
  log_id: number;
  action: string;
  description?: string | null;
  ip_address?: string | null;
  created_at: string;
  username?: string | null;
  real_name?: string | null;
}
export interface DashboardStats {
  today_orders: number;
  today_revenue: number;
  new_users: number;
  pending_orders: number;
  total_products: number;
  active_products: number;
  order_growth: number;
  revenue_growth: number;
}
/** Dashboard lists come back as bare arrays; SUM() columns are DECIMAL strings. */
export interface RecentOrder { order_id: number; order_no: string; total_amount: Money; status: number; created_at: string; username?: string | null }
export interface TopProduct { product_id: number; title: string; title_en?: string | null; order_count?: number; total_sales: Money; total_revenue: Money }
export interface SalesTrendPoint { date: string; order_count: number; revenue: Money | null }

// 管理员优惠券API
export interface AdminCoupon extends Coupon { received_count: number; used_count: number }
export interface AdminCouponPage { data: AdminCoupon[]; pagination?: CouponPagination }
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
    api.get<unknown, AdminCouponPage>('/admin/coupons', { params: { page, page_size: pageSize, status } }),
  
  // 获取优惠券详情
  getDetail: (id: number) =>
    api.get(`/admin/coupons/${id}`),

  getByCode: (code: string) =>
    api.get<unknown, unknown>(`/admin/coupons/by-code/${encodeURIComponent(code)}`),
  
  // 更新优惠券状态
  updateStatus: (id: number, status: number) =>
    api.put(`/admin/coupons/${id}/status`, { status }),
};
