import type { AdminLog } from '@/lib/api';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown) => value == null || typeof value === 'string';

/** Reject invalid snapshots before the query cache exposes them to the log table. */
export function readAdminLogs(value: unknown, page: number, limit = 20): { logs: AdminLog[]; pagination: { total: number } } {
  if (!record(value) || !Array.isArray(value.logs) || value.logs.length > limit || !record(value.pagination) || !count(value.pagination.total) ||
      (value.pagination.page !== undefined && value.pagination.page !== page) ||
      (value.pagination.limit !== undefined && value.pagination.limit !== limit) ||
      (value.pagination.totalPages !== undefined && value.pagination.totalPages !== Math.ceil(value.pagination.total / limit))) {
    throw new Error('获取日志失败');
  }
  const ids = new Set<number>();
  for (const row of value.logs) {
    if (!record(row) || !count(row.log_id) || row.log_id === 0 || ids.has(row.log_id) ||
        typeof row.action !== 'string' || !row.action.trim() || !text(row.username) || !text(row.real_name) ||
        !text(row.description) || !text(row.ip_address) || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error('获取日志失败');
    }
    ids.add(row.log_id);
  }
  return { logs: value.logs as AdminLog[], pagination: { total: value.pagination.total } };
}
