import type { ShippingAddress } from '@/lib/api';

/** Validate owned address reads before selecting an address or enabling address writes. */
export function readAddressList(value: unknown): { addresses: ShippingAddress[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid address list');
  const result = value as Record<string, unknown>;
  if (result.success === false || result.error != null || !Array.isArray(result.addresses)) throw new Error('Invalid address list');
  const ids = new Set<number>();
  for (const row of result.addresses) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid address list');
    const address = row as Record<string, unknown>;
    const id = address.address_id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || ids.has(id) ||
      typeof address.receiver_name !== 'string' || typeof address.phone !== 'string' ||
      ![true, false, 0, 1].includes(address.is_default as boolean | number) ||
      ['province', 'city', 'district', 'detail_address'].some(name => address[name] !== null && typeof address[name] !== 'string')) {
      throw new Error('Invalid address list');
    }
    ids.add(id);
  }
  return { addresses: result.addresses as ShippingAddress[] };
}
