import { describe, expect, it } from 'vitest';
import type { OrderPreview } from '@/lib/api/orders';
import { validOrderPreview } from '@/lib/order-preview';

const availableCoupon = () => ({ user_coupon_id: 9, name: '八折优惠', code: 'SAVE20', discount_amount: 4.04 });
const quote = (): OrderPreview => ({
  original_amount: 20.2, discount_amount: 0, total_amount: 20.2,
  coupon: null, available_coupons: [availableCoupon()],
});
const selectedQuote = (): OrderPreview => ({
  ...quote(), discount_amount: 4.04, total_amount: 16.16,
  coupon: { user_coupon_id: 9, name: '八折优惠', code: 'SAVE20' },
});

describe('order preview validation', () => {
  it('accepts the backend couponless and selected coupon payloads', () => {
    expect(validOrderPreview(quote())).toBe(true);
    expect(validOrderPreview(selectedQuote(), 9)).toBe(true);
  });

  it('preserves harmless backend metadata and legacy string values', () => {
    const response = {
      ...selectedQuote(), success: true, error: null, request_id: 'quote-1',
      coupon: { user_coupon_id: 9, name: '', code: '', coupon_id: 5 },
      available_coupons: [{ ...availableCoupon(), name: '', code: '', can_use: true,
        discount_value: '20.00', min_amount: '0.00', max_discount: null, user_id: 1 }],
    };
    const before = structuredClone(response);

    expect(validOrderPreview(response, 9)).toBe(true);
    expect(response).toEqual(before);
  });

  it('accepts a genuine zero quote and zero coupon savings', () => {
    expect(validOrderPreview({ original_amount: 0, discount_amount: 0, total_amount: 0,
      coupon: null, available_coupons: [] })).toBe(true);
    expect(validOrderPreview({ ...selectedQuote(), discount_amount: 0, total_amount: 20.2,
      available_coupons: [{ ...availableCoupon(), discount_amount: 0 }] }, 9)).toBe(true);
  });

  it('compares cents without rejecting ordinary binary floating point noise', () => {
    expect(validOrderPreview({ ...selectedQuote(), original_amount: 0.3,
      discount_amount: 0.1, total_amount: 0.3 - 0.1,
      available_coupons: [{ ...availableCoupon(), discount_amount: 0.1 }] }, 9)).toBe(true);
    expect(validOrderPreview({ ...quote(), original_amount: 0.1 + 0.2,
      total_amount: 0.1 + 0.2, available_coupons: [] })).toBe(true);
  });

  it('accepts maximum backend money and coupon ID bounds', () => {
    expect(validOrderPreview({ ...quote(), original_amount: 99999999.99,
      total_amount: 99999999.99 })).toBe(true);
    expect(validOrderPreview({ original_amount: 99999999.99, discount_amount: 99999999.99,
      total_amount: 0, coupon: { user_coupon_id: 2147483647, name: 'All', code: 'ALL' },
      available_coupons: [{ user_coupon_id: 2147483647, name: 'All', code: 'ALL',
        discount_amount: 99999999.99 }] }, 2147483647)).toBe(true);
  });

  it.each([null, undefined, [], 'quote', false, 20.2].map(response => ({ response })))(
    'rejects a non-object quote: $response', ({ response }) => {
      expect(validOrderPreview(response)).toBe(false);
    });

  it.each([{ success: false }, { error: 'Unable to quote' }, { error: {} }, { error: false }, { error: '' }])(
    'rejects a failure payload even when money fields are present: %j', failure => {
      expect(validOrderPreview({ ...quote(), ...failure })).toBe(false);
    });

  const invalidMoney = [
    { name: 'numeric string', value: '20.20' }, { name: 'null', value: null },
    { name: 'boolean', value: true }, { name: 'missing', value: undefined },
    { name: 'object', value: {} }, { name: 'NaN', value: NaN },
    { name: 'infinity', value: Infinity }, { name: 'negative infinity', value: -Infinity },
    { name: 'negative', value: -0.01 }, { name: 'sub-cent', value: 0.001 },
    { name: 'positive amount below one cent', value: Number.EPSILON / 100 },
    { name: 'tiny sub-cent', value: 0.100000001 }, { name: 'over maximum', value: 100000000 },
    { name: 'sub-cent above maximum', value: 99999999.991 },
  ];
  const invalidTotals = (['original_amount', 'discount_amount', 'total_amount'] as const)
    .flatMap(field => invalidMoney.map(invalid => ({ field, ...invalid })));
  it.each(invalidTotals)('rejects $name in $field', ({ field, value }) => {
    expect(validOrderPreview({ ...quote(), [field]: value })).toBe(false);
  });

  it('rejects a total that disagrees with original minus discount', () => {
    expect(validOrderPreview({ ...selectedQuote(), total_amount: 16.17 }, 9)).toBe(false);
  });

  it('rejects a discount larger than the original amount', () => {
    expect(validOrderPreview({ ...selectedQuote(), discount_amount: 20.21, total_amount: 0,
      available_coupons: [{ ...availableCoupon(), discount_amount: 20.21 }] }, 9)).toBe(false);
  });

  it('rejects couponless savings that the backend cannot generate', () => {
    expect(validOrderPreview({ ...quote(), discount_amount: 4.04, total_amount: 16.16 })).toBe(false);
  });

  it.each([undefined, null, {}, 'coupons'])('requires an available coupons array: %s', available_coupons => {
    expect(validOrderPreview({ ...quote(), available_coupons })).toBe(false);
  });

  it('rejects an invalid or sparse available coupon list without dropping rows', () => {
    expect(validOrderPreview({ ...quote(), available_coupons: [availableCoupon(), null] })).toBe(false);
    expect(validOrderPreview({ ...quote(), available_coupons: new Array(1) })).toBe(false);
    expect(validOrderPreview({ ...quote(), available_coupons: [[], 'coupon'] })).toBe(false);
  });

  const invalidIds = [0, -1, 1.5, '9', null, undefined, NaN, Infinity, 2147483648];
  it.each(invalidIds)('rejects an invalid available coupon ID: %s', user_coupon_id => {
    expect(validOrderPreview({ ...quote(), available_coupons: [{ ...availableCoupon(), user_coupon_id }] })).toBe(false);
  });

  it.each(invalidIds)('rejects an invalid requested coupon ID: %s', requestedId => {
    // Undefined means no coupon requested, so a selected coupon is still invalid here.
    expect(validOrderPreview(selectedQuote(), requestedId as number | undefined)).toBe(false);
  });

  it.each(['name', 'code'] as const)('requires string %s for available and selected coupons', field => {
    for (const value of [null, undefined, 20, {}]) {
      expect(validOrderPreview({ ...quote(), available_coupons: [{ ...availableCoupon(), [field]: value }] })).toBe(false);
      expect(validOrderPreview({ ...selectedQuote(), coupon: { ...selectedQuote().coupon!, [field]: value } }, 9)).toBe(false);
    }
  });

  it.each(invalidMoney)('rejects $name in an available coupon discount', ({ value }) => {
    expect(validOrderPreview({ ...quote(), available_coupons: [{ ...availableCoupon(), discount_amount: value }] })).toBe(false);
  });

  it('rejects an available coupon discount above the original amount', () => {
    expect(validOrderPreview({ ...quote(), available_coupons: [{ ...availableCoupon(), discount_amount: 20.21 }] })).toBe(false);
  });

  it('rejects duplicate available coupon IDs even with different metadata', () => {
    expect(validOrderPreview({ ...quote(), available_coupons: [availableCoupon(), availableCoupon()] })).toBe(false);
    expect(validOrderPreview({ ...quote(), available_coupons: [availableCoupon(),
      { ...availableCoupon(), name: 'Different', code: 'OTHER', discount_amount: 1 }] })).toBe(false);
  });

  it('requires an explicit null coupon when none was requested', () => {
    expect(validOrderPreview({ ...quote(), coupon: undefined })).toBe(false);
    expect(validOrderPreview(selectedQuote())).toBe(false);
  });

  it.each([null, undefined, [], 'coupon', false].map(coupon => ({ coupon })))(
    'requires the requested selected coupon object: $coupon', ({ coupon }) => {
      expect(validOrderPreview({ ...selectedQuote(), coupon }, 9)).toBe(false);
    });

  it('rejects a selected coupon different from the requested one', () => {
    expect(validOrderPreview(selectedQuote(), 10)).toBe(false);
  });

  it('requires the selected coupon to appear in the available list', () => {
    expect(validOrderPreview({ ...selectedQuote(), available_coupons: [] }, 9)).toBe(false);
  });

  it.each(['name', 'code'] as const)('rejects selected %s different from the available entry', field => {
    expect(validOrderPreview({ ...selectedQuote(), coupon: { ...selectedQuote().coupon!, [field]: 'OTHER' } }, 9)).toBe(false);
  });

  it('requires the selected coupon discount to match the quote', () => {
    expect(validOrderPreview({ ...selectedQuote(), available_coupons: [{ ...availableCoupon(), discount_amount: 4 }] }, 9)).toBe(false);
  });
});
