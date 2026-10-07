import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import { FavoriteModel } from '../../models/favorite.model';
import { BrowseHistoryModel } from '../../models/browse-history.model';
import { UserModel } from '../../models/user.model';
import { migrateCouponTables } from '../../database/migrate-coupon';
import favoriteRoutes from '../../routes/favorite.routes';
import browseRoutes from '../../routes/browse.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

// Own only customer_activity_test_${pid}; never run against the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 收藏与浏览历史边界', () => {
  const database = `customer_activity_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const app = express(); app.use(express.json()); app.use('/api/favorites', favoriteRoutes); app.use('/api/browse', browseRoutes);
  const auth = (userId = 1) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });
  const time = '2026-01-02 03:04:05';

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const tables = new Set(['users', 'products', 'product_skus', 'favorites', 'browse_history', 'orders']);
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (tables.has(match[2])) await db.query(match[1]);
    }
    await migrateCouponTables(db);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    for (const table of ['coupon_usage_logs', 'user_coupons', 'coupons', 'orders', 'browse_history', 'favorites', 'product_skus', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query(`INSERT INTO users (user_id,username,email,password_hash)
      VALUES (1,'one','one@example.test','test'),(2,'two','two@example.test','test')`);
    await db.query(`INSERT INTO products (product_id,title,price,stock,status)
      VALUES (1,'商品一',10,5,1),(2,'商品二',20,6,1),(3,'下架',30,7,0),(4,'软删除',40,8,-1),(5,'商品五',50,9,1)`);
  });

  async function raw(table: string) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY ${table === 'favorites' ? 'favorite_id' : 'id'}`); return rows;
  }

  test('真实HTTP鉴权、隔离和正常收藏/浏览响应保持原合同', async () => {
    await request(app).get('/api/favorites/my').expect(401); await request(app).get('/api/browse/history').expect(401);
    await request(app).post('/api/favorites').set(auth()).send({ product_id: 1 }).expect(200);
    expect((await request(app).post('/api/favorites').set(auth()).send({ product_id: 1 }).expect(200)).body.already_favorited).toBe(true);
    await request(app).post('/api/favorites').set(auth(2)).send({ product_id: 2 }).expect(200);
    await request(app).post('/api/browse/record').set(auth()).send({ product_id: 1 }).expect(200);
    await request(app).post('/api/browse/record').set(auth(2)).send({ product_id: 2 }).expect(200);
    const favorites = await request(app).get('/api/favorites/my').set(auth()).expect(200);
    expect(favorites.body.pagination).toEqual({ page: 1, limit: 20, total: 1, total_pages: 1 });
    expect(favorites.body.favorites.map((row: any) => row.product_id)).toEqual([1]);
    const history = await request(app).get('/api/browse/history').set(auth()).expect(200);
    expect(history.body.pagination).toEqual({ page: 1, limit: 20, total: 1, total_pages: 1 });
    expect(history.body.history.map((row: any) => row.product_id)).toEqual([1]);
    expect((await request(app).get('/api/favorites/check/2').set(auth()).expect(200)).body.is_favorited).toBe(false);
    expect((await request(app).post('/api/favorites/check-multiple').set(auth()).send({ product_ids: [1, 2] }).expect(200)).body.favorites).toEqual({ 1: true, 2: false });
    await request(app).delete('/api/favorites/2').set(auth()).expect(404);
    await request(app).delete('/api/browse/history/2').set(auth()).expect(404);
  });

  test.each([3, 4, 999])('不存在/非上架商品%s拒绝新增且不留下孤儿', async product_id => {
    await request(app).post('/api/favorites').set(auth()).send({ product_id }).expect(404);
    await request(app).post('/api/favorites/toggle').set(auth()).send({ product_id }).expect(404);
    await request(app).post('/api/browse/record').set(auth()).send({ product_id }).expect(404);
    expect(await raw('favorites')).toHaveLength(0); expect(await raw('browse_history')).toHaveLength(0);
  });

  test('历史孤儿保留可删除行，NULL商品投影安全fallback，原计数与个人统计不减少', async () => {
    await db.query('INSERT INTO favorites (user_id,product_id) VALUES (1,999),(1,3),(2,999)');
    await db.query('INSERT INTO browse_history (user_id,product_id) VALUES (1,999),(1,3),(2,999)');
    const favorite = await request(app).get('/api/favorites/my').set(auth()).expect(200);
    const history = await request(app).get('/api/browse/history').set(auth()).expect(200);
    for (const row of [favorite.body.favorites.find((row: any) => row.product_id === 999), history.body.history.find((row: any) => row.product_id === 999)]) {
      expect(row).toMatchObject({ product_id: 999, title: '商品已不存在', price: 0, stock: 0, status: -1, has_sku: 0 });
      expect(row).not.toHaveProperty('existing_product_id');
    }
    expect(favorite.body.pagination.total).toBe(2); expect(history.body.pagination.total).toBe(2);
    expect(await FavoriteModel.getFavoriteCount(1)).toBe(2);
    expect(await UserModel.getStats(1)).toMatchObject({ favoriteCount: 2 });
    expect((await request(app).post('/api/favorites/toggle').set(auth()).send({ product_id: 999 }).expect(200)).body.is_favorited).toBe(false);
    await request(app).delete('/api/browse/history/999').set(auth()).expect(200);
    expect(await FavoriteModel.isFavorited(2, 999)).toBe(true); expect(await BrowseHistoryModel.hasViewed(2, 999)).toBe(true);
  });

  test('收藏时间并列按favorite_id倒序，删除最后页后保留正确总数', async () => {
    await db.query('INSERT INTO favorites (favorite_id,user_id,product_id,created_at) VALUES (11,1,1,?),(12,1,2,?),(13,1,5,?),(14,2,1,?)', [time, time, time, time]);
    const first = await request(app).get('/api/favorites/my?page=1&limit=2').set(auth()).expect(200);
    const last = await request(app).get('/api/favorites/my?page=2&limit=2').set(auth()).expect(200);
    expect(first.body.favorites.map((row: any) => row.favorite_id)).toEqual([13, 12]);
    expect(last.body.favorites.map((row: any) => row.favorite_id)).toEqual([11]);
    await request(app).delete('/api/favorites/1').set(auth()).expect(200);
    const empty = await request(app).get('/api/favorites/my?page=2&limit=2').set(auth()).expect(200);
    expect(empty.body.favorites).toEqual([]); expect(empty.body.pagination).toEqual({ page: 2, limit: 2, total: 2, total_pages: 1 });
    expect(await FavoriteModel.getFavoriteCount(2)).toBe(1);
  });

  test('浏览去重按最新真实时间再ID，乱序id与时间不会错误取MAX(id)', async () => {
    await db.query(`INSERT INTO browse_history (id,user_id,product_id,browsed_at)
      VALUES (10,1,1,'2026-01-03 03:04:05'),(90,1,1,'2026-01-01 03:04:05'),
             (20,1,2,'2026-01-02 03:04:05'),(21,1,2,'2026-01-02 03:04:05'),
             (30,1,5,'2026-01-02 03:04:05'),(100,2,1,'2026-01-04 03:04:05')`);
    const first = await request(app).get('/api/browse/history?page=1&limit=2').set(auth()).expect(200);
    const last = await request(app).get('/api/browse/history?page=2&limit=2').set(auth()).expect(200);
    expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 3, total_pages: 2 });
    expect(first.body.history.map((row: any) => [row.id, row.product_id])).toEqual([[10, 1], [30, 5]]);
    expect(last.body.history.map((row: any) => [row.id, row.product_id])).toEqual([[21, 2]]);
    expect(first.body.history[0].browsed_at).toBe('2026-01-03T03:04:05.000Z');
    await request(app).delete('/api/browse/history/2').set(auth()).expect(200);
    const empty = await request(app).get('/api/browse/history?page=2&limit=2').set(auth()).expect(200);
    expect(empty.body.history).toEqual([]); expect(empty.body.pagination.total).toBe(2);
    expect(await BrowseHistoryModel.hasViewed(2, 1)).toBe(true);
  });

  test('推荐最近ID使用兼容MySQL8的group最新时间排序，去重且稳定', async () => {
    await db.query(`INSERT INTO browse_history (id,user_id,product_id,browsed_at)
      VALUES (10,1,1,'2026-01-03 03:04:05'),(90,1,1,'2026-01-01 03:04:05'),
             (20,1,2,'2026-01-02 03:04:05'),(30,1,5,'2026-01-02 03:04:05'),
             (100,2,4,'2026-01-04 03:04:05')`);
    expect(await BrowseHistoryModel.getRecentProductIds(1)).toEqual([1, 5, 2]);
    expect(await BrowseHistoryModel.getRecentProductIds(1, 2)).toEqual([1, 5]);
  });

  test('清空只删除本人历史，重复清空保持原空响应', async () => {
    await db.query('INSERT INTO browse_history (user_id,product_id) VALUES (1,1),(1,1),(2,1),(2,2)');
    expect((await request(app).delete('/api/browse/history').set(auth()).expect(200)).body).toEqual({ message: '清除成功', cleared: true });
    expect((await raw('browse_history')).map(row => row.user_id)).toEqual([2, 2]);
    expect((await request(app).delete('/api/browse/history').set(auth()).expect(200)).body).toEqual({ message: '暂无浏览历史', cleared: false });
  });

  test('SKU投影保留规格价格/库存和has_sku，停用全部规格仍为规格商品', async () => {
    await db.query(`INSERT INTO product_skus (product_id,sku_code,specs,price,stock)
      VALUES (1,'RED','{"色":"红"}',3,2),(1,'BLUE','{"色":"蓝"}',5,4)`);
    await request(app).post('/api/favorites').set(auth()).send({ product_id: 1 }).expect(200);
    await request(app).post('/api/browse/record').set(auth()).send({ product_id: 1 }).expect(200);
    for (const rows of [(await FavoriteModel.getUserFavorites(1)).favorites, (await BrowseHistoryModel.getUserHistory(1)).history]) {
      expect(rows[0]).toMatchObject({ price: '3.00', stock: '6', has_sku: 1 });
    }
    await db.query('UPDATE product_skus SET status = 0 WHERE product_id = 1');
    expect((await FavoriteModel.getUserFavorites(1)).favorites[0]).toMatchObject({ stock: '0', has_sku: 1 });
  });

  test('BIGINT商品2147483650可保存、单批检查、记录和删除，保留数值精度', async () => {
    const id = 2147483650;
    await db.query("INSERT INTO products (product_id,title,price,stock,status) VALUES (?,'大ID商品',1,1,1)", [id]);
    await request(app).post('/api/favorites').set(auth()).send({ product_id: id }).expect(200);
    await request(app).post('/api/browse/record').set(auth()).send({ product_id: id }).expect(200);
    expect((await request(app).get(`/api/favorites/check/${id}`).set(auth()).expect(200)).body.is_favorited).toBe(true);
    expect((await request(app).post('/api/favorites/check-multiple').set(auth()).send({ product_ids: [id, 1] }).expect(200)).body.favorites).toEqual({ [id]: true, 1: false });
    expect((await FavoriteModel.getUserFavorites(1)).favorites[0].product_id).toBe(id);
    expect(await BrowseHistoryModel.getRecentProductIds(1)).toEqual([id]);
    await request(app).delete(`/api/favorites/${id}`).set(auth()).expect(200);
    await request(app).delete(`/api/browse/history/${id}`).set(auth()).expect(200);
    expect(await raw('favorites')).toHaveLength(0); expect(await raw('browse_history')).toHaveLength(0);
  });

  test('非法参数不会执行SQL或修改原行，直接模型边界也拒绝', async () => {
    await db.query('INSERT INTO favorites (user_id,product_id) VALUES (1,1)');
    await db.query('INSERT INTO browse_history (user_id,product_id) VALUES (1,1)');
    const favorites = await raw('favorites'); const history = await raw('browse_history'); (query as jest.Mock).mockClear();
    for (const suffix of ['page=0', 'page=1x', 'limit=101', 'page=1&page=2', 'user_id=2']) {
      await request(app).get(`/api/favorites/my?${suffix}`).set(auth()).expect(400);
      await request(app).get(`/api/browse/history?${suffix}`).set(auth()).expect(400);
    }
    await request(app).post('/api/favorites').set(auth()).send({ product_id: '1' }).expect(400);
    await request(app).post('/api/favorites/check-multiple').set(auth()).send({ product_ids: [1, '2'] }).expect(400);
    await request(app).delete('/api/browse/history/1x').set(auth()).expect(400);
    await expect(FavoriteModel.getUserFavorites(1, 0)).rejects.toThrow(); await expect(BrowseHistoryModel.getRecentProductIds(1, 101)).rejects.toThrow();
    expect((query as jest.Mock).mock.calls).toHaveLength(13);
    for (const [sql, params] of (query as jest.Mock).mock.calls) {
      expect(sql).toBe('SELECT auth_version, status FROM users WHERE user_id = ?'); expect(params).toEqual([1]);
    }
    expect(await raw('favorites')).toEqual(favorites); expect(await raw('browse_history')).toEqual(history);
  });
  test('推荐使用 MySQL 浏览记录及有效SKU库存，排除已浏览和下架商品', async () => {
    await db.query('UPDATE products SET category_id=1');
    await db.query('INSERT INTO product_skus(product_id,sku_code,price,stock,status) VALUES(5,?,12,0,0)', ['REC-DISABLED']);
    await BrowseHistoryModel.add(1, 1);
    const { getRecommendationsByBrowseHistory, getRelatedProducts } = require('../../services/recommendation.service');
    const personalized = await getRecommendationsByBrowseHistory(1, 10);
    expect(personalized.map((p: any) => p.product_id)).toEqual([2]);
    const related = await getRelatedProducts(1, 10);
    expect(related.map((p: any) => p.product_id)).toEqual([2]);
  });

});
