import type { Order, OrderItem } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';

export type CustomerOrderAction = 'pay' | 'cancel' | 'confirm';
export const customerOrderTarget = { pay: 1, cancel: 4, confirm: 3 };
const acknowledgementMessages = { pay: '模拟支付完成，未实际扣款', cancel: '订单已取消', confirm: '确认收货成功' };

export function validCustomerOrderAcknowledgement(value: unknown, action: CustomerOrderAction) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return receipt.message === acknowledgementMessages[action] && !('error' in receipt) &&
    (!('success' in receipt) || receipt.success === true) && (action !== 'pay' || receipt.payment_mode === 'demo');
}

export function uncertainCustomerOrderWrite(error: unknown) {
  const status = requestFailure(error).response?.status;
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function successfulRecord(value: unknown): value is Record<string, unknown> {
  return record(value) && !('error' in value) && (!('success' in value) || value.success === true);
}

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function money(value: unknown): boolean {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))) return false;
  const amount = Number(value);
  const cents = amount * 100;
  // MySQL DECIMAL(10,2) may arrive as text or a number with representation noise.
  return Number.isFinite(amount) && amount >= 0 && amount <= 99999999.99 &&
    (Math.round(cents) !== 0 || amount === 0) &&
    Math.abs(cents - Math.round(cents)) <= Number.EPSILON * Math.max(1, Math.abs(cents)) * 2;
}

const nullableText = (value: unknown) => value == null || typeof value === 'string';
const date = (value: unknown) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));

export function validCustomerOrder(value: unknown): value is Order {
  if (!successfulRecord(value) || !positiveId(value.order_id) ||
      !Number.isInteger(value.status) || Number(value.status) < 0 || Number(value.status) > 4 ||
      typeof value.order_no !== 'string' || !value.order_no.trim() || !money(value.total_amount) || !date(value.created_at)) return false;
  if (!['original_amount', 'discount_amount'].every(key => value[key] == null || money(value[key])) ||
      !['coupon_name', 'coupon_code', 'payment_method', 'shipping_company', 'tracking_number'].every(key => nullableText(value[key])) ||
      !['paid_at', 'shipped_at', 'completed_at'].every(key => value[key] == null || date(value[key])) ||
      (value.user_coupon_id != null && !positiveId(value.user_coupon_id))) return false;
  const address = value.shipping_address_snapshot;
  return address == null || (record(address) && typeof address.receiver_name === 'string' && typeof address.phone === 'string' &&
    ['province', 'city', 'district', 'detail_address'].every(key => address[key] === null || typeof address[key] === 'string'));
}

function validCustomerOrderItem(value: unknown, orderId: number): value is OrderItem {
  if (!successfulRecord(value) || !positiveId(value.item_id) || value.order_id !== orderId || !positiveId(value.product_id) ||
      !(value.product_name === null || typeof value.product_name === 'string') || !positiveId(value.quantity) || !money(value.price) ||
      !['product_name_en', 'product_image', 'sku_code'].every(key => nullableText(value[key])) ||
      (value.sku_id != null && !positiveId(value.sku_id))) return false;
  if (value.sku_specs != null && (!record(value.sku_specs) || !Object.values(value.sku_specs).every(entry =>
      typeof entry === 'string' || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))))) return false;
  return value.sku_specs_en == null || (record(value.sku_specs_en) && Object.values(value.sku_specs_en).every(entry =>
    record(entry) && (entry.name === undefined || typeof entry.name === 'string') && (entry.value === undefined || typeof entry.value === 'string')));
}

export function customerOrderListSnapshot(value: unknown, request: { page: number; limit: number; status?: number }): { orders: Order[]; total: number; page: number; limit: number; totalPages: number } | null {
  if (!successfulRecord(value) || !Array.isArray(value.orders) || value.page !== request.page || value.limit !== request.limit ||
      !Number.isSafeInteger(value.total) || Number(value.total) < 0 || value.totalPages !== Math.ceil(Number(value.total) / request.limit) ||
      value.orders.length > request.limit) return null;
  const ids = new Set<number>();
  for (const order of value.orders) {
    if (!validCustomerOrder(order) || ids.has(order.order_id) || (request.status !== undefined && order.status !== request.status)) return null;
    ids.add(order.order_id);
  }
  return { orders: value.orders, total: value.total as number, page: request.page, limit: request.limit, totalPages: value.totalPages as number };
}

export function customerOrderSnapshot(value: unknown, id: number): { order: Order; items: OrderItem[] } | null {
  if (!successfulRecord(value) || !validCustomerOrder(value.order) || value.order.order_id !== id || !Array.isArray(value.items)) return null;
  const ids = new Set<number>();
  for (const item of value.items) {
    if (!validCustomerOrderItem(item, id) || ids.has(item.item_id)) return null;
    ids.add(item.item_id);
  }
  return { order: value.order, items: value.items };
}

export function customerOrderCheckMessage(before: number, actual: number, action: CustomerOrderAction) {
  return actual === customerOrderTarget[action] ? '已核对，订单状态已更新'
    : actual === before ? '已核对，订单尚未更新，请确认信息后重试' : '订单已变更，请核对实际状态';
}
