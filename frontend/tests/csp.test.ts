import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildContentSecurityPolicy } = require('../csp.js') as typeof import('../csp.js');
const configPath = require.resolve('../next.config.js');
afterEach(() => { delete require.cache[configPath]; });

const directives = (policy: string) => Object.fromEntries(policy.split(';').map(part => part.trim()).filter(Boolean)
  .map(part => { const [name, ...values] = part.split(/\s+/); return [name, values]; }));

describe('enforced policy', () => {
  it('limits scripts, connections, forms, plugins, base and framing to this site', () => {
    const { enforced } = buildContentSecurityPolicy({ dev: false });
    const csp = directives(enforced);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp['connect-src']).toEqual(["'self'"]);
    expect(csp['img-src']).toEqual(["'self'", 'https:', 'data:', 'blob:']);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'self'"]);
    // Plain-HTTP Docker deployments must keep working.
    expect(csp).not.toHaveProperty('upgrade-insecure-requests');
    expect(enforced).not.toMatch(/unsafe-eval/);
  });

  it('allows a separate API origin and the Sentry ingest host, nothing broader', () => {
    const { enforced } = buildContentSecurityPolicy({ dev: false, apiUrl: 'https://api.shop.example/api', sentryDsn: 'https://key@o123.ingest.sentry.io/45' });
    expect(directives(enforced)['connect-src']).toEqual(["'self'", 'https://api.shop.example', 'https://o123.ingest.sentry.io']);
  });

  it('ignores a same-origin API path and an invalid DSN', () => {
    const { enforced } = buildContentSecurityPolicy({ dev: false, apiUrl: '/api', sentryDsn: 'not a url' });
    expect(directives(enforced)['connect-src']).toEqual(["'self'"]);
  });

  it('lets the development server evaluate code and load the analytics debug script', () => {
    const csp = directives(buildContentSecurityPolicy({ dev: true, apiUrl: 'http://localhost:3001/api' }).enforced);
    expect(csp['script-src']).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://va.vercel-scripts.com']);
    expect(csp['connect-src']).toEqual(["'self'", 'http://localhost:3001', 'ws:']);
  });
});

describe('report-only trial', () => {
  it('is the same policy without inline scripts', () => {
    const { enforced, reportOnly } = buildContentSecurityPolicy({ dev: false });
    expect(directives(reportOnly)['script-src']).toEqual(["'self'"]);
    const without = (policy: string, ...names: string[]) => Object.fromEntries(Object.entries(directives(policy)).filter(([name]) => !names.includes(name)));
    expect(without(reportOnly, 'script-src', 'report-uri')).toEqual(without(enforced, 'script-src'));
  });

  it('reports to the Sentry security endpoint when a DSN is configured', () => {
    const { reportOnly } = buildContentSecurityPolicy({ dev: false, sentryDsn: 'https://key@o123.ingest.sentry.io/45' });
    expect(directives(reportOnly)['report-uri']).toEqual(['https://o123.ingest.sentry.io/api/45/security/?sentry_key=key']);
  });

  it('has no report endpoint without a DSN', () => {
    expect(directives(buildContentSecurityPolicy({ dev: false }).reportOnly)).not.toHaveProperty('report-uri');
  });
});

it('never reports from pages whose URL holds a secret', async () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@o123.ingest.sentry.io/45');
  delete require.cache[configPath];
  const rules: { source: string; headers: { key: string; value: string }[] }[] = await require(configPath).headers();
  const reset = rules.filter(rule => rule.source.startsWith('/reset-password'));
  expect(reset.map(rule => rule.source)).toEqual(['/reset-password', '/reset-password/:path*']);
  for (const rule of reset) {
    expect(rule.headers).toHaveLength(1);
    expect(rule.headers[0].key).toBe('Content-Security-Policy-Report-Only');
    expect(rule.headers[0].value).not.toMatch(/report-uri/);
    expect(directives(rule.headers[0].value)['script-src']).toEqual(["'self'"]);
  }
  // Every other page still reports, and the reset rules come last so they override it.
  expect(rules[0].headers.find(header => header.key === 'Content-Security-Policy-Report-Only')!.value).toMatch(/report-uri/);
  expect(rules.indexOf(reset[0])).toBeGreaterThan(0);
});

it('next.config sends both headers on every page', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PUBLIC_API_URL', '/api'); vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
  delete require.cache[configPath];
  const [{ source, headers }] = await require(configPath).headers();
  expect(source).toBe('/:path*');
  const byKey = Object.fromEntries(headers.map(({ key, value }: { key: string; value: string }) => [key, value]));
  expect(byKey['Content-Security-Policy']).toBe(buildContentSecurityPolicy({ dev: false, apiUrl: '/api' }).enforced);
  expect(byKey['Content-Security-Policy-Report-Only']).toBe(buildContentSecurityPolicy({ dev: false, apiUrl: '/api' }).reportOnly);
  expect(byKey['X-Frame-Options']).toBe('SAMEORIGIN');
});
