import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { migrateSkuTables } from '../../database/migrate-sku';
import { migrateAddressTables } from '../../database/migrate-address';
import { migrateFulfillment } from '../../database/migrate-fulfillment';
import { migrateAfterSalesProgress } from '../../database/migrate-after-sales-progress';
import userRoutes from '../../routes/user.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../middleware/rate-limit', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Tests own and clean only personal_data_export_test_${pid}; DB_NAME is never used.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 个人信息导出', () => {
  const database = `personal_data_export_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const app = express(); app.use(express.json()); app.use('/api/users', userRoutes);
  const auth = (userId: number) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) await db.query(match[1]);
    const admin = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    const visits = admin.match(/(CREATE TABLE IF NOT EXISTS page_visits[\s\S]*?ENGINE[^`]*)/);
    await db.query(visits![1]);
    await migrateCouponTables(db);
    await migrateSkuTables(db);
    await migrateAddressTables(db);
    await migrateFulfillment(db);
    await migrateAfterSalesProgress(db);

    for (const userId of [1, 2]) {
      const n = userId === 1 ? 'one' : 'two';
      await db.query(`INSERT INTO users (user_id,username,email,password_hash,phone) VALUES (?,?,?,?,?)`,
        [userId, n, `${n}@example.test`, `hash_of_${n}`, `1380013800${userId}`]);
      await db.query(`INSERT INTO products (product_id,title,price,stock) VALUES (?,?,10,5)`, [userId * 10, `商品${n}`]);
      await db.query(`INSERT INTO shipping_addresses (user_id,receiver_name,phone,province,city,district,detail_address,is_default)
        VALUES (?,?,?,'省','市','区',?,1)`, [userId, `收货人${n}`, `1390013900${userId}`, `${n} 路 1 号`]);
      await db.query(`INSERT INTO orders (order_id,order_no,user_id,total_amount,original_amount,discount_amount,status,checkout_key,shipping_address_snapshot)
        VALUES (?,?,?,20,20,0,3,?,JSON_OBJECT('receiver_name',?))`, [userId * 100, `ORD${n}`, userId, `secret-checkout-${n}`, `收货人${n}`]);
      await db.query(`INSERT INTO order_items (order_id,product_id,product_name,quantity,price) VALUES (?,?,?,2,10)`, [userId * 100, userId * 10, `商品${n}`]);
      await db.query(`INSERT INTO reviews (product_id,user_id,order_id,rating,content) VALUES (?,?,?,5,?)`, [userId * 10, userId, userId * 100, `评价${n}`]);
      await db.query(`INSERT INTO favorites (user_id,product_id) VALUES (?,?)`, [userId, userId * 10]);
      await db.query(`INSERT INTO browse_history (user_id,product_id) VALUES (?,?)`, [userId, userId * 10]);
      await db.query(`INSERT INTO search_history (user_id,keyword,result_count) VALUES (?,?,1)`, [userId, `搜索${n}`]);
      await db.query(`INSERT INTO cart (user_id,product_id,quantity) VALUES (?,?,1)`, [userId, userId * 10]);
      await db.query(`INSERT INTO after_sales_requests (order_id,user_id,type,reason,status,reviewed_by) VALUES (?,?,'refund',?,'requested',99)`,
        [userId * 100, userId, `原因${n}`]);
      await db.query(`INSERT INTO page_visits (user_id,session_id,page_url,ip_address,user_agent) VALUES (?,?,?,?,'UA')`,
        [userId, `s${n}`, `/p/${n}`, `10.0.0.${userId}`]);
    }
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,min_amount,total_quantity,remain_quantity,status,start_time,end_time)
      VALUES (1,'WELCOME','新人券',1,5,0,10,9,1,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))`);
    await db.query(`INSERT INTO user_coupons (user_id,coupon_id,status,expired_at) VALUES (1,1,1,DATE_ADD(NOW(),INTERVAL 1 DAY))`);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  test('导出本人的全部个人信息，以 JSON 附件返回且不缓存', async () => {
    const res = await request(app).get('/api/users/data-export').set(auth(1)).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="personal-data-\d{8}\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = res.body;
    expect(data.format_version).toBe(1);
    expect(data.account).toMatchObject({ user_id: 1, username: 'one', email: 'one@example.test', phone: '13800138001' });
    expect(data.addresses).toEqual([expect.objectContaining({ receiver_name: '收货人one', detail_address: 'one 路 1 号' })]);
    expect(data.orders).toEqual([expect.objectContaining({ order_no: 'ORDone', shipping_address_snapshot: { receiver_name: '收货人one' },
      items: [expect.objectContaining({ product_name: '商品one', quantity: 2 })] })]);
    expect(data.after_sales).toEqual([expect.objectContaining({ order_no: 'ORDone', reason: '原因one' })]);
    expect(data.reviews).toEqual([expect.objectContaining({ content: '评价one', product_title: '商品one' })]);
    expect(data.favorites).toEqual([expect.objectContaining({ product_id: 10, product_title: '商品one' })]);
    expect(data.browse_history).toEqual([expect.objectContaining({ product_id: 10 })]);
    expect(data.search_history).toEqual([expect.objectContaining({ keyword: '搜索one' })]);
    expect(data.cart).toEqual([expect.objectContaining({ product_id: 10, quantity: 1 })]);
    expect(data.coupons).toEqual([expect.objectContaining({ name: '新人券', code: 'WELCOME' })]);
    expect(data.page_visits).toEqual([expect.objectContaining({ page_url: '/p/one', ip_address: '10.0.0.1' })]);
  });

  test('不含其他用户的数据，也不含密码哈希、会话版本和内部键', async () => {
    const res = await request(app).get('/api/users/data-export').set(auth(1)).expect(200);
    const text = JSON.stringify(res.body);
    for (const other of ['two@example.test', '收货人two', 'ORDtwo', '评价two', '搜索two', '10.0.0.2']) expect(text).not.toContain(other);
    for (const internal of ['hash_of_one', 'password_hash', 'auth_version', 'secret-checkout-one', 'checkout_key', 'reviewed_by']) expect(text).not.toContain(internal);
  });

  test('未登录不能导出', async () => {
    await request(app).get('/api/users/data-export').expect(401);
  });
});
