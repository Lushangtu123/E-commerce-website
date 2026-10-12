import { expect, it, vi } from 'vitest';
import { readCheckoutChoices, storeCheckoutChoices, clearCheckoutChoices } from '@/lib/checkout-choices';

it('stores only identifiers and isolates sessions and direct-purchase intents', () => {
  const choices = { addressId: 42, couponId: null };
  expect(storeCheckoutChoices('first', null, choices)).toBe(true);
  expect(readCheckoutChoices('first', null)).toEqual(choices);
  expect(readCheckoutChoices('other', null)).toEqual({});
  expect(readCheckoutChoices('first', 'purchase')).toEqual({});
  expect(storeCheckoutChoices('first', 'purchase', { addressId: 41, couponId: 7 })).toBe(true);
  clearCheckoutChoices('first', 'purchase');
  expect(readCheckoutChoices('first', null)).toEqual(choices);
  expect(readCheckoutChoices('first', 'purchase')).toEqual({});
});

it.each(['null', '[]', '{"addressId":0}', '{"addressId":2147483648}', '{"couponId":"7"}', '{"couponId":-1}', '{"couponId":1.1}', '{"addressId":42,"receiver_name":"private"}'])('rejects malformed or excessive choice data %s', raw => {
  sessionStorage.setItem('checkout-choices:["first",null]', raw);
  expect(() => readCheckoutChoices('first', null)).toThrow('Invalid checkout choices');
});

it('requires a read-back acknowledgement before declaring the choices saved', () => {
  vi.spyOn(sessionStorage, 'getItem').mockReturnValue('{}');
  expect(storeCheckoutChoices('first', null, { addressId: 42 })).toBe(false);
});
