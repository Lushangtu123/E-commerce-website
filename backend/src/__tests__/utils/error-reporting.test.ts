const sentry = {
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  flush: jest.fn(async () => true),
  withScope: jest.fn((fn: (scope: unknown) => void) => fn(scope)),
  getDefaultIntegrations: jest.fn(() => ['EventFilters', 'LinkedErrors', 'Dedupe', 'RequestData', 'Console', 'Http',
    'OnUncaughtException', 'OnUnhandledRejection', 'ContextLines', 'LocalVariablesAsync', 'Context', 'Modules'].map(name => ({ name }))),
  onUnhandledRejectionIntegration: jest.fn((options: unknown) => ({ name: 'OnUnhandledRejection', options })),
};
const scope = { setTag: jest.fn(), setContext: jest.fn() };
jest.mock('@sentry/node', () => sentry);

import type { ErrorEvent } from '@sentry/node';

const event = (value: object) => value as ErrorEvent;

type Reporting = typeof import('../../utils/error-reporting');
let reporting: Reporting;
const OLD_ENV = { ...process.env };

function load(dsn?: string): Reporting {
  jest.resetModules();
  process.env = { ...OLD_ENV };
  if (dsn) process.env.SENTRY_DSN = dsn; else delete process.env.SENTRY_DSN;
  reporting = require('../../utils/error-reporting');
  reporting.initErrorReporting();
  return reporting;
}
const options = () => sentry.init.mock.calls[0][0];
const sent = () => JSON.stringify([sentry.captureException.mock.calls, sentry.captureMessage.mock.calls, scope.setContext.mock.calls, scope.setTag.mock.calls]);

beforeEach(() => jest.clearAllMocks());
afterAll(() => { process.env = OLD_ENV; });

describe('initErrorReporting', () => {
  test('未配置 SENTRY_DSN 时不初始化，也不上报', async () => {
    load();
    reporting.reportLoggedError([{ err: new Error('boom') }, '失败']);
    await reporting.flushErrorReporting();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  test('配置后只上报错误：不发个人信息、不做性能追踪', () => {
    load('https://key@o1.ingest.sentry.io/1');
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(options()).toMatchObject({ dsn: 'https://key@o1.ingest.sentry.io/1', enableOpenTelemetrySetup: false, enableRuntimeChannelInjection: false });
    expect(options().dataCollection).toEqual({
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false,
    });
    expect(options().tracesSampleRate).toBeUndefined();
    expect(options().beforeBreadcrumb()).toBeNull();
  });

  test('只保留错误相关集成，去掉请求数据、控制台、HTTP 和局部变量采集', () => {
    load('https://key@o1.ingest.sentry.io/1');
    const names = options().integrations(sentry.getDefaultIntegrations()).map((i: { name: string }) => i.name);
    expect(names).toEqual(expect.arrayContaining(['EventFilters', 'LinkedErrors', 'Dedupe', 'OnUncaughtException', 'OnUnhandledRejection', 'ContextLines', 'Context']));
    for (const name of ['RequestData', 'Console', 'Http', 'LocalVariablesAsync', 'Modules']) expect(names).not.toContain(name);
    // An unhandled rejection still ends the process, as it does without Sentry.
    expect(sentry.onUnhandledRejectionIntegration).toHaveBeenCalledWith({ mode: 'strict' });
  });
});

describe('reportLoggedError', () => {
  beforeEach(() => load('https://key@o1.ingest.sentry.io/1'));

  test('上报错误并带上请求 ID 和日志消息', () => {
    // load() resets the module registry, so take the request context the reporter now uses.
    const { runWithRequestId } = require('../../utils/request-context') as typeof import('../../utils/request-context');
    runWithRequestId('req-42', () => reporting.reportLoggedError([{ err: new TypeError('bad input') }, '处理订单失败']));
    const [error] = sentry.captureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TypeError');
    expect(error.message).toBe('bad input');
    expect(error.stack).toMatch(/^TypeError: bad input\n\s+at /);
    expect(scope.setTag).toHaveBeenCalledWith('request_id', 'req-42');
    expect(scope.setContext).toHaveBeenCalledWith('log', { message: '处理订单失败' });
  });

  test('数据库错误不把 SQL 或数据发出去，但保留调用位置和错误码', () => {
    const dbError = Object.assign(new Error("Duplicate entry 'alice@example.test' for key 'users.email'"), {
      code: 'ER_DUP_ENTRY', errno: 1062, sql: "INSERT INTO users (email) VALUES ('alice@example.test')", sqlMessage: "Duplicate entry 'alice@example.test'",
    });
    reporting.reportLoggedError([{ err: dbError }, "注册失败: Duplicate entry 'alice@example.test'"]);
    expect(sent()).not.toContain('alice@example.test');
    expect(sent()).not.toContain('INSERT INTO');
    const [error] = sentry.captureException.mock.calls[0];
    expect(error.message).toBe('数据库操作失败');
    expect(error.stack).toMatch(/\n\s+at /);
    expect(scope.setTag).toHaveBeenCalledWith('error_code', 'ER_DUP_ENTRY');
  });

  test('没有错误对象的错误日志作为消息上报', () => {
    reporting.reportLoggedError(['云数据库初始化失败']);
    expect(sentry.captureMessage).toHaveBeenCalledWith('云数据库初始化失败', 'error');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  test('flush 等待未发送的事件', async () => {
    await reporting.flushErrorReporting(500);
    expect(sentry.flush).toHaveBeenCalledWith(500);
  });
});

describe('scrubEvent', () => {
  beforeEach(() => load('https://key@o1.ingest.sentry.io/1'));

  test('删除请求、Cookie 和用户信息', () => {
    const scrubbed = reporting.scrubEvent(event({
      request: { url: '/api/users/login?email=a@b.test', headers: { cookie: 'session=x', authorization: 'Bearer y' }, data: '{"password":"p"}' },
      user: { email: 'a@b.test', ip_address: '1.2.3.4' }, exception: { values: [{ type: 'Error', value: 'boom' }] },
    }), {});
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.exception?.values?.[0].value).toBe('boom');
  });

  test('未捕获的数据库异常在发送前去掉 SQL 文本', () => {
    const original = Object.assign(new Error('x'), { code: 'ER_PARSE_ERROR', sql: 'SELECT * FROM users WHERE email = "a@b.test"' });
    const scrubbed = reporting.scrubEvent(event({ exception: { values: [{ type: 'Error', value: 'You have an error near "a@b.test"' }, { type: 'Error', value: 'SELECT secret FROM t' }] } }), { originalException: original });
    expect(scrubbed.exception?.values?.map(value => value.value)).toEqual(['数据库操作失败', '数据库操作失败']);
  });

  test('非数据库异常中出现的 SQL 文本也会被替换', () => {
    const scrubbed = reporting.scrubEvent(event({ exception: { values: [{ type: 'Error', value: 'failed: UPDATE users SET email = 1' }] } }), { originalException: new Error('other') });
    expect(scrubbed.exception?.values?.[0].value).toBe('数据库操作失败');
  });
});
