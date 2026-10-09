import type { Order, OrderItem } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';

export type CustomerOrderAction = 'pay' | 'cancel' | 'confirm';
export const customerOrderTarget = { pay: 1, cancel: 4, confirm: 3 };

export function uncertainCustomerOrderWrite(error: unknown) {
  const status = requestFailure(error).response?.status;
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function validCustomerOrder(value: unknown): value is Order {
  if (!value || typeof value !== 'object') return false;
  const order = value as Partial<Order>;
  return Number.isSafeInteger(order.order_id) && Number(order.order_id) > 0 &&
    Number.isInteger(order.status) && Number(order.status) >= 0 && Number(order.status) <= 4;
}

export function customerOrderSnapshot(value: unknown, id: number): { order: Order; items: OrderItem[] } | null {
  if (!value || typeof value !== 'object' || !('order' in value) || !validCustomerOrder(value.order) || value.order.order_id !== id) return null;
  if ('items' in value && !Array.isArray(value.items)) return null;
  return { order: value.order, items: 'items' in value ? value.items as OrderItem[] : [] };
}

export function customerOrderCheckMessage(before: number, actual: number, action: CustomerOrderAction) {
  return actual === customerOrderTarget[action] ? '已核对，订单状态已更新'
    : actual === before ? '已核对，订单尚未更新，请确认信息后重试' : '订单已变更，请核对实际状态';
}
