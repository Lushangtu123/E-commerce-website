/**
 * 健康检查测试（mock 全部数据库模块）
 */
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../database/rabbitmq', () => ({ getChannel: jest.fn() }));
jest.mock('../../database/mongodb', () => ({
  __esModule: true,
  default: { connection: { db: null } },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getPool } = require('../../database/mysql');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRedisClient } = require('../../database/redis');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getChannel } = require('../../database/rabbitmq');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mongoose = require('../../database/mongodb').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getHealthReport } = require('../../utils/health');

function mockAllUp() {
  getPool.mockReturnValue({ query: jest.fn().mockResolvedValue([[]]) });
  getRedisClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });
  mongoose.connection.db = { admin: () => ({ ping: jest.fn().mockResolvedValue({ ok: 1 }) }) };
  getChannel.mockReturnValue({});
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllUp();
});

test('全部依赖正常时状态为 ok', async () => {
  const report = await getHealthReport();
  expect(report.status).toBe('ok');
  expect(typeof report.timestamp).toBe('string');
  expect(typeof report.uptimeSeconds).toBe('number');
  for (const dep of Object.values(report.dependencies) as any[]) {
    expect(dep.status).toBe('up');
    expect(typeof dep.latencyMs).toBe('number');
  }
  expect(Object.keys(report.dependencies).sort()).toEqual(
    ['mongodb', 'mysql', 'rabbitmq', 'redis'].sort()
  );
});

test('MySQL 异常时状态为 degraded 并携带错误信息', async () => {
  getPool.mockReturnValue({
    query: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
  });
  const report = await getHealthReport();
  expect(report.status).toBe('degraded');
  expect(report.dependencies.mysql.status).toBe('down');
  expect(report.dependencies.mysql.error).toContain('ECONNREFUSED');
  expect(report.dependencies.redis.status).toBe('up');
});

test('依赖检查超时时标记为 down', async () => {
  getRedisClient.mockReturnValue({ ping: jest.fn().mockReturnValue(new Promise(() => {})) });
  const report = await getHealthReport();
  expect(report.status).toBe('degraded');
  expect(report.dependencies.redis.status).toBe('down');
  expect(report.dependencies.redis.error).toBe('检查超时');
}, 10000);

test('RabbitMQ 未初始化时标记为 down', async () => {
  getChannel.mockImplementation(() => {
    throw new Error('RabbitMQ未初始化');
  });
  const report = await getHealthReport();
  expect(report.status).toBe('degraded');
  expect(report.dependencies.rabbitmq.status).toBe('down');
});

test('MongoDB 未连接时标记为 down', async () => {
  mongoose.connection.db = null;
  const report = await getHealthReport();
  expect(report.status).toBe('degraded');
  expect(report.dependencies.mongodb.status).toBe('down');
  expect(report.dependencies.mongodb.error).toBe('MongoDB未初始化');
});
