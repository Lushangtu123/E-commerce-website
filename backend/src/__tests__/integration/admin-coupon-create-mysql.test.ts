import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { CouponModel } from '../../models/coupon.model';
import { AdminCouponController } from '../../controllers/admin-coupon.controller';
import logger from '../../utils/logger';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;

integration('管理员优惠券创建冲突（真实 MySQL）', () => {
  const database = `admin_coupon_create_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 6,
  };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'orders'].includes(match[2])) await db.query(match[1]);
    }
    await migrateCouponTables(db);
    const adminSource = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    for (const match of adminSource.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['roles', 'admins', 'admin_logs'].includes(match[2])) await db.query(match[1]);
    }
    await db.query("INSERT INTO admins(admin_id,username,password_hash) VALUES(1,'first','fixture'),(2,'second','fixture')");
  });
  beforeEach(async () => { jest.clearAllMocks(); await db.query('DELETE FROM admin_logs'); await db.query('DELETE FROM coupons'); });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  const input = (code: string, name: string, adminId: number) => ({ body: {
    code, name, type: 1, discount_value: 10, total_quantity: 100,
    start_time: '2026-01-01', end_time: '2026-12-31',
  }, admin: { adminId }, ip: '127.0.0.1', get: () => 'fixture' }) as any;
  const response = () => ({ statusCode: 200, body: undefined as any,
    status(value: number) { this.statusCode = value; return this; },
    json(value: unknown) { this.body = value; return this; },
  });

  test.each([['RACE', 'RACE'], ['RACE', 'race']])('同代码并发 %s / %s 仅创建一次，失败方收到明确冲突', async (firstCode, secondCode) => {
    let readCount = 0;
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const find = CouponModel.findByCode.bind(CouponModel);
    jest.spyOn(CouponModel, 'findByCode').mockImplementation(async code => {
      const result = await find(code);
      if (++readCount === 2) release();
      await bothRead;
      return result;
    });
    const first = response(), second = response();
    await Promise.all([
      AdminCouponController.createCoupon(input(firstCode, 'first admin coupon', 1), first as any),
      AdminCouponController.createCoupon(input(secondCode, 'second admin coupon', 2), second as any),
    ]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT code, name, total_quantity, remain_quantity FROM coupons');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total_quantity: 100, remain_quantity: 100 });
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const rejected = first.statusCode === 409 ? first : second;
    expect(rejected.body).toEqual({ success: false, message: '优惠券代码已存在' });
    expect((await db.query<RowDataPacket[]>('SELECT action FROM admin_logs'))[0]).toEqual([{ action: 'CREATE_COUPON' }]);
  });

  test('顺序重复创建同样返回 409，不同代码正常创建', async () => {
    const first = response(), repeated = response(), another = response();
    await AdminCouponController.createCoupon(input('ONE', 'first coupon', 1), first as any);
    await AdminCouponController.createCoupon(input('ONE', 'conflicting coupon', 2), repeated as any);
    await AdminCouponController.createCoupon(input('TWO', 'other coupon', 2), another as any);
    expect([first.statusCode, repeated.statusCode, another.statusCode]).toEqual([200, 409, 200]);
    expect(repeated.body.message).toBe('优惠券代码已存在');
    const [rows] = await db.query<RowDataPacket[]>('SELECT code, name FROM coupons ORDER BY code');
    expect(rows).toEqual([{ code: 'ONE', name: 'first coupon' }, { code: 'TWO', name: 'other coupon' }]);
    expect((await db.query<RowDataPacket[]>('SELECT action FROM admin_logs'))[0]).toEqual([{ action: 'CREATE_COUPON' }, { action: 'CREATE_COUPON' }]);
  });

  test('撤销未提交的同代码插入后，两位等待的创建者仍只提交一张券和一条审计', async () => {
    const blocker = await db.getConnection();
    const errors: string[] = [];
    jest.spyOn(logger, 'error').mockImplementation((value: any) => { errors.push(value.err?.code ?? 'unknown'); });
    const first = response(), second = response();
    let pending: Promise<unknown[]> | undefined;
    try {
      await blocker.beginTransaction();
      await blocker.execute(`INSERT INTO coupons
        (code,name,type,discount_value,total_quantity,remain_quantity,start_time,end_time)
        VALUES ('RACE','uncommitted fixture',1,10,100,100,'2026-01-01','2026-12-31')`);
      pending = Promise.all([
        AdminCouponController.createCoupon(input('RACE', 'first admin coupon', 1), first as any),
        AdminCouponController.createCoupon(input('race', 'second admin coupon', 2), second as any),
      ]);
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (waiting < 2 && Date.now() < deadline) {
        const [locks] = await db.query<RowDataPacket[]>(`SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting
          FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks l ON w.BLOCKING_ENGINE_LOCK_ID = l.ENGINE_LOCK_ID
          WHERE l.OBJECT_SCHEMA = ? AND l.OBJECT_NAME = 'coupons'`, [database]);
        waiting = Number(locks[0].waiting);
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(2);
      await blocker.rollback();
      await pending;
      expect({ statuses: [first.statusCode, second.statusCode].sort(), errors }).toEqual({ statuses: [200, 409], errors: [] });
      expect((await db.query<RowDataPacket[]>('SELECT coupon_id FROM coupons'))[0]).toHaveLength(1);
      expect((await db.query<RowDataPacket[]>('SELECT action FROM admin_logs'))[0]).toEqual([{ action: 'CREATE_COUPON' }]);
    } finally {
      await blocker.rollback(); blocker.release();
      if (pending) await pending;
    }
  });
});
