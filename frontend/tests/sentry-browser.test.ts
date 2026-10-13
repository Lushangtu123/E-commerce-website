import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), globalHandlersIntegration: vi.fn(() => ({ name: 'GlobalHandlers' })), dedupeIntegration: vi.fn(() => ({ name: 'Dedupe' })) }));
vi.mock('@sentry/browser', () => sdk);
const dsn = 'https://public@example.ingest.sentry.io/1';

beforeEach(() => { vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn); });

it('does nothing without a DSN or outside the browser', async () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
  let reporter = await import('@/lib/error-reporting');
  await reporter.initBrowserErrorReporting(); reporter.reportBrowserError(new Error('secret'));
  expect(sdk.init).not.toHaveBeenCalled(); expect(sdk.captureException).not.toHaveBeenCalled();
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn); vi.stubGlobal('window', undefined); vi.resetModules();
  reporter = await import('@/lib/error-reporting'); await reporter.initBrowserErrorReporting();
  expect(sdk.init).not.toHaveBeenCalled();
});

it('initializes once with only error capture and public build metadata', async () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'preview'); vi.stubEnv('NEXT_PUBLIC_SENTRY_RELEASE', 'a'.repeat(40));
  const reporter = await import('@/lib/error-reporting');
  await Promise.all([reporter.initBrowserErrorReporting(), reporter.initBrowserErrorReporting()]);
  await reporter.initBrowserErrorReporting();
  expect(sdk.init).toHaveBeenCalledTimes(1);
  const options = sdk.init.mock.calls[0][0];
  expect(options).toMatchObject({ dsn, environment: 'preview', release: 'a'.repeat(40), defaultIntegrations: false, sendClientReports: false, maxBreadcrumbs: 0, tracesSampleRate: 0, tracePropagationTargets: [], integrations: [{ name: 'GlobalHandlers' }, { name: 'Dedupe' }] });
  expect(options.dataCollection).toEqual({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 });
  expect(options.beforeBreadcrumb({ message: 'secret' })).toBeNull();
});

it('captures React boundary errors once and isolates SDK failures', async () => {
  const reporter = await import('@/lib/error-reporting'); await reporter.initBrowserErrorReporting();
  const error = new Error('token=secret'); reporter.reportBrowserError(error); reporter.reportBrowserError(error);
  expect(sdk.captureException).toHaveBeenCalledTimes(1);
  sdk.captureException.mockImplementationOnce(() => { throw new Error('offline'); });
  expect(() => reporter.reportBrowserError(new Error('another'))).not.toThrow();
});

it('failed initialization never breaks the application and can retry', async () => {
  const reporter = await import('@/lib/error-reporting'); sdk.init.mockImplementationOnce(() => { throw new Error('failed'); });
  await expect(reporter.initBrowserErrorReporting()).resolves.toBeUndefined(); reporter.reportBrowserError(new Error('secret'));
  expect(sdk.captureException).not.toHaveBeenCalled(); await reporter.initBrowserErrorReporting(); expect(sdk.init).toHaveBeenCalledTimes(2);
});

