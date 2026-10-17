/**
 * A request authenticated just before account deletion waits for the user row lock that deletion
 * holds. Once deletion commits, that request must not write anything for the deleted account.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { migrateSkuTables } from '../../database/migrate-sku';
import { migrateAddressTables } from '../../database/migrate-address';
import { migrateAddressCreations } from '../../database/migrate-address-creations';
import { migrateCartAdds } from '../../database/migrate-cart-adds';
import { migrateAccountSecurity } from '../../database/migrate-account-security';
import { migrateFulfillment } from '../../database/migrate-fulfillment';
import { migrateAfterSalesProgress } from '../../database/migrate-after-sales-progress';
import { PasswordResetModel } from '../../models/password-reset.model';
import userRoutes from '../../routes/user.routes';
import cartRoutes from '../../routes/cart.routes';
import addressRoutes from '../../routes/address.routes';
import favoriteRoutes from '../../routes/favorite.routes';
import browseRoutes from '../../routes/browse.routes';
import searchRoutes from '../../routes/search.routes';
import couponRoutes from '../../routes/coupon.routes';
import orderRoutes from '../../routes/order.routes';
import afterSalesRoutes from '../../routes/after-sales.routes';
import reviewRoutes from '../../routes/review.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({
  getRedisClient: () => ({ del: jest.fn(async () => 0), get: jest.fn(async () => null), setex: jest.fn(async () => 'OK'), set: jest.fn(async () => 'OK') }),
}));
jest.mock('../../middleware/rate-limit', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return new Proxy({}, { get: () => pass });
});

// Tests own and clean only account_deletion_race_${pid}; DB_NAME is never used.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 注销与并发写入', () => {
  const database = `account_deletion_race_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 6,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const app = express(); app.use(express.json());
  app.use('/api/users', userRoutes); app.use('/api/cart', cartRoutes); app.use('/api/addresses', addressRoutes);
  app.use('/api/favorites', favoriteRoutes); app.use('/api/browse', browseRoutes); app.use('/api/search', searchRoutes);
  app.use('/api/coupons', couponRoutes); app.use('/api/orders', afterSalesRoutes); app.use('/api/orders', orderRoutes);
  app.use('/api/reviews', reviewRoutes);
  const auth = { Authorization: `Bearer ${jwt.sign({ userId: 1, authVersion: 0 }, 'test-jwt-secret')}` };
  const count = async (sql: string) => Number((await db.query<RowDataPacket[]>(sql))[0][0].n);

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) await db.query(match[1]);
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
      'password_reset_tokens', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query(`INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'one','one@example.test','unused')`);
    await db.query(`INSERT INTO products (product_id,title,price,stock,status) VALUES (10,'商品',10,5,1)`);
    await db.query(`INSERT INTO shipping_addresses (address_id,user_id,receiver_name,phone,province,city,district,detail_address,is_default)
      VALUES (5,1,'收货人','13900139000','省','市','区','一路',1)`);
    await db.query(`INSERT INTO orders (order_id,order_no,user_id,total_amount,original_amount,discount_amount,status,shipping_address_snapshot)
      VALUES (100,'ORD100',1,10,10,0,3,JSON_OBJECT('receiver_name','收货人'))`);
    await db.query(`INSERT INTO order_items (order_id,product_id,product_name,quantity,price) VALUES (100,10,'商品',1,10)`);
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,per_user_limit,start_time,end_time)
      VALUES (1,'LATE','晚到券',3,5,10,10,1,DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 1 DAY))`);
  });

  /** Holds the user row as deletion does, lets `start` queue behind it, then commits the deletion. */
  async function deleteWhileWaiting<T>(start: () => Promise<T>): Promise<T> {
    const holder: PoolConnection = await db.getConnection();
    let pending: Promise<T> | undefined;
    try {
      await holder.beginTransaction();
      await holder.query('SELECT user_id FROM users WHERE user_id = 1 FOR UPDATE');
      pending = start();
      let waiting = false;
      for (let attempt = 0; attempt < 300 && !waiting; attempt++) {
        const [waits] = await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
           JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID
           WHERE l.OBJECT_SCHEMA = ? AND l.OBJECT_NAME = 'users'`, [database]);
        waiting = Number(waits[0].n) > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // The account deletion's own effect on the user row (account-deletion.service).
      await holder.query(`UPDATE users SET username = 'deleted_1', email = 'deleted_1@deleted.invalid', phone = NULL,
        password_hash = '!deleted', status = 0, auth_version = auth_version + 1, deleted_at = NOW() WHERE user_id = 1`);
      await holder.commit();
      return await pending;
    } finally {
      if (pending) await pending.catch(() => undefined);
      holder.release();
    }
  }

  const send = (method: 'post' | 'put', url: string, body: object) => () => request(app)[method](url).set(auth).send(body).then(res => res);
  test.each([
    ['加入购物车', send('post', '/api/cart', { product_id: 10, quantity: 1 }), 'SELECT COUNT(*) AS n FROM cart'],
    ['新增收货地址', send('post', '/api/addresses', { receiver_name: '新收货人', phone: '13800138000', province: '省', city: '市', district: '区', detail_address: '二路' }),
      'SELECT COUNT(*) AS n FROM shipping_addresses WHERE address_id <> 5'],
    ['收藏商品', send('post', '/api/favorites', { product_id: 10 }), 'SELECT COUNT(*) AS n FROM favorites'],
    ['记录浏览', send('post', '/api/browse/record', { product_id: 10 }), 'SELECT COUNT(*) AS n FROM browse_history'],
    ['领取优惠券', send('post', '/api/coupons/receive', { coupon_id: 1 }), 'SELECT COUNT(*) AS n FROM user_coupons'],
    ['提交订单', send('post', '/api/orders', { items: [{ product_id: 10, quantity: 1 }], shipping_address_id: 5, checkout_key: randomUUID() }),
      'SELECT COUNT(*) AS n FROM orders WHERE order_id <> 100'],
    ['发表评价', send('post', '/api/reviews', { product_id: 10, order_id: 100, rating: 5, content: '晚到的评价' }), 'SELECT COUNT(*) AS n FROM reviews'],
    ['申请售后', send('post', '/api/orders/100/after-sales', { type: 'refund', reason: '晚到的申请' }), 'SELECT COUNT(*) AS n FROM after_sales_requests'],
    ['修改资料', send('put', '/api/users/profile', { phone: '13700137000' }), 'SELECT COUNT(*) AS n FROM users WHERE phone IS NOT NULL'],
  ])('%s：等待注销锁的请求在注销提交后返回 401，不留下数据', async (_, start, remaining) => {
    const response = await deleteWhileWaiting(start);
    expect(response.status).toBe(401);
    expect(await count(remaining)).toBe(0);
  });

  test('搜索记录：注销提交后到达的关键词只按匿名记录', async () => {
    const response = await deleteWhileWaiting(send('post', '/api/search/record', { keyword: '晚到的搜索', result_count: 1 }));
    expect(response.status).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM search_history WHERE user_id IS NOT NULL')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM search_history WHERE user_id IS NULL')).toBe(1);
  });

  test('找回密码：注销提交后不再为该账号签发重置凭据', async () => {
    const issued = await deleteWhileWaiting(() => PasswordResetModel.issue(1, 'a'.repeat(64)));
    expect(issued).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM password_reset_tokens')).toBe(0);
  });
});
