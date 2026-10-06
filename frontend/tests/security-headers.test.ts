import { expect, it } from 'vitest';
import config from '../next.config.js';

it('sends the baseline security headers with every response and no x-powered-by', async () => {
  expect(config.poweredByHeader).toBe(false);
  const rules = await config.headers();
  expect(rules).toHaveLength(1);
  expect(rules[0].source).toBe('/:path*');

  const headers = Object.fromEntries(rules[0].headers.map(({ key, value }: { key: string; value: string }) => [key.toLowerCase(), value]));
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(headers['content-security-policy']).toBe("frame-ancestors 'self'");
  expect(headers['permissions-policy']).toMatch(/camera=\(\)/);
});
