import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** A receipt survives removal/clear/checkout: never attach it to a cart row or catalog FK. */
export async function migrateCartAdds(pool: Pool, checkOnly = false): Promise<void> {
  const [tables] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','cart','cart_add_receipts')"
  );
  for (const name of ['users', 'cart']) {
    const table = tables.find(row => row.TABLE_NAME === name);
    if (!table) throw new Error('请先创建 users 和 cart 表');
    if (table.ENGINE !== 'InnoDB') throw new Error('购物车添加事务必须使用 InnoDB');
  }
  const table = tables.find(row => row.TABLE_NAME === 'cart_add_receipts');
  if (!table) {
    if (checkOnly) throw new Error('购物车添加收据表尚未迁移');
    await pool.query(`CREATE TABLE cart_add_receipts (
      user_id BIGINT NOT NULL,
      add_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, add_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  } else if (table.ENGINE !== 'InnoDB') throw new Error('购物车添加收据表必须使用 InnoDB');
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_add_receipts'"
  );
  for (const [name, type] of Object.entries({ user_id: 'bigint', add_key: 'char(36)', payload_fingerprint: 'char(64)', created_at: 'timestamp' })) {
    const column = columns.find(row => row.COLUMN_NAME === name);
    if (!column || column.COLUMN_TYPE !== type || column.IS_NULLABLE !== 'NO' ||
      (type.startsWith('char') && (column.CHARACTER_SET_NAME !== 'ascii' || column.COLLATION_NAME !== 'ascii_bin'))) throw new Error('购物车添加收据字段结构不兼容');
  }
  const [primary] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME,NON_UNIQUE,SUB_PART FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_add_receipts' AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX"
  );
  if (primary.length !== 2 || primary[0].COLUMN_NAME !== 'user_id' || primary[1].COLUMN_NAME !== 'add_key' ||
    primary.some(row => row.NON_UNIQUE !== 0 || row.SUB_PART !== null)) throw new Error('购物车添加收据主键结构不兼容');
  const [foreignKeys] = await pool.query<RowDataPacket[]>(
    "SELECT REFERENCED_TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cart_add_receipts' AND REFERENCED_TABLE_NAME IS NOT NULL"
  );
  if (foreignKeys.length) throw new Error('购物车添加收据不能依赖可删除记录的外键');
}

if (require.main === module) {
  connectDatabase().then(() => migrateCartAdds(getPool(), process.argv.includes('--check'))).then(() => {
    logger.info('购物车添加收据结构检查完成'); process.exit(0);
  }).catch(error => { logger.error({ err: error }, '购物车添加收据结构检查失败'); process.exit(1); });
}
