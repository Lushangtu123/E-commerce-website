import '../load-env';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Add optional English content without rewriting existing product data or historical snapshots. */
export async function migrateProductI18n(pool: Pool): Promise<void> {
  const additions: Record<string, Record<string, string>> = {
    products: { title_en: 'VARCHAR(200) DEFAULT NULL', description_en: 'TEXT DEFAULT NULL', specs_en: 'JSON DEFAULT NULL' },
    product_skus: { specs_en: 'JSON DEFAULT NULL' },
    order_items: { product_name_en: 'VARCHAR(200) DEFAULT NULL', sku_specs_en: 'JSON DEFAULT NULL' },
  };
  const existing = new Map<string, Set<string>>();
  // Check all base tables before applying any DDL so a missing prerequisite cannot leave a partial upgrade.
  for (const table of Object.keys(additions)) {
    const [columns] = await pool.query<RowDataPacket[]>(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]
    );
    if (!columns.length) throw new Error(`请先运行基础迁移创建 ${table} 表`);
    existing.set(table, new Set(columns.map(column => column.COLUMN_NAME)));
  }
  for (const [table, fields] of Object.entries(additions)) {
    for (const [column, definition] of Object.entries(fields)) {
      if (!existing.get(table)!.has(column)) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

if (require.main === module) {
  connectDatabase().then(() => migrateProductI18n(getPool())).then(() => {
    logger.info('商品双语内容迁移完成');
    process.exit(0);
  }).catch(() => {
    logger.error('商品双语内容迁移失败');
    process.exit(1);
  });
}
