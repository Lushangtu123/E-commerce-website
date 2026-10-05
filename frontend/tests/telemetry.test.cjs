const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./runtime.cjs');
const { redactTelemetryUrl } = loadSource('src/lib/telemetry.ts');

test('telemetry removes URL secrets without changing the source event', () => {
  const event = { type: 'pageview', url: 'https://example.test/reset-password?email=customer%40example.test#token=secret' };
  const result = redactTelemetryUrl(event);
  assert.equal(result.url, 'https://example.test/reset-password');
  assert.equal(result.type, 'pageview');
  assert.match(event.url, /token=secret/);
});

test('speed insights retains route grouping while redacting search and credentials', () => {
  const result = redactTelemetryUrl({ type: 'vital', route: '/products/[id]', url: 'https://user:secret@example.test/products/1?q=private#details' });
  assert.equal(result.url, 'https://example.test/products/1');
  assert.equal(result.route, '/products/[id]');
  assert.equal(result.type, 'vital');
});

test('telemetry drops malformed and non-web URLs', () => {
  for (const url of ['not a URL', 'javascript:alert(1)', 'file:///private/secret']) {
    assert.equal(redactTelemetryUrl({ type: 'pageview', url }), null);
  }
});
