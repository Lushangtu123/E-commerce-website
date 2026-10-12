import { describe, expect, it } from 'vitest';
import { readAddressList } from '@/lib/address-list-response';

const address = { address_id: 41, receiver_name: 'Receiver', phone: '13800138000',
  province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: 1 };

describe('owned address list response', () => {
  it('accepts an actual empty list', () => expect(readAddressList({ addresses: [] })).toEqual({ addresses: [] }));
  it.each([true, false, 0, 1])('accepts database and boolean default markers %s', is_default => {
    const addresses = [{ ...address, is_default, province: null, city: null, district: null, detail_address: null }];
    expect(readAddressList({ addresses, success: true, error: null }).addresses).toBe(addresses);
  });
  it.each([
    null, undefined, [], {}, { addresses: null }, { addresses: {} }, { addresses: [null] },
    { addresses: [address, address] }, { addresses: [address], success: false }, { addresses: [], error: '' },
    ...[0, -1, 1.5, '41', Number.MAX_SAFE_INTEGER + 1, NaN].map(address_id => ({ addresses: [{ ...address, address_id }] })),
    ...['receiver_name', 'phone', 'province', 'city', 'district', 'detail_address'].map(key => ({ addresses: [{ ...address, [key]: {} }] })),
    { addresses: [{ ...address, is_default: 2 }] }, { addresses: [{ ...address, is_default: undefined }] },
  ])('rejects invalid or contradictory list %j', value => {
    expect(() => readAddressList(value)).toThrow('Invalid address list');
  });
});
