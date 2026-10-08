jest.mock('../../database/mysql', () => ({
  pool: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
  getPool: jest.fn(),
}));

import { getPool, pool } from '../../database/mysql';
import { CouponModel } from '../../models/coupon.model';

let connection: any;
let affectedRows: number;
let insertFails: boolean;

beforeEach(() => {
  jest.clearAllMocks();
  (getPool as jest.Mock).mockReturnValue(pool);
  affectedRows = 1;
  insertFails = false;
  connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql: string) => {
      if (sql.includes('FROM users')) return [[{ user_id: 7 }], []];
      if (sql.includes('FROM coupons')) return [[{ coupon_id: 10, remain_quantity: 2, per_user_limit: 1, end_time: new Date('2027-01-01') }], []];
      if (sql.includes('COUNT(*)')) return [[{ count: 0 }], []];
      if (sql.includes('UPDATE coupons')) return [{ affectedRows }, []];
      if (insertFails) throw new Error('insert failure');
      return [{ insertId: 501, affectedRows: 1 }, []];
    }),
  };
  (pool.getConnection as jest.Mock).mockResolvedValue(connection);
  (pool.execute as jest.Mock).mockImplementation(async (sql: string, params: any[]) => {
    if (params?.some(value => value === undefined)) throw new TypeError('Bind parameters must not contain undefined');
    if (sql.includes('INSERT INTO coupons')) return [{ insertId: 42, affectedRows: 1 }, []];
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }], []];
    return [[], []];
  });
  (pool.query as jest.Mock).mockResolvedValue([[], []]);
});

test('合法创建可省略可选描述和封顶，status=0保持禁用', async () => {
  const id = await CouponModel.create({
    code: 'TEST', name: '测试券', type: 1, discount_value: 10, total_quantity: 100,
    remain_quantity: 0, per_user_limit: 1, start_time: new Date('2026-01-01'), end_time: new Date('2027-01-01'), status: 0,
  });
  expect(id).toBe(42);
  expect((pool.execute as jest.Mock).mock.calls[0][1]).toEqual([
    'TEST', '测试券', null, 1, 10, 0, null, 100, 0, 1, expect.any(Date), expect.any(Date), 0,
  ]);
});

