/**
 * 个人信息保存期限（与隐私政策“保存期限”一致）
 *
 * 每天运行一次：独立部署由 index.ts 的定时器触发；Vercel 上由外部定时任务调用
 * POST /api/internal/data-retention（CRON_SECRET）。按批删除，避免长时间锁表。
 * 订单、售后和支付信息依照《电子商务法》至少保存三年，不在这里清理。
 */
import type { ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import logger from '../utils/logger';

export const RETENTION = { browseHistoryDays: 180, searchHistoryDays: 180, pageVisitDays: 90 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const PURGES = {
  browse_history: `DELETE FROM browse_history WHERE browsed_at < NOW() - INTERVAL ${RETENTION.browseHistoryDays} DAY LIMIT ?`,
  search_history: `DELETE FROM search_history WHERE created_at < NOW() - INTERVAL ${RETENTION.searchHistoryDays} DAY LIMIT ?`,
  password_reset_tokens: 'DELETE FROM password_reset_tokens WHERE expires_at < NOW() LIMIT ?',
  page_visits: `DELETE FROM page_visits WHERE created_at < NOW() - INTERVAL ${RETENTION.pageVisitDays} DAY LIMIT ?`,
} as const;

export type RetentionResult = Record<keyof typeof PURGES, number>;

export async function purgeExpiredPersonalData({ batchSize = 1000 } = {}): Promise<RetentionResult> {
  const pool = getPool();
  const result = {} as RetentionResult;
  for (const [table, sql] of Object.entries(PURGES) as [keyof typeof PURGES, string][]) {
    let total = 0;
    for (;;) {
      const [deleted] = await pool.query<ResultSetHeader>(sql, [batchSize]);
      total += deleted.affectedRows;
      if (deleted.affectedRows < batchSize) break;
    }
    result[table] = total;
  }
  return result;
}

/** Standalone deployments: run now, then once a day. */
export function startDataRetentionJob(): NodeJS.Timeout {
  const run = () => purgeExpiredPersonalData()
    .then(result => logger.info({ result }, '[数据保留] 已清理过期个人信息'))
    .catch(error => logger.error({ err: error }, '[数据保留] 清理失败'));
  void run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return timer;
}
