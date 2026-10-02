jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), pool: {} }));

import { CouponModel, CouponType } from '../../models/coupon.model';

function discount(overrides: any, amount: number) {
  return CouponModel.calculateDiscount({ type: CouponType.DISCOUNT, discount_value: 20, min_amount: 0, ...overrides } as any, amount);
}

describe('优惠金额合同', () => {
  test('discount_value=20 减免20%，100元订单优惠20元', () => {
    expect(discount({}, 100)).toBe(20);
  });

  test('折扣优惠按分四舍五入', () => {
    expect(discount({}, 19.99)).toBe(4);
    expect(discount({ discount_value: 50 }, 0.01)).toBe(0.01);
  });

  test.each([undefined, null, 0, '0.00'])('max_discount=%p 兼容为无限额', max_discount => {
    expect(discount({ max_discount }, 100)).toBe(20);
  });

  test('满减和无门槛受订单金额限制，折扣受正数上限限制', () => {
    expect(discount({ type: 1, discount_value: '50.00', min_amount: '100.00' }, 99.99)).toBe(0);
    expect(discount({ type: 1, discount_value: '50.00', min_amount: '100.00' }, 100)).toBe(50);
    expect(discount({ type: 3, discount_value: '50.00' }, 10)).toBe(10);
    expect(discount({ max_discount: '10.00' }, 100)).toBe(10);
  });

  test.each([
    { discount_value: -1 }, { discount_value: 0 }, { discount_value: 101 },
    { discount_value: Infinity }, { discount_value: 'not-money' },
    { min_amount: -1 }, { max_discount: -1 }, { max_discount: Infinity },
    { type: 4 }, { type: 3, min_amount: 1 },
  ])('非法规则不产生优惠：%p', rule => {
    expect(() => discount(rule, 100)).toThrow();
  });

  test.each([-1, Infinity, NaN, 0.001])('非法订单金额 %p 不产生优惠', amount => {
    expect(() => discount({}, amount)).toThrow();
  });
});
