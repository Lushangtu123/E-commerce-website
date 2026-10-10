import type { AuthSession } from '@/lib/api/account';
import { requestFailure } from '@/lib/api-error';
import { CUSTOMER_CLEANUP_KEY, CustomerSessionPublicationError, storedSessionId, useAuthStore, type User } from '@/store/useAuthStore';

export interface CustomerAuthAttempt {
  current: () => boolean;
  /** Storage becoming unavailable may be reported, but never authorizes sending credentials. */
  reportable: () => boolean;
  forget: () => void;
  commit: (session: AuthSession) => void;
}

export class CustomerAuthAbandoned extends Error {}
export class CustomerAuthUnconfirmed extends Error {
  constructor(public readonly report: boolean, public readonly reason: 'unknown' | 'cleanup' | 'storage' = 'unknown') {
    super('Customer sign-in result is unconfirmed');
  }
}
export class CustomerSessionChanged extends Error {
  constructor() { super('登录状态已变化，请刷新后重试'); }
}

let writing = false;
const waiting: (() => void)[] = [];
let authRevision = 0;
let cleanupPending = false;

function needsCleanup() {
  return cleanupPending || (typeof window !== 'undefined' && localStorage.getItem(CUSTOMER_CLEANUP_KEY) === '1');
}

function recordCleanup(pending: boolean) {
  cleanupPending = pending;
  if (typeof window !== 'undefined') {
    if (pending) localStorage.setItem(CUSTOMER_CLEANUP_KEY, '1');
    else localStorage.removeItem(CUSTOMER_CLEANUP_KEY);
  }
}

/**
 * One customer cookie writer at a time, including response handling and abandoned-response cleanup.
 * Web Locks extend this ordering to cooperating tabs on the same origin; without them the queue
 * orders this tab only. Never abort an in-flight write: its Set-Cookie may already have arrived.
 */
function queueWrite<T>(write: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      writing = true;
      const run = async () => write();
      let answer: Promise<T>;
      try {
        answer = typeof navigator !== 'undefined' && navigator.locks?.request
          ? navigator.locks.request('customer-session-cookie', run).then(value => value) : run();
      } catch (error) { answer = Promise.reject(error); }
      const finish = () => {
        const next = waiting.shift();
        if (next) next();
        else writing = false;
      };
      answer.then(value => { resolve(value); finish(); }, error => { reject(error); finish(); });
    };
    if (writing) waiting.push(start);
    else start();
  });
}

/** Other customer cookie changes supersede an outstanding sign-in, even when already signed out. */
export function customerSessionWrite<T>(write: () => Promise<T>): Promise<T> {
  authRevision += 1;
  return queueWrite(write);
}

/** Bind account-scoped writes before waiting; the cookie may belong to another sign-in afterwards. */
export function customerAccountWrite<T>(write: () => Promise<T>, stillInvoked: () => boolean = () => true): Promise<T> {
  const { sessionId, user } = useAuthStore.getState();
  const userId = user?.user_id;
  const current = () => {
    try {
      const state = useAuthStore.getState();
      return stillInvoked() && state.isHydrated && state.isAuthenticated && !!sessionId &&
        Number.isSafeInteger(userId) && Number(userId) > 0 && state.sessionId === sessionId &&
        state.user?.user_id === userId && storedSessionId() === sessionId &&
        JSON.parse(localStorage.getItem('user') || 'null')?.user_id === userId;
    } catch { return false; }
  };
  if (!current()) return Promise.reject(new CustomerSessionChanged());
  return customerSessionWrite(async () => {
    if (!current()) throw new CustomerSessionChanged();
    return write();
  });
}

/** Called inside the queue; invoking the public queued logout here would deadlock. */
export async function clearCustomerCookie(clear: () => Promise<unknown>, canFinishCleanup: () => boolean = () => true): Promise<void> {
  try { recordCleanup(true); } catch { /* The in-memory marker remains set; always try server cleanup. */ }
  const value = await clear();
  if (!value || typeof value !== 'object' || !('message' in value) || value.message !== '已退出登录') {
    throw new Error('Invalid customer logout acknowledgement');
  }
  // A confirmed server logout can still leave a local profile that is unsafe to restore.
  // Keep the marker if its final check fails or cannot read browser storage.
  if (canFinishCleanup()) recordCleanup(false);
}

/** Remember logout before a Web Lock or earlier cookie writer makes it wait. */
export function customerSessionLogout(clear: () => Promise<unknown>): Promise<{ message: string }> {
  try { recordCleanup(true); } catch { /* Cleanup must still run when storage is denied. */ }
  return customerSessionWrite(async () => {
    await clearCustomerCookie(clear, () => !!useAuthStore.getState().sessionId || !storedSessionId() || !localStorage.getItem('user'));
    return { message: '已退出登录' };
  });
}

