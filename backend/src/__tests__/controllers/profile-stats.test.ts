jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../database/mysql';
import userRoutes from '../../routes/user.routes';
import { UserModel } from '../../models/user.model';

const app = express(); app.use(express.json()); app.use('/api/users', userRoutes);
const auth = (userId = 7) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });
const stats = { totalOrders: 8, pendingOrders: 2, totalCoupons: 9, availableCoupons: 3, favoriteCount: 4 };

beforeEach(() => { jest.clearAllMocks(); (query as jest.Mock).mockResolvedValue([{ ...stats }]); });

test('个人统计需要用户认证，管理员令牌或匿名不能读取', async () => {
  await request(app).get('/api/users/stats').expect(401);
  const admin = jwt.sign({ adminId: 1, type: 'admin' }, 'test-jwt-secret');
  await request(app).get('/api/users/stats').set('Authorization', `Bearer ${admin}`).expect(401);
  expect(query).not.toHaveBeenCalled();
});

test('只按登录用户单次查询，query user_id不能更改范围，DTO不泄露原始数据', async () => {
  (query as jest.Mock).mockResolvedValue([{ ...stats, totalOrders: '8', password_hash: 'private', user_id: 999, email: 'private@example.test' }]);
  const response = await request(app).get('/api/users/stats?user_id=999').set(auth()).expect(200);
  expect(response.body).toEqual({ stats });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(expect.any(String), [7]);
});

test('有效空用户返回五项零，删除的用户返回404', async () => {
  const zero = Object.fromEntries(Object.keys(stats).map(key => [key, 0]));
  (query as jest.Mock).mockResolvedValue([zero]);
  expect((await request(app).get('/api/users/stats').set(auth()).expect(200)).body).toEqual({ stats: zero });
  (query as jest.Mock).mockResolvedValue([]);
  await request(app).get('/api/users/stats').set(auth()).expect(404);
});

test('数据库未知错误返回500且不暴露内部信息', async () => {
  (query as jest.Mock).mockRejectedValue(new Error('private db secret'));
  const response = await request(app).get('/api/users/stats').set(auth()).expect(500);
  expect(response.body).toEqual({ error: '获取个人统计失败' });
});

test.each([0, -1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 1])('模型统计直接调用也拒绝非法用户ID %p', async userId => {
  await expect((UserModel as any).getStats(userId)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
