import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Add nullable retry receipts without rewriting historical products or their inventory. */
export async function migrateProductCreations(pool: Pool, checkOnly = false): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products'");
  if (!columns.length) throw new Error('请先创建 products 表');
  const fields = {
    created_by_admin_id: { type: 'bigint', sql: 'BIGINT DEFAULT NULL' },
    create_key: { type: 'char(36)', sql: 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL' },
    create_fingerprint: { type: 'char(64)', sql: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL' },
  };
  for (const [name, field] of Object.entries(fields)) {
    const column = columns.find(value => value.COLUMN_NAME === name);
    if (column && (column.COLUMN_TYPE !== field.type || column.IS_NULLABLE !== 'YES' ||
      (name !== 'created_by_admin_id' && (column.CHARACTER_SET_NAME !== 'ascii' || column.COLLATION_NAME !== 'ascii_bin')))) throw new Error('商品新增请求号字段结构不兼容');
    if (!column && checkOnly) throw new Error('商品新增请求号字段尚未迁移');
  }
  const [indexes] = await pool.query<RowDataPacket[]>("SELECT COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND INDEX_NAME='unique_admin_create_key' ORDER BY SEQ_IN_INDEX");
  if (indexes.length && (indexes.length !== 2 || indexes[0].COLUMN_NAME !== 'created_by_admin_id' || indexes[1].COLUMN_NAME !== 'create_key' || indexes.some(value => value.NON_UNIQUE !== 0))) throw new Error('商品新增请求号唯一索引结构不兼容');
  if (!indexes.length && checkOnly) throw new Error('商品新增请求号唯一索引尚未迁移');
  if (checkOnly) return;
  const additions = Object.entries(fields).filter(([name]) => !columns.some(value => value.COLUMN_NAME === name)).map(([name, field]) => `ADD COLUMN ${name} ${field.sql}`);
  if (!indexes.length) additions.push('ADD UNIQUE KEY unique_admin_create_key(created_by_admin_id,create_key)');
  if (additions.length) await pool.query(`ALTER TABLE products ${additions.join(', ')}`);
}
if (require.main === module) {
  connectDatabase().then(() => migrateProductCreations(getPool(), process.argv.includes('--check'))).then(() => {
    logger.info('商品新增请求号结构检查完成'); process.exit(0);
  }).catch(() => { logger.error('商品新增请求号结构检查失败'); process.exit(1); });
}
