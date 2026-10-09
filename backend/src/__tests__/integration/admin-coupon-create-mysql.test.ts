import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { CouponModel } from '../../models/coupon.model';
import { AdminCouponController } from '../../controllers/admin-coupon.controller';
import { logAdminAction } from '../../controllers/admin-log.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));
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
  });
  beforeEach(async () => { jest.clearAllMocks(); await db.query('DELETE FROM coupons'); });
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
    expect(logAdminAction).toHaveBeenCalledTimes(1);
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
    expect(logAdminAction).toHaveBeenCalledTimes(2);
  });
});
