import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const configPath = require.resolve('../next.config.js');
afterEach(() => { delete require.cache[configPath]; });

it('forwards only environment and commit metadata from Vercel at build time', () => {
  vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40));
  vi.stubEnv('SENTRY_DSN', 'backend-private'); vi.stubEnv('JWT_SECRET', 'secret');
  delete require.cache[configPath];
  expect(require(configPath).env).toEqual({ ECOMMERCE_SERVERLESS_API: 'false', NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'preview', NEXT_PUBLIC_SENTRY_RELEASE: 'a'.repeat(40) });
});

it('uses local defaults when Vercel system variables are absent', () => {
  vi.stubEnv('VERCEL_ENV', ''); vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
  vi.stubEnv('NODE_ENV', 'development'); delete require.cache[configPath];
  expect(require(configPath).env).toMatchObject({ NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'development', NEXT_PUBLIC_SENTRY_RELEASE: '' });
});
