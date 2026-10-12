import type { AdminOrderRow, AdminPage, AdminProductRow, AdminUserRow } from '@/lib/api';
import { validCustomerOrder } from '@/lib/customer-order-recovery';
import { validProductSnapshot } from '@/lib/admin-inventory-write';
import { validAdminUserSnapshot } from '@/lib/admin-user-read';
import { moneyToCents } from '@/lib/money';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown) => value == null || typeof value === 'string';
const money = (value: unknown) => {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  try { moneyToCents(value); return true; } catch { return false; }
};
// Lifetime spend is SUM(order amounts), so it can exceed one DECIMAL(10,2) order.
function aggregateMoney(value: unknown): boolean {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))) return false;
  const amount = Number(value), cents = amount * 100;
  return Number.isFinite(amount) && amount >= 0 &&
    (Math.round(cents) !== 0 || amount === 0) &&
    Math.abs(cents - Math.round(cents)) <= Number.EPSILON * Math.max(1, Math.abs(cents)) * 2;
}
interface ListRequest { page: number; status?: string }
function pagination(value: unknown, page: number): value is AdminPage & Record<string, unknown> {
  if (!record(value) || value.success === false || value.error != null || !record(value.pagination)) return false;
  const meta = value.pagination;
  // Older admin API consumers used totals only; validate echoed fields whenever present.
  return count(meta.total) && (meta.page === undefined || meta.page === page) &&
    (meta.limit === undefined || meta.limit === 20) &&
    (meta.totalPages === undefined || meta.totalPages === Math.ceil(meta.total / 20));
}
const matchesStatus = (status: unknown, request: ListRequest) => !request.status || String(status) === request.status;

export function readAdminOrders(value: unknown, request: ListRequest & { userId?: string }): AdminPage & { orders: AdminOrderRow[] } {
  if (!pagination(value, request.page) || !Array.isArray(value.orders) || value.orders.length > 20) throw new Error('Invalid admin orders');
  const ids = new Set<number>();
  for (const row of value.orders) {
    if (!record(row) || !validCustomerOrder(row) || ids.has(row.order_id) || !matchesStatus(row.status, request) ||
        !text(row.username) || (row.item_count != null && !count(row.item_count)) ||
        (request.userId && row.user_id !== Number(request.userId))) throw new Error('Invalid admin order');
    ids.add(row.order_id);
  }
  return { ...value, orders: value.orders as AdminOrderRow[] };
}

export function readAdminProducts(value: unknown, request: ListRequest): AdminPage & { products: AdminProductRow[] } {
  if (!pagination(value, request.page) || !validProductSnapshot(value) || value.products.length > 20 ||
      !value.products.every(row => matchesStatus(row.status, request) &&
        money(row.price) && (row.original_price == null || money(row.original_price)) && text(row.category_name) &&
        (row.sales_count == null || count(row.sales_count)) &&
        (row.has_sku === undefined || [false, true, 0, 1].includes(row.has_sku)) &&
        (row.sellable_stock == null || count(row.sellable_stock)) && (row.sku_min_price == null || money(row.sku_min_price)))) {
    throw new Error('Invalid admin products');
  }
  return value;
}

export function readAdminUsers(value: unknown, request: ListRequest): AdminPage & { users: AdminUserRow[] } {
  if (!pagination(value, request.page) || !validAdminUserSnapshot(value, request.page) ||
      !value.users.every(row => matchesStatus(row.status, request) && (row.total_spent == null || aggregateMoney(row.total_spent)))) {
    throw new Error('Invalid admin users');
  }
  return value;
}
