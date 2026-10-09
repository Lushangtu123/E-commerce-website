/**
 * 管理员优惠券审计日志测试
 * 验证控制器将审计身份交给优惠券事务模型；SQL 原子性由集成测试覆盖
 */
import { Response } from 'express';

jest.mock('../../models/coupon.model', () => ({
  CouponModel: {
    findByCode: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
  },
  CouponType: { FULL_REDUCTION: 1, DISCOUNT: 2, NO_THRESHOLD: 3 },
  CouponStatus: { DISABLED: 0, ENABLED: 1 },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../controllers/admin-log.controller', () => ({
  logAdminAction: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CouponModel } = require('../../models/coupon.model');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logAdminAction } = require('../../controllers/admin-log.controller');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AdminCouponController } = require('../../controllers/admin-coupon.controller');

function mockRes() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq(overrides: any = {}) {
  return {
    admin: { adminId: 1, username: 'admin', roleId: 1, type: 'super' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
    params: {},
    body: {},
    ...overrides,
  } as any;
}

beforeEach(() => jest.clearAllMocks());

const validCreation = {
  code: 'NEW2024', name: '新用户券', type: 1, discount_value: 10, total_quantity: 100,
  start_time: '2026-01-01', end_time: '2026-12-31',
};

describe('createCoupon', () => {
  test('代码预查冲突返回 409，不插入或记录创建日志', async () => {
    CouponModel.findByCode.mockResolvedValue({ coupon_id: 1 });
    const res = mockRes();
    await AdminCouponController.createCoupon(mockReq({ body: validCreation }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '优惠券代码已存在' });
    expect(CouponModel.create).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('代码插入竞争的唯一键冲突返回 409，不误报服务器故障', async () => {
    CouponModel.findByCode.mockResolvedValue(null);
    CouponModel.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }));
    const res = mockRes();
    await AdminCouponController.createCoupon(mockReq({ body: validCreation }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '优惠券代码已存在' });
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('其他插入故障仍返回 500，不误报代码冲突', async () => {
    CouponModel.findByCode.mockResolvedValue(null);
    CouponModel.create.mockRejectedValue(Object.assign(new Error('database unavailable'), { code: 'ER_LOCK_WAIT_TIMEOUT' }));
    const res = mockRes();
    await AdminCouponController.createCoupon(mockReq({ body: validCreation }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '创建优惠券失败' });
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('创建成功时将管理员身份及审计元数据传给同事务模型', async () => {
    CouponModel.findByCode.mockResolvedValue(null);
    CouponModel.create.mockResolvedValue(42);

    const req = mockReq({
      body: {
        code: 'NEW2024',
        name: '新用户券',
        type: 1,
        discount_value: 10,
        total_quantity: 100,
        start_time: '2026-01-01',
        end_time: '2026-12-31',
      },
    });
    const res = mockRes();

    await AdminCouponController.createCoupon(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
    expect(CouponModel.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'NEW2024' }),
      { adminId: 1, ip: '127.0.0.1', userAgent: 'test-agent' });
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('创建失败时不记录审计日志', async () => {
    const req = mockReq({ body: {} }); // 缺少必填字段
    const res = mockRes();

    await AdminCouponController.createCoupon(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('updateCouponStatus', () => {
  test('更新成功时将审计身份传入事务而不调用提交后的日志助手', async () => {
    CouponModel.findById.mockResolvedValue({
      coupon_id: 7,
      name: '老券',
      code: 'OLD2024',
    });
    CouponModel.updateStatus.mockResolvedValue(true);

    const req = mockReq({ params: { id: '7' }, body: { status: 0 } });
    const res = mockRes();

    await AdminCouponController.updateCouponStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
    expect(CouponModel.updateStatus).toHaveBeenCalledWith(7, 0, { adminId: 1, ip: '127.0.0.1', userAgent: 'test-agent' });
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('优惠券不存在时不记录审计日志', async () => {
    CouponModel.findById.mockResolvedValue(null);

    const req = mockReq({ params: { id: '999' }, body: { status: 0 } });
    const res = mockRes();

    await AdminCouponController.updateCouponStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('getCouponByCode', () => {
  test('returns the canonical coupon even when disabled or exhausted', async () => {
    const coupon = { coupon_id: 7, code: 'SAVE', status: 0, remain_quantity: 0 };
    CouponModel.findByCode.mockResolvedValue(coupon);
    const res = mockRes();
    await AdminCouponController.getCouponByCode(mockReq({ params: { code: 'SAVE' } }), res);
    expect(CouponModel.findByCode).toHaveBeenCalledWith('SAVE');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: coupon });
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('returns explicit absence for an unused code', async () => {
    CouponModel.findByCode.mockResolvedValue(null);
    const res = mockRes();
    await AdminCouponController.getCouponByCode(mockReq({ params: { code: 'MISSING' } }), res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
  });

  test.each([{}, { code: '' }, { code: 'x'.repeat(51) }, { code: ['SAVE'] }, { code: 'SAVE', extra: 'bad' }])(
    'rejects invalid code parameters %j before reading the model', async params => {
      const res = mockRes();
      await AdminCouponController.getCouponByCode(mockReq({ params }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(CouponModel.findByCode).not.toHaveBeenCalled();
    }
  );

  test('returns a failed read without claiming absence', async () => {
    CouponModel.findByCode.mockRejectedValue(new Error('database unavailable'));
    const res = mockRes();
    await AdminCouponController.getCouponByCode(mockReq({ params: { code: 'SAVE' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '获取优惠券详情失败' });
  });
});
