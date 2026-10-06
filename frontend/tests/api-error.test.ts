import { expect, it } from 'vitest';
import { requestFailure } from '@/lib/api-error';

it('exposes server details and never throws for non-object errors', () => {
  const failure = { message: 'Request failed', response: { status: 409, data: { error: '库存不足', code: 'OUT_OF_STOCK' } } };
  expect(requestFailure(failure)).toBe(failure);
  expect(requestFailure(failure).response?.data?.error).toBe('库存不足');

  for (const value of [null, undefined, 'offline', 42]) {
    expect({ ...requestFailure(value) }, String(value)).toEqual({});
    expect(requestFailure(value).response?.data?.error).toBeUndefined();
  }
});
