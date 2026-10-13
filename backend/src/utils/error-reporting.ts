/**
 * 错误上报（Sentry，可选）
 *
 * 配置 SENTRY_DSN 后启用，否则所有函数都是空操作。上报只经过两条路径：
 * - logger 的 error/fatal 日志（utils/logger.ts 的钩子），内容先经过 log-safety 的脱敏；
 * - 未捕获的异常和 Promise 拒绝，发送前由 scrubEvent 去掉数据库文本。
 * 不发送请求头、Cookie、请求体、用户信息、局部变量和面包屑，也不做性能追踪。
 *
 * 环境变量：SENTRY_DSN、SENTRY_ENVIRONMENT（默认 VERCEL_ENV / NODE_ENV）、SENTRY_RELEASE（默认 VERCEL_GIT_COMMIT_SHA）
 */
import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/node';
import { DATABASE_MESSAGE, containsSqlText, isDatabaseError, safeError, safeLogArguments } from './log-safety';
import { currentRequestId } from './request-context';

// Error capture only: no request data, console or HTTP breadcrumbs, local variables, sessions or module lists.
const KEPT_INTEGRATIONS = new Set(['EventFilters', 'FunctionToString', 'LinkedErrors', 'Dedupe', 'OnUncaughtException', 'ContextLines', 'Context']);

type Integration = ReturnType<typeof Sentry.onUnhandledRejectionIntegration>;

let enabled = false;

export function initErrorReporting(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || enabled) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    // Collect nothing about users, requests, queries or local variables (most default to on in v11).
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false,
    },
    // No tracer provider and no load-time rewriting of Express or other modules: errors only.
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    integrations: (defaults: Integration[]) => [
      ...defaults.filter(integration => KEPT_INTEGRATIONS.has(integration.name)),
      // Keep Node's default: an unhandled rejection still ends the process.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
  });
  enabled = true;
}

/** Last line of defence for every event, including uncaught exceptions that bypassed the logger. */
export function scrubEvent(event: ErrorEvent, hint: EventHint): ErrorEvent {
  delete event.request;
  delete event.user;
  const database = isDatabaseError(hint?.originalException);
  for (const value of event.exception?.values ?? []) {
    if (value.value && (database || containsSqlText(value.value))) value.value = DATABASE_MESSAGE;
  }
  if (event.message && containsSqlText(event.message)) event.message = DATABASE_MESSAGE;
  return event;
}

/** Rebuild an error from its sanitized fields; only the original stack frames (code locations) are kept. */
function reportableError(original: unknown): { error: Error; code?: string } {
  const safe = safeError(original);
  const error = new Error(String(safe.message));
  error.name = String(safe.type);
  const stack = original instanceof Error && typeof original.stack === 'string' ? original.stack : '';
  const frames = stack.split('\n').filter(line => /^\s+at /.test(line));
  error.stack = [`${error.name}: ${error.message}`, ...frames].join('\n');
  return { error, code: typeof safe.code === 'string' ? safe.code : undefined };
}

/** Called by the logger for error and fatal lines with the original, unsanitized arguments. */
export function reportLoggedError(args: unknown[]): void {
  if (!enabled) return;
  const [first] = args;
  const fields = first && typeof first === 'object' && !(first instanceof Error) ? first as Record<string, unknown> : null;
  const original = first instanceof Error ? first : fields?.err ?? fields?.error;
  const safeArgs = safeLogArguments(args);
  const message = typeof safeArgs[0] === 'string' ? safeArgs[0] : typeof safeArgs[1] === 'string' ? safeArgs[1] : undefined;
  Sentry.withScope(scope => {
    const requestId = currentRequestId();
    if (requestId) scope.setTag('request_id', requestId);
    if (original === undefined) {
      Sentry.captureMessage(message ?? '错误日志', 'error');
      return;
    }
    const { error, code } = reportableError(original);
    if (code) scope.setTag('error_code', code);
    if (message) scope.setContext('log', { message });
    Sentry.captureException(error);
  });
}

/** Wait for queued events, e.g. before a serverless response ends or the process exits. */
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
