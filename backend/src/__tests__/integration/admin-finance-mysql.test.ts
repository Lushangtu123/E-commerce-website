import fs from 'node:fs';
import path from 'node:path';
import mysql, { Pool, ResultSetHeader } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { getPool } from '../../database/mysql';
import { getDashboardStats, getSalesTrend, getTopProducts } from '../../controllers/admin-dashboard.controller';
import { getOrderStatistics } from '../../controllers/admin-order.controller';
import { getAdminUsers, getAdminUserDetail } from '../../controllers/admin-user.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 管理员收入统计', () => {
  const database = `admin_finance_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00', connectionLimit: 3 };
  let server: Pool, db: Pool, created = false;
  const app = express();
  app.get('/dashboard', getDashboardStats);
  app.get('/trend', getSalesTrend);
  app.get('/top', getTopProducts);
  app.get('/orders/stats', getOrderStatistics);
  app.get('/users', getAdminUsers);
  app.get('/users/:userId', getAdminUserDetail);
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'orders', 'products', 'order_items'].includes(match[2])) await db.query(match[1]);
    }
    // Legacy baseline needs status for user-management SQL; production migration owns this column.
    const [columns] = await db.query<any[]>("SHOW COLUMNS FROM users LIKE 'status'");
    if (!columns.length) await db.query('ALTER TABLE users ADD COLUMN status TINYINT NOT NULL DEFAULT 1');
    await db.query('CREATE TABLE shipping_addresses (address_id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT, is_default TINYINT, created_at DATETIME)');
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'fixture','fixture@example.test','not-a-password')");
    await db.query("INSERT INTO products(title,price,stock,status) VALUES('fixture',10,1,1)");
  });
  beforeEach(async () => {
    await db.query('DELETE FROM order_items');
    await db.query('DELETE FROM orders');
    for (const [status, amount] of [[0, 1000], [1, 10.10], [2, 20.20], [3, 30.30], [4, 2000]]) {
      const [order] = await db.query<ResultSetHeader>('INSERT INTO orders(order_no,user_id,total_amount,status,created_at) VALUES(?,1,?,?,UTC_TIMESTAMP())', [`status-${status}`, amount, status]);
      await db.query("INSERT INTO order_items(order_id,product_id,product_name,price,quantity) VALUES(?,1,'fixture',?,1)", [order.insertId, amount]);
    }
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  test('今日收入与趋势只计算已付款状态，订单数量保留全部状态', async () => {
    const stats = await request(app).get('/dashboard').expect(200);
    expect(stats.body.today_orders).toBe(5);
    expect(Number(stats.body.today_revenue)).toBe(60.60);
    const trend = await request(app).get('/trend').expect(200);
    expect(trend.body).toHaveLength(1);
    expect(Number(trend.body[0].revenue)).toBe(60.60);
    expect(Number(trend.body[0].order_count)).toBe(5);
  });
  test('订单统计和用户累计消费排除未付款取消金额，平均订单值仅计算已付款订单', async () => {
    const stats = await request(app).get('/orders/stats').expect(200);
    expect(stats.body.total_orders).toBe(5);
    expect(Number(stats.body.total_revenue)).toBe(60.60);
    expect(Number(stats.body.avg_order_value)).toBe(20.20);
    const users = await request(app).get('/users').expect(200);
    expect(Number(users.body.users[0].total_spent)).toBe(60.60);
    const detail = await request(app).get('/users/1').expect(200);
    expect(Number(detail.body.user.total_spent)).toBe(60.60);
  });
  test('没有已付款订单时收入和平均订单值为零', async () => {
    await db.query('DELETE FROM order_items WHERE order_id IN (SELECT order_id FROM orders WHERE status IN (1,2,3))');
    await db.query('DELETE FROM orders WHERE status IN (1,2,3)');
    const stats = await request(app).get('/orders/stats').expect(200);
    expect(stats.body.total_revenue).not.toBeNull();
    expect(stats.body.avg_order_value).not.toBeNull();
    expect(Number(stats.body.total_revenue)).toBe(0);
    expect(Number(stats.body.avg_order_value)).toBe(0);
  });
  test('热销商品只累计已付款订单的销量和收入', async () => {
    const products = await request(app).get('/top').expect(200);
    expect(products.body).toHaveLength(1);
    expect(Number(products.body[0].total_sales)).toBe(3);
    expect(Number(products.body[0].total_revenue)).toBe(60.60);
  });
});
