/** Controller tests run the real order service and isolate only external boundaries. */
import { Response } from 'express';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/message-queue.service', () => ({ sendOrderTimeoutCheckMessage: jest.fn() }));

import { getPool, query } from '../../database/mysql';
import { getRedisClient } from '../../database/redis';
import { sendOrderTimeoutCheckMessage } from '../../services/message-queue.service';
import { OrderController } from '../../controllers/order.controller';

const ADDRESS = { receiver_name: '收件人', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '测试路1号' };
const PRODUCT = { product_id: 1, title: '测试商品', price: '99.00', stock: 10, main_image: 'img.jpg', status: 1 };
let products: any[];
let connection: any;

function mockRes() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  products = [PRODUCT];
  connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql: string) => {
      if (sql.includes('checkout_key =')) return [[], []];
      if (sql.includes('FROM users')) return [[{ user_id: 7 }], []];
      if (sql.includes('FROM product_skus')) return [[], []];
      if (sql.includes('FROM products')) return [products, []];
      if (sql.includes('FROM shipping_addresses')) return [[{ address_id: 3, ...ADDRESS }], []];
      if (sql.includes('INSERT INTO orders')) return [{ insertId: 1001, affectedRows: 1 }, []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  (getPool as jest.Mock).mockReturnValue({ getConnection: jest.fn().mockResolvedValue(connection) });
  (getRedisClient as jest.Mock).mockReturnValue({ del: jest.fn().mockResolvedValue(1) });
  (sendOrderTimeoutCheckMessage as jest.Mock).mockResolvedValue(true);
});

describe('create 创建订单', () => {
  test.each([undefined, null, '3', 0, -1, 1.5])('必须明确选择合法本人地址 address=%p，失败不创建事务', async address => {
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111',
      items: [{ product_id: 1, quantity: 1 }], shipping_address_id: address,
    } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(sendOrderTimeoutCheckMessage).not.toHaveBeenCalled();
  });

  test('负数数量返回 400，不创建订单或增加库存', async () => {
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111', items: [{ product_id: 1, quantity: -2 }] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  test('成功创建并返回订单 ID，提交后发送超时消息', async () => {
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111',
      items: [{ product_id: 1, quantity: 2 }], shipping_address_id: 3, remark: '尽快',
    } } as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ message: '订单创建成功', order_id: 1001, original_amount: 198, discount_amount: 0, total_amount: 198 });
    const orderInsert = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO orders'));
    expect(orderInsert[1]).toEqual([expect.any(String), 7, '198.00', 3, '尽快', 0, '198.00', '0.00', null, null, null, JSON.stringify(ADDRESS), '11111111-1111-4111-8111-111111111111', expect.stringMatching(/^[a-f0-9]{64}$/)]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(sendOrderTimeoutCheckMessage).toHaveBeenCalledWith(1001, 7);
    expect(connection.commit.mock.invocationCallOrder[0]).toBeLessThan((sendOrderTimeoutCheckMessage as jest.Mock).mock.invocationCallOrder[0]);
  });

  test('重试返回相同响应，不重复扣库存、移除购物车或发送超时消息', async () => {
    const body = { checkout_key: '11111111-1111-4111-8111-111111111111', shipping_address_id: 3, items: [{ product_id: 1, quantity: 2 }] };
    const first = mockRes();
    await OrderController.create({ userId: 7, body } as any, first);
    const insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO orders'));
    const execute = connection.execute.getMockImplementation();
    connection.execute.mockImplementation((sql: string, params: any[]) => sql.includes('checkout_key =')
      ? Promise.resolve([[{ order_id: 1001, checkout_fingerprint: insert[1].at(-1), original_amount: '198.00', discount_amount: '0.00', total_amount: '198.00' }], []])
      : execute(sql, params));
    const retried = mockRes();
    await OrderController.create({ userId: 7, body } as any, retried);
    expect(retried.json).toHaveBeenCalledWith((first.json as jest.Mock).mock.calls[0][0]);
    expect(getRedisClient().del).toHaveBeenCalledTimes(1);
    const statements = connection.execute.mock.calls.map(([sql]: [string]) => sql);
    for (const text of ['INSERT INTO orders', 'stock = stock -', 'DELETE FROM cart']) expect(statements.filter((sql: string) => sql.includes(text))).toHaveLength(1);
    expect(sendOrderTimeoutCheckMessage).toHaveBeenCalledTimes(1);
  });

  test.each([undefined, null, '', 'not-a-uuid', 123])('无效请求号 %p 不创建事务', async checkout_key => {
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key, items: [{ product_id: 1, quantity: 1 }], shipping_address_id: 3 } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('MQ 发送失败时已提交订单仍创建成功', async () => {
    (sendOrderTimeoutCheckMessage as jest.Mock).mockResolvedValue(false);
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111', shipping_address_id: 3, items: [{ product_id: 1, quantity: 1 }] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('订单商品为空时返回 400', async () => {
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111', items: [] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.execute).not.toHaveBeenCalled();
  });

  test('商品不存在时返回 400 并回滚', async () => {
    products = [];
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111', shipping_address_id: 3, items: [{ product_id: 999, quantity: 1 }] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('库存不足时返回 400 并回滚', async () => {
    products = [{ ...PRODUCT, stock: 1 }];
    const res = mockRes();
    await OrderController.create({ userId: 7, body: { checkout_key: '11111111-1111-4111-8111-111111111111', shipping_address_id: 3, items: [{ product_id: 1, quantity: 5 }] } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe('getDetail 订单详情', () => {
  test('订单不存在返回 404', async () => {
    (query as jest.Mock).mockResolvedValue([]);
    const res = mockRes();
    await OrderController.getDetail({ userId: 7, params: { id: '999' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('查看他人订单返回 403', async () => {
    (query as jest.Mock).mockResolvedValue([{ order_id: 1, user_id: 8 }]);
    const res = mockRes();
    await OrderController.getDetail({ userId: 7, params: { id: '1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
