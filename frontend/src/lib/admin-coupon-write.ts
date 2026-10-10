import type { AdminCouponPage, Coupon } from '@/lib/api';
import type { CouponFormValues } from '@/components/AdminCouponForm';
import { requestFailure } from '@/lib/api-error';

export type CouponWriteIntent = { key: string } & (
  { kind: 'create'; input: CouponFormValues } | { kind: 'status'; id: number; status: number }
);
const storageKey = (sessionId: string) => `pending-admin-coupon-write:${sessionId}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const money = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value)) &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 99999999.99;

export function unknownCouponWrite(error: unknown) {
  const status = requestFailure(error).response?.status;
  return status === undefined || status === 408 || status >= 500;
}

/** A partial, wrong-identity, or invalid detail must never unlock an uncertain write. */
export function validCouponSnapshot(value: unknown): value is Coupon {
  return record(value) && positiveId(value.coupon_id) && typeof value.code === 'string' && !!value.code.trim() && value.code.length <= 50 &&
    typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 100 &&
    (value.description == null || typeof value.description === 'string') && [1, 2, 3].includes(Number(value.type)) &&
    typeof value.type === 'number' && money(value.discount_value) && Number(value.discount_value) > 0 &&
    (value.type !== 2 || Number(value.discount_value) <= 100) && money(value.min_amount) &&
    (value.max_discount == null || money(value.max_discount)) && positiveId(value.total_quantity) && count(value.remain_quantity) &&
    Number(value.remain_quantity) <= Number(value.total_quantity) && positiveId(value.per_user_limit) &&
    (value.status === 0 || value.status === 1) && date(value.start_time) && date(value.end_time) &&
    Date.parse(String(value.end_time)) > Date.parse(String(value.start_time));
}

export function validCouponPage(value: unknown): value is AdminCouponPage {
  if (!record(value) || !Array.isArray(value.data) || !record(value.pagination) ||
    !positiveId(value.pagination.page) || !positiveId(value.pagination.page_size) || Number(value.pagination.page_size) > 100 ||
    !count(value.pagination.total) || !count(value.pagination.total_pages) ||
    value.pagination.total_pages !== Math.ceil(Number(value.pagination.total) / Number(value.pagination.page_size)) ||
    value.data.length > Number(value.pagination.page_size) || value.data.length > Number(value.pagination.total)) return false;
  const ids = new Set<number>();
  return value.data.every(row => {
    if (!validCouponSnapshot(row) || !record(row) || !count(row.received_count) || !count(row.used_count) || ids.has(row.coupon_id)) return false;
    ids.add(row.coupon_id); return true;
  });
}

/** Server DECIMAL strings and its null/zero no-cap convention describe the same submitted rules. */
export function matchesCouponCreation(coupon: Coupon, input: CouponFormValues) {
  return coupon.code.toUpperCase() === input.code.trim().toUpperCase() && coupon.name === input.name.trim() &&
    (coupon.description ?? '') === input.description && coupon.type === input.type &&
    Number(coupon.discount_value) === input.discount_value && Number(coupon.min_amount) === input.min_amount &&
    Number(coupon.max_discount ?? 0) === input.max_discount && coupon.total_quantity === input.total_quantity &&
    coupon.per_user_limit === input.per_user_limit && Date.parse(coupon.start_time) === Date.parse(input.start_time) &&
    Date.parse(coupon.end_time) === Date.parse(input.end_time);
}

/** Critical coupon rules and state must agree across the detail and refreshed list. */
export function matchesCouponSnapshot(value: Coupon, canonical: Coupon) {
  return value.coupon_id === canonical.coupon_id && value.status === canonical.status && matchesCouponCreation(value, {
    code: canonical.code, name: canonical.name, description: canonical.description ?? '', type: canonical.type,
    discount_value: Number(canonical.discount_value), min_amount: Number(canonical.min_amount), max_discount: Number(canonical.max_discount ?? 0),
    total_quantity: canonical.total_quantity, per_user_limit: canonical.per_user_limit,
    start_time: canonical.start_time, end_time: canonical.end_time,
  });
}

function validIntent(value: unknown): value is CouponWriteIntent {
  if (!record(value) || typeof value.key !== 'string' || !value.key || value.key.length > 100) return false;
  if (value.kind === 'status') return positiveId(value.id) && (value.status === 0 || value.status === 1) &&
    Object.keys(value).every(key => ['key', 'kind', 'id', 'status'].includes(key));
  if (value.kind !== 'create' || !record(value.input) || Object.keys(value).some(key => !['key', 'kind', 'input'].includes(key))) return false;
  const input = value.input;
  const strings = ['code', 'name', 'description', 'start_time', 'end_time'];
  const numbers = ['type', 'discount_value', 'min_amount', 'max_discount', 'total_quantity', 'per_user_limit'];
  return strings.every(key => typeof input[key] === 'string') && !!String(input.code).trim() && !!String(input.name).trim() &&
    numbers.every(key => typeof input[key] === 'number' && Number.isFinite(input[key])) && date(input.start_time) && date(input.end_time) &&
    Object.keys(input).every(key => [...strings, ...numbers].includes(key));
}

/** Written before a request, so a navigation cannot lose the original code or payload. */
export function readCouponWrite(sessionId: string): CouponWriteIntent | null {
  const stored = sessionStorage.getItem(storageKey(sessionId));
  if (stored === null) return null;
  const value: unknown = JSON.parse(stored);
  if (!validIntent(value)) throw new Error('Invalid coupon write intent');
  return value;
}

export function storeCouponWrite(sessionId: string, intent: CouponWriteIntent): boolean {
  try {
    const previous = readCouponWrite(sessionId), serialized = JSON.stringify(intent);
    if (!validIntent(intent) || previous && JSON.stringify(previous) !== serialized) return false;
    sessionStorage.setItem(storageKey(sessionId), serialized);
    return sessionStorage.getItem(storageKey(sessionId)) === serialized;
  } catch { return false; }
}

export function clearCouponWrite(sessionId: string, key: string): boolean {
  try {
    const previous = readCouponWrite(sessionId);
    if (previous && previous.key !== key) return false;
    sessionStorage.removeItem(storageKey(sessionId));
    return sessionStorage.getItem(storageKey(sessionId)) === null;
  } catch { return false; }
}

export function couponCreationDraft(input: CouponFormValues): CouponFormValues {
  const local = (value: string) => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  return { ...input, start_time: local(input.start_time), end_time: local(input.end_time) };
}