/** Snapshot both this tab and browser storage; a later session can never inherit this submission. */
export function customerAuthAttempt(alive: () => boolean, commit: (session: AuthSession) => void): CustomerAuthAttempt {
  const state = useAuthStore.getState();
  const sessionId = state.sessionId, userId = state.user?.user_id ?? null, revision = authRevision;
  let storedId: string | null, storedUserId: number | null;
  try { storedId = storedSessionId(); storedUserId = JSON.parse(localStorage.getItem('user') || 'null')?.user_id ?? null; }
  catch { throw new CustomerAuthUnconfirmed(true, 'cleanup'); }
  const sameIdentity = (allowUnavailableStorage = false) => {
    const current = useAuthStore.getState();
    if (current.sessionId !== sessionId || (current.user?.user_id ?? null) !== userId) return false;
    try {
      return storedSessionId() === storedId && (JSON.parse(localStorage.getItem('user') || 'null')?.user_id ?? null) === storedUserId;
    } catch { return allowUnavailableStorage; }
  };
  return {
    current: () => alive() && authRevision === revision && sameIdentity(),
    reportable: () => alive() && authRevision === revision && sameIdentity(true),
    forget: () => { if (sameIdentity(true)) useAuthStore.getState().logout(); },
    commit,
  };
}

function validUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<User>;
  return Number.isSafeInteger(user.user_id) && user.user_id! > 0 &&
    typeof user.username === 'string' && !!user.username.trim() && typeof user.email === 'string' && !!user.email.trim() &&
    (user.phone == null || typeof user.phone === 'string') && (user.avatar_url == null || typeof user.avatar_url === 'string');
}

export function customerSignIn(request: () => Promise<AuthSession>, clear: () => Promise<unknown>, attempt?: CustomerAuthAttempt): Promise<AuthSession> {
  return queueWrite(async () => {
    if (attempt && !attempt.current()) throw new CustomerAuthAbandoned();
    try { if (needsCleanup()) await clearCustomerCookie(clear); }
    catch { throw new CustomerAuthUnconfirmed(!attempt || attempt.reportable(), 'cleanup'); }
    if (attempt && !attempt.current()) throw new CustomerAuthAbandoned();
    // A reload may outlive this JS context. Never send credentials without recording its possible cookie.
    try { recordCleanup(true); }
    catch { throw new CustomerAuthUnconfirmed(!attempt || attempt.reportable(), 'cleanup'); }
    let data: AuthSession;
    try {
      data = await request();
    } catch (error) {
      const status = requestFailure(error).response?.status;
      // A definite form rejection did not set a cookie. A lost or incomplete reply may have.
      if (status && status >= 400 && status < 500 && status !== 408) {
        try { recordCleanup(false); } catch { /* The next explicit attempt can reconcile this marker. */ }
        throw error;
      }
      const report = !attempt || attempt.reportable();
      try { await clearCustomerCookie(clear); } catch { /* The next sign-in must clear it before sending credentials. */ }
      const stillCurrent = !attempt || attempt.reportable();
      attempt?.forget();
      throw new CustomerAuthUnconfirmed(report && stillCurrent);
    }
    const valid = !!data && typeof data === 'object' && validUser(data.user);
    if (!valid || (attempt && !attempt.current())) {
      const report = !attempt || attempt.reportable();
      try { await clearCustomerCookie(clear); } catch { /* Keep cleanup pending across tabs and reloads. */ }
      const stillCurrent = !attempt || attempt.reportable();
      attempt?.forget();
      if (!valid) throw new CustomerAuthUnconfirmed(report && stillCurrent);
      if (report && stillCurrent) throw new CustomerAuthUnconfirmed(true, 'storage');
      throw new CustomerAuthAbandoned();
    }
    // Publishing the profile belongs to the same lock as Set-Cookie, before the next write starts.
    const report = !attempt || attempt.reportable();
    let publishedSessionId: string | null = null;
    try {
      attempt?.commit(data);
      if (attempt) publishedSessionId = useAuthStore.getState().sessionId;
      // Other tabs must keep protected requests blocked until the profile is fully recorded.
      recordCleanup(false);
    } catch (error) {
      const identity = () => { try { return storedSessionId(); } catch { return undefined; } };
      const afterFailure = identity();
      try { await clearCustomerCookie(clear); } catch { /* The next explicit sign-in must reconcile cleanup first. */ }
      const stillOwned = afterFailure === identity();
      if (stillOwned && error instanceof CustomerSessionPublicationError && !error.sessionReplaced && !error.storageInvalidated) {
        // The cookie is gone, but a readable mixed pair must also stay signed out after reload.
        try { recordCleanup(true); } catch { /* The in-memory marker still blocks a later credential write. */ }
      }
      const state = useAuthStore.getState();
      if (stillOwned && publishedSessionId && afterFailure === publishedSessionId &&
          state.sessionId === publishedSessionId && state.user?.user_id === data.user.user_id) {
        // Publication succeeded but clearing its marker failed; the cookie was still cleaned above.
        useAuthStore.getState().logout();
      } else attempt?.forget();
      throw new CustomerAuthUnconfirmed(report && stillOwned && !(error instanceof CustomerSessionPublicationError && error.sessionReplaced), 'storage');
    }
    return data;
  });
}
