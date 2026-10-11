import type { DashboardStats, RecentOrder, SalesTrendPoint, TopProduct } from '@/lib/api';

function invalidResponse(): never {
  throw new Error('Invalid dashboard response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** MySQL SUM/DECIMAL values may be decimal strings, including a genuine zero. */
function isDecimal(value: unknown): value is number | string {
  return isFiniteNumber(value) || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)));
}

function isCount(value: unknown, allowDecimalString = false): value is number | string {
  return (allowDecimalString ? isDecimal(value) : isFiniteNumber(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function count(value: unknown, allowDecimalString = false): number {
  if (!isCount(value, allowDecimalString)) invalidResponse();
  return Number(value);
}

function isMoney(value: unknown): value is number | string {
  return isDecimal(value) && Number(value) >= 0;
}

function money(value: unknown): number {
  if (!isMoney(value)) invalidResponse();
  return Number(value);
}

function growth(value: unknown): number {
  if (!isFiniteNumber(value)) invalidResponse();
  return value;
}

export function readDashboardStats(data: unknown): DashboardStats {
  if (!isRecord(data)) invalidResponse();
  const totalProducts = count(data.total_products);
  return {
    today_orders: count(data.today_orders),
    today_revenue: money(data.today_revenue),
    new_users: count(data.new_users),
    pending_orders: count(data.pending_orders),
    total_products: totalProducts,
    // SUM over an empty products table is null; a missing total is never evidence of zero.
    active_products: data.active_products === null && totalProducts === 0 ? 0 : count(data.active_products, true),
    order_growth: growth(data.order_growth),
    revenue_growth: growth(data.revenue_growth),
  };
}

function isId(value: unknown): boolean {
  return isCount(value) && Number(value) > 0;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  // Date.parse normalizes impossible days such as February 30 instead of rejecting them.
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function isRecentOrder(row: unknown): row is RecentOrder {
  return isRecord(row) && isId(row.order_id) && isText(row.order_no) && isOptionalText(row.username) &&
    isMoney(row.total_amount) && isCount(row.status) && Number(row.status) <= 4 && isDate(row.created_at);
}

function isTopProduct(row: unknown): row is TopProduct {
  return isRecord(row) && isId(row.product_id) && isText(row.title) && isOptionalText(row.title_en) &&
    isCount(row.total_sales, true) && isMoney(row.total_revenue);
}

function isSalesTrendPoint(row: unknown): row is SalesTrendPoint {
  return isRecord(row) && isDate(row.date) && isCount(row.order_count) && isMoney(row.revenue);
}

function readList<T>(data: unknown, key: string, isRow: (row: unknown) => row is T): T[] {
  const rows = Array.isArray(data) ? data : isRecord(data) ? data[key] : undefined;
  // Reject the section as a whole: dropping bad rows would invent an incomplete successful result.
  if (!Array.isArray(rows) || !rows.every(isRow)) invalidResponse();
  return rows;
}

export const readDashboardOrders = (data: unknown) => readList(data, 'orders', isRecentOrder);
export const readDashboardProducts = (data: unknown) => readList(data, 'products', isTopProduct);
export const readDashboardTrend = (data: unknown) => readList(data, 'trend', isSalesTrendPoint);
