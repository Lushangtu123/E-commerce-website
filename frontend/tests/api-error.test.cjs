const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./runtime.cjs');

const { requestFailure } = loadSource('src/lib/api-error.ts');

test('request failures expose server details and never throw for non-object errors', () => {
  const failure = { message: 'Request failed', response: { status: 409, data: { error: '库存不足', code: 'OUT_OF_STOCK' } } };
  assert.equal(requestFailure(failure), failure);
  assert.equal(requestFailure(failure).response?.data?.error, '库存不足');
  for (const value of [null, undefined, 'offline', 42]) {
    assert.deepEqual({ ...requestFailure(value) }, {}, String(value));
    assert.equal(requestFailure(value).response?.data?.error, undefined);
  }
});
