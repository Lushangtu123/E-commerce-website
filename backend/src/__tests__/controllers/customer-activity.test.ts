jest.mock('../../database/mysql', () => ({ query: jest.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../database/mysql';
import favoriteRoutes from '../../routes/favorite.routes';
import browseRoutes from '../../routes/browse.routes';
import { FavoriteModel } from '../../models/favorite.model';
import { BrowseHistoryModel } from '../../models/browse-history.model';

const app = express(); app.use(express.json()); app.use('/api/favorites', favoriteRoutes); app.use('/api/browse', browseRoutes);
const auth = { Authorization: `Bearer ${jwt.sign({ userId: 7 }, 'test-jwt-secret')}` };
let available: boolean;
let favorited: boolean;
let orphan: boolean;
const expectOnlyAuthentication = () => {
  expect((query as jest.Mock).mock.calls.filter(([sql]) => !sql.startsWith('SELECT auth_version'))).toHaveLength(0);
  for (const [, params] of (query as jest.Mock).mock.calls) expect(params).toEqual([7]);
};

beforeEach(() => {
  jest.clearAllMocks(); available = true; favorited = false; orphan = false;
  (query as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT auth_version')) return [{ auth_version: 0 }];
    if (sql.startsWith('INSERT')) return { insertId: available ? 50 : 0, affectedRows: available ? 1 : 0 };
    if (sql.startsWith('DELETE')) return { affectedRows: 1 };
    if (sql.startsWith('SELECT 1 FROM favorites')) return favorited ? [{ 1: 1 }] : [];
    if (sql.includes('COUNT(')) return [{ total: 3, count: 3 }];
    return [{ favorite_id: 1, id: 1, user_id: 7, product_id: 1, existing_product_id: orphan ? null : 1, title: orphan ? null : '商品', price: orphan ? null : '3.00', stock: orphan ? null : 3, status: orphan ? null : 1, has_sku: orphan ? null : 0 }];
  });
});

test('所有收藏/历史端点都需要用户登录，未认证不查数据库', async () => {
  await request(app).get('/api/favorites/my').expect(401);
  await request(app).post('/api/favorites').send({ product_id: 1 }).expect(401);
  await request(app).post('/api/favorites/toggle').send({ product_id: 1 }).expect(401);
  await request(app).delete('/api/favorites/1').expect(401);
  await request(app).get('/api/browse/history').expect(401);
  await request(app).post('/api/browse/record').send({ product_id: 1 }).expect(401);
  await request(app).delete('/api/browse/history').expect(401);
  expect(query).not.toHaveBeenCalled();
});

test.each([
  'page=0', 'page=-1', 'page=1x', 'page=1.5', 'page=', 'page=01', 'page=1&page=2', 'page[]=1', 'page=2147483648',
  'limit=0', 'limit=-1', 'limit=101', 'limit=1x', 'limit=', 'limit=1&limit=2', 'limit[]=1', 'user_id=8', 'unknown=x',
])('列表严格拒绝非法/未知参数 %s，仅验证会话，不查询业务数据', async parameters => {
  await request(app).get(`/api/favorites/my?${parameters}`).set(auth).expect(400);
  await request(app).get(`/api/browse/history?${parameters}`).set(auth).expect(400);
  expectOnlyAuthentication();
});

test('默认分页20和规范最大整数页，响应保留pagination合同及绑定参数', async () => {
  const favorite = await request(app).get('/api/favorites/my').set(auth).expect(200);
  expect(favorite.body.pagination).toEqual({ page: 1, limit: 20, total: 3, total_pages: 1 });
  expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [7, 20, 0]);
  const history = await request(app).get('/api/browse/history?page=2147483647&limit=100').set(auth).expect(200);
  expect(history.body.pagination).toEqual({ page: 2147483647, limit: 100, total: 3, total_pages: 1 });
  expect(query).toHaveBeenNthCalledWith(5, expect.any(String), [7, 100, 214748364600]);
});

test.each([0, -1, 1.5, '1', null, true, [], Number.MAX_SAFE_INTEGER + 1])('商品body严格数值正整数 %p', async product_id => {
  for (const endpoint of ['/api/favorites', '/api/favorites/toggle', '/api/browse/record']) {
    await request(app).post(endpoint).set(auth).send({ product_id }).expect(400);
  }
  expectOnlyAuthentication();
});

test('商品body拒绝未知字段和空body，尤其不能提供user_id', async () => {
  for (const endpoint of ['/api/favorites', '/api/favorites/toggle', '/api/browse/record']) {
    await request(app).post(endpoint).set(auth).send({ product_id: 1, user_id: 8 }).expect(400);
    await request(app).post(endpoint).set(auth).send({}).expect(400);
  }
  expectOnlyAuthentication();
});

test.each(['0', '-1', '1x', '1.5', '01', '9007199254740992'])('商品path严格规范正整数 %s', async id => {
  await request(app).delete(`/api/favorites/${id}`).set(auth).expect(400);
  await request(app).get(`/api/favorites/check/${id}`).set(auth).expect(400);
  await request(app).delete(`/api/browse/history/${id}`).set(auth).expect(400);
  expectOnlyAuthentication();
});

test.each([[], Array(101).fill(1), [1, '2'], [1, null], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], '1,2'])('批量check严格1..100整数数组 %p', async product_ids => {
  await request(app).post('/api/favorites/check-multiple').set(auth).send({ product_ids }).expect(400);
  expectOnlyAuthentication();
});

