import type { AfterSalesRequest } from '@/lib/api';
import { validAfterSalesRequest } from '@/lib/after-sales-response';
import { moneyToCents } from '@/lib/money';

export type AfterSalesWrite = { before: AfterSalesRequest } & (
  { kind: 'review'; status: 'approved' | 'rejected'; note: string } |
  { kind: 'complete'; amount: string; reference: string; note: string }
);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** A canonical read must carry enough state to distinguish an unchanged request from a saved write. */
export function validAfterSalesWriteSnapshot(value: unknown, intent: AfterSalesWrite): value is AfterSalesRequest {
  const before = intent.before;
  if (!validAfterSalesRequest(value) || value.request_id !== before.request_id || value.order_id !== before.order_id ||
    value.type !== before.type || value.reason !== before.reason || (before.user_id !== undefined && value.user_id !== before.user_id)) return false;
  if (intent.kind === 'review') return !['approved', 'rejected'].includes(value.status) ||
    (typeof value.review_note === 'string' && !!value.review_note.trim() && date(value.reviewed_at));
  if (value.completed_at === null) return true;
  try { return date(value.completed_at) && typeof value.completion_note === 'string' && !!value.completion_note.trim() &&
    (value.refund_reference === null || typeof value.refund_reference === 'string') && value.refund_amount != null && moneyToCents(value.refund_amount) >= 0; }
  catch { return false; }
}

/** Mutation replies omit joined order context, but must describe the exact saved intent. */
export function matchesAfterSalesWrite(value: unknown, intent: AfterSalesWrite) {
  if (!validAfterSalesWriteSnapshot(value, intent)) return false;
  if (intent.kind === 'review') return value.status === intent.status && value.review_note === intent.note && date(value.reviewed_at);
  try {
    return value.status === 'approved' && date(value.completed_at) && value.completion_note === intent.note &&
      (value.refund_reference ?? '') === intent.reference && value.refund_amount != null && moneyToCents(value.refund_amount) === moneyToCents(intent.amount);
  } catch { return false; }
}
