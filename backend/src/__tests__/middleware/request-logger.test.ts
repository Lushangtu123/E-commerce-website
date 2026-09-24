/**
 * 请求日志中间件测试（mock logger，只断言调用行为）
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logger = require('../../utils/logger').default as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { requestLogger } = require('../../middleware/request-logger');

beforeEach(() => jest.clearAllMocks());

function buildApp() {
  const app = express();
  app.use(requestLogger);
  app.get('/ok', (req, res) => res.json({ ok: true }));
  app.get('/bad', (req, res) => res.status(400).json({ e: 1 }));
  app.get('/boom', (req, res) => res.status(500).json({ e: 1 }));
  return app;
}

test('200 请求记 info 日志', async () => {
  const res = await request(buildApp()).get('/ok').expect(200);
  expect(res.body).toEqual({ ok: true }); // 不影响正常响应
  expect(logger.info).toHaveBeenCalledTimes(1);
  const [data, msg] = logger.info.mock.calls[0];
  expect(msg).toBe('HTTP请求');
  expect(data).toMatchObject({ method: 'GET', url: '/ok', status: 200 });
  expect(typeof data.durationMs).toBe('number');
  expect(typeof data.ip).toBe('string');
});

test('400 请求记 warn 日志', async () => {
  await request(buildApp()).get('/bad').expect(400);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  const [data] = logger.warn.mock.calls[0];
  expect(data).toMatchObject({ method: 'GET', url: '/bad', status: 400 });
  expect(logger.info).not.toHaveBeenCalled();
});

test('500 请求记 error 日志', async () => {
  await request(buildApp()).get('/boom').expect(500);
  expect(logger.error).toHaveBeenCalledTimes(1);
  const [data] = logger.error.mock.calls[0];
  expect(data).toMatchObject({ method: 'GET', url: '/boom', status: 500 });
  expect(logger.info).not.toHaveBeenCalled();
});
