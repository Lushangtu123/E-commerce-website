import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Only adds nullable retry identity; existing receipts and coupon balances are preserved. */
export async function migrateCouponClaims(pool: Pool, checkOnly = false): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_coupons'"
  );
  if (!columns.length) throw new Error('请先创建 user_coupons 表');
  const column = columns.find(value => value.COLUMN_NAME === 'claim_key');
  if (!column) {
    if (checkOnly) throw new Error('领取请求号字段尚未迁移');
    await pool.query('ALTER TABLE user_coupons ADD COLUMN claim_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL');
  } else if (column.COLUMN_TYPE !== 'char(36)' || column.IS_NULLABLE !== 'YES' || column.CHARACTER_SET_NAME !== 'ascii' || column.COLLATION_NAME !== 'ascii_bin') {
    throw new Error('领取请求号字段结构不兼容');
  }
  const [indexes] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME,NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_coupons' AND INDEX_NAME='unique_user_claim_key' ORDER BY SEQ_IN_INDEX"
  );
  if (!indexes.length) {
    if (checkOnly) throw new Error('领取请求号唯一索引尚未迁移');
    await pool.query('ALTER TABLE user_coupons ADD UNIQUE KEY unique_user_claim_key (user_id,claim_key)');
  } else if (indexes.length !== 2 || indexes[0].COLUMN_NAME !== 'user_id' || indexes[1].COLUMN_NAME !== 'claim_key' || indexes.some(value => value.NON_UNIQUE !== 0)) {
    throw new Error('领取请求号唯一索引结构不兼容');
  }
}

if (require.main === module) {
  connectDatabase().then(() => migrateCouponClaims(getPool(), process.argv.includes('--check'))).then(() => {
    logger.info('优惠券领取请求号结构检查完成'); process.exit(0);
  }).catch(() => { logger.error('优惠券领取请求号结构检查失败'); process.exit(1); });
}