describe('privacy allowlist', () => {
  it('removes arbitrary text, user/request/scope fields and frame URLs or variables', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'production'); vi.stubEnv('NEXT_PUBLIC_SENTRY_RELEASE', 'b'.repeat(40));
    const { scrubBrowserEvent } = await import('@/lib/sentry-browser');
    const event = { event_id: 'a'.repeat(32), timestamp: 123, level: 'error' as const, platform: 'javascript', environment: 'production', release: 'b'.repeat(40), request: { url: 'https://shop/orders?token=secret', headers: { Cookie: 'secret' }, data: 'password=secret' }, user: { email: 'private@example.com' }, breadcrumbs: [{ message: 'secret' }], extra: { password: 'secret' }, tags: { token: 'secret' }, contexts: { trace: { trace_id: 'secret', span_id: 'secret' } }, message: 'password=secret', exception: { values: [{ type: 'TypeError', value: 'password=secret email private@example.com', mechanism: { type: 'onerror', handled: false, data: { token: 'secret' } }, stacktrace: { frames: [{ filename: 'https://shop/_next/static/chunks/app-123.js?token=secret#private', lineno: 42, colno: 9, function: 'private@example.com', vars: { token: 'secret' }, pre_context: ['secret'] }, { filename: 'https://other/orders/private@example.com?token=secret' }] } }] } };
    const safe = scrubBrowserEvent(event);
    expect(JSON.stringify(safe)).not.toMatch(/secret|private|password|token|shop|other/);
    expect(safe).toMatchObject({ environment: 'production', release: 'b'.repeat(40), exception: { values: [{ type: 'TypeError', value: 'Browser exception (TypeError)', mechanism: { type: 'onerror', handled: false }, stacktrace: { frames: [{ filename: '/_next/static/chunks/app-123.js', lineno: 42, colno: 9 }] } }] } });
    expect(Object.keys(safe!)).toEqual(['type', 'event_id', 'timestamp', 'platform', 'level', 'environment', 'release', 'exception']);
  });
  it('drops non-error telemetry and strips attacker-controlled error type/mechanism text', async () => {
    const { scrubBrowserEvent } = await import('@/lib/sentry-browser');
    expect(scrubBrowserEvent({ type: 'transaction' })).toBeNull();
    const safe = scrubBrowserEvent({ exception: { values: [{ type: 'secret@example.com', value: 'token=secret', mechanism: { type: 'token=secret', handled: true } }] } });
    expect(JSON.stringify(safe)).not.toMatch(/secret|token/);
    expect(safe?.exception?.values?.[0]).toMatchObject({ type: 'Error', value: 'Browser exception (Error)' });
  });
});

it('boots reporting through the Next client instrumentation seam', async () => {
  await import('@/instrumentation-client');
  await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
});

it('reports errors raised while the SDK is still loading, once it has started', async () => {
  const reporter = await import('@/lib/error-reporting');
  const loading = reporter.initBrowserErrorReporting();
  const early = new TypeError('during hydration'), boundary = new Error('boundary');
  window.dispatchEvent(new ErrorEvent('error', { error: early }));
  reporter.reportBrowserError(boundary);
  expect(sdk.captureException).not.toHaveBeenCalled();
  await loading;
  expect(sdk.captureException.mock.calls.map(([error]) => error)).toEqual([early, boundary]);
  // The SDK's own handlers take over: the temporary listener is gone.
  window.dispatchEvent(new ErrorEvent('error', { error: new Error('later') }));
  expect(sdk.captureException).toHaveBeenCalledTimes(2);
});

it('does not load the SDK without a DSN', async () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
  const reporter = await import('@/lib/error-reporting');
  await reporter.initBrowserErrorReporting(); reporter.reportBrowserError(new Error('x'));
  expect(sdk.init).not.toHaveBeenCalled();
});

describe('request id', () => {
  const failure = (headers: Record<string, string>) => ({ response: { status: 500, headers: { get: (name: string) => headers[name] } } });
  const event = { exception: { values: [{ type: 'Error', value: 'Request failed' }] } };

  it('tags an API failure with the backend request id only', async () => {
    const { scrubBrowserEvent } = await import('@/lib/sentry-browser');
    expect(scrubBrowserEvent(event, { originalException: failure({ 'x-request-id': 'req-123' }) })?.tags).toEqual({ request_id: 'req-123' });
  });

  it.each<Record<string, string>>([{}, { 'x-request-id': 'bad id with spaces' }, { 'x-request-id': 'a'.repeat(129) }])('adds no tags without a safe request id (%o)', async headers => {
    const { scrubBrowserEvent } = await import('@/lib/sentry-browser');
    expect(scrubBrowserEvent(event, { originalException: failure(headers) })).not.toHaveProperty('tags');
    expect(scrubBrowserEvent(event, { originalException: new Error('plain') })).not.toHaveProperty('tags');
  });
});
