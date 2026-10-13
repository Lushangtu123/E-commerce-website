/**
 * 浏览器端错误上报（Sentry，可选）
 *
 * 构建时配置 NEXT_PUBLIC_SENTRY_DSN 后由 instrumentation-client 按需加载，否则不进入页面代码。上报来源：
 * - logger.error（lib/logger.ts），其中 4xx 响应属于预期结果，不上报；
 * - 未捕获的异常和 Promise 拒绝（GlobalHandlers / BrowserApiErrors）。
 * 只发送错误类型、消息、调用栈、页面路径和后端请求 ID；不发送请求体、请求头、
 * 查询参数、用户信息、面包屑和会话，也不做性能追踪。
 */
import * as Sentry from '@sentry/browser';
import type { ErrorEvent } from '@sentry/browser';
import { setErrorReporter } from '@/lib/logger';

type Integration = { name: string };
const KEPT_INTEGRATIONS = ['EventFilters', 'FunctionToString', 'BrowserApiErrors', 'GlobalHandlers', 'LinkedErrors', 'Dedupe', 'HttpContext'];
// The same shape the backend accepts for X-Request-Id.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

let enabled = false;

export function initClientErrorReporting(dsn = process.env.NEXT_PUBLIC_SENTRY_DSN): void {
  if (!dsn || enabled || typeof window === 'undefined') return;
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false,
    },
    sendClientReports: false,
    integrations: (defaults: Integration[]) => defaults.filter(integration => KEPT_INTEGRATIONS.includes(integration.name)),
    beforeBreadcrumb: () => null,
    beforeSend: scrubClientEvent,
  });
  enabled = true;
  setErrorReporter(reportClientError);
}

/** Keep only the page URL without query or fragment (reset tokens, coupon or order ids). */
export function scrubClientEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  let url: string | undefined;
  try { if (event.request?.url) { const parsed = new URL(event.request.url); url = parsed.origin + parsed.pathname; } }
  catch { url = undefined; }
  if (url) event.request = { url };
  else delete event.request;
  return event;
}

interface FailureFields {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  digest?: unknown;
  config?: { url?: unknown; method?: unknown };
  response?: { status?: unknown; headers?: unknown };
}

function isErrorLike(value: unknown): value is FailureFields {
  return value instanceof Error || (!!value && typeof value === 'object' && typeof (value as FailureFields).message === 'string' && typeof (value as FailureFields).stack === 'string');
}

function header(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  const get = (headers as { get?: unknown }).get;
  return typeof get === 'function' ? get.call(headers, name) : (headers as Record<string, unknown>)[name];
}

/** Called by logger.error with its arguments. */
export function reportClientError(args: unknown[]): void {
  if (!enabled) return;
  const original = args.find(isErrorLike);
  const message = args.filter((arg): arg is string => typeof arg === 'string').join(' ') || undefined;
  if (!original) {
    if (message) Sentry.captureMessage(message, 'error');
    return;
  }
  const status = original.response?.status;
  // A 4xx is an expected outcome (validation, sign-in, conflicts) that the page already handles.
  if (typeof status === 'number' && status >= 400 && status < 500) return;
  Sentry.withScope(scope => {
    const requestId = header(original.response?.headers, 'x-request-id');
    if (typeof requestId === 'string' && SAFE_REQUEST_ID.test(requestId)) scope.setTag('request_id', requestId);
    if (typeof status === 'number') scope.setTag('http_status', String(status));
    if (typeof original.digest === 'string') scope.setTag('digest', original.digest);
    const url = original.config?.url;
    if (typeof url === 'string') {
      scope.setContext('api', { method: typeof original.config?.method === 'string' ? original.config.method.toUpperCase() : undefined, path: url.split('?')[0] });
    }
    if (message) scope.setContext('log', { message });
    // Send only name, message and stack: an axios error also carries the request body and headers.
    const error = new Error(String(original.message));
    error.name = typeof original.name === 'string' ? original.name : 'Error';
    if (typeof original.stack === 'string') error.stack = original.stack;
    Sentry.captureException(error);
  });
}
