import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import userRoutes from '../../routes/user.routes';
import orderRoutes from '../../routes/order.routes';
import { UserModel } from '../../models/user.model';
import { OrderModel } from '../../models/order.model';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/message-queue.service', () => ({ sendOrderTimeoutCheckMessage: jest.fn() }));

// Tests own and clean only profile_stats_test_${pid}; DB_NAME is never used.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 个人统计与订单分页', () => {
  const database = `profile_stats_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  let couponId: number;
  const app = express(); app.use(express.json()); app.use('/api/users', userRoutes); app.use('/api/orders', orderRoutes);
  const auth = (userId = 1) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const tables = new Set(['users', 'orders', 'favorites', 'products']);
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
    for (const table of ['coupon_usage_logs', 'user_coupons', 'coupons', 'favorites', 'orders', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query(`INSERT INTO users (user_id,username,email,password_hash)
      VALUES (1,'one','one@example.test','private_hash'),(2,'two','two@example.test','private_hash')`);
    couponId = 0;
  });

  async function coupon(changes: Record<string, any> = {}, receipt: Record<string, any> = {}) {
    const definition = { type: 1, discount_value: 5, min_amount: 0, max_discount: null, status: 1, ...changes };
    const id = ++couponId;
    await db.query(`INSERT INTO coupons
      (coupon_id,code,name,type,discount_value,min_amount,max_discount,total_quantity,remain_quantity,status,start_time,end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, 100, 50, ?, DATE_SUB(NOW(),INTERVAL 1 DAY), DATE_ADD(NOW(),INTERVAL 1 DAY))`,
    [id, `C${id}`, `券${id}`, definition.type, definition.discount_value, definition.min_amount, definition.max_discount, definition.status]);
    const received = { user_id: 1, status: 1, ...receipt };
    await db.query('INSERT INTO user_coupons (user_id,coupon_id,status,expired_at) VALUES (?, ?, ?, DATE_ADD(NOW(),INTERVAL 1 DAY))', [received.user_id, id, received.status]);
    return id;
  }

  async function orders() {
    // All timestamps match deliberately: ID descending must make every page deterministic.
    for (const [index, status] of [0, 1, 2, 3, 4, 0].entries()) {
      await db.query('INSERT INTO orders (order_id,order_no,user_id,total_amount,status,created_at) VALUES (?, ?, 1, 10, ?, ?)', [index + 1, `U1-${index}`, status, '2026-01-02 03:04:05']);
    }
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status,created_at) VALUES (20,'U2',2,10,0,'2026-01-02 03:04:05')");
  }

  test('真实认证统计返回当前用户空计数，删除用户撤销会话401，不暴露用户私密字段', async () => {
    await request(app).get('/api/users/stats').expect(401);
    const admin = jwt.sign({ adminId: 1, type: 'admin' }, 'test-jwt-secret');
    await request(app).get('/api/users/stats').set('Authorization', `Bearer ${admin}`).expect(401);
    const response = await request(app).get('/api/users/stats?user_id=2').set(auth()).expect(200);
    expect(response.body).toEqual({ stats: { totalOrders: 0, pendingOrders: 0, totalCoupons: 0, availableCoupons: 0, favoriteCount: 0 } });
    await db.query('DELETE FROM users WHERE user_id = 1');
    await request(app).get('/api/users/stats').set(auth()).expect(401);
  });

  test('订单/券/收藏总量按本人统计，券门槛不减少可用数量，不发生JOIN倍增', async () => {
    await orders();
    await coupon({ min_amount: 999999 });
    await coupon({ type: 2, discount_value: 100, max_discount: 0 });
    await coupon({ type: 3, discount_value: 5, max_discount: 10 });
    await coupon({}, { status: 2 }); await coupon({}, { status: 3 });
    await coupon({}, { user_id: 2 });
    await db.query("INSERT INTO products (product_id,title,price,stock,status) VALUES (1,'上架',1,1,1),(2,'删除',1,1,-1)");
    await db.query('INSERT INTO favorites (user_id,product_id) VALUES (1,1),(1,2),(1,999),(2,1)');
    (query as jest.Mock).mockClear();
    const response = await request(app).get('/api/users/stats?user_id=2').set(auth()).expect(200);
    expect(response.body).toEqual({ stats: { totalOrders: 6, pendingOrders: 2, totalCoupons: 5, availableCoupons: 3, favoriteCount: 3 } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT auth_version FROM users WHERE user_id = ?', [1]);
    expect(await UserModel.getStats(2)).toEqual({ totalOrders: 1, pendingOrders: 1, totalCoupons: 1, availableCoupons: 1, favoriteCount: 1 });
  });

  test('可用券过滤用户状态、启用时间、过期时间及非法历史规则，读取不改券状态', async () => {
    await coupon(); // the one valid receipt
    await coupon({ status: 0 });
    const future = await coupon(); await db.query('UPDATE coupons SET start_time = DATE_ADD(NOW(),INTERVAL 1 DAY) WHERE coupon_id = ?', [future]);
    const ended = await coupon(); await db.query('UPDATE coupons SET end_time = NOW() WHERE coupon_id = ?', [ended]);
    const expired = await coupon(); await db.query('UPDATE user_coupons SET expired_at = NOW() WHERE coupon_id = ?', [expired]);
    await coupon({}, { status: 2 }); await coupon({}, { status: 3 });
    for (const rule of [
      { type: 9 }, { discount_value: 0 }, { discount_value: -1 },
      { type: 2, discount_value: 101 }, { min_amount: -1 }, { min_amount: null },
      { type: 3, min_amount: 1 }, { max_discount: -1 },
    ]) await coupon(rule);
    const [before] = await db.query('SELECT * FROM user_coupons ORDER BY user_coupon_id');
    const result = await request(app).get('/api/users/stats').set(auth()).expect(200);
    expect(result.body.stats).toMatchObject({ totalCoupons: 15, availableCoupons: 1 });
    const [after] = await db.query('SELECT * FROM user_coupons ORDER BY user_coupon_id'); expect(after).toEqual(before);
  });

  test('有效期start等于现在可用，正数折扣封顶可用，user同券多张逐张计数', async () => {
    const id = await coupon({ type: 2, discount_value: 20, min_amount: 1000, max_discount: 5 });
    await db.query('UPDATE coupons SET start_time = NOW() WHERE coupon_id = ?', [id]);
    await db.query('INSERT INTO user_coupons (user_id,coupon_id,status,expired_at) VALUES (1,?,1,DATE_ADD(NOW(),INTERVAL 1 DAY))', [id]);
    expect(await UserModel.getStats(1)).toMatchObject({ totalCoupons: 2, availableCoupons: 2 });
  });

  test('订单列表真实驱动分页稳定、status0/取消筛选与总数隔离', async () => {
    await orders();
    await request(app).get('/api/orders').expect(401);
    const first = await request(app).get('/api/orders?page=1&limit=2').set(auth()).expect(200);
    const second = await request(app).get('/api/orders?page=2&limit=2').set(auth()).expect(200);
    expect(first.body).toMatchObject({ total: 6, page: 1, limit: 2, totalPages: 3 });
    expect(first.body.orders.map((order: any) => order.order_id)).toEqual([6, 5]);
    expect(second.body.orders.map((order: any) => order.order_id)).toEqual([4, 3]);
    const pending = await request(app).get('/api/orders?status=0').set(auth()).expect(200);
    expect(pending.body).toMatchObject({ total: 2, page: 1, limit: 10, totalPages: 1 });
    expect(pending.body.orders.map((order: any) => order.order_id)).toEqual([6, 1]);
    const cancelled = await request(app).get('/api/orders?status=4').set(auth()).expect(200);
    expect(cancelled.body).toMatchObject({ total: 1 }); expect(cancelled.body.orders[0].order_id).toBe(5);
    const other = await request(app).get('/api/orders').set(auth(2)).expect(200);
    expect(other.body.total).toBe(1); expect(other.body.orders[0].order_id).toBe(20);
    const empty = await request(app).get('/api/orders?page=2147483647&limit=100').set(auth()).expect(200);
    expect(empty.body.orders).toEqual([]); expect(empty.body.total).toBe(6);
  });

  test('非法分页HTTP或直接模型调用不查询和修改数据库，未知用户范围不能覆盖登录用户', async () => {
    await orders();
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM orders ORDER BY order_id');
    (query as jest.Mock).mockClear();
    for (const params of ['page=1x', 'page=-1', 'page=0', 'limit=101', 'status=5', 'status=0&status=1', 'page=1&page=2', 'user_id=2']) {
      await request(app).get(`/api/orders?${params}`).set(auth()).expect(400);
    }
    await expect(OrderModel.listByUser(1, undefined, 0, 10)).rejects.toThrow();
    expect((query as jest.Mock).mock.calls).toHaveLength(8);
    for (const [sql, params] of (query as jest.Mock).mock.calls) {
      expect(sql).toBe('SELECT auth_version FROM users WHERE user_id = ?'); expect(params).toEqual([1]);
    }
    const [after] = await db.query<RowDataPacket[]>('SELECT * FROM orders ORDER BY order_id'); expect(after).toEqual(before);
  });
});
