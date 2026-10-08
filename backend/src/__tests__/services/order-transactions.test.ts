import { Response } from 'express';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/message-queue.service', () => ({ sendOrderTimeoutCheckMessage: jest.fn() }));

import { getPool, query } from '../../database/mysql';
import { getRedisClient } from '../../database/redis';
import { sendOrderTimeoutCheckMessage } from '../../services/message-queue.service';
import { OrderController } from '../../controllers/order.controller';
import { cancelTimeoutOrder, checkAndCancelTimeoutOrders } from '../../services/order-timeout.service';
import { getAdminOrderDetail, getOrderStatistics, updateOrderStatus } from '../../controllers/admin-order.controller';

const ADDRESS = { receiver_name: '收件人', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '测试路1号' };
const PRODUCT = { product_id: 1, title: '商品', price: '19.99', stock: 10, main_image: 'image.jpg', status: 1 };
let order: any;
let productMissing: boolean;
let addressOwned: boolean;
let deductionFails: boolean;
let failSql: string | undefined;
let connection: any;
let pool: any;
let redis: any;

function response() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function request(body: any = {}, userId = 7) {
  return { userId, body: { shipping_address_id: 3, checkout_key: '11111111-1111-4111-8111-111111111111', ...body }, params: { id: '1001', orderId: '1001' }, query: {}, admin: { adminId: 1 }, get: () => undefined } as any;
}

function matching(pattern: string) {
  return connection.execute.mock.calls.filter(([sql]: [string]) => sql.includes(pattern));
}

beforeEach(() => {
  jest.clearAllMocks();
  order = { order_id: 1001, order_no: 'test-order', user_id: 7, status: 0, created_at: new Date(), has_timed_out: 1 };
  productMissing = false;
  addressOwned = true;
  deductionFails = false;
  failSql = undefined;
  connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM users')) return [[{ user_id: 7 }], []];
      if (failSql && sql.includes(failSql)) throw new Error('database failure');
      if (sql.includes('FROM product_skus')) return [[], []];
      if (sql.includes('FROM products')) return [productMissing ? [] : [{ ...PRODUCT, product_id: params[0] }], []];
      if (sql.includes('FROM shipping_addresses')) return [addressOwned ? [{ address_id: 3, ...ADDRESS }] : [], []];
      if (sql.includes('FROM order_items')) {
        return [[{ item_id: 1, order_id: 1001, product_id: 1, sku_id: null, quantity: 2 }], []];
      }
      if (sql.includes('checkout_key =')) return [[], []];
      if (sql.includes('FROM orders')) return [[{ ...order }], []];
      if (sql.includes('INSERT INTO orders')) return [{ insertId: 1001, affectedRows: 1 }, []];
      if (sql.includes('stock = stock -')) return [{ affectedRows: deductionFails ? 0 : 1 }, []];
      if (sql.includes('UPDATE orders')) {
        order.status = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 1 }, []];
    }),
  };
  pool = {
    getConnection: jest.fn().mockResolvedValue(connection),
    query: jest.fn((sql: string, params: any[]) => connection.execute(sql, params)),
    execute: jest.fn((sql: string, params: any[]) => connection.execute(sql, params)),
  };
  (getPool as jest.Mock).mockReturnValue(pool);
  (query as jest.Mock).mockImplementation(async (sql: string, params: any[]) => (await connection.execute(sql, params))[0]);
  redis = { del: jest.fn().mockResolvedValue(1) };
  (getRedisClient as jest.Mock).mockReturnValue(redis);
  (sendOrderTimeoutCheckMessage as jest.Mock).mockResolvedValue(true);
});

