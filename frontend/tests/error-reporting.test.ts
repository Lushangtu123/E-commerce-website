import { AxiosError, AxiosHeaders } from 'axios';
import type { ErrorEvent } from '@sentry/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  const scope = { setTag: vi.fn(), setContext: vi.fn() };
  return {
    scope,
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    withScope: vi.fn((fn: (value: typeof scope) => void) => fn(scope)),
    getDefaultIntegrations: vi.fn(() => ['EventFilters', 'FunctionToString', 'ConversationId', 'BrowserApiErrors', 'Breadcrumbs', 'Console',
      'GlobalHandlers', 'LinkedErrors', 'Dedupe', 'HttpContext', 'CultureContext', 'BrowserSession'].map(name => ({ name }))),
  };
});
vi.mock('@sentry/browser', () => sentry);

type Reporting = typeof import('@/lib/error-reporting');
async function load(dsn?: string): Promise<Reporting> {
  vi.resetModules();
  const reporting = await import('@/lib/error-reporting');
  reporting.initClientErrorReporting(dsn);
  return reporting;
}
const options = () => sentry.init.mock.calls[0][0];
const event = (value: object) => value as ErrorEvent;

function axiosFailure(status: number | undefined, requestId?: string) {
  const config = { url: '/orders/12?token=secret', method: 'post', headers: new AxiosHeaders(), data: '{"password":"hunter2"}' };
  const response = status === undefined ? undefined : {
    status, statusText: '', data: { error: '服务器内部错误' }, config,
    headers: new AxiosHeaders(requestId ? { 'x-request-id': requestId } : {}),
  };
  return new AxiosError(status ? `Request failed with status code ${status}` : 'Network Error', status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK', config, null, response);
}

beforeEach(() => vi.clearAllMocks());

describe('initClientErrorReporting', () => {
  it('does nothing without a DSN', async () => {
    const reporting = await load(undefined);
    reporting.reportClientError(['加载失败:', new Error('boom')]);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('collects errors only: no user data, breadcrumbs, sessions or tracing', async () => {
    await load('https://key@o1.ingest.sentry.io/2');
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(options()).toMatchObject({ dsn: 'https://key@o1.ingest.sentry.io/2', sendClientReports: false });
    expect(options().tracesSampleRate).toBeUndefined();
    expect(options().dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false });
    expect(options().beforeBreadcrumb()).toBeNull();
    const names = options().integrations(sentry.getDefaultIntegrations()).map((integration: { name: string }) => integration.name);
    expect(names).toEqual(['EventFilters', 'FunctionToString', 'BrowserApiErrors', 'GlobalHandlers', 'LinkedErrors', 'Dedupe', 'HttpContext']);
  });

  it('initializes once', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.initClientErrorReporting('https://key@o1.ingest.sentry.io/2');
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });
});

describe('reportClientError', () => {
  it('reports an error with the logged message', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['应用渲染失败:', new TypeError('x is undefined')]);
    const [error] = sentry.captureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect([error.name, error.message]).toEqual(['TypeError', 'x is undefined']);
    expect(sentry.scope.setContext).toHaveBeenCalledWith('log', { message: '应用渲染失败:' });
  });

  it('tags a server failure with the backend request ID, status and path, but sends no request data', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['加载订单失败:', axiosFailure(500, 'req-abc')]);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('request_id', 'req-abc');
    expect(sentry.scope.setTag).toHaveBeenCalledWith('http_status', '500');
    expect(sentry.scope.setContext).toHaveBeenCalledWith('api', { method: 'POST', path: '/orders/12' });
    const sent = JSON.stringify([sentry.captureException.mock.calls, sentry.scope.setContext.mock.calls, sentry.scope.setTag.mock.calls]);
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('token=secret');
    const [error] = sentry.captureException.mock.calls[0];
    expect(Object.keys(error)).not.toContain('config');
  });

  it('reports network failures', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['加载失败:', axiosFailure(undefined)]);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 409, 429])('does not report an expected %s response', async status => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['操作失败:', axiosFailure(status, 'req-1')]);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('ignores an unsafe request ID header', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['加载失败:', axiosFailure(502, 'bad id with spaces')]);
    expect(sentry.scope.setTag).not.toHaveBeenCalledWith('request_id', expect.anything());
  });

  it('tags the Next.js error digest', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['页面渲染失败:', Object.assign(new Error('render'), { digest: '12345' })]);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('digest', '12345');
  });

  it('reports a message when no error is logged', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError(['结算状态无效', 42]);
    expect(sentry.captureMessage).toHaveBeenCalledWith('结算状态无效', 'error');
  });

  it('ignores a call with nothing to report', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    reporting.reportClientError([42, null]);
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});

describe('scrubClientEvent', () => {
  it('keeps only the page path of the request and drops user data and breadcrumbs', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    const scrubbed = reporting.scrubClientEvent(event({
      request: { url: 'https://shop.example/reset-password?token=abc#x', headers: { 'User-Agent': 'UA', Referer: 'https://shop.example/?q=1' } },
      user: { id: '1', email: 'a@b.test' }, breadcrumbs: [{ message: 'click' }],
    }));
    expect(scrubbed.request).toEqual({ url: 'https://shop.example/reset-password' });
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
  });

  it('drops an unparsable request URL', async () => {
    const reporting = await load('https://key@o1.ingest.sentry.io/2');
    expect(reporting.scrubClientEvent(event({ request: { url: 'not a url' } })).request).toBeUndefined();
    expect(reporting.scrubClientEvent(event({})).request).toBeUndefined();
  });
});

describe('logger', () => {
  it('reports logger.error through Sentry, but not warnings', async () => {
    await load('https://key@o1.ingest.sentry.io/2');
    const { logger } = await import('@/lib/logger');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('慢请求');
    expect(sentry.captureException).not.toHaveBeenCalled();
    logger.error('加载失败:', new Error('boom'));
    expect(console.error).toHaveBeenCalledWith('加载失败:', expect.any(Error));
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException.mock.calls[0][0].message).toBe('boom');
  });

  it('logs without reporting until error reporting has started', async () => {
    await load(undefined);
    const { logger } = await import('@/lib/logger');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('加载失败:', new Error('boom'));
    expect(console.error).toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
