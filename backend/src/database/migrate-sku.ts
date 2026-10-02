import { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Additive upgrade: historical cart/order rows keep their IDs and remain base-product rows. */
export async function migrateSkuTables(pool: Pool): Promise<void> {
  const additions: Record<string, Record<string, string>> = {
    cart: {
      sku_id: 'BIGINT DEFAULT NULL',
      sku_key: 'BIGINT GENERATED ALWAYS AS (COALESCE(sku_id, 0)) STORED',
    },
    order_items: { sku_id: 'BIGINT DEFAULT NULL', sku_code: 'VARCHAR(50) DEFAULT NULL', sku_specs: 'JSON DEFAULT NULL' },
  };
  for (const [table, fields] of Object.entries(additions)) {
    const [columns] = await pool.query<RowDataPacket[]>(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]
    );
    if (!columns.length) throw new Error(`请先运行基础迁移创建 ${table} 表`);
    const existing = new Set(columns.map(column => column.COLUMN_NAME));
    for (const [column, definition] of Object.entries(fields)) {
      if (!existing.has(column)) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  const [indexes] = await pool.query<RowDataPacket[]>(
    "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart'"
  );
  const names = new Set(indexes.map(index => index.INDEX_NAME));
  // Install the stricter NULL-safe identity before removing the legacy product-only key.
  if (!names.has('uk_user_product_sku')) {
    await pool.query('ALTER TABLE cart ADD UNIQUE KEY uk_user_product_sku (user_id, product_id, sku_key)');
  }
  if (names.has('uk_user_product')) await pool.query('ALTER TABLE cart DROP INDEX uk_user_product');
  logger.info('SKU购物车与订单规格快照迁移完成');
}

if (require.main === module) {
  connectDatabase().then(() => migrateSkuTables(getPool())).then(() => process.exit(0)).catch(error => {
    logger.error({ err: error }, 'SKU迁移失败');
    process.exit(1);
  });
}
