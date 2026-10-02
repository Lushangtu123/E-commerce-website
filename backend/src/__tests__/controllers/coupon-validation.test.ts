import { Response } from 'express';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

import { getPool } from '../../database/mysql';
import { CouponController } from '../../controllers/coupon.controller';
import { AdminCouponController } from '../../controllers/admin-coupon.controller';

const validCreate = {
  code: 'TEST', name: '测试券', type: 2, discount_value: 20, total_quantity: 10,
  start_time: '2026-01-01', end_time: '2027-01-01',
};
let db: any;
let userCoupon: any;

function response() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function request(overrides: any = {}) {
  return {
    userId: 7, admin: { adminId: 1 }, body: {}, query: {}, params: { id: '10' },
    get: () => undefined, ...overrides,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  userCoupon = {
    user_coupon_id: 501, user_id: 7, coupon_id: 10, status: 1, type: 2,
    discount_value: '20.00', min_amount: '0.00', max_discount: '0.00',
    coupon_status: 1, expired_at: new Date('2027-01-01'),
    start_time: new Date('2026-01-01'), end_time: new Date('2027-01-01'),
  };
  const execute = jest.fn(async (sql: string, params: any[]) => {
    if (sql.includes('FROM user_coupons uc')) {
      if (sql.includes('uc.expired_at > NOW()')) {
        const valid = userCoupon.status === 1 && userCoupon.coupon_status === 1 &&
          userCoupon.expired_at > new Date() && userCoupon.start_time <= new Date() && userCoupon.end_time > new Date();
        return [valid ? [userCoupon] : [], []];
      }
      return [[userCoupon], []];
    }
    if (sql.includes('COUNT(*)')) return [[{ count: 0, total: 1 }], []];
    if (sql.includes('FOR UPDATE')) return [[{ ...userCoupon, remain_quantity: 10, per_user_limit: 1 }], []];
    if (sql.includes('WHERE code =')) return [[], []];
    if (sql.includes('SELECT * FROM coupons')) return [[{ coupon_id: 10, name: '测试券', code: 'TEST' }], []];
    if (params?.some(value => value === undefined)) throw new TypeError('undefined bind');
    return [{ insertId: 501, affectedRows: 1 }, []];
  });
  const connection = {
    execute, beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined), release: jest.fn(),
  };
  db = { execute, query: execute, getConnection: jest.fn().mockResolvedValue(connection) };
  (getPool as jest.Mock).mockReturnValue(db);
});

describe('严格优惠券创建', () => {
  test('最小合法创建成功并用 NULL 写可选字段', async () => {
    const res = response();
    await AdminCouponController.createCoupon(request({ body: validCreate }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: '优惠券创建成功', data: { coupon_id: 501 } });
    const insert = db.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO coupons'));
    expect(insert[1]).not.toContain(undefined);
    expect(insert[1][2]).toBeNull();
    expect(insert[1][6]).toBeNull();
  });

  test.each([
    { discount_value: -1 }, { discount_value: 101 }, { discount_value: Infinity }, { discount_value: '20' },
    { total_quantity: -1 }, { total_quantity: 1.5 }, { per_user_limit: 0 }, { per_user_limit: 1.5 },
    { min_amount: -1 }, { max_discount: -1 }, { max_discount: Infinity },
    { type: 3, min_amount: 1 }, { end_time: '2025-01-01' }, { start_time: 'invalid' },
    { unexpected: true },
  ])('拒绝非法创建 %p，数据库不写入', async overrides => {
    const res = response();
    await AdminCouponController.createCoupon(request({ body: { ...validCreate, ...overrides } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('领取与查询校验', () => {
  test.each([
    { coupon_id: 10, code: 'TEST' }, { code: '   ' }, { code: 'A'.repeat(51) }, { coupon_id: 10, extra: true },
  ])('拒绝非法领取 %p', async body => {
    const res = response();
    await CouponController.receiveCoupon(request({ body }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });

  test.each([
    { page: '-1' }, { page: '1foo' }, { page_size: '1.5' }, { page_size: '101' }, { page: ['1', '2'] },
  ])('列表拒绝非法分页 %p', async query => {
    const res = response();
    await CouponController.getAvailableCoupons(request({ query }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });

  test('用户券状态和详情 ID 拒绝非法输入', async () => {
    const status = response();
    await CouponController.getUserCoupons(request({ query: { status: '4' } }), status);
    expect(status.status).toHaveBeenCalledWith(400);
    const detail = response();
    await CouponController.getCouponDetail(request({ params: { id: '10foo' } }), detail);
    expect(detail.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });

  test('管理员状态与分页输入校验', async () => {
    const list = response();
    await AdminCouponController.getCouponList(request({ query: { status: '2' } }), list);
    expect(list.status).toHaveBeenCalledWith(400);
    const update = response();
    await AdminCouponController.updateCouponStatus(request({ body: { status: 0, extra: true } }), update);
    expect(update.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('可用券与优惠预览', () => {
  test.each(['100foo', '-1', 'Infinity', '0', '0.001'])('可用券拒绝金额 %s', async amount => {
    const res = response();
    await CouponController.getAvailableForOrder(request({ query: { amount } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });

  test.each([-1, Infinity, 0.001, '100'])('预览拒绝金额 %p', async order_amount => {
    const res = response();
    await CouponController.calculateDiscount(request({ body: { user_coupon_id: 501, order_amount } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.execute).not.toHaveBeenCalled();
  });

  test.each([
    { expired_at: new Date('2025-01-01') }, { coupon_status: 0 },
    { start_time: new Date('2028-01-01') }, { end_time: new Date('2025-01-01') }, { status: 2 },
  ])('不预览不可用券 %p', async overrides => {
    Object.assign(userCoupon, overrides);
    const res = response();
    await CouponController.calculateDiscount(request({ body: { user_coupon_id: 501, order_amount: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.execute.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE user_coupons'))).toBe(false);
  });

  test('没有属于自己的券时返回404', async () => {
    const res = response();
    await CouponController.calculateDiscount(request({ body: { user_coupon_id: 999, order_amount: 100 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('有效券预览返回金额和应付金额，不核销', async () => {
    const res = response();
    await CouponController.calculateDiscount(request({ body: { user_coupon_id: 501, order_amount: 100 } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { discount_amount: 20, final_amount: 80 } });
    expect(db.execute.mock.calls.every(([sql]: [string]) => !sql.includes('UPDATE'))).toBe(true);
  });
});
