import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { getPool } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { migrateCouponClaims } from '../../database/migrate-coupon-claims';
import { CouponModel } from '../../models/coupon.model';
import { CouponController } from '../../controllers/coupon.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
const key = '00000000-0000-4000-8000-000000000001';
const nextKey = '00000000-0000-4000-8000-000000000002';
// Keep the red test executable against the previous two-argument API.
const claim = CouponModel.receiveCoupon as (user: number, coupon: number, claimKey?: string) => Promise<number>;

integration('真实 MySQL 优惠券领取请求号', () => {
  const database = `coupon_claim_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00', connectionLimit: 6,
  };
  let server: Pool, db: Pool, created = false;
  const app = express(); app.use(express.json());
  app.post('/receive', (req, _res, next) => { (req as any).userId = 1; next(); }, CouponController.receiveCoupon);
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
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
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'one','one@example.test','fixture'),(2,'two','two@example.test','fixture')");
    await db.query(`INSERT INTO coupons(coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,per_user_limit,start_time,end_time)
      VALUES(1,'ONE','One',3,5,10,10,2,NOW()-INTERVAL 1 DAY,NOW()+INTERVAL 1 DAY),
      (2,'TWO','Two',3,5,10,10,2,NOW()-INTERVAL 1 DAY,NOW()+INTERVAL 1 DAY)`);
  });
  async function counts(id = 1) {
    const [rows] = await db.query<RowDataPacket[]>('SELECT remain_quantity,(SELECT COUNT(*) FROM user_coupons WHERE coupon_id=?) AS receipts FROM coupons WHERE coupon_id=?', [id, id]);
    return rows[0];
  }
  test('同一请求号并发和响应丢失后重试仅创建一张券', async () => {
    const [first, retry] = await Promise.all([claim(1, 1, key), claim(1, 1, key)]);
    expect(first).toBe(retry); expect(await claim(1, 1, key)).toBe(first);
    expect(await counts()).toMatchObject({ remain_quantity: 9, receipts: 1 });
    const secondIntent = await claim(1, 1, nextKey); expect(secondIntent).not.toBe(first);
    expect(await counts()).toMatchObject({ remain_quantity: 8, receipts: 2 });
  });
  test('真实路由接收请求号并返回原领取记录', async () => {
    const first = await request(app).post('/receive').send({ coupon_id: 1, claim_key: key }).expect(200);
    const retry = await request(app).post('/receive').send({ coupon_id: 1, claim_key: key }).expect(200);
    expect(retry.body.data).toEqual(first.body.data); expect(await counts()).toMatchObject({ remain_quantity: 9, receipts: 1 });
  });
  test('已用、失效、达到限额后仍可核对原领取；新请求不得绕过限制', async () => {
    const first = await claim(1, 1, key);
    await db.query('UPDATE user_coupons SET status=2 WHERE user_coupon_id=?', [first]);
    await db.query('UPDATE coupons SET status=0,remain_quantity=0,end_time=NOW()-INTERVAL 1 DAY WHERE coupon_id=1');
    expect(await claim(1, 1, key)).toBe(first);
    await expect(claim(1, 1, nextKey)).rejects.toThrow('优惠券不存在或已失效');
  });
  test('同一用户不能把请求号换成其他券，不同用户可以独立使用相同请求号', async () => {
    await claim(1, 1, key);
    await expect(claim(1, 2, key)).rejects.toMatchObject({ statusCode: 409 });
    expect(await counts(2)).toMatchObject({ remain_quantity: 10, receipts: 0 });
    await claim(2, 1, key); expect(await counts()).toMatchObject({ remain_quantity: 8, receipts: 2 });
  });
  test('非法请求号被拒绝，旧版未携带请求号仍受正常限额约束', async () => {
    for (const invalid of ['', 'not-a-key', 1, null]) {
      await request(app).post('/receive').send({ coupon_id: 1, claim_key: invalid }).expect(400);
    }
    await request(app).post('/receive').send({ coupon_id: 1 }).expect(200);
    await request(app).post('/receive').send({ coupon_id: 1 }).expect(200);
    await request(app).post('/receive').send({ coupon_id: 1 }).expect(400);
    expect(await counts()).toMatchObject({ remain_quantity: 8, receipts: 2 });
  });
  test('重复迁移添加可空字段和唯一索引，并保留历史券与余量', async () => {
    await db.query('ALTER TABLE user_coupons DROP INDEX unique_user_claim_key, DROP COLUMN claim_key');
    await expect(migrateCouponClaims(db, true)).rejects.toThrow('领取请求号字段尚未迁移');
    await db.query('INSERT INTO user_coupons(user_id,coupon_id,expired_at) VALUES(1,1,NOW()+INTERVAL 1 DAY),(1,1,NOW()+INTERVAL 1 DAY)');
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons ORDER BY user_coupon_id');
    await migrateCouponTables(db); await migrateCouponTables(db);
    const [after] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons ORDER BY user_coupon_id');
    expect(after).toEqual(before.map(value => ({ ...value, claim_key: null })));
    await expect(migrateCouponClaims(db, true)).resolves.toBeUndefined();
    const [indexes] = await db.query<RowDataPacket[]>("SELECT COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_coupons' AND INDEX_NAME='unique_user_claim_key' ORDER BY SEQ_IN_INDEX");
    expect(indexes.map(value => value.COLUMN_NAME)).toEqual(['user_id', 'claim_key']); expect(indexes.every(value => value.NON_UNIQUE === 0)).toBe(true);
    expect(await counts()).toMatchObject({ remain_quantity: 10, receipts: 2 });
  });
});
