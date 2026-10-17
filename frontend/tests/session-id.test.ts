import { afterEach, describe, expect, it, vi } from 'vitest';
import { newSessionId } from '@/lib/session-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newSessionId', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses randomUUID when the page is a secure context', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');
    expect(newSessionId()).toMatch(UUID_V4);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('builds a version 4 UUID from getRandomValues over plain HTTP, never Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff) });
    expect(newSessionId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(random).not.toHaveBeenCalled();
  });

  it('refuses to invent an identifier without Web Crypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => newSessionId()).toThrow('Web Crypto is unavailable');
  });
});
