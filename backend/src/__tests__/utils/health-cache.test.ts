jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../database/rabbitmq', () => ({ getChannel: jest.fn(), isRabbitMQConfigured: () => false }));
jest.mock('../../database/elasticsearch', () => ({ getESClient: () => null }));

function fixture() {
  const mysql = jest.fn().mockResolvedValue([[]]);
  const redis = jest.fn().mockResolvedValue('PONG');
  require('../../database/mysql').getPool.mockReturnValue({ query: mysql });
  require('../../database/redis').getRedisClient.mockReturnValue({ ping: redis });
  const health = require('../../utils/health');
  const report: typeof import('../../utils/health').getCachedHealthReport = health.getCachedHealthReport;
  return { mysql, redis, report };
}

beforeEach(() => { jest.resetModules(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('concurrent public reports share one dependency probe', async () => {
  const { report, mysql, redis } = fixture();
  const reports = await Promise.all(Array.from({ length: 20 }, () => report(true)));
  expect(reports.every(item => item.status === 'ok')).toBe(true);
  expect(mysql).toHaveBeenCalledTimes(1);
  expect(redis).toHaveBeenCalledTimes(1);
});

test('reports reuse probes for five seconds then refresh and expose a new failure', async () => {
  const { report, mysql, redis } = fixture();
  expect((await report(true)).status).toBe('ok');
  mysql.mockRejectedValue(new Error('synthetic database outage'));
  await jest.advanceTimersByTimeAsync(4999);
  expect((await report(true)).status).toBe('ok');
  expect(mysql).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect((await report(true)).status).toBe('degraded');
  expect(mysql).toHaveBeenCalledTimes(2);
  expect(redis).toHaveBeenCalledTimes(2);
});

test('unresolved underlying probes are not queued again after report timeouts', async () => {
  const { report, mysql, redis } = fixture();
  let recover!: () => void;
  mysql.mockReturnValue(new Promise<void>(resolve => { recover = resolve; }));
  const first = report(true);
  await jest.advanceTimersByTimeAsync(3000);
  expect((await first).dependencies.mysql.error).toBe('检查超时');
  await jest.advanceTimersByTimeAsync(5000);
  const second = report(true);
  await jest.advanceTimersByTimeAsync(3000);
  expect((await second).status).toBe('degraded');
  expect(mysql).toHaveBeenCalledTimes(1);
  expect(redis).toHaveBeenCalledTimes(2);
  recover();
  await jest.advanceTimersByTimeAsync(5000);
  mysql.mockResolvedValue([[]]);
  expect((await report(true)).status).toBe('ok');
  expect(mysql).toHaveBeenCalledTimes(2);
});

test('cached public dependency errors do not disclose raw service details', async () => {
  const { report, mysql } = fixture();
  mysql.mockRejectedValue(new Error('audit-private-host audit-private-query'));
  const result = await report(true);
  expect(result.status).toBe('degraded');
  expect(result.dependencies.mysql.error).toBe('依赖不可用');
  expect(JSON.stringify(result)).not.toContain('audit-private');
});

test('standalone and serverless report scopes stay distinct', async () => {
  const { report } = fixture();
  const esPing = jest.fn().mockResolvedValue(true);
  require('../../database/elasticsearch').getESClient = () => ({ ping: esPing });
  expect(Object.keys((await report(true)).dependencies)).toEqual(['mysql', 'redis']);
  expect((await report(false)).dependencies.elasticsearch.status).toBe('up');
  expect(esPing).toHaveBeenCalledTimes(1);
});