describe('下单原子性', () => {
  test('双语商品与SKU快照只取服务器锁定内容，忽略客户端伪造翻译', async () => {
    const original = connection.execute.getMockImplementation();
    const specs = { 颜色: '红色', 尺寸: 42, 防水: false };
    const specs_en = { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' } };
    connection.execute.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('FROM products')) return [[{ ...PRODUCT, title_en: 'Server shirt' }], []];
      if (sql.includes('FROM product_skus')) return [[{ sku_id: 11, product_id: 1, sku_code: 'RED', specs, specs_en, stock: 3, price: '19.99', status: 1 }], []];
      return original(sql, params);
    });
    const res = response();
    await OrderController.create(request({ items: [{ product_id: 1, sku_id: 11, quantity: 1, title_en: 'Forged', specs_en: { 颜色: { value: 'Forged' } } }] }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(matching('FROM products')[0][0]).toContain('title_en');
    expect(matching('FROM product_skus')[0][0]).toContain('specs_en');
    const [sql, params] = matching('INSERT INTO order_items')[0];
    expect(sql).toContain('product_name_en');
    expect(sql).toContain('sku_specs_en');
    expect(params).toContain('Server shirt');
    expect(params).toContain(JSON.stringify(specs_en));
    expect(params).not.toContain('Forged');
  });

  test('重复商品合并、按商品 ID 加锁，并按服务器价格写入订单', async () => {
    const res = response();
    await OrderController.create(request({ items: [
      { product_id: 2, quantity: 1, price: 0 },
      { product_id: 1, quantity: 1 },
      { product_id: 1, quantity: 2 },
    ], shipping_address_id: 3 }), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(matching('FROM products').map(([sql, params]: [string, any[]]) => ({ locked: sql.includes('FOR UPDATE'), id: params[0] })))
      .toEqual([{ locked: true, id: 1 }, { locked: true, id: 2 }]);
    expect(matching('INSERT INTO order_items').map(([, params]: [string, any[]]) => params.slice(-2)))
      .toEqual([[3, '19.99'], [1, '19.99']]);
    expect(matching('INSERT INTO orders')[0][1]).toContain('79.96');
    expect(matching('DELETE FROM cart')).toHaveLength(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test.each([0, -1, 1.5, '2', null])('拒绝非法 quantity=%p，事务开始前返回 400', async quantity => {
    const res = response();
    await OrderController.create(request({ items: [{ product_id: 1, quantity }] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('条件扣库存返回零行时回滚，不清购物车也不发送超时消息', async () => {
    deductionFails = true;
    const res = response();
    await OrderController.create(request({ items: [{ product_id: 1, quantity: 1 }] }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(matching('DELETE FROM cart')).toHaveLength(0);
    expect(sendOrderTimeoutCheckMessage).not.toHaveBeenCalled();
  });

  test.each(['INSERT INTO order_items', 'DELETE FROM cart'])('%s 数据库失败时回滚所有变更', async sql => {
    failSql = sql;
    const res = response();
    await OrderController.create(request({ items: [{ product_id: 1, quantity: 1 }] }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('不能使用他人的收货地址', async () => {
    addressOwned = false;
    const res = response();
    await OrderController.create(request({ items: [{ product_id: 1, quantity: 1 }], shipping_address_id: 3 }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(matching('FROM shipping_addresses')[0][1]).toEqual([3, 7]);
    expect(matching('INSERT INTO orders')).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('提交后 Redis 与 MQ 拒绝也返回创建成功', async () => {
    redis.del.mockRejectedValue(new Error('redis down'));
    (sendOrderTimeoutCheckMessage as jest.Mock).mockRejectedValue(new Error('mq down'));
    const res = response();
    await OrderController.create(request({ items: [{ product_id: 1, quantity: 1 }] }), res);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(sendOrderTimeoutCheckMessage).toHaveBeenCalledWith(1001, 7);
  });
});

describe('订单状态迁移', () => {
  test('手动取消恢复商品库存，重复请求不能重复回补', async () => {
    const first = response();
    await OrderController.cancel(request(), first);
    expect(first.json).toHaveBeenCalledWith({ message: '订单已取消' });
    expect(matching('FROM orders')[0][0]).toContain('FOR UPDATE');
    expect(matching('stock = stock +')[0][1]).toEqual([2, 1, 2147483645]);
    expect(order.status).toBe(4);

    const second = response();
    await OrderController.cancel(request(), second);
    expect(second.status).toHaveBeenCalledWith(400);
    expect(matching('stock = stock +')).toHaveLength(1);
  });

  test('支付只计销量一次，取消不能覆盖已支付订单', async () => {
    order.has_timed_out = 0;
    const first = response();
    await OrderController.pay(request(), first);
    expect(first.json).toHaveBeenCalledWith({ message: '模拟支付完成，未实际扣款', payment_mode: 'demo' });
    expect(matching('FROM orders')[0][0]).toContain('FOR UPDATE');
    expect(matching('UPDATE orders')[0][0]).toContain('paid_at = NOW()');
    expect(order.status).toBe(1);
    await OrderController.pay(request(), response());
    const cancel = response();
    await OrderController.cancel(request(), cancel);
    expect(cancel.status).toHaveBeenCalledWith(400);
    expect(matching('sales_count = sales_count +')).toHaveLength(1);
    expect(matching('stock = stock +')).toHaveLength(0);
  });

  test.each([1, '1'])('数据库行锁确认已到期时拒绝付款且不改变库存、券或销量（%s）', async timedOut => {
    order.has_timed_out = timedOut;
    order.user_coupon_id = 3;
    const res = response();
    await OrderController.pay(request(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: '订单支付已超时，请重新下单' });
    expect(matching('FROM orders')[0][0]).toContain('FOR UPDATE');
    expect(matching('FROM orders')[0][0]).toMatch(/created_at\s*<=\s*DATE_SUB\(NOW\(\), INTERVAL 30 MINUTE\)/);
    expect(connection.execute.mock.calls.filter(([sql]: [string]) => /^UPDATE\b/i.test(sql))).toHaveLength(0);
    expect(matching('FROM order_items')).toHaveLength(0);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(redis.del).not.toHaveBeenCalled();
    expect(order.status).toBe(0);
  });

  test('付款等待订单行锁跨过截止时间后，按取得锁后的数据库时间拒绝', async () => {
    order.has_timed_out = 0;
    const original = connection.execute.getMockImplementation();
    connection.execute.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('FROM orders') && !sql.includes('FOR UPDATE')) return Promise.resolve([[{ has_timed_out: 1 }], []]);
      return original(sql, params);
    });
    const res = response();
    await OrderController.pay(request(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: '订单支付已超时，请重新下单' });
    expect(connection.execute.mock.calls.filter(([sql]: [string]) => /^UPDATE\b/i.test(sql))).toHaveLength(0);
  });

  test('库存回补失败时回滚取消状态', async () => {
    failSql = 'stock = stock +';
    const res = response();
    await OrderController.cancel(request(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('不能操作他人的订单', async () => {
    const res = response();
    await OrderController.pay(request({}, 8), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(matching('UPDATE orders')).toHaveLength(0);
  });

  test('后台已支付订单发货写 shipped_at，禁止回退到待支付', async () => {
    order.status = 1;
    const shipped = response();
    await updateOrderStatus(request({ status: 2, shipping_company: '顺丰', tracking_number: 'SFTEST1001' }), shipped);
    expect(shipped.json).toHaveBeenCalledWith({ message: '更新成功', status: 2 });
    expect(matching('UPDATE orders')[0][0]).toContain('shipped_at = NOW()');
    expect(matching('UPDATE orders')[0][0]).not.toContain('updated_at');
    const backwards = response();
    await updateOrderStatus(request({ status: 0 }), backwards);
    expect(backwards.status).toHaveBeenCalledWith(400);
    expect(matching('UPDATE orders')).toHaveLength(1);
  });

  test('用户确认已发货订单写 completed_at', async () => {
    order.status = 2;
    const res = response();
    await OrderController.confirm(request(), res);
    expect(res.json).toHaveBeenCalledWith({ message: '确认收货成功' });
    expect(matching('UPDATE orders')[0][0]).toContain('completed_at = NOW()');
  });
});

describe('超时和后台 schema 兼容', () => {
  test('尚未满 30 分钟时不取消', async () => {
    order.has_timed_out = 0;
    expect(await cancelTimeoutOrder(1001)).toBe(false);
    expect(matching('FROM orders')[0][0]).toMatch(/created_at\s*<=\s*DATE_SUB\(NOW\(\), INTERVAL 30 MINUTE\)/);
    expect(matching('stock = stock +')).toHaveLength(0);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('到期取消兼容迁移后的无规格历史明细，重复执行不回补', async () => {
    expect(await cancelTimeoutOrder(1001)).toBe(true);
    expect(await cancelTimeoutOrder(1001)).toBe(false);
    expect(matching('stock = stock +')).toHaveLength(1);
    expect(matching('FROM order_items')[0][0]).toContain('sku_id');
  });

  test('定时任务使用准确的 30 分钟边界', async () => {
    await checkAndCancelTimeoutOrders();
    expect(pool.execute.mock.calls[0][0]).toMatch(/created_at\s*<=\s*DATE_SUB\(NOW\(\), INTERVAL 30 MINUTE\)/);
  });

  test('后台订单详情使用已存地址快照，不回读当前地址', async () => {
    const res = response();
    await getAdminOrderDetail(request(), res);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('o.*');
    expect(sql).not.toContain('JOIN shipping_addresses');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ receiver_name: null, recipient_phone: null, detail_address: null }),
    }));
    expect(sql).not.toContain('sa.postal_code');
    expect(sql).not.toContain('sa.recipient_name');
  });

  test('后台统计已发货=2、已完成=3、已取消=4', async () => {
    await getOrderStatistics(request(), response());
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('status = 2 THEN 1 ELSE 0 END) as shipped');
    expect(sql).toContain('status = 3 THEN 1 ELSE 0 END) as completed');
    expect(sql).toContain('status = 4 THEN 1 ELSE 0 END) as cancelled');
    expect(sql).not.toContain('status = 5');
  });
});
