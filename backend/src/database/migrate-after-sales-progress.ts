import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';

export const AFTER_SALES_PROGRESS_COLUMNS = {
  return_company: 'VARCHAR(60)', return_tracking_number: 'VARCHAR(100)',
  return_submitted_at: 'TIMESTAMP', refund_amount: 'DECIMAL(10,2)',
  refund_reference: 'VARCHAR(100)', completion_note: 'VARCHAR(500)',
  completed_by: 'BIGINT', completed_at: 'TIMESTAMP',
} as const;

export async function checkAfterSalesProgress(pool: Pool) {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='after_sales_requests'"
  );
  const missing = Object.entries(AFTER_SALES_PROGRESS_COLUMNS).filter(([name, type]) => {
    const column = columns.find(value => value.COLUMN_NAME === name);
    return !column || String(column.COLUMN_TYPE).toLowerCase() !== type.toLowerCase() || column.IS_NULLABLE !== 'YES';
  }).map(([name]) => name);
  return { status: missing.length ? 'migration_required' : 'ready', missing };
}

/** Add nullable progress fields only; leave all request, order and payment history intact. */
export async function migrateAfterSalesProgress(pool: Pool): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='after_sales_requests'"
  );
  if (!columns.length) throw new Error('请先运行物流及售后审核迁移');
  for (const [name, type] of Object.entries(AFTER_SALES_PROGRESS_COLUMNS)) {
    if (!columns.some(column => column.COLUMN_NAME === name)) {
      await pool.query(`ALTER TABLE after_sales_requests ADD COLUMN ${name} ${type} NULL DEFAULT NULL`);
    }
  }
  if ((await checkAfterSalesProgress(pool)).status !== 'ready') throw new Error('售后进度字段类型不兼容');
}

if (require.main === module) void (async () => {
  try {
    await connectDatabase();
    if (!process.argv.includes('--check')) await migrateAfterSalesProgress(getPool());
    const result = await checkAfterSalesProgress(getPool()); console.log(JSON.stringify(result));
    if (result.status !== 'ready') process.exitCode = 1;
  } catch { console.error('售后进度数据库操作失败，请检查连接和表结构'); process.exitCode = 1; }
  finally { try { await getPool().end(); } catch { /* Connection may not have initialized. */ } }
})();
