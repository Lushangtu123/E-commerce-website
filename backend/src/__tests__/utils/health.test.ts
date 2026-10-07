/**
 * 健康检查测试（mock 全部数据库模块）
 */
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../database/rabbitmq', () => ({ getChannel: jest.fn(), isRabbitMQConfigured: jest.fn() }));
jest.mock('../../database/elasticsearch', () => ({ getESClient: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getPool } = require('../../database/mysql');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRedisClient } = require('../../database/redis');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getChannel, isRabbitMQConfigured } = require('../../database/rabbitmq');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getESClient } = require('../../database/elasticsearch');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getHealthReport } = require('../../utils/health');

function mockAllUp() {
  getPool.mockReturnValue({ query: jest.fn().mockResolvedValue([[]]) });
  getRedisClient.mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') });
  isRabbitMQConfigured.mockReturnValue(true);
  getChannel.mockReturnValue({});
  getESClient.mockReturnValue({ ping: jest.fn().mockResolvedValue(true) });
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
  expect(Object.keys(report.dependencies).sort()).toEqual(['elasticsearch', 'mysql', 'rabbitmq', 'redis']);
  expect(report.dependencies.rabbitmq.optional).toBe(true);
  expect(report.dependencies.elasticsearch.optional).toBe(true);
  expect(report.dependencies.mysql.optional).toBeUndefined();
});

test('Vercel 仅检查所部署的 MySQL 和 Redis，不要求常驻 RabbitMQ', async () => {
  getESClient.mockReturnValue(null);
  getChannel.mockImplementation(() => { throw new Error('RabbitMQ未初始化'); });
  const report = await getHealthReport(true);
  expect(report.status).toBe('ok');
  expect(Object.keys(report.dependencies).sort()).toEqual(['mysql', 'redis']);
});

test('未配置的可选依赖不出现在报告中', async () => {
  isRabbitMQConfigured.mockReturnValue(false);
  getESClient.mockReturnValue(null);
  const report = await getHealthReport();
  expect(report.status).toBe('ok');
  expect(Object.keys(report.dependencies).sort()).toEqual(['mysql', 'redis']);
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

test('RabbitMQ 断开时标记为 down，但整体仍为 ok', async () => {
  getChannel.mockImplementation(() => {
    throw new Error('RabbitMQ未初始化');
  });
  const report = await getHealthReport();
  expect(report.status).toBe('ok');
  expect(report.dependencies.rabbitmq.status).toBe('down');
});

test('Elasticsearch 不可用时标记为 down，但整体仍为 ok', async () => {
  getESClient.mockReturnValue({ ping: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) });
  const report = await getHealthReport();
  expect(report.status).toBe('ok');
  expect(report.dependencies.elasticsearch.status).toBe('down');
});
