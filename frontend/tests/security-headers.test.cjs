const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('every response carries the baseline security headers and no x-powered-by', async () => {
  const config = require(path.resolve(__dirname, '../next.config.js'));
  assert.equal(config.poweredByHeader, false);
  const rules = await config.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*');
  const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(headers['content-security-policy'], "frame-ancestors 'self'");
  assert.match(headers['permissions-policy'], /camera=\(\)/);
});
