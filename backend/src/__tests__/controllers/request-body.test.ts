jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
// Rate limiting is not under test here.
jest.mock('../../middleware/rate-limit', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import { query } from '../../database/mysql';
import { createApp } from '../../app';

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue([]);
});

test('超过 1MB 的请求体返回 413，不进入业务逻辑', async () => {
  const res = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').set('Content-Type', 'application/json')
    .send(JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(1024 * 1024 + 1) }));
  expect(res.status).toBe(413);
  expect(res.body.error).toBe('请求体过大');
  expect(query).not.toHaveBeenCalled();
});

test('格式错误的 JSON 返回 400 而不是 500', async () => {
  const res = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').set('Content-Type', 'application/json').send('{"email":');
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('请求格式无效');
  expect(query).not.toHaveBeenCalled();
});

test('1MB 以内的正常请求体照常处理', async () => {
  const res = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').set('Content-Type', 'application/json')
    .send(JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(500 * 1024) }));
  expect(res.status).toBe(401);
});

// Express 5 leaves req.body undefined when nothing was parsed; endpoints must still answer 400, not 500.
test.each([
  '/api/users/login',
  '/api/users/register',
  '/api/users/password/reset',
  '/api/admin/login',
])('没有请求体的 POST %s 返回 400', async path => {
  const res = await request(app).post(path).set('X-Requested-With', 'XMLHttpRequest');
  expect(res.status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
