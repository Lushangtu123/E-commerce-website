import express from 'express';
import request from 'supertest';
import Redis from 'ioredis';
import { rateLimit } from 'express-rate-limit';

const integration = process.env.REDIS_TEST_URL ? describe : describe.skip;
integration('真实 Redis 跨实例限流', () => {
  let client: Redis;
  beforeAll(() => { client = new Redis(process.env.REDIS_TEST_URL!, {
    keyPrefix: `ecommerce:test:limits:${process.pid}:${Date.now()}:`, maxRetriesPerRequest: 1,
  }); });
  afterAll(() => client.disconnect());
  test('两个应用实例共享计数，API 与认证窗口隔离', async () => {
    const { RedisRateLimitStore } = require('../../middleware/redis-rate-limit-store');
    const buildApp = () => {
      const app = express();
      app.get('/api', rateLimit({ windowMs: 60000, limit: 2,
        store: new RedisRateLimitStore('api:', () => client) }), (_req, res) => res.json({ ok: true }));
      app.get('/auth', rateLimit({ windowMs: 60000, limit: 2,
        store: new RedisRateLimitStore('auth:', () => client) }), (_req, res) => res.json({ ok: true }));
      return app;
    };
    const one = buildApp(), two = buildApp();
    await request(one).get('/api').expect(200);
    await request(two).get('/api').expect(200);
    await request(one).get('/api').expect(429);
    await request(two).get('/auth').expect(200);
    expect(await client.pttl('api:::ffff:127.0.0.1')).toBeGreaterThan(0);
  });
});
