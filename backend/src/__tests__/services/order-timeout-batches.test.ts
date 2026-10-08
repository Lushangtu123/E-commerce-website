jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/order.service', () => ({ transitionOrder: jest.fn(), invalidateOrderProductCache: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const KEY = 'order-timeouts:cursor:v1';
const row = (id: number) => ({ order_id: id, order_no: `order-${id}`, user_id: 1, created_at: new Date(0) });
let cursor: string | null;
let execute: jest.Mock;
let redis: { get: jest.Mock; eval: jest.Mock };
let transition: jest.Mock;
let warnings: jest.Mock;
let check: typeof import('../../services/order-timeout.service').checkAndCancelTimeoutOrders;

function loadWorker() {
  jest.resetModules();
  require('../../database/mysql').getPool.mockReturnValue({ execute });
  require('../../database/redis').getRedisClient.mockReturnValue(redis);
  transition = require('../../services/order.service').transitionOrder;
  warnings = require('../../utils/logger').default.warn;
  return require('../../services/order-timeout.service').checkAndCancelTimeoutOrders as typeof check;
}

beforeEach(() => {
  cursor = null;
  execute = jest.fn().mockResolvedValue([[], []]);
  redis = {
    get: jest.fn(async () => cursor),
    eval: jest.fn(async (_script: string, _keys: number, _key: string, expected: string, next: string) => {
      if ((cursor ?? '') !== expected) return 0;
      cursor = next;
      return 1;
    }),
  };
  check = loadWorker();
});

test('批次分别计成功、并发跳过和失败并继续后续订单', async () => {
  execute.mockResolvedValue([[row(1), row(2), row(3)], []]);
  transition.mockResolvedValueOnce({ changed: true, orderNo: 'order-1', productIds: [1] })
    .mockResolvedValueOnce({ changed: false, orderNo: 'order-2', productIds: [] })
    .mockRejectedValueOnce(new Error('inventory failure'));
  expect(await check()).toEqual({ checked: 3, cancelled: 1, failed: 1, skipped: 1 });
  expect(transition).toHaveBeenCalledTimes(3);
  expect(JSON.parse(cursor!).afterId).toBe(3);
  expect(redis.get).toHaveBeenCalledWith(KEY);
});

test('最早50笔永久失败不阻挡其他实例处理后续订单，尾部复位后重试旧失败', async () => {
  const pending = Array.from({ length: 51 }, (_, index) => row(index + 1));
  execute.mockImplementation(async (sql: string, params: number[] = []) => {
    const afterId = /order_id\s*>\s*\?/.test(sql) ? params[0] : 0;
    return [pending.filter(order => order.order_id > afterId).slice(0, 50), []];
  });
  const attempt = async (id: number) => {
    if (id <= 50) throw new Error('permanent inventory failure');
    pending.splice(pending.findIndex(order => order.order_id === id), 1);
    return { changed: true, orderNo: `order-${id}`, productIds: [] };
  };
  transition.mockImplementation(attempt);
  expect(await check()).toMatchObject({ checked: 50, cancelled: 0 });
  check = loadWorker();
  transition.mockImplementation(attempt);
  expect(await check()).toEqual({ checked: 1, cancelled: 1, failed: 0, skipped: 0 });
  expect(await check()).toEqual({ checked: 0, cancelled: 0, failed: 0, skipped: 0 });
  expect(await check()).toEqual({ checked: 50, cancelled: 0, failed: 50, skipped: 0 });
  expect(execute).toHaveBeenCalledTimes(4);
  expect(transition).toHaveBeenCalledTimes(51);
  for (const [sql] of execute.mock.calls) expect(sql).toMatch(/ORDER BY order_id LIMIT 50/);
});

test('晚结束的空批次不能覆盖其他实例已推进的新版本游标', async () => {
  cursor = JSON.stringify({ afterId: 50, version: 'old' });
  const newer = JSON.stringify({ afterId: 50, version: 'new-after-wrap' });
  execute.mockImplementation(async () => { cursor = newer; return [[], []]; });
  expect(await check()).toEqual({ checked: 0, cancelled: 0, failed: 0, skipped: 0 });
  expect(cursor).toBe(newer);
  expect(redis.eval).toHaveBeenCalled();
});

test('Redis读取失败时从头进行有界扫描且不覆盖未知进度', async () => {
  redis.get.mockRejectedValue(new Error('redis unavailable'));
  execute.mockResolvedValue([[row(1)], []]);
  transition.mockResolvedValue({ changed: true, orderNo: 'order-1', productIds: [] });
  expect(await check(1)).toEqual({ checked: 1, cancelled: 1, failed: 0, skipped: 0 });
  expect(execute.mock.calls[0][1]).toEqual([0]);
  expect(warnings).toHaveBeenCalled();
  expect(redis.eval).not.toHaveBeenCalled();
});

test('Redis游标写入失败不回滚或误报已完成的订单取消', async () => {
  execute.mockResolvedValue([[row(1)], []]);
  transition.mockResolvedValue({ changed: true, orderNo: 'order-1', productIds: [] });
  redis.eval.mockRejectedValue(new Error('redis unavailable'));
  expect(await check()).toEqual({ checked: 1, cancelled: 1, failed: 0, skipped: 0 });
  expect(warnings).toHaveBeenCalled();
});

test.each([0, 101])('拒绝无界或非法批次 %s，且不访问数据库和Redis', async batchSize => {
  await expect(check(batchSize)).rejects.toThrow('无效的订单检查批次大小');
  expect(execute).not.toHaveBeenCalled();
  expect(redis.get).not.toHaveBeenCalled();
});
