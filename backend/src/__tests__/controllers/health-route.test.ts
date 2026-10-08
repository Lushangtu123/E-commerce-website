jest.mock('../../load-env', () => ({}));
jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../database/rabbitmq', () => ({ getChannel: jest.fn(), isRabbitMQConfigured: () => false }));
jest.mock('../../database/elasticsearch', () => ({ getESClient: () => null }));

import request from 'supertest';

function fixture() {
  const mysql = jest.fn().mockResolvedValue([[]]);
  const redis = jest.fn().mockResolvedValue('PONG');
  require('../../database/mysql').getPool.mockReturnValue({ query: mysql });
  require('../../database/redis').getRedisClient.mockReturnValue({ ping: redis });
  return { app: require('../../app').createApp({ serverless: true }), mysql, redis };
}
beforeEach(() => { jest.resetModules(); });

test('health aliases share a local quota without charging the business API or Redis', async () => {
  const { app, mysql, redis } = fixture();
  for (let i = 0; i < 30; i++) await request(app).get(i % 2 ? '/health' : '/api/health').expect(200);
  const limited = await request(app).get('/api/health').expect(429);
  expect(limited.headers['retry-after']).toBeDefined();
  expect(limited.body.error).toBe('健康检查请求过于频繁，请稍后再试');
  expect(mysql).toHaveBeenCalledTimes(1);
  expect(redis).toHaveBeenCalledTimes(1);
  await request(app).get('/api/payments/settings').expect(200);
});

test('public health preserves 503 but hides service error details', async () => {
  const { app, mysql } = fixture();
  mysql.mockRejectedValue(new Error('audit-private-service-detail'));
  const response = await request(app).get('/api/health').expect(503);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.dependencies.mysql.error).toBe('依赖不可用');
  expect(JSON.stringify(response.body)).not.toContain('audit-private');
});
