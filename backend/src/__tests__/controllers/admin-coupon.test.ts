/**
 * 管理员优惠券审计日志测试
 * 验证创建/更新优惠券时会写入操作日志
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

jest.mock('../../controllers/admin.controller', () => ({
  logAdminAction: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CouponModel } = require('../../models/coupon.model');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logAdminAction } = require('../../controllers/admin.controller');
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

describe('createCoupon', () => {
  test('创建成功时记录 CREATE_COUPON 审计日志', async () => {
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
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(logAdminAction).toHaveBeenCalledWith(
      1,
      'CREATE_COUPON',
      'coupon',
      '42',
      '创建优惠券: 新用户券 (NEW2024)',
      '127.0.0.1',
      'test-agent'
    );
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
  test('更新成功时记录 UPDATE_COUPON_STATUS 审计日志', async () => {
    CouponModel.findById.mockResolvedValue({
      coupon_id: 7,
      name: '老券',
      code: 'OLD2024',
    });
    CouponModel.updateStatus.mockResolvedValue(undefined);

    const req = mockReq({ params: { id: '7' }, body: { status: 0 } });
    const res = mockRes();

    await AdminCouponController.updateCouponStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(logAdminAction).toHaveBeenCalledWith(
      1,
      'UPDATE_COUPON_STATUS',
      'coupon',
      '7',
      '停用优惠券: 老券 (OLD2024)',
      '127.0.0.1',
      'test-agent'
    );
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
