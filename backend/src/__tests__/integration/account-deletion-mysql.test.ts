import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool, query } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { migrateSkuTables } from '../../database/migrate-sku';
import { migrateAddressTables } from '../../database/migrate-address';
import { migrateAddressCreations } from '../../database/migrate-address-creations';
import { migrateCartAdds } from '../../database/migrate-cart-adds';
import { migrateAccountSecurity } from '../../database/migrate-account-security';
import { migrateFulfillment } from '../../database/migrate-fulfillment';
import { migrateAfterSalesProgress } from '../../database/migrate-after-sales-progress';
import userRoutes from '../../routes/user.routes';
import reviewRoutes from '../../routes/review.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ del: jest.fn(async () => 0), get: jest.fn(async () => null), setex: jest.fn() }) }));
jest.mock('../../middleware/rate-limit', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Tests own and clean only account_deletion_test_${pid}; DB_NAME is never used.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 账号注销', () => {
  const database = `account_deletion_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const app = express(); app.use(express.json()); app.use('/api/users', userRoutes); app.use('/api/reviews', reviewRoutes);
  const auth = (userId: number) => ({ Authorization: `Bearer ${jwt.sign({ userId, authVersion: 0 }, 'test-jwt-secret')}` });
  const PASSWORD = 'correct horse battery staple';
  const one = async <T extends RowDataPacket>(sql: string, params: unknown[] = []) => ((await db.query<T[]>(sql, params))[0])[0];
  const count = async (table: string, userId = 1) => Number((await one(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [userId]))!.n);

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) await db.query(match[1]);
    const admin = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    await db.query(admin.match(/(CREATE TABLE IF NOT EXISTS page_visits[\s\S]*?ENGINE[^`]*)/)![1]);
    for (const step of [migrateCouponTables, migrateSkuTables, migrateAddressTables, migrateAddressCreations, migrateCartAdds,
      migrateAccountSecurity, migrateFulfillment, migrateAfterSalesProgress]) await step(db);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    for (const table of ['after_sales_requests', 'coupon_usage_logs', 'user_coupons', 'coupons', 'reviews', 'order_items', 'orders', 'cart',
      'cart_add_receipts', 'favorites', 'browse_history', 'search_history', 'shipping_addresses', 'address_creation_receipts',
      'password_reset_tokens', 'page_visits', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
    const hash = await bcrypt.hash(PASSWORD, 4);
    for (const userId of [1, 2]) {
      const n = userId === 1 ? 'one' : 'two';
      await db.query(`INSERT INTO users (user_id,username,email,password_hash,phone,avatar_url) VALUES (?,?,?,?,?,?)`,
        [userId, n, `${n}@example.test`, hash, `1380013800${userId}`, `https://img.example/${n}.png`]);
      await db.query(`INSERT INTO products (product_id,title,price,stock) VALUES (?,?,10,5)`, [userId * 10, `商品${n}`]);
      await db.query(`INSERT INTO shipping_addresses (user_id,receiver_name,phone,detail_address) VALUES (?,?,?,?)`, [userId, `收货人${n}`, '13900139000', `${n} 路`]);
      await db.query(`INSERT INTO address_creation_receipts (user_id,create_key,address_id,payload_fingerprint) VALUES (?,UUID(),1,REPEAT('a',64))`, [userId]);
      await db.query(`INSERT INTO orders (order_id,order_no,user_id,total_amount,original_amount,discount_amount,status,shipping_address_snapshot)
        VALUES (?,?,?,20,20,0,3,JSON_OBJECT('receiver_name',?))`, [userId * 100, `ORD${n}`, userId, `收货人${n}`]);
      await db.query(`INSERT INTO reviews (product_id,user_id,order_id,rating,content) VALUES (?,?,?,5,?)`, [userId * 10, userId, userId * 100, `评价${n}`]);
      await db.query(`INSERT INTO cart (user_id,product_id,quantity) VALUES (?,?,1)`, [userId, userId * 10]);
      await db.query(`INSERT INTO cart_add_receipts (user_id,add_key,payload_fingerprint) VALUES (?,UUID(),REPEAT('b',64))`, [userId]);
      await db.query(`INSERT INTO favorites (user_id,product_id) VALUES (?,?)`, [userId, userId * 10]);
      await db.query(`INSERT INTO browse_history (user_id,product_id) VALUES (?,?)`, [userId, userId * 10]);
      await db.query(`INSERT INTO search_history (user_id,keyword) VALUES (?,?)`, [userId, `搜索${n}`]);
      await db.query(`INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 HOUR))`, [String(userId).repeat(64), userId]);
      await db.query(`INSERT INTO page_visits (user_id,session_id,page_url,ip_address) VALUES (?,?,'/',?)`, [userId, `s${n}`, `10.0.0.${userId}`]);
    }
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,min_amount,total_quantity,remain_quantity,status,start_time,end_time)
      VALUES (1,'C1','券',1,5,0,10,8,1,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))`);
    // One unused, one used on the completed order.
    await db.query(`INSERT INTO user_coupons (user_coupon_id,user_id,coupon_id,status,order_id,expired_at) VALUES
      (1,1,1,1,NULL,DATE_ADD(NOW(),INTERVAL 1 DAY)),(2,1,1,2,100,DATE_ADD(NOW(),INTERVAL 1 DAY))`);
  });

  const deleteAccount = (userId = 1, body: unknown = { password: PASSWORD }) =>
    request(app).post('/api/users/account/delete').set(auth(userId)).set('X-Requested-With', 'XMLHttpRequest').send(body as object);

  test('注销：删除个人数据，保留交易记录，用户行去身份化并使登录失效', async () => {
    const res = await deleteAccount().expect(200);
    expect(res.body).toEqual({ message: '账号已注销' });
    for (const table of ['shipping_addresses', 'address_creation_receipts', 'cart', 'cart_add_receipts', 'favorites', 'browse_history',
      'search_history', 'password_reset_tokens', 'page_visits']) expect([table, await count(table)]).toEqual([table, 0]);
    // Unused coupons go; the coupon used on an order stays with the transaction record.
    expect((await db.query<RowDataPacket[]>('SELECT user_coupon_id FROM user_coupons WHERE user_id = 1'))[0].map(row => row.user_coupon_id)).toEqual([2]);
    expect(await count('orders')).toBe(1);
    expect(await count('reviews')).toBe(1);
    const user = await one('SELECT * FROM users WHERE user_id = 1');
    expect(user).toMatchObject({ username: 'deleted_1', email: 'deleted_1@deleted.invalid', phone: null, avatar_url: null, status: 0, auth_version: 1 });
    expect(user!.deleted_at).toBeInstanceOf(Date);
    expect(await bcrypt.compare(PASSWORD, user!.password_hash)).toBe(false);
    // Customer 2 is untouched.
    for (const table of ['shipping_addresses', 'cart', 'favorites', 'browse_history', 'search_history', 'page_visits']) expect(await count(table, 2)).toBe(1);
    expect(await one('SELECT username, status FROM users WHERE user_id = 2')).toMatchObject({ username: 'two', status: 1 });
    // The old session no longer works, and the email can sign up again.
    await request(app).get('/api/users/profile').set(auth(1)).expect(401);
    expect(await one("SELECT COUNT(*) AS n FROM users WHERE email = 'one@example.test'")).toMatchObject({ n: 0 });
  });

  test('评价保留，作者显示为已注销', async () => {
    await deleteAccount().expect(200);
    const res = await request(app).get('/api/reviews/product/10').expect(200);
    expect(res.body.reviews).toEqual([expect.objectContaining({ content: '评价one', username: null, avatar_url: null, author_deleted: true })]);
    const other = await request(app).get('/api/reviews/product/20').expect(200);
    expect(other.body.reviews[0]).toMatchObject({ username: 'two', author_deleted: false });
  });

  test('密码错误：拒绝，数据不变', async () => {
    const res = await deleteAccount(1, { password: 'wrong password' }).expect(400);
    expect(res.body).toEqual({ error: '密码错误' });
    expect(await one('SELECT username, deleted_at FROM users WHERE user_id = 1')).toMatchObject({ username: 'one', deleted_at: null });
    expect(await count('shipping_addresses')).toBe(1);
  });

  test.each([
    ['待支付订单', 'UPDATE orders SET status = 0 WHERE user_id = 1'],
    ['已发货订单', 'UPDATE orders SET status = 2 WHERE user_id = 1'],
    ['处理中的售后', "INSERT INTO after_sales_requests (order_id,user_id,type,reason,status) VALUES (100,1,'refund','x','requested')"],
    ['已通过未结案的售后', "INSERT INTO after_sales_requests (order_id,user_id,type,reason,status) VALUES (100,1,'refund','x','approved')"],
  ])('有%s时不能注销', async (_label, setup) => {
    await db.query(setup);
    const res = await deleteAccount().expect(409);
    expect(res.body).toEqual({ error: '有未完成的订单或售后，处理完成后才能注销账号' });
    expect(await one('SELECT deleted_at FROM users WHERE user_id = 1')).toMatchObject({ deleted_at: null });
    expect(await count('cart')).toBe(1);
  });

  test('已结案的售后不阻止注销', async () => {
    await db.query("INSERT INTO after_sales_requests (order_id,user_id,type,reason,status,completed_at) VALUES (100,1,'refund','x','approved',NOW())");
    await deleteAccount().expect(200);
    expect(await count('after_sales_requests')).toBe(1);
  });
});
