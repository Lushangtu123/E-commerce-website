import { expect, it } from 'vitest';
import { readPendingCheckout, storePendingCheckout } from '@/lib/pending-checkout';

const sessionKey = '["checkout-session",1]';
const input = { items: [{ product_id: 1, quantity: 1 }], shipping_address_id: 2, checkout_key: '11111111-1111-4111-8111-111111111111' };

it('does not restore a pending checkout with inconsistent confirmed amounts', () => {
  storePendingCheckout({ sessionKey, input: { ...input, expected_quote: { original_amount: 10, discount_amount: 2, total_amount: 10 } } } as never);
  expect(readPendingCheckout(sessionKey)).toBeNull();
});

it('restores a historical checkout without confirmed quote fields unchanged', () => {
  const attempt = { sessionKey, input };
  expect(storePendingCheckout(attempt)).toBe(true);
  expect(readPendingCheckout(sessionKey)).toEqual(attempt);
});

it.each([
  null,
  [],
  {},
  { original_amount: 10, discount_amount: 0 },
  { original_amount: '10', discount_amount: 0, total_amount: 10 },
  { original_amount: 10, discount_amount: -1, total_amount: 11 },
  { original_amount: 10, discount_amount: 11, total_amount: 0 },
  { original_amount: 10.001, discount_amount: 0, total_amount: 10.001 },
  { original_amount: 1e-20, discount_amount: 0, total_amount: 1e-20 },
  { original_amount: 100000000, discount_amount: 0, total_amount: 100000000 },
  { original_amount: 10, discount_amount: 0, total_amount: 10, extra: true },
])('rejects an invalid stored quote without stripping it to a legacy checkout: %j', expected_quote => {
  storePendingCheckout({ sessionKey, input: { ...input, expected_quote } } as never);
  expect(readPendingCheckout(sessionKey)).toBeNull();
});

it.each([
  { original_amount: 0, discount_amount: 0, total_amount: 0 },
  { original_amount: 10, discount_amount: 10, total_amount: 0 },
  { original_amount: 10.29, discount_amount: 0.3, total_amount: 9.99 },
  { original_amount: 99999999.99, discount_amount: 0, total_amount: 99999999.99 },
])('retains exact valid amounts, direct source and request key for recovery: %j', expected_quote => {
  const attempt = { sessionKey, input: { ...input, checkout_source: 'buy_now' as const, expected_quote } };
  expect(storePendingCheckout(attempt)).toBe(true);
  expect(readPendingCheckout(sessionKey)).toEqual(attempt);
  expect(readPendingCheckout('another-session')).toBeNull();
});
