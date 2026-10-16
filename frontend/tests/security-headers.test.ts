import { expect, it } from 'vitest';
import config from '../next.config.js';

it('sends the baseline security headers with every response and no x-powered-by', async () => {
  expect(config.poweredByHeader).toBe(false);
  const rules = await config.headers();
  expect(rules).toHaveLength(3);
  expect(rules[0].source).toBe('/:path*');

  const headers = Object.fromEntries(rules[0].headers.map(({ key, value }: { key: string; value: string }) => [key.toLowerCase(), value]));
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  // The policy itself is covered by tests/csp.test.ts.
  expect(headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
  expect(headers['content-security-policy']).toMatch(/script-src 'self'/);
  expect(headers['content-security-policy-report-only']).toMatch(/script-src 'self';/);
  expect(headers['permissions-policy']).toMatch(/camera=\(\)/);
});
