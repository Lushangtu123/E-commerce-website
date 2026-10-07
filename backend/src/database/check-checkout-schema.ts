import '../load-env';
import { connectDatabase, getPool } from './mysql';
import type { RowDataPacket } from 'mysql2/promise';

async function check(): Promise<void> {
  try {
    await connectDatabase();
    const pool = getPool();
    const [columns] = await pool.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
    );
    const missing = ['checkout_key', 'checkout_fingerprint'].filter(name => !columns.some(column => column.COLUMN_NAME === name));
    const [indexes] = await pool.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'unique_user_checkout_key' ORDER BY SEQ_IN_INDEX"
    );
    if (indexes.length !== 2 || indexes.some(index => Number(index.NON_UNIQUE) !== 0) ||
        indexes[0]?.COLUMN_NAME !== 'user_id' || indexes[1]?.COLUMN_NAME !== 'checkout_key') missing.push('unique_user_checkout_key');
    console.log(JSON.stringify({ status: missing.length ? 'migration_required' : 'ready', missing }));
    if (missing.length) process.exitCode = 1;
  } catch {
    console.error('结算数据库结构检查失败；未修改数据库');
    process.exitCode = 1;
  } finally {
    try { await getPool().end(); } catch { /* Initialization may have failed. */ }
  }
}

if (require.main === module) void check();