test('锁定有余量的券在扣减时失效，回滚且不创建用户券', async () => {
  affectedRows = 0;
  await expect(CouponModel.receiveCoupon(7, 10)).rejects.toThrow('优惠券不存在或已失效');
  expect(connection.execute.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE coupons'))[0]).toContain('remain_quantity > 0');
  expect(connection.execute.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO user_coupons'))).toBe(false);
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('锁定时已无余量仍返回领完，既不扣减也不创建用户券', async () => {
  const original = connection.execute.getMockImplementation();
  connection.execute.mockImplementation(async (sql: string) => sql.includes('FROM coupons')
    ? [[{ coupon_id: 10, remain_quantity: 0 }], []]
    : original(sql));
  await expect(CouponModel.receiveCoupon(7, 10)).rejects.toThrow('优惠券已领完');
  expect(connection.execute.mock.calls.some(([sql]: [string]) => /UPDATE coupons|INSERT INTO user_coupons/.test(sql))).toBe(false);
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('用户券列表按有效状态筛选，不把过期未使用券当作可用', async () => {
  await CouponModel.getUserCoupons(7, 3);
  const [sql, params] = (pool.execute as jest.Mock).mock.calls[0];
  expect(sql).toContain('CASE WHEN uc.status = 1');
  expect(sql).toContain('uc.expired_at <= NOW()');
  expect(sql).toContain('c.status AS coupon_status');
  expect(sql).toContain('c.start_time');
  expect(sql).toContain('c.end_time');
  expect(params).toEqual([7, 3]);
});

test('订单可用券从同一事务连接查询并筛选、排序金额', async () => {
  connection.execute.mockResolvedValue([[
    { user_coupon_id: 1, type: 2, discount_value: '20.00', min_amount: '0.00', max_discount: '0.00' },
    { user_coupon_id: 2, type: 1, discount_value: '30.00', min_amount: '100.00' },
    { user_coupon_id: 3, type: 1, discount_value: '50.00', min_amount: '101.00' },
  ], []]);
  const result = await (CouponModel as any).getAvailableForOrder(7, 100, connection);
  expect(result.map((coupon: any) => [coupon.user_coupon_id, coupon.discount_amount])).toEqual([[2, 30], [1, 20]]);
  const [sql, params] = connection.execute.mock.calls[0];
  expect(sql).toContain('INNER JOIN coupons');
  expect(sql).toContain('uc.user_id = ?');
  expect(sql).toContain('uc.status = 1');
  expect(sql).toContain('uc.expired_at > NOW()');
  expect(sql).toContain('c.status = 1');
  expect(sql).toContain('NOW() >= c.start_time');
  expect(sql).toContain('NOW() < c.end_time');
  expect(params).toEqual([7]);
  expect(pool.execute).not.toHaveBeenCalled();
});

test('分页绑定占位符并拒绝负数或非整页', async () => {
  await CouponModel.getList({ status: 1, page: 2, page_size: 10 });
  expect(pool.query).toHaveBeenCalledTimes(1);
  const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
  expect(sql).toContain('LIMIT ? OFFSET ?');
  expect(params).toEqual([1, 10, 10]);
  await expect(CouponModel.getList({ page: -1 })).rejects.toThrow();
  await expect(CouponModel.getList({ page_size: 1.5 })).rejects.toThrow();
});

test('后台券列表聚合真实领取和当前使用次数并返回数字', async () => {
  (pool.query as jest.Mock).mockResolvedValue([[{ coupon_id: 10, received_count: '4', used_count: '2' }], []]);
  const result = await CouponModel.getList({ page: 2, page_size: 10, status: 0, include_usage: true } as Parameters<typeof CouponModel.getList>[0]);
  expect(result.coupons[0]).toMatchObject({ received_count: 4, used_count: 2 });
  const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
  expect(sql).toContain('FROM user_coupons');
  expect(sql).toContain('status = 2');
  expect(sql).toContain('AS received_count');
  expect(sql).toContain('AS used_count');
  expect(sql).toMatch(/ORDER BY created_at DESC, coupon_id DESC/);
  expect(params).toEqual([0, 10, 10]);
  expect(pool.query).toHaveBeenCalledTimes(1);
});

test('顾客可领券列表不查询后台使用统计且同时间分页排序稳定', async () => {
  await CouponModel.getList({ available_only: true, page: 1, page_size: 50 });
  const [sql] = (pool.query as jest.Mock).mock.calls[0];
  expect(sql).not.toContain('FROM user_coupons');
  expect(sql).toMatch(/ORDER BY created_at DESC, coupon_id DESC/);
});

test('可用券列表跳过旧库非法规则，仍返回其他合法券', async () => {
  (pool.execute as jest.Mock).mockResolvedValue([[
    { user_coupon_id: 1, type: 2, discount_value: '120.00', min_amount: '0.00', max_discount: null },
    { user_coupon_id: 2, type: 2, discount_value: '20.00', min_amount: '0.00', max_discount: '0.00' },
    { user_coupon_id: 3, type: 1, discount_value: '-10.00', min_amount: '0.00', max_discount: null },
  ], []]);
  const result = await CouponModel.getAvailableForOrder(7, 100);
  expect(result.map(coupon => [coupon.user_coupon_id, coupon.discount_amount])).toEqual([[2, 20]]);
  expect(pool.execute).toHaveBeenCalledTimes(1);
});

test('领取用户券插入失败回滚余量', async () => {
  insertFails = true;
  await expect(CouponModel.receiveCoupon(7, 10)).rejects.toThrow('insert failure');
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});
