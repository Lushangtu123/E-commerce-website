jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

const originalEnv = { ...process.env };
beforeEach(() => { jest.resetModules(); });
afterEach(() => { process.env = { ...originalEnv }; });

test('云 MySQL 使用 CA 校验证书，并限制每个实例的连接数', async () => {
  const mysql = require('mysql2/promise');
  process.env.DB_SSL = 'true';
  process.env.DB_SSL_CA_BASE64 = Buffer.from('test-ca').toString('base64');
  process.env.DB_CONNECTION_LIMIT = '2';
  const connection = { ping: jest.fn().mockResolvedValue(undefined), release: jest.fn() };
  const pool = { getConnection: jest.fn().mockResolvedValue(connection), end: jest.fn() };
  (mysql.createPool as jest.Mock).mockReturnValue(pool);
  const { connectDatabase } = require('../../database/mysql');
  await connectDatabase();
  expect(mysql.createPool).toHaveBeenCalledWith(expect.objectContaining({
    connectionLimit: 2, connectTimeout: 10000,
    ssl: { ca: 'test-ca', rejectUnauthorized: true },
  }));
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('Upstash rediss URL 启用 TLS，商城缓存隔离且并发请求复用连接', async () => {
  process.env.REDIS_URL = 'rediss://default:fixture-password@redis.example.test:6379';
  process.env.REDIS_KEY_PREFIX = 'ecommerce:preview:';
  const Redis = require('ioredis').default;
  const client = { on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined), ping: jest.fn().mockResolvedValue('PONG'), disconnect: jest.fn() };
  Redis.mockReturnValue(client);
  const { connectRedis, getRedisClient } = require('../../database/redis');
  await Promise.all([connectRedis(), connectRedis()]);
  await connectRedis();
  expect(Redis).toHaveBeenCalledTimes(1);
  expect(Redis).toHaveBeenCalledWith(process.env.REDIS_URL, expect.objectContaining({
    lazyConnect: true, keyPrefix: 'ecommerce:preview:', maxRetriesPerRequest: 1,
    connectTimeout: 10000, commandTimeout: 5000,
  }));
  expect(getRedisClient()).toBe(client);
});

test('并发冷启动只初始化一个 MySQL 池，连接失败后释放资源并允许重试', async () => {
  const mysql = require('mysql2/promise');
  const connection = { ping: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined), release: jest.fn() };
  const pool = { getConnection: jest.fn().mockResolvedValue(connection), end: jest.fn().mockResolvedValue(undefined) };
  mysql.createPool.mockReturnValue(pool);
  const { connectDatabase, getPool } = require('../../database/mysql');
  const results = await Promise.allSettled([connectDatabase(), connectDatabase()]);
  expect(mysql.createPool).toHaveBeenCalledTimes(1);
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(connection.release).toHaveBeenCalledTimes(1);
  expect(pool.end).toHaveBeenCalledTimes(1);
  expect(() => getPool()).toThrow('数据库未初始化');
  await Promise.all([connectDatabase(), connectDatabase()]);
  await connectDatabase();
  expect(mysql.createPool).toHaveBeenCalledTimes(2);
  expect(getPool()).toBe(pool);
});
