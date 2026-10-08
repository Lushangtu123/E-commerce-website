import type { AfterSalesRequest } from '@/lib/api';

export function validAfterSalesRequest(value: unknown): value is AfterSalesRequest {
  if (!value || typeof value !== 'object') return false;
  const row = value as AfterSalesRequest;
  return Number.isSafeInteger(row.request_id) && row.request_id > 0 && Number.isSafeInteger(row.order_id) && row.order_id > 0 &&
    ['refund', 'return'].includes(row.type) && ['requested', 'approved', 'rejected', 'withdrawn'].includes(row.status) && typeof row.reason === 'string';
}
