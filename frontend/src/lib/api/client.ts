/** The shared API client: one axios instance that checks and records the session of every request. */
import axios, { type AxiosRequestConfig } from 'axios';
import { CUSTOMER_CLEANUP_KEY, SESSION_KEY, storedSessionId, useAuthStore } from '@/store/useAuthStore';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT, ADMIN_SESSION_KEY, adminSessionIsReady, clearAdminSession, getAdminSession } from '@/lib/admin-session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const EXPECTED_CUSTOMER_HEADER = 'X-Expected-Customer-Id';
const EXPECTED_ADMIN_HEADER = 'X-Expected-Admin-Id';

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
const dispatchedAdminRequests = new WeakSet<object>();

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
  // These responses are identical for every shopper. Browsing must also work when
  // storage is disabled; keep optional personalized reads and every write guarded.
  if (config.method?.toLowerCase() === 'get' && (
    ['/products', '/products/hot', '/search/hot', '/search/suggestions'].includes(path) ||
    /^\/products\/[1-9]\d*$/.test(path) || /^\/reviews\/product\/[1-9]\d*$/.test(path) ||
    /^\/recommendations\/related\/[1-9]\d*$/.test(path)
  )) return null;
  if ((path === '/payments/settings' || path === '/users/password/capabilities') && config.method?.toLowerCase() === 'get') return null;
  if ((path === '/users/password/forgot' || path === '/users/password/reset') && config.method?.toLowerCase() === 'post') return null;
  if (path === '/admin/logout' && config.method?.toLowerCase() === 'post') return 'admin-cleanup';
  return path === '/admin' || path.startsWith('/admin/') ? 'admin' : 'customer';
};

/** Preserve in-flight results while the same administrator is temporarily paused. */
const waitForAdminPublication = (config: AxiosRequestConfig) => {
  if (typeof window === 'undefined' || !dispatchedAdminRequests.has(config) || getRequestIdentity(config) !== 'admin') return null;
  const sessionId = requestSessions.get(config);
  const paused = () => {
    try { return localStorage.getItem(ADMIN_SESSION_KEY) === sessionId && !adminSessionIsReady(); }
    catch { return false; }
  };
  if (!paused()) return null;
  return new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADMIN_SESSION_EVENT, check);
      resolve();
    };
    const check = () => {
      if (timer !== undefined || paused()) return;
      // Cleanup can briefly clear the marker before a queued login sets it again.
      // Recheck next task, so callers never receive a result in that microtask gap.
      timer = setTimeout(() => { timer = undefined; if (!paused()) finish(); }, 0);
    };
    const onStorage = (event: StorageEvent) => {
      if ((event.storageArea === null || event.storageArea === localStorage) &&
          (event.key === null || event.key === ADMIN_SESSION_KEY || event.key === ADMIN_CLEANUP_KEY)) check();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADMIN_SESSION_EVENT, check);
    check();
  });
};

// 请求拦截器：核对会话，记录请求所属的登录
api.interceptors.request.use(
  (config) => {
    // Bind protected customer calls to this tab's profile; callers cannot select another account.
    config.headers.delete(EXPECTED_CUSTOMER_HEADER);
    config.headers.delete(EXPECTED_ADMIN_HEADER);
    if (typeof window !== 'undefined') {
      const identity = getRequestIdentity(config);
      if (identity === 'customer') {
        const auth = useAuthStore.getState();
        const sessionId = storedSessionId();
        // Another tab signed in or out: the cookie may no longer belong to the account this tab shows.
        if (localStorage.getItem(CUSTOMER_CLEANUP_KEY) === '1' || (auth.isHydrated && auth.sessionId !== sessionId)) {
          throw new Error('登录状态已变化，请刷新后重试');
        }
        if (auth.isHydrated && auth.isAuthenticated) {
          const userId = auth.user?.user_id;
          if (!Number.isSafeInteger(userId) || Number(userId) <= 0) throw new Error('登录状态已变化，请刷新后重试');
          // The cookie can change after this check. The API rejects a different authenticated customer.
          config.headers.set(EXPECTED_CUSTOMER_HEADER, String(userId));
        }
        requestSessions.set(config, sessionId);
      }
      if (identity === 'admin') {
        // Fail closed with the original storage error before checking the publication marker.
        requestSessions.set(config, localStorage.getItem(ADMIN_SESSION_KEY));
        if (!adminSessionIsReady()) throw new Error('登录状态已变化，请刷新后重试');
        const adminId = getAdminSession()?.admin.admin_id;
        // Legacy profiles without an ID still authenticate through the verified HttpOnly cookie.
        if (Number.isSafeInteger(adminId) && Number(adminId) > 0) config.headers.set(EXPECTED_ADMIN_HEADER, String(adminId));
        dispatchedAdminRequests.add(config);
      }
      // The raw stored id, so a 401 can also clear an unreadable profile, including cleanup requests.
      if (identity === 'admin-cleanup') requestSessions.set(config, localStorage.getItem(ADMIN_SESSION_KEY));
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
const rejectResponse = (error: unknown) => {
    const failure = error as { response?: { status?: number; config?: AxiosRequestConfig }; config?: AxiosRequestConfig };
    if (failure.response?.status === 401) {
      // token过期或未登录
      if (typeof window !== 'undefined') {
        try {
          const config = failure.config || failure.response.config || {};
          const identity = getRequestIdentity(config);
          if (identity) {
            if (identity === 'admin' || identity === 'admin-cleanup') {
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
            window.location.href = identity === 'admin' || identity === 'admin-cleanup' ? '/admin/login' : '/login';
          }
        } catch {
          // Preserve the HTTP error if storage is unavailable; do not clear a
          // session that cannot be compared with this request.
          return Promise.reject(error);
        }
      }
    }
    return Promise.reject(error);
};
api.interceptors.response.use(
  response => {
    const waiting = waitForAdminPublication(response.config);
    return waiting ? waiting.then(() => response.data) : response.data;
  },
  error => {
    const config = error.config || error.response?.config;
    const waiting = config && waitForAdminPublication(config);
    return waiting ? waiting.then(() => rejectResponse(error)) : rejectResponse(error);
  },
);

export default api;
