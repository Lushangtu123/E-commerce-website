/**
 * 限流中间件测试
 *
 * 注意：express 的 import 会被提升到文件顶部，所以这里用 require()
 * 加载被测模块，确保环境变量先生效；每个用例通过 jest.resetModules()
 * 拿到全新的限流器实例（内存计数器隔离）。
 */
process.env.RATE_LIMIT_WINDOW = '60000';
process.env.RATE_LIMIT_MAX = '3';
process.env.RATE_LIMIT_AUTH_MAX = '2';

import express from 'express';
import request from 'supertest';

function loadLimiters() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../middleware/rate-limit') as {
    apiLimiter: any;
    authLimiter: any;
  };
}

describe('apiLimiter 通用限流', () => {
  test('阈值内放行，超阈值返回 429', async () => {
    const { apiLimiter } = loadLimiters();
    const app = express();
    app.use('/api', apiLimiter);
    app.get('/api/ping', (req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/ping').expect(200);
    }
    const res = await request(app).get('/api/ping').expect(429);
    expect(res.body).toEqual({ error: '请求过于频繁，请稍后再试' });
  });

  test('返回标准 RateLimit 响应头', async () => {
    const { apiLimiter } = loadLimiters();
    const app = express();
    app.use(apiLimiter);
    app.get('/ping', (req, res) => res.json({ ok: true }));

    const res = await request(app).get('/ping').expect(200);
    // draft-7 标准：合并式 RateLimit 头
    expect(res.headers['ratelimit']).toMatch(/limit=3, remaining=2/);
    expect(res.headers['ratelimit-policy']).toBe('3;w=60');
  });
});

describe('authLimiter 登录限流', () => {
  function buildApp() {
    const { authLimiter } = loadLimiters();
    const app = express();
    app.use(express.json());
    app.post('/login', authLimiter, (req, res) => res.status(401).json({ error: 'bad' }));
    app.post('/login-ok', authLimiter, (req, res) => res.json({ ok: true }));
    return app;
  }

  test('连续失败达到阈值后返回 429', async () => {
    const app = buildApp();
    await request(app).post('/login').expect(401);
    await request(app).post('/login').expect(401);
    const res = await request(app).post('/login').expect(429);
    expect(res.body).toEqual({ error: '登录尝试过于频繁，请稍后再试' });
  });

  test('成功登录不计入限流次数', async () => {
    const app = buildApp();
    for (let i = 0; i < 10; i++) {
      await request(app).post('/login-ok').expect(200);
    }
  });
});
