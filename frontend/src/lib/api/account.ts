import type { User } from '@/store/useAuthStore';
import api from './client';
import { customerSessionLogout, customerAccountWrite, customerSessionWrite, customerSignIn, type CustomerAuthAttempt } from '@/lib/customer-auth-flow';

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

export interface AuthSession {
  message?: string;
  user: User;
}

export const userApi = {
  register: (data: { username: string; email: string; password: string }, attempt?: CustomerAuthAttempt) =>
    customerSignIn(() => api.post<unknown, AuthSession>('/users/register', data), () => api.post('/users/logout'), attempt),
  login: (data: { email: string; password: string }, attempt?: CustomerAuthAttempt) =>
    customerSignIn(() => api.post<unknown, AuthSession>('/users/login', data), () => api.post('/users/logout'), attempt),
  /** Clears the httpOnly session cookie; the API needs no valid session to do so. */
  logout: () => customerSessionLogout(() => api.post('/users/logout')),
  getProfile: () => api.get<unknown, { user: User }>('/users/profile'),
  getStats: () => api.get<unknown, { stats: UserStats }>('/users/stats'),
  updateProfile: (data: ProfileInput) => api.put<unknown, { message: string; user: User }>('/users/profile', data),
  passwordCapabilities: () => api.get<unknown, { passwordResetAvailable: boolean; passwordMinLength: number; passwordMaxBytes: number }>('/users/password/capabilities'),
  forgotPassword: (email: string) => api.post<unknown, { message: string }>('/users/password/forgot', { email }),
  resetPassword: (data: { token: string; newPassword: string }) => customerSessionWrite(() => api.post('/users/password/reset', data)),
  changePassword: (data: { currentPassword: string; newPassword: string }, stillInvoked?: () => boolean) =>
    customerAccountWrite(() => api.put('/users/password', data), stillInvoked),
};

// 收货地址相关API
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

export interface AddressCreationInput extends AddressInput { create_key?: string }
export interface AddressCreationResult {
  address_id: number;
  creation_status: 'created' | 'replayed' | 'deleted';
  message?: string;
}

export const addressApi = {
  list: () => api.get<unknown, { addresses: ShippingAddress[] }>('/addresses'),
  create: (data: AddressCreationInput) => api.post<unknown, AddressCreationResult>('/addresses', data),
  update: (addressId: number, data: AddressInput) => api.put(`/addresses/${addressId}`, data),
  setDefault: (addressId: number) => api.put(`/addresses/${addressId}/default`, {}),
  remove: (addressId: number) => api.delete(`/addresses/${addressId}`),
};
