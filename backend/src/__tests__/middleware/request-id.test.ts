jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../middleware/rate-limit', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from 'express';
import request from 'supertest';
import { requestId } from '../../middleware/request-id';
import { currentRequestId, logContext } from '../../utils/request-context';
import { createApp } from '../../app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function probe() {
  const app = express();
  app.use(requestId);
  app.get('/probe', async (_req, res) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    res.json({ seen: currentRequestId(), log: logContext() });
  });
  return app;
}

test('没有请求 ID 时生成 UUID，并写入响应头', async () => {
  const res = await request(probe()).get('/probe').expect(200);
  expect(res.headers['x-request-id']).toMatch(UUID);
  expect(res.body.seen).toBe(res.headers['x-request-id']);
});

test('沿用上游传来的合法请求 ID', async () => {
  const res = await request(probe()).get('/probe').set('X-Request-Id', 'edge-abc_123:4.5').expect(200);
  expect(res.headers['x-request-id']).toBe('edge-abc_123:4.5');
  expect(res.body.seen).toBe('edge-abc_123:4.5');
});

test.each([
  ['含换行', 'abc\r\nforged: 1'],
  ['含空格', 'two words'],
  ['过长', 'a'.repeat(129)],
])('上游请求 ID %s 时改为新生成的 UUID', async (_label, incoming) => {
  const res = await request(probe()).get('/probe').set('X-Request-Id', incoming.replace(/[\r\n]/g, '')).expect(200);
  expect(res.headers['x-request-id']).toMatch(UUID);
});

test('异步处理期间的日志都带同一个请求 ID', async () => {
  const res = await request(probe()).get('/probe').expect(200);
  expect(res.body.log).toEqual({ requestId: res.headers['x-request-id'] });
});

test('请求之外没有请求 ID', () => {
  expect(currentRequestId()).toBeUndefined();
  expect(logContext()).toEqual({});
});

test('并发请求互不串号', async () => {
  const app = probe();
  const results = await Promise.all(['r-1', 'r-2', 'r-3'].map(id => request(app).get('/probe').set('X-Request-Id', id)));
  expect(results.map(r => r.body.seen)).toEqual(['r-1', 'r-2', 'r-3']);
});

describe('createApp', () => {
  const app = createApp();

  test('所有响应（包括 404 和请求体错误）都带请求 ID', async () => {
    const notFound = await request(app).get('/api/does-not-exist').expect(404);
    expect(notFound.headers['x-request-id']).toMatch(UUID);
    const badJson = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest')
      .set('Content-Type', 'application/json').send('{"email":').expect(400);
    expect(badJson.headers['x-request-id']).toMatch(UUID);
  });

  test('跨域请求可以读取 X-Request-Id 响应头', async () => {
    const res = await request(app).get('/api/does-not-exist').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/i);
  });
});