test('批量check拒绝未知字段，合法数组仅按本人owner绑定', async () => {
  await request(app).post('/api/favorites/check-multiple').set(auth).send({ product_ids: [1], user_id: 8 }).expect(400);
  expectOnlyAuthentication();
  await request(app).post('/api/favorites/check-multiple').set(auth).send({ product_ids: [1, 2] }).expect(200);
  expect(query).toHaveBeenCalledWith(expect.any(String), [7, 1, 2]);
});

test('新增收藏/历史通过上架商品条件插入，不存在或下架时404', async () => {
  available = false;
  await request(app).post('/api/favorites').set(auth).send({ product_id: 1 }).expect(404);
  await request(app).post('/api/favorites/toggle').set(auth).send({ product_id: 1 }).expect(404);
  await request(app).post('/api/browse/record').set(auth).send({ product_id: 1 }).expect(404);
  const insertions = (query as jest.Mock).mock.calls.filter(([sql]: [string]) => sql.startsWith('INSERT'));
  expect(insertions).toHaveLength(3);
  for (const [sql, values] of insertions) {
    expect(sql).toMatch(/SELECT.+FROM products.+status = 1/s);
    expect(values).toEqual([7, 1]);
  }
});

test('取消已有孤儿收藏不检查商品，新增合法商品保持原响应', async () => {
  favorited = true; available = false;
  const response = await request(app).post('/api/favorites/toggle').set(auth).send({ product_id: 999 }).expect(200);
  expect(response.body).toEqual({ message: '取消收藏成功', is_favorited: false });
  expect((query as jest.Mock).mock.calls.some(([sql]: [string]) => sql.startsWith('INSERT'))).toBe(false);
  available = true;
  expect((await request(app).post('/api/favorites').set(auth).send({ product_id: 1 }).expect(200)).body.favorite_id).toBe(50);
  expect((await request(app).post('/api/browse/record').set(auth).send({ product_id: 1 }).expect(200)).body.id).toBe(50);
});

test('孤儿列表投影安全默认值并保留原product_id供删除，总量不减少', async () => {
  orphan = true;
  const favorite = await request(app).get('/api/favorites/my').set(auth).expect(200);
  const history = await request(app).get('/api/browse/history').set(auth).expect(200);
  for (const item of [favorite.body.favorites[0], history.body.history[0]]) {
    expect(item).toMatchObject({ product_id: 1, title: '商品已不存在', price: 0, stock: 0, status: -1, has_sku: 0 });
    expect(item).not.toHaveProperty('existing_product_id');
  }
  expect(favorite.body.pagination.total).toBe(3); expect(history.body.pagination.total).toBe(3);
});

test('删除/清空/计数使用req.userId提供的owner并保留原响应', async () => {
  await request(app).delete('/api/favorites/1').set(auth).expect(200);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), [7, 1]);
  await request(app).delete('/api/browse/history/1').set(auth).expect(200);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), [7, 1]);
  await request(app).delete('/api/browse/history').set(auth).expect(200);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), [7]);
  expect((await request(app).get('/api/favorites/count').set(auth).expect(200)).body).toEqual({ count: 3 });
});

test.each([[0, 20], [-1, 20], ['1', 20], [null, 20], [2147483648, 20], [1, 0], [1, 101], [1, '20'], [1, 1.5]])('直接模型列表拒绝非法分页 %p/%p', async (page, limit) => {
  await expect((FavoriteModel.getUserFavorites as any)(7, page, limit)).rejects.toThrow();
  await expect((BrowseHistoryModel.getUserHistory as any)(7, page, limit)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});

test('直接模型商品/批量/recent边界拒绝无效值', async () => {
  await expect(FavoriteModel.add(7, -1)).rejects.toThrow();
  await expect(FavoriteModel.remove(7, 0)).rejects.toThrow();
  await expect(FavoriteModel.isFavorited(7, 1.5)).rejects.toThrow();
  await expect(FavoriteModel.checkMultipleFavorites(7, [])).rejects.toThrow();
  await expect(BrowseHistoryModel.add(7, Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow();
  await expect(BrowseHistoryModel.deleteRecord(7, -1)).rejects.toThrow();
  await expect(BrowseHistoryModel.getRecentProductIds(7, 101)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});

test('未知数据库异常仍是500且不泄露内部信息', async () => {
  (query as jest.Mock).mockImplementation(async sql => {
    if (sql.startsWith('SELECT auth_version')) return [{ auth_version: 0 }];
    throw new Error('private database secret');
  });
  const result = await request(app).get('/api/favorites/my').set(auth).expect(500);
  expect(result.body).toEqual({ message: '获取收藏列表失败' });
});
