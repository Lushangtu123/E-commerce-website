import Redis from 'ioredis';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/order.service', () => ({ transitionOrder: jest.fn(), invalidateOrderProductCache: jest.fn().mockResolvedValue(undefined) }));

const integration = process.env.REDIS_TEST_URL ? describe : describe.skip;
integration('真实 Redis 保存订单超时扫描进度', () => {
  const key = 'order-timeouts:cursor:v1';
  let client: Redis;
  const pending = [1, 2, 3];
  const execute = jest.fn(async (_sql: string, params: number[]) => [pending.filter(id => id > params[0]).slice(0, 2).map(order_id => ({ order_id, order_no: `test-${order_id}` })), []]);
  function worker() {
    jest.resetModules();
    require('../../database/mysql').getPool.mockReturnValue({ execute });
    require('../../database/redis').getRedisClient.mockReturnValue(client);
    require('../../services/order.service').transitionOrder.mockImplementation(async (id: number) => {
      if (id < 3) throw new Error('synthetic inventory failure');
      pending.splice(pending.indexOf(id), 1);
      return { changed: true, productIds: [], orderNo: `test-${id}` };
    });
    return require('../../services/order-timeout.service').checkAndCancelTimeoutOrders;
  }
  beforeAll(() => { client = new Redis(process.env.REDIS_TEST_URL!, {
    keyPrefix: `ecommerce:test:timeouts:${process.pid}:${Date.now()}:`, maxRetriesPerRequest: 1, protocol: 2,
  }); });
  afterAll(async () => { if (client) { await client.del(key); client.disconnect(); } });

  test('新实例越过失败批次并处理后续订单，尾部重置后旧失败可再试', async () => {
    expect(await worker()(2)).toEqual({ checked: 2, cancelled: 0, failed: 2, skipped: 0 });
    const first = JSON.parse((await client.get(key))!);
    expect(first.afterId).toBe(2);
    expect(await client.ttl(key)).toBeGreaterThan(0);
    expect(await worker()(2)).toEqual({ checked: 1, cancelled: 1, failed: 0, skipped: 0 });
    expect(await worker()(2)).toMatchObject({ checked: 0 });
    expect(JSON.parse((await client.get(key))!).afterId).toBe(0);
    expect(await worker()(2)).toEqual({ checked: 2, cancelled: 0, failed: 2, skipped: 0 });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  test('真实Lua比较版本，迟到的复位无法覆盖新扫描进度', async () => {
    await client.set(key, JSON.stringify({ afterId: 100, version: 'old' }));
    const newer = JSON.stringify({ afterId: 100, version: 'new' });
    execute.mockImplementationOnce(async () => { await client.set(key, newer); return [[], []]; });
    await worker()(2);
    expect(await client.get(key)).toBe(newer);
  });
});
