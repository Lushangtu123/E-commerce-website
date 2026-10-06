import { expect, it } from 'vitest';
import { redactTelemetryUrl } from '@/lib/telemetry';

it('removes URL secrets without changing the source event', () => {
  const event = { type: 'pageview', url: 'https://example.test/reset-password?email=customer%40example.test#token=secret' };

  const result = redactTelemetryUrl(event);

  expect(result).toMatchObject({ type: 'pageview', url: 'https://example.test/reset-password' });
  expect(event.url).toMatch(/token=secret/);
});

it('keeps speed insights route grouping while redacting the query and credentials', () => {
  const result = redactTelemetryUrl({ type: 'vital', route: '/products/[id]', url: 'https://user:secret@example.test/products/1?q=private#details' });

  expect(result).toMatchObject({ type: 'vital', route: '/products/[id]', url: 'https://example.test/products/1' });
});

it.each(['not a URL', 'javascript:alert(1)', 'file:///private/secret'])('drops the malformed or non-web URL %s', (url) => {
  expect(redactTelemetryUrl({ type: 'pageview', url })).toBeNull();
});
