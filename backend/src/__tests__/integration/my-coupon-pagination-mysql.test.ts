import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { getPool } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { CouponController } from '../../controllers/coupon.controller';
import type { AuthRequest } from '../../middleware/auth';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 我的优惠券分页', () => {
  const database = `my_coupon_pages_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool; let db: Pool; let created = false;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as AuthRequest).userId = 1; next(); });
  app.get('/coupons', CouponController.getUserCoupons);
  app.post('/calculate', CouponController.calculateDiscount);
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
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
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,start_time,end_time)
      VALUES (1,'PAGED','Paged',3,1,100,100,DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 1 DAY))`);
  });
  async function receipts(count: number, user = 1) {
    for (let i = 1; i <= count; i++) await db.query(`INSERT INTO user_coupons (user_id,coupon_id,status,received_at,expired_at)
      VALUES (?,1,1,'2026-01-01 00:00:00',DATE_ADD(NOW(),INTERVAL 1 DAY))`, [user]);
  }
  test('51张同时间券分页完整不重复，隔离账号且查询不修改历史券', async () => {
    await receipts(51); await receipts(2, 2);
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons ORDER BY user_coupon_id');
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await request(app).get(`/coupons?status=1&page=${page}&page_size=20`).expect(200);
      expect(response.body.pagination).toEqual({ page, page_size: 20, total: 51, total_pages: 3 });
      expect(response.body.data).toHaveLength(page === 3 ? 11 : 20);
      expect(response.body.data.every((row: any) => row.user_id === 1)).toBe(true);
      ids.push(...response.body.data.map((row: any) => row.user_coupon_id));
    }
    expect(ids).toEqual(before.filter(row => row.user_id === 1).map(row => row.user_coupon_id).reverse());
    expect(new Set(ids).size).toBe(51);
    const [after] = await db.query('SELECT * FROM user_coupons ORDER BY user_coupon_id'); expect(after).toEqual(before);
  });
  test('过期有效状态用于分页与总数，空页保持正确元数据', async () => {
    await receipts(3);
    await db.query('UPDATE user_coupons SET expired_at = DATE_SUB(NOW(),INTERVAL 1 SECOND) ORDER BY user_coupon_id LIMIT 1');
    await db.query('UPDATE user_coupons SET status = 2 WHERE expired_at > NOW() ORDER BY user_coupon_id LIMIT 1');
    for (const status of [1, 2, 3]) {
      const response = await request(app).get(`/coupons?status=${status}&page=1&page_size=20`).expect(200);
      expect(response.body.pagination).toMatchObject({ total: 1, total_pages: 1 });
      expect(response.body.data.map((row: any) => row.status)).toEqual([status]);
    }
    const empty = await request(app).get('/coupons?status=1&page=2&page_size=20').expect(200);
    expect(empty.body.data).toEqual([]); expect(empty.body.pagination).toMatchObject({ page: 2, total: 1, total_pages: 1 });
  });
  test('未分页旧接口和优惠预览仍能读取第一页之外的券，不核销任何券', async () => {
    await receipts(21); await receipts(1, 2);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons ORDER BY user_coupon_id');
    const owned = rows.filter(row => row.user_id === 1);
    const legacy = await request(app).get('/coupons').expect(200);
    expect(legacy.body.data).toHaveLength(21); expect(legacy.body.pagination).toBeUndefined();
    const result = await request(app).post('/calculate').send({ user_coupon_id: owned[0].user_coupon_id, order_amount: 10 }).expect(200);
    expect(result.body.data).toEqual({ discount_amount: 1, final_amount: 9 });
    await request(app).post('/calculate').send({ user_coupon_id: rows.at(-1)!.user_coupon_id, order_amount: 10 }).expect(404);
    const [after] = await db.query('SELECT * FROM user_coupons ORDER BY user_coupon_id'); expect(after).toEqual(rows);
  });
});
