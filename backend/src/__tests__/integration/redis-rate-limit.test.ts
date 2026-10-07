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
    // express-rate-limit 8 keys IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) by their IPv4 form
    expect(await client.pttl('api:127.0.0.1')).toBeGreaterThan(0);
    expect(await client.pttl('auth:127.0.0.1')).toBeGreaterThan(0);
  });

  test('真实客户端终止后，连接入口恢复 PING 和限流计数', async () => {
    const previous = { url: process.env.REDIS_URL, prefix: process.env.REDIS_KEY_PREFIX };
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
    process.env.REDIS_KEY_PREFIX = `ecommerce:test:recovery:${process.pid}:${Date.now()}:`;
    const { connectRedis, getRedisClient } = require('../../database/redis');
    try {
      await connectRedis();
      const first = getRedisClient();
      expect(await first.ping()).toBe('PONG');
      await new Promise<void>(resolve => { first.once('end', resolve); first.disconnect(); });
      await Promise.all([connectRedis(), connectRedis()]);
      expect(await getRedisClient().ping()).toBe('PONG');
      const { RedisRateLimitStore } = require('../../middleware/redis-rate-limit-store');
      const app = express();
      app.get('/recovered', rateLimit({ windowMs: 60000, limit: 1,
        store: new RedisRateLimitStore('recovered:') }), (_req, res) => res.json({ ok: true }));
      await request(app).get('/recovered').expect(200);
      await request(app).get('/recovered').expect(429);
    } finally {
      try { getRedisClient().disconnect(); } catch {}
      if (previous.url === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous.url;
      if (previous.prefix === undefined) delete process.env.REDIS_KEY_PREFIX; else process.env.REDIS_KEY_PREFIX = previous.prefix;
    }
  });
});
