/**
 * 用户端优惠券流程测试
 * 覆盖：领取优惠券（按 ID / 按 code）、异常分支
 */
import { Response } from 'express';

jest.mock('../../models/coupon.model', () => ({
  CouponModel: {
    findByCode: jest.fn(),
    receiveCoupon: jest.fn(),
    findById: jest.fn(),
  },
  CouponType: { FULL_REDUCTION: 1, DISCOUNT: 2, NO_THRESHOLD: 3 },
  CouponStatus: { DISABLED: 0, ENABLED: 1 },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CouponModel } = require('../../models/coupon.model');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CouponController } = require('../../controllers/coupon.controller');

function mockRes() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('receiveCoupon 领取优惠券', () => {
  test('按 coupon_id 领取成功', async () => {
    CouponModel.receiveCoupon.mockResolvedValue(501);

    const req = { userId: 7, body: { coupon_id: 10 } } as any;
    const res = mockRes();

    await CouponController.receiveCoupon(req, res);

    expect(CouponModel.receiveCoupon).toHaveBeenCalledWith(7, 10);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: { user_coupon_id: 501 },
      })
    );
  });

  test('按 code 领取成功（先查 code 再领取）', async () => {
    CouponModel.findByCode.mockResolvedValue({ coupon_id: 11, code: 'NEW2024' });
    CouponModel.receiveCoupon.mockResolvedValue(502);

    const req = { userId: 7, body: { code: 'NEW2024' } } as any;
    const res = mockRes();

    await CouponController.receiveCoupon(req, res);

    expect(CouponModel.findByCode).toHaveBeenCalledWith('NEW2024');
    expect(CouponModel.receiveCoupon).toHaveBeenCalledWith(7, 11);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('code 不存在时返回 404 且不扣减', async () => {
    CouponModel.findByCode.mockResolvedValue(null);

    const req = { userId: 7, body: { code: 'NOPE' } } as any;
    const res = mockRes();

    await CouponController.receiveCoupon(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(CouponModel.receiveCoupon).not.toHaveBeenCalled();
  });

  test('未提供 ID 或 code 时返回 400', async () => {
    const req = { userId: 7, body: {} } as any;
    const res = mockRes();

    await CouponController.receiveCoupon(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(CouponModel.receiveCoupon).not.toHaveBeenCalled();
  });

  test('已领完时返回 400（model 抛错透出）', async () => {
    CouponModel.receiveCoupon.mockRejectedValue(new Error('优惠券已领完'));

    const req = { userId: 7, body: { coupon_id: 10 } } as any;
    const res = mockRes();

    await CouponController.receiveCoupon(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: '优惠券已领完' })
    );
  });

  test('达领取上限时返回 400', async () => {
    CouponModel.receiveCoupon.mockRejectedValue(new Error('已达领取上限'));

    const req = { userId: 7, body: { coupon_id: 10 } } as any;
    const res = mockRes();

    await CouponController.receiveCoupon(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '已达领取上限' })
    );
  });
});
