import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { getPool } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { CouponModel } from '../../models/coupon.model';
import { AdminCouponController } from '../../controllers/admin-coupon.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 优惠券统计和分页', () => {
  const database = `coupon_stats_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool; let db: Pool; let created = false;
  const app = express(); app.get('/coupons', AdminCouponController.getCouponList);
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'orders'].includes(match[2])) await db.query(match[1]);
    }
    await migrateCouponTables(db);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    for (const table of ['coupon_usage_logs', 'user_coupons', 'coupons', 'orders', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'one','one@example.test','test'),(2,'two','two@example.test','test')");
  });
  async function coupon(id: number, status = 1) {
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,status,start_time,end_time,created_at)
      VALUES (?, ?, ?, 3, 5, 100, 100, ?, DATE_SUB(NOW(),INTERVAL 1 DAY), DATE_ADD(NOW(),INTERVAL 1 DAY), '2026-01-01 00:00:00')`,
    [id, `C${id}`, `券${id}`, status]);
  }
  test('真实后台接口统计已领和当前已用，不被重复日志倍增；无领取券返回零', async () => {
    await coupon(1); await coupon(2, 0);
    for (const [user, status] of [[1, 1], [1, 2], [1, 3], [2, 2]]) {
      await db.query('INSERT INTO user_coupons (user_id,coupon_id,status,expired_at) VALUES (?,1,?,DATE_ADD(NOW(),INTERVAL 1 DAY))', [user, status]);
    }
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status) VALUES (1,'AUDIT',1,5,0)");
    await db.query('INSERT INTO coupon_usage_logs (user_id,coupon_id,user_coupon_id,order_id,discount_amount,order_amount) SELECT user_id,coupon_id,user_coupon_id,1,5,10 FROM user_coupons WHERE coupon_id = 1');
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons ORDER BY user_coupon_id');
    const response = await request(app).get('/coupons?page=1&page_size=50').expect(200);
    expect(response.body).toMatchObject({ success: true, pagination: { page: 1, page_size: 50, total: 2, total_pages: 1 } });
    expect(response.body.data.map((row: any) => [row.coupon_id, row.received_count, row.used_count])).toEqual([[2, 0, 0], [1, 4, 2]]);
    const [after] = await db.query('SELECT * FROM user_coupons ORDER BY user_coupon_id'); expect(after).toEqual(before);
    await db.query('UPDATE user_coupons SET status = 1 WHERE coupon_id = 1 AND status = 2');
    const restored = await request(app).get('/coupons?status=1').expect(200);
    expect(restored.body.data[0]).toMatchObject({ received_count: 4, used_count: 0 });
  });
  test('51张同时间券两页完整、不重复，状态0正确筛选', async () => {
    for (let id = 1; id <= 51; id++) await coupon(id, id % 2);
    const first = await request(app).get('/coupons?page=1&page_size=50').expect(200);
    const second = await request(app).get('/coupons?page=2&page_size=50').expect(200);
    expect(first.body.pagination).toMatchObject({ total: 51, total_pages: 2 });
    expect(first.body.data.map((row: any) => row.coupon_id)).toEqual(Array.from({ length: 50 }, (_, i) => 51 - i));
    expect(second.body.data.map((row: any) => row.coupon_id)).toEqual([1]);
    const off = await request(app).get('/coupons?status=0').expect(200);
    expect(off.body.pagination.total).toBe(25); expect(off.body.data.every((row: any) => row.status === 0)).toBe(true);
    const publicList = await CouponModel.getList({ available_only: true, page: 2, page_size: 20 });
    expect(publicList.total).toBe(26); expect(publicList.coupons).toHaveLength(6);
    expect(publicList.coupons.every(row => !Object.prototype.hasOwnProperty.call(row, 'used_count'))).toBe(true);
  });
});
