import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Deliberately no address FK: a receipt must survive physical address deletion. */
export async function migrateAddressCreations(pool: Pool, checkOnly = false): Promise<void> {
  const [tables] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('users','shipping_addresses','address_creation_receipts')"
  );
  if (!tables.some(row => row.TABLE_NAME === 'users') || !tables.some(row => row.TABLE_NAME === 'shipping_addresses')) throw new Error('请先创建 users 和 shipping_addresses 表');
  const table = tables.find(row => row.TABLE_NAME === 'address_creation_receipts');
  if (!table) {
    if (checkOnly) throw new Error('地址新增收据表尚未迁移');
    await pool.query(`CREATE TABLE address_creation_receipts (
      user_id BIGINT NOT NULL,
      create_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      address_id BIGINT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, create_key),
      UNIQUE KEY unique_user_create_key (user_id, create_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  } else if (table.ENGINE !== 'InnoDB') throw new Error('地址新增收据表必须使用 InnoDB');
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='address_creation_receipts'"
  );
  for (const [name, type] of Object.entries({ user_id: 'bigint', create_key: 'char(36)', payload_fingerprint: 'char(64)', address_id: 'bigint', created_at: 'timestamp' })) {
    const column = columns.find(row => row.COLUMN_NAME === name);
    if (!column || column.COLUMN_TYPE !== type || column.IS_NULLABLE !== 'NO' ||
      (type.startsWith('char') && (column.CHARACTER_SET_NAME !== 'ascii' || column.COLLATION_NAME !== 'ascii_bin'))) throw new Error('地址新增收据字段结构不兼容');
  }
  const [indexes] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='address_creation_receipts' AND INDEX_NAME='unique_user_create_key' ORDER BY SEQ_IN_INDEX"
  );
  if (indexes.length !== 2 || indexes[0].COLUMN_NAME !== 'user_id' || indexes[1].COLUMN_NAME !== 'create_key' || indexes.some(row => row.NON_UNIQUE !== 0)) throw new Error('地址新增收据唯一索引结构不兼容');
  const [foreignKeys] = await pool.query<RowDataPacket[]>(
    "SELECT REFERENCED_TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='address_creation_receipts' AND REFERENCED_TABLE_NAME IS NOT NULL"
  );
  if (foreignKeys.length) throw new Error('地址新增收据不能依赖可删除记录的外键');
}

if (require.main === module) {
  connectDatabase().then(() => migrateAddressCreations(getPool(), process.argv.includes('--check'))).then(() => {
    logger.info('地址新增收据结构检查完成'); process.exit(0);
  }).catch(error => { logger.error({ err: error }, '地址新增收据结构检查失败'); process.exit(1); });
}
