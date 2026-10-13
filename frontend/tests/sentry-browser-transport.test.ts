import { expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/browser';

const sent = vi.hoisted(() => [] as unknown[]);
// Real SDK event building, integrations, scrubbing and envelopes; only transport is replaced.
vi.mock('@sentry/browser', async importOriginal => {
  const actual = await importOriginal<typeof import('@sentry/browser')>();
  return { ...actual, init: (options: Parameters<typeof actual.init>[0]) => actual.init({ ...options, transport: () => ({ send: async envelope => { sent.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) }) };
});

it('real SDK captures global errors, rejections and handled errors without sensitive event fields or other telemetry', async () => {
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1');
  vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'preview');
  vi.stubEnv('NEXT_PUBLIC_SENTRY_RELEASE', 'a'.repeat(40));
  const { initBrowserErrorReporting, reportBrowserError } = await import('@/lib/error-reporting');
  await initBrowserErrorReporting();
  Sentry.setUser({ email: 'private@example.com', ip_address: '127.0.0.1' });
  Sentry.setExtra('password', 'secret'); Sentry.setTag('token', 'secret');
  Sentry.addBreadcrumb({ message: 'private@example.com' });
  const error = new TypeError('password=secret');
  error.stack = 'TypeError: password=secret\n    at secret (https://shop/_next/static/chunks/app.js?token=secret:12:4)';
  window.dispatchEvent(new ErrorEvent('error', { error, message: 'password=secret', filename: 'https://shop/?token=secret', lineno: 12 }));
  const rejection = new Event('unhandledrejection');
  Object.defineProperty(rejection, 'reason', { value: new RangeError('private@example.com') });
  window.dispatchEvent(rejection);
  reportBrowserError(new ReferenceError('token=secret'));
  await Sentry.flush(2000);
  const events = sent.flatMap(envelope => (envelope as [unknown, [Record<string, unknown>, Record<string, unknown>][]])[1]);
  expect(events).toHaveLength(3);
  expect(events.every(([header]) => header.type === 'event')).toBe(true);
  expect(JSON.stringify(sent)).not.toMatch(/secret|private|password|token|127\.0\.0\.1|shop/);
  expect(events.map(([, event]) => (event.exception as { values: { type: string }[] }).values[0].type)).toEqual(['TypeError', 'RangeError', 'ReferenceError']);
  for (const [, event] of events) {
    expect(event).toMatchObject({ environment: 'preview', release: 'a'.repeat(40) });
    for (const key of ['user', 'request', 'breadcrumbs', 'extra', 'contexts', 'tags']) expect(event).not.toHaveProperty(key);
  }
  await Sentry.close();
});
