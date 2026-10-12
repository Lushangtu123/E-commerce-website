import type { AfterSalesRequest } from '@/lib/api';
import { moneyToCents } from '@/lib/money';

export function validAfterSalesEnvelope(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    !('success' in value && value.success === false) && !('error' in value && value.error != null);
}

const text = (value: unknown) => value == null || typeof value === 'string';
const nonempty = (value: unknown) => typeof value === 'string' && !!value.trim();
function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
function money(value: unknown) {
  try { moneyToCents(value as number | string); return true; } catch { return false; }
}

export function validAfterSalesRequest(value: unknown): value is AfterSalesRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as AfterSalesRequest;
  if (!(Number.isSafeInteger(row.request_id) && row.request_id > 0 && Number.isSafeInteger(row.order_id) && row.order_id > 0 &&
    ['refund', 'return'].includes(row.type) && ['requested', 'approved', 'rejected', 'withdrawn'].includes(row.status) && typeof row.reason === 'string')) return false;
  if (row.user_id != null && (!Number.isSafeInteger(row.user_id) || row.user_id <= 0)) return false;
  if (!['order_no', 'username', 'review_note', 'return_company', 'return_tracking_number', 'refund_reference', 'completion_note', 'payment_method']
    .every(key => text((value as Record<string, unknown>)[key])) ||
    ![row.created_at, row.reviewed_at, row.return_submitted_at, row.completed_at].every(value => value == null || date(value)) ||
    ![row.refund_amount, row.total_amount].every(value => value == null || money(value))) return false;
  if (row.return_submitted_at != null && (row.type !== 'return' || row.status !== 'approved' ||
    !nonempty(row.return_company) || !nonempty(row.return_tracking_number))) return false;
  // A closed request must carry a real amount and note. Missing money is not a zero refund.
  if (row.completed_at != null && (row.status !== 'approved' || !money(row.refund_amount) || !nonempty(row.completion_note) ||
    (moneyToCents(row.refund_amount!) > 0 && !nonempty(row.refund_reference)) ||
    (row.type === 'return' && !row.return_submitted_at))) return false;
  return true;
}
