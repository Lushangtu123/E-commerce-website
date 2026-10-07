import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Add retry identity without changing any existing order, stock or coupon. */
export async function migrateOrderCheckout(pool: Pool): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
  );
  if (!columns.length) throw new Error('请先运行基础迁移创建 orders 表');
  for (const [name, size] of [['checkout_key', 36], ['checkout_fingerprint', 64]] as const) {
    if (!columns.some(column => column.COLUMN_NAME === name)) {
      await pool.query(`ALTER TABLE orders ADD COLUMN ${name} CHAR(${size}) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL`);
    }
  }
  const [indexes] = await pool.query<RowDataPacket[]>(
    "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'unique_user_checkout_key'"
  );
  if (!indexes.length) await pool.query('ALTER TABLE orders ADD UNIQUE KEY unique_user_checkout_key (user_id, checkout_key)');
}

if (require.main === module) {
  connectDatabase().then(() => migrateOrderCheckout(getPool())).then(() => {
    logger.info('结算重试保护迁移完成');
    process.exit(0);
  }).catch(() => {
    logger.error('结算重试保护迁移失败');
    process.exit(1);
  });
}
