jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/message-queue.service', () => ({ sendOrderTimeoutCheckMessage: jest.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../database/mysql';
import orderRoutes from '../../routes/order.routes';
import { OrderModel } from '../../models/order.model';
import { OrderController } from '../../controllers/order.controller';

const app = express(); app.use('/api/orders', orderRoutes);
const auth = { Authorization: `Bearer ${jwt.sign({ userId: 7 }, 'test-jwt-secret')}` };
beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockImplementation(async (sql: string) => sql.startsWith('SELECT auth_version') ? [{ auth_version: 0 }] : sql.includes('COUNT(*)') ? [{ total: 3 }] : [{ order_id: 2, user_id: 7, status: 0 }]);
});

test('未认证不能列订单；默认分页使用10且同时间按订单ID稳定排序', async () => {
  await request(app).get('/api/orders').expect(401);
  expect(query).not.toHaveBeenCalled();
  const response = await request(app).get('/api/orders').set(auth).expect(200);
  expect(response.body).toMatchObject({ page: 1, limit: 10, total: 3, totalPages: 1 });
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ORDER BY created_at DESC, order_id DESC LIMIT ? OFFSET ?'), [7, 10, 0]);
});

test.each(['0', '1', '2', '3', '4'])('合法状态%s与分页绑定参数，status0不会丢失', async status => {
  const response = await request(app).get(`/api/orders?status=${status}&page=2&limit=2`).set(auth).expect(200);
  expect(response.body).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
  expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('status = ?'), [7, Number(status)]);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), [7, Number(status), 2, 2]);
});

test.each([
  'status=1x', 'status=-1', 'status=5', 'status=1.5', 'status=', 'status=null', 'status=0&status=1',
  'page=-1', 'page=0', 'page=1x', 'page=1.5', 'page=', 'page=1&page=2', 'page=2147483648',
  'limit=0', 'limit=-1', 'limit=101', 'limit=2x', 'limit=', 'limit=1&limit=2', 'user_id=8',
])('非法订单查询仅检查会话且不执行订单SQL：%s', async params => {
  await request(app).get(`/api/orders?${params}`).set(auth).expect(400);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith('SELECT auth_version FROM users WHERE user_id = ?', [7]);
});

test('最大page与limit可安全计算并绑定offset', async () => {
  await request(app).get('/api/orders?page=2147483647&limit=100').set(auth).expect(200);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), [7, 100, 214748364600]);
});

test.each([
  [null, 1, 10], ['0', 1, 10], [-1, 1, 10], [5, 1, 10], [1.5, 1, 10],
  [undefined, 0, 10], [undefined, -1, 10], [undefined, '1', 10], [undefined, null, 10],
  [undefined, 1, 0], [undefined, 1, 101], [undefined, 1, 1.5], [undefined, 1, '10'],
])('模型分页直接调用拒绝非法状态/分页 %p/%p/%p', async (status, page, limit) => {
  await expect((OrderModel.listByUser as any)(7, status, page, limit)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});

test('controller非HTTP调用的null或数组分页也返回400', async () => {
  for (const params of [{ status: null }, { page: null }, { limit: null }, { status: ['1'] }, { page: ['1'] }]) {
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await OrderController.list({ userId: 7, query: params } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  }
  expect(query).not.toHaveBeenCalled();
});

test('数据库失败保持500且隐藏驱动细节', async () => {
  (query as jest.Mock).mockImplementation(async sql => {
    if (sql.startsWith('SELECT auth_version')) return [{ auth_version: 0 }];
    throw new Error('driver secret');
  });
  const response = await request(app).get('/api/orders').set(auth).expect(500);
  expect(response.body).toEqual({ error: '获取订单列表失败' });
});
