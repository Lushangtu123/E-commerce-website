import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const awaitGate = createRequire(import.meta.url)('./e2e/await-gate.cjs') as <T>(promise: Promise<T>, label: string) => Promise<T>;

afterEach(() => vi.useRealTimers());

it('fails a missing intercepted request after 30 seconds with its location', async () => {
  vi.useFakeTimers();
  const failure = vi.fn();
  void awaitGate(new Promise(() => {}), 'product card detail request').catch(failure);
  await vi.advanceTimersByTimeAsync(29999);
  expect(failure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(failure).toHaveBeenCalledExactlyOnceWith(new Error('Timed out waiting for product card detail request'));
  expect(vi.getTimerCount()).toBe(0);
});

it('returns a completed request and clears its timeout', async () => {
  vi.useFakeTimers();
  expect(await awaitGate(Promise.resolve('response'), 'initial cart response')).toBe('response');
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves an immediate request failure and clears its timeout', async () => {
  vi.useFakeTimers();
  const original = new Error('fixture refused the request');
  await expect(awaitGate(Promise.reject(original), 'initial cart response')).rejects.toBe(original);
  expect(vi.getTimerCount()).toBe(0);
});
