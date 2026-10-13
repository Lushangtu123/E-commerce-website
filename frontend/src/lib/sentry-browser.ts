/**
 * The Sentry part of browser error reporting, loaded on demand by lib/error-reporting.ts only when
 * NEXT_PUBLIC_SENTRY_DSN is set. Arbitrary error text is never sent.
 */
import * as Sentry from '@sentry/browser';
import type { ErrorEvent, Event, EventHint, StackFrame } from '@sentry/browser';

const ERROR_TYPES = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError']);
const MECHANISMS = new Set(['generic', 'onerror', 'onunhandledrejection']);
// The same shape the backend accepts for X-Request-Id: an opaque id, never user data.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const reported = new WeakSet<Error>();

/** The backend request id of an API failure (an axios error), so a report can be matched with the server logs. */
function requestIdOf(error: unknown): string | undefined {
  const headers = (error as { response?: { headers?: unknown } } | null)?.response?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const get = (headers as { get?: unknown }).get;
  const value = typeof get === 'function' ? get.call(headers, 'x-request-id') : (headers as Record<string, unknown>)['x-request-id'];
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value) ? value : undefined;
}

/** Only static bundle locations can leave the browser, never page URLs or source text. */
function safeFrame(frame: StackFrame): StackFrame | null {
  const path = frame.filename?.split(/[?#]/, 1)[0]?.replace(/^https?:\/\/[^/]+/, '');
  if (!path || !/^\/_next\/static\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.js$/.test(path)) return null;
  return {
    filename: path,
    ...(Number.isInteger(frame.lineno) && frame.lineno! > 0 ? { lineno: frame.lineno } : {}),
    ...(Number.isInteger(frame.colno) && frame.colno! >= 0 ? { colno: frame.colno } : {}),
  };
}

/** Rebuild every event from an allowlist, including SDK-generated unhandled errors. */
export function scrubBrowserEvent(event: Event, hint?: EventHint): ErrorEvent | null {
  if (event.type || !event.exception?.values?.length) return null;
  const requestId = requestIdOf(hint?.originalException);
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: 'error',
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    exception: {
      values: event.exception.values.map(value => {
        const type = ERROR_TYPES.has(value.type ?? '') ? value.type! : 'Error';
        const frames = value.stacktrace?.frames?.map(safeFrame).filter((frame): frame is StackFrame => frame !== null);
        return {
          type,
          value: `Browser exception (${type})`,
          ...(value.mechanism ? { mechanism: {
            type: MECHANISMS.has(value.mechanism.type) ? value.mechanism.type : 'generic',
            handled: value.mechanism.handled === true,
          } } : {}),
          ...(frames?.length ? { stacktrace: { frames } } : {}),
        };
      }),
    },
    ...(requestId ? { tags: { request_id: requestId } } : {}),
  };
}

/** Returns whether the SDK started; a failure leaves the page untouched and lets the caller retry. */
export function startSentry(dsn: string): boolean {
  try {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
      defaultIntegrations: false,
      integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
      dataCollection: {
        userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
        graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
        databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0,
      },
      sendClientReports: false,
      maxBreadcrumbs: 0,
      tracesSampleRate: 0,
      tracePropagationTargets: [],
      beforeBreadcrumb: () => null,
      beforeSend: scrubBrowserEvent,
    });
    return true;
  } catch {
    // Monitoring must never prevent hydration or the existing recovery UI.
    return false;
  }
}

/** Reports an error once: React boundary errors and errors raised before the SDK loaded. */
export function captureBrowserError(error: Error): void {
  if (reported.has(error)) return;
  try {
    Sentry.captureException(error);
    reported.add(error);
  } catch {
    // Keep the retry/home controls usable even if the SDK fails.
  }
}
