import { requestFailure } from '@/lib/api-error';
import { ADMIN_CLEANUP_KEY, ADMIN_SESSION_EVENT, ADMIN_SESSION_KEY, AdminSessionPublicationError, clearAdminSession, getAdminSession, type AdminSession } from '@/lib/admin-session';

export interface AdminAuthResult { admin: AdminSession['admin'] }
export interface AdminAuthAttempt {
  current: () => boolean;
  forget: () => void;
  commit: (result: AdminAuthResult) => void;
}
export class AdminAuthAbandoned extends Error {}
export class AdminAuthUnconfirmed extends Error {
  constructor(public readonly report: boolean, cleanup = false) {
    super(cleanup ? '管理员会话清理尚未确认，请重试登录' : '管理员登录结果尚未确认，请重新登录');
  }
}

let writing = false;
const waiting: (() => void)[] = [];
let revision = 0;
let cleanupPending = false;

function needsCleanup() {
  return cleanupPending || (typeof window !== 'undefined' && localStorage.getItem(ADMIN_CLEANUP_KEY) === '1');
}
function recordCleanup(pending: boolean) {
  cleanupPending = pending;
  if (typeof window !== 'undefined') {
    if (pending) localStorage.setItem(ADMIN_CLEANUP_KEY, '1');
    else localStorage.removeItem(ADMIN_CLEANUP_KEY);
    try { window.dispatchEvent(new Event(ADMIN_SESSION_EVENT)); } catch { /* The durable marker still guards each request. */ }
  }
}

/** Keep cookie writes, profile publication and abandoned-response cleanup in one ordered operation. */
function queueWrite<T>(write: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      writing = true;
      const run = async () => write();
      let answer: Promise<T>;
      try {
        // Cooperating tabs share this lock; browsers without Web Locks retain this tab's ordering.
        answer = typeof navigator !== 'undefined' && navigator.locks?.request
          ? navigator.locks.request('admin-session-cookie', run).then(value => value) : run();
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

/** Only an acknowledged logout clears the durable marker; never automatically repeat a sign-in. */
async function clearCookie(clear: () => Promise<unknown>): Promise<{ message: string }> {
  recordCleanup(true);
  const value = await clear();
  if (!value || typeof value !== 'object' || !('message' in value) || value.message !== '已退出登录') {
    throw new Error('Invalid administrator logout acknowledgement');
  }
  recordCleanup(false);
  return { message: value.message };
}

/** Record before waiting so navigation or reload cannot forget an unfinished logout. */
export function adminSessionLogout(clear: () => Promise<unknown>): Promise<{ message: string }> {
  revision += 1;
  try { recordCleanup(true); }
  catch (error) { return Promise.reject(error); }
  return queueWrite(() => clearCookie(clear));
}

export function adminAuthAttempt(alive: () => boolean, commit: AdminAuthAttempt['commit']): AdminAuthAttempt {
  let sessionId: string | null;
  try { sessionId = typeof window === 'undefined' ? null : localStorage.getItem(ADMIN_SESSION_KEY); }
  catch { throw new AdminAuthUnconfirmed(true, true); }
  const adminId = getAdminSession()?.admin.admin_id ?? null;
  const started = revision;
  const sameIdentity = () => {
    try {
      return localStorage.getItem(ADMIN_SESSION_KEY) === sessionId &&
        (getAdminSession()?.admin.admin_id ?? null) === adminId;
    } catch { return false; }
  };
  return {
    current: () => alive() && revision === started && sameIdentity(),
    forget: () => { if (sameIdentity()) clearAdminSession(sessionId); },
    commit,
  };
}

function validAdmin(value: unknown): value is AdminSession['admin'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const admin = value as AdminSession['admin'];
  return Number.isSafeInteger(admin.admin_id) && Number(admin.admin_id) > 0 &&
    typeof admin.username === 'string' && !!admin.username.trim() &&
    (admin.real_name == null || typeof admin.real_name === 'string') &&
    (admin.role_name == null || typeof admin.role_name === 'string');
}

export function adminSignIn(request: () => Promise<AdminAuthResult>, clear: () => Promise<unknown>, attempt: AdminAuthAttempt): Promise<AdminAuthResult> {
  return queueWrite(async () => {
    if (!attempt.current()) throw new AdminAuthAbandoned();
    if (needsCleanup()) {
      try { await clearCookie(clear); }
      catch { throw new AdminAuthUnconfirmed(attempt.current(), true); }
    }
    if (!attempt.current()) throw new AdminAuthAbandoned();
    // A hard reload can outlive this request's JS context, so remember its possible cookie now.
    recordCleanup(true);
    let value: AdminAuthResult;
    try { value = await request(); }
    catch (error) {
      const status = requestFailure(error).response?.status;
      if (status && status >= 400 && status < 500 && status !== 408) {
        recordCleanup(false);
        throw error;
      }
      const report = attempt.current();
      try { await clearCookie(clear); } catch { /* Next explicit sign-in must first confirm cleanup. */ }
      const stillCurrent = attempt.current();
      attempt.forget();
      throw new AdminAuthUnconfirmed(report && stillCurrent);
    }
    const valid = !!value && typeof value === 'object' && validAdmin(value.admin);
    if (!valid || !attempt.current()) {
      const report = attempt.current();
      try { await clearCookie(clear); } catch { /* Keep the durable marker across pages and reloads. */ }
      const stillCurrent = attempt.current();
      attempt.forget();
      if (!valid) throw new AdminAuthUnconfirmed(report && stillCurrent);
      throw new AdminAuthAbandoned();
    }
    const report = attempt.current();
    let publishedSessionId: string | null = null;
    try {
      // These synchronous writes finish in this lock before another cookie writer starts.
      attempt.commit(value);
      publishedSessionId = getAdminSession()?.sessionId ?? null;
      // Every intermediate identity event remains blocked until both storage writes finish.
      recordCleanup(false);
    } catch (error) {
      const identity = () => { try { return localStorage.getItem(ADMIN_SESSION_KEY); } catch { return undefined; } };
      const afterFailure = identity();
      try { await clearCookie(clear); } catch { /* Storage failure must not leave an untracked cookie. */ }
      const stillOwned = afterFailure === identity();
      if (stillOwned && publishedSessionId && afterFailure === publishedSessionId &&
          getAdminSession()?.admin.admin_id === value.admin.admin_id) {
        // Publication succeeded but final marker clearing failed; its cookie has been cleaned above.
        clearAdminSession(publishedSessionId);
      } else attempt.forget();
      throw new AdminAuthUnconfirmed(report && stillOwned && !(error instanceof AdminSessionPublicationError && error.sessionReplaced));
    }
    return value;
  });
}
