import { getPool } from '../../database/mysql';
import { CouponModel } from '../../models/coupon.model';
import { AdminCouponController } from '../../controllers/admin-coupon.controller';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));

const coupon = { code: 'RACE', name: 'Fixture', type: 1, discount_value: 10, total_quantity: 100,
  start_time: new Date('2026-01-01'), end_time: new Date('2026-12-31') };
const audit = { adminId: 1, ip: '127.0.0.1', userAgent: 'fixture' };
const failure = (code: string) => Object.assign(new Error(code), { code });
const deadlock = () => failure('ER_LOCK_DEADLOCK');
const connection = () => ({ beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined), release: jest.fn(),
  execute: jest.fn().mockResolvedValue([{ insertId: 42 }, []]) });
let pool: { getConnection: jest.Mock; execute: jest.Mock };
let first: ReturnType<typeof connection>, second: ReturnType<typeof connection>;
beforeEach(() => {
  jest.clearAllMocks(); first = connection(); second = connection();
  pool = { getConnection: jest.fn().mockResolvedValueOnce(first).mockResolvedValue(second), execute: jest.fn().mockResolvedValue([[], []]) };
  (getPool as jest.Mock).mockReturnValue(pool);
});

test.each(['insert', 'audit'])('restarts the whole audited create after a %s work deadlock and cleanup', async phase => {
  if (phase === 'audit') first.execute.mockResolvedValueOnce([{ insertId: 41 }, []]);
  first.execute.mockRejectedValueOnce(deadlock());
  pool.getConnection.mockReset().mockImplementationOnce(() => first).mockImplementationOnce(() => {
    expect(first.rollback).toHaveBeenCalledTimes(1);
    expect(first.release).toHaveBeenCalledTimes(1);
    return second;
  });
  expect(await CouponModel.create(coupon, audit)).toBe(42);
  expect(first.commit).not.toHaveBeenCalled();
  expect(second.execute.mock.calls.map(([sql]) => sql.includes('INSERT INTO coupons') ? 'coupon' : 'audit')).toEqual(['coupon', 'audit']);
  expect(second.commit).toHaveBeenCalledTimes(1);
  expect(second.release).toHaveBeenCalledTimes(1);
});

test('a persistent deadlock gets at most one fresh transaction, with both attempts rolled back', async () => {
  const error = deadlock(); first.execute.mockRejectedValue(error); second.execute.mockRejectedValue(error);
  await expect(CouponModel.create(coupon, audit)).rejects.toBe(error);
  expect(pool.getConnection).toHaveBeenCalledTimes(2);
  for (const current of [first, second]) {
    expect(current.rollback).toHaveBeenCalledTimes(1); expect(current.release).toHaveBeenCalledTimes(1);
    expect(current.commit).not.toHaveBeenCalled();
  }
});

test('a duplicate on the retry retains the controller’s 409 contract', async () => {
  first.execute.mockRejectedValueOnce(deadlock()); second.execute.mockRejectedValueOnce(failure('ER_DUP_ENTRY'));
  const res = { statusCode: 200, body: undefined as unknown, status(value: number) { this.statusCode = value; return this; }, json(value: unknown) { this.body = value; return this; } };
  await AdminCouponController.createCoupon({ body: coupon, admin: { adminId: 1 }, ip: audit.ip, get: () => audit.userAgent } as any, res as any);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({ success: false, message: '优惠券代码已存在' });
  expect(pool.getConnection).toHaveBeenCalledTimes(2);
  expect(second.commit).not.toHaveBeenCalled();
});

test.each(['ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY', 'ECONNRESET'])('does not retry a work failure %s', async code => {
  const error = failure(code); first.execute.mockRejectedValueOnce(error);
  await expect(CouponModel.create(coupon, audit)).rejects.toBe(error);
  expect(pool.getConnection).toHaveBeenCalledTimes(1);
});

test.each(['acquire', 'begin', 'commit'] as const)('does not retry an error from %s, even with a deadlock-shaped code', async phase => {
  const error = deadlock();
  if (phase === 'acquire') pool.getConnection.mockReset().mockRejectedValue(error);
  else first[phase === 'begin' ? 'beginTransaction' : 'commit'].mockRejectedValueOnce(error);
  await expect(CouponModel.create(coupon, audit)).rejects.toBe(error);
  expect(pool.getConnection).toHaveBeenCalledTimes(1);
});

test('does not retry when transaction cleanup fails', async () => {
  first.execute.mockRejectedValueOnce(deadlock()); const error = failure('ECONNRESET'); first.rollback.mockRejectedValueOnce(error);
  await expect(CouponModel.create(coupon, audit)).rejects.toBe(error);
  expect(pool.getConnection).toHaveBeenCalledTimes(1); expect(first.release).toHaveBeenCalledTimes(1);
});

test('does not retry an unaudited autocommit insert', async () => {
  const error = deadlock(); pool.execute.mockRejectedValueOnce(error);
  await expect(CouponModel.create(coupon)).rejects.toBe(error);
  expect(pool.execute).toHaveBeenCalledTimes(1); expect(pool.getConnection).not.toHaveBeenCalled();
});
