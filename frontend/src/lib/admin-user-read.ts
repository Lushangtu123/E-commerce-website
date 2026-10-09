import type { AdminPage, AdminUserDetail, AdminUserOrders, AdminUserRow } from '@/lib/api/admin';
import { requestFailure } from '@/lib/api-error';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown) => value == null || typeof value === 'string';
const money = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value)) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && Number.isFinite(new Date(value).getTime());

/** Match the API's canonical positive BIGINT path within JavaScript's safe range. */
export function adminUserId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return positiveId(id) ? id : null;
}

function validUser(value: unknown): value is AdminUserRow {
  return object(value) && positiveId(value.user_id) && typeof value.username === 'string' && typeof value.email === 'string' &&
    text(value.phone) && (value.status === 0 || value.status === 1) && date(value.created_at) &&
    (value.updated_at == null || date(value.updated_at)) && (value.order_count == null || count(value.order_count)) &&
    (value.total_spent == null || money(value.total_spent));
}

function validOrders(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<number>();
  return value.every(row => {
    if (!object(row) || !positiveId(row.order_id) || ids.has(row.order_id) || typeof row.order_no !== 'string' ||
        !money(row.total_amount) || !count(row.status) || row.status > 4 || !date(row.created_at) ||
        (row.item_count != null && !count(row.item_count))) return false;
    ids.add(row.order_id);
    return true;
  });
}

function validPagination(value: unknown, page: number, limit: number): boolean {
  if (!object(value) || !count(value.total)) return false;
  return (value.page == null || value.page === page) && (value.limit == null || value.limit === limit) &&
    (value.totalPages == null || (count(value.totalPages) && value.totalPages === Math.ceil(value.total / limit)));
}

/** A different customer's response must never populate this customer's page. */
export function validAdminUserDetail(value: unknown, userId: number): value is AdminUserDetail {
  if (!object(value) || !validUser(value.user) || value.user.user_id !== userId || !validOrders(value.recent_orders) ||
      !Array.isArray(value.addresses)) return false;
  const ids = new Set<number>();
  return value.addresses.every(row => {
    if (!object(row) || !positiveId(row.address_id) || ids.has(row.address_id) ||
        (row.user_id != null && row.user_id !== userId) || typeof row.receiver_name !== 'string' || typeof row.phone !== 'string' ||
        !['province', 'city', 'district', 'detail_address'].every(field => text(row[field])) ||
        ![undefined, null, false, true, 0, 1].includes(row.is_default as undefined | null | boolean | number)) return false;
    ids.add(row.address_id);
    return true;
  });
}

export function validAdminUserOrders(value: unknown, userId: number, page: number): value is AdminUserOrders {
  return object(value) && validOrders(value.orders) && (value.orders as Record<string, unknown>[]).length <= 10 &&
    (value.orders as Record<string, unknown>[]).every(row => row.user_id == null || row.user_id === userId) &&
    validPagination(value.pagination, page, 10);
}

export type AdminUserSnapshot = AdminPage & { users: AdminUserRow[] };
/** Only a valid snapshot for the requested page can unlock an uncertain write. */
export function validAdminUserSnapshot(value: unknown, page: number): value is AdminUserSnapshot {
  if (!object(value) || !Array.isArray(value.users) || value.users.length > 20 || !validPagination(value.pagination, page, 20)) return false;
  const ids = new Set<number>();
  return value.users.every(row => {
    if (!validUser(row) || ids.has(row.user_id)) return false;
    ids.add(row.user_id);
    return true;
  });
}

/** Timeouts, conflicts and rate limits may hide a committed result; validation/auth rejections are definite. */
export function unknownUserStatusWrite(error: unknown): boolean {
  const status = requestFailure(error).response?.status;
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function userStatusAcknowledged(value: unknown, status: number): boolean {
  return object(value) && value.message === '更新成功' && value.status === status;
}
