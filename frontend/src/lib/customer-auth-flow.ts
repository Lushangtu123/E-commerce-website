import type { AuthSession } from '@/lib/api/account';
import { requestFailure } from '@/lib/api-error';
import { storedSessionId, useAuthStore, type User } from '@/store/useAuthStore';

export interface CustomerAuthAttempt {
  current: () => boolean;
  forget: () => void;
  commit: (session: AuthSession) => void;
}

export class CustomerAuthAbandoned extends Error {}
export class CustomerAuthUnconfirmed extends Error {
  constructor(public readonly report: boolean) { super('Customer sign-in result is unconfirmed'); }
}
export class CustomerSessionChanged extends Error {
  constructor() { super('登录状态已变化，请刷新后重试'); }
}

let writing = false;
const waiting: (() => void)[] = [];
let authRevision = 0;
let cleanupPending = false;
const CLEANUP_KEY = 'customer_session_cleanup_pending';

function needsCleanup() {
  return cleanupPending || (typeof window !== 'undefined' && localStorage.getItem(CLEANUP_KEY) === '1');
}

function recordCleanup(pending: boolean) {
  cleanupPending = pending;
  if (typeof window !== 'undefined') {
    if (pending) localStorage.setItem(CLEANUP_KEY, '1');
    else localStorage.removeItem(CLEANUP_KEY);
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
export async function clearCustomerCookie(clear: () => Promise<unknown>): Promise<void> {
  recordCleanup(true);
  await clear();
  recordCleanup(false);
}

/** Snapshot both this tab and browser storage; a later session can never inherit this submission. */
export function customerAuthAttempt(alive: () => boolean, commit: (session: AuthSession) => void): CustomerAuthAttempt {
  const state = useAuthStore.getState();
  const sessionId = state.sessionId, userId = state.user?.user_id ?? null, revision = authRevision;
  const sameIdentity = () => {
    try {
      const current = useAuthStore.getState();
      return current.sessionId === sessionId && (current.user?.user_id ?? null) === userId &&
        storedSessionId() === sessionId && (JSON.parse(localStorage.getItem('user') || 'null')?.user_id ?? null) === userId;
    } catch { return false; }
  };
  return {
    current: () => alive() && authRevision === revision && sameIdentity(),
    forget: () => { if (sameIdentity()) useAuthStore.getState().logout(); },
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
    if (needsCleanup()) {
      try { await clearCustomerCookie(clear); }
      catch { throw new CustomerAuthUnconfirmed(!attempt || attempt.current()); }
    }
    if (attempt && !attempt.current()) throw new CustomerAuthAbandoned();
    let data: AuthSession;
    try {
      data = await request();
    } catch (error) {
      const status = requestFailure(error).response?.status;
      // A definite form rejection did not set a cookie. A lost or incomplete reply may have.
      if (status && status >= 400 && status < 500 && status !== 408) throw error;
      const report = !attempt || attempt.current();
      try { await clearCustomerCookie(clear); } catch { /* The next sign-in must clear it before sending credentials. */ }
      const stillCurrent = !attempt || attempt.current();
      attempt?.forget();
      throw new CustomerAuthUnconfirmed(report && stillCurrent);
    }
    const valid = !!data && typeof data === 'object' && validUser(data.user);
    if (!valid || (attempt && !attempt.current())) {
      const report = !attempt || attempt.current();
      try { await clearCustomerCookie(clear); } catch { /* Keep cleanup pending across tabs and reloads. */ }
      const stillCurrent = !attempt || attempt.current();
      attempt?.forget();
      if (!valid) throw new CustomerAuthUnconfirmed(report && stillCurrent);
      throw new CustomerAuthAbandoned();
    }
    // Publishing the profile belongs to the same lock as Set-Cookie, before the next write starts.
    attempt?.commit(data);
    return data;
  });
}
