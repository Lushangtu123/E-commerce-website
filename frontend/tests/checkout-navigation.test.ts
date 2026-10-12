import { describe, expect, it } from 'vitest';
import { checkoutAddressHref, safeCheckoutReturn } from '@/lib/checkout-navigation';
import { readCheckoutSelection, storeCheckoutSelection } from '@/lib/checkout-selection';

const id = '11111111-1111-4111-8111-111111111111';
const scope = JSON.stringify(['first-session', 1]);
describe('checkout navigation and selection isolation', () => {
  it.each(['/cart', `/cart?buy_now=${id}`])('preserves the exact safe return %s', path => expect(safeCheckoutReturn(path)).toBe(path));
  it.each([undefined, null, '', 'https://evil.test/cart', '//evil.test/cart', '/admin', '/cart/other', '/cart?buy_now=bad',
    `/cart?buy_now=${id}&next=https://evil.test`, `/cart?buy_now=${id}#hash`, `/cart?buy_now=${id}%0a`, '/cart?user_coupon_id=2', '/cart?buy_now=%31'])
    ('rejects the unsafe or unsupported return %s', path => expect(safeCheckoutReturn(path)).toBe('/cart'));
  it('uses only the original direct purchase UUID in the address return query', () => {
    expect(checkoutAddressHref(id)).toBe(`/profile/address?return_to=${encodeURIComponent('/cart?buy_now=' + id)}`);
    expect(checkoutAddressHref(null)).toBe('/profile/address');
    expect(checkoutAddressHref('bad')).toBe('/profile/address');
  });
  it('keeps explicit empty selection distinct from an absent draft', () => {
    expect(readCheckoutSelection(scope)).toBeNull();
    expect(storeCheckoutSelection(scope, [])).toBe(true);
    expect(readCheckoutSelection(scope)).toEqual([]);
  });
  it('isolates choices across customers, sign-ins and tab storage', () => {
    storeCheckoutSelection(scope, ['12:base', '13:7']);
    expect(readCheckoutSelection(JSON.stringify(['first-session', 2]))).toBeNull();
    expect(readCheckoutSelection(JSON.stringify(['other-session', 1]))).toBeNull();
    expect(readCheckoutSelection(scope)).toEqual(['12:base', '13:7']);
    sessionStorage.clear();
    expect(readCheckoutSelection(scope)).toBeNull();
  });
  it.each(['{}', 'null', '["12:base","12:base"]', '["0:base"]', '["12:0"]', '["12:base",{}]', JSON.stringify(Array.from({ length: 101 }, (_, i) => `${i + 1}:base`))])
    ('rejects an unreadable subset instead of declaring no draft (%s)', value => {
      sessionStorage.setItem(`checkout-selection:${scope}`, value);
      expect(() => readCheckoutSelection(scope)).toThrow();
    });
});
