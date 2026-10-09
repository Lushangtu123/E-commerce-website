/** The shared API client: one axios instance that checks and records the session of every request. */
import axios, { type AxiosRequestConfig } from 'axios';
import { SESSION_KEY, storedSessionId, useAuthStore } from '@/store/useAuthStore';
import { ADMIN_SESSION_KEY, clearAdminSession } from '@/lib/admin-session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  // The customer session travels in an httpOnly cookie. The header tells the API a write came
  // from this site's scripts, which a cross-site form cannot claim.
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

/** The sign-in a request was sent for, so a late 401 cannot sign out a newer one. */
const requestSessions = new WeakMap<object, string | null>();

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
  // Clearing an uncertain cookie needs no valid sign-in, including after storage identity changed.
  if (path === '/users/logout' && config.method?.toLowerCase() === 'post') return null;
  // Categories are a public read shared by the storefront and admin editor.
  // Keep this exception exact and read-only; protected customer calls still
  // require their hydrated identity to match browser storage.
  if (path === '/products/categories' && config.method?.toLowerCase() === 'get') return null;
  if ((path === '/payments/settings' || path === '/users/password/capabilities') && config.method?.toLowerCase() === 'get') return null;
  if ((path === '/users/password/forgot' || path === '/users/password/reset') && config.method?.toLowerCase() === 'post') return null;
  return path === '/admin' || path.startsWith('/admin/') ? 'admin' : 'customer';
};

// 请求拦截器：核对会话，记录请求所属的登录
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const identity = getRequestIdentity(config);
      if (identity === 'customer') {
        const auth = useAuthStore.getState();
        const sessionId = storedSessionId();
        // Another tab signed in or out: the cookie may no longer belong to the account this tab shows.
        if (auth.isHydrated && auth.sessionId !== sessionId) throw new Error('登录状态已变化，请刷新后重试');
        requestSessions.set(config, sessionId);
      }
      // The raw stored id, so a 401 can also clear a stored session whose profile is unreadable.
      if (identity === 'admin') requestSessions.set(config, localStorage.getItem(ADMIN_SESSION_KEY));
      // Both sessions travel in httpOnly cookies; a caller's header must not override them.
      config.headers.delete('Authorization');
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
            if (identity === 'admin') {
              const currentSession = localStorage.getItem(ADMIN_SESSION_KEY);
              // Only the sign-in this request was sent for may be ended by its 401.
              if (currentSession && requestSessions.get(config) !== currentSession) return Promise.reject(error);
              if (!clearAdminSession(currentSession)) return Promise.reject(error);
            } else {
              const currentSession = storedSessionId();
              // Only the sign-in this request was sent for may be ended by its 401.
              if (currentSession && requestSessions.get(config) !== currentSession) return Promise.reject(error);
              localStorage.removeItem(SESSION_KEY);
              localStorage.removeItem('user');
            }
            window.location.href = identity === 'admin' ? '/admin/login' : '/login';
          }
        } catch {
          // Preserve the HTTP error if storage is unavailable; do not clear a
          // session that cannot be compared with this request.
          return Promise.reject(error);
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
