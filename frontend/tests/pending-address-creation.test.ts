import { describe, expect, it, vi } from 'vitest';
import { clearPendingAddressCreation, readPendingAddressCreation, storePendingAddressCreation, type PendingAddressCreation } from '@/lib/pending-address-creation';

const attempt: PendingAddressCreation = {
  key: '861dc7fb-0207-4b9a-98c3-95e6d28acb28', uncertain: false,
  input: { receiver_name: '收件人', phone: '13800000000', province: '省', city: '市', district: '区', detail_address: '路1号', is_default: false },
};
describe('durable per-tab address creation identity', () => {
  it('roundtrips the complete original payload and isolates account/sign-in identity', () => {
    expect(storePendingAddressCreation('one', 1, attempt)).toBe(true);
    expect(readPendingAddressCreation('one', 1)).toEqual(attempt);
    expect(readPendingAddressCreation('one', 2)).toBeNull();
    expect(readPendingAddressCreation('other', 1)).toBeNull();
  });
  it('does not replace a pending payload/key or downgrade its uncertainty', () => {
    expect(storePendingAddressCreation('one', 1, attempt)).toBe(true);
    expect(storePendingAddressCreation('one', 1, { ...attempt, input: { ...attempt.input, detail_address: '另一地址' } })).toBe(false);
    expect(storePendingAddressCreation('one', 1, { ...attempt, key: '0272a762-b4f9-43da-8e56-79405f7dab36' })).toBe(false);
    expect(storePendingAddressCreation('one', 1, { ...attempt, uncertain: true })).toBe(true);
    expect(storePendingAddressCreation('one', 1, attempt)).toBe(false);
    expect(readPendingAddressCreation('one', 1)).toEqual({ ...attempt, uncertain: true });
  });
  it('only removes the matching intent and treats unavailable storage as a lock', () => {
    storePendingAddressCreation('one', 1, attempt);
    expect(clearPendingAddressCreation('one', 1, 'another-key')).toBe(false);
    expect(clearPendingAddressCreation('one', 1, attempt.key)).toBe(true);
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => readPendingAddressCreation('one', 1)).toThrow('blocked');
    expect(storePendingAddressCreation('one', 1, attempt)).toBe(false);
    expect(clearPendingAddressCreation('one', 1, attempt.key)).toBe(false);
  });
  it.each(['null', '{broken', JSON.stringify({ ...attempt, key: 'invalid' }), JSON.stringify({ ...attempt, input: { ...attempt.input, receiver_name: '' } })])('keeps malformed pending data intact: %s', data => {
    sessionStorage.setItem('pending-address-create:one:1', data);
    expect(() => readPendingAddressCreation('one', 1)).toThrow();
    expect(clearPendingAddressCreation('one', 1, attempt.key)).toBe(false);
    expect(sessionStorage.getItem('pending-address-create:one:1')).toBe(data);
  });
});
