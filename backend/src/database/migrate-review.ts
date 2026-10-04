import { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Never remove historical reviews automatically. Operators resolve reported conflicts before retrying. */
export async function migrateReviewTables(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  let lock: string | undefined;
  let acquired = false;
  try {
    const [database] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    if (!database[0]?.name) throw new Error('评价迁移需要指定数据库');
    lock = `reviews-migration:${database[0].name}`.slice(0, 64);
    const [held] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 30) AS acquired', [lock]);
    if (Number(held[0]?.acquired) !== 1) throw new Error('无法获取评价迁移锁，请稍后重试');
    acquired = true;

    const [columns] = await connection.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews'"
    );
    if (!['order_id', 'product_id', 'rating'].every(name => columns.some(column => column.COLUMN_NAME === name))) {
      throw new Error('请先运行基础迁移创建 reviews 表');
    }
    const [duplicates] = await connection.query<RowDataPacket[]>(
      'SELECT order_id, product_id, COUNT(*) AS count FROM reviews GROUP BY order_id, product_id HAVING COUNT(*) > 1 ORDER BY order_id, product_id LIMIT 5'
    );
    if (duplicates.length) {
      const conflicts = duplicates.map(row => `order=${row.order_id},product=${row.product_id},count=${row.count}`).join('; ');
      throw new Error(`存在重复评价，请人工核对后重试；未删除记录：${conflicts}`);
    }
    const [invalid] = await connection.query<RowDataPacket[]>(
      'SELECT review_id FROM reviews WHERE rating IS NULL OR rating < 1 OR rating > 5 ORDER BY review_id LIMIT 5'
    );
    if (invalid.length) throw new Error(`存在非法评分，请人工核对后重试；未修改记录：${invalid.map(row => row.review_id).join(',')}`);

    const [index] = await connection.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME, NON_UNIQUE, SUB_PART FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND INDEX_NAME = 'uk_review_order_product' ORDER BY SEQ_IN_INDEX"
    );
    if (index.length && (index.length !== 2 || index[0].COLUMN_NAME !== 'order_id' || index[1].COLUMN_NAME !== 'product_id' ||
      index.some(row => Number(row.NON_UNIQUE) !== 0 || row.SUB_PART !== null))) {
      throw new Error('评价唯一索引定义不一致，请人工核对');
    }
    const [constraints] = await connection.query<RowDataPacket[]>(
      `SELECT tc.ENFORCED, cc.CHECK_CLAUSE FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'reviews' AND tc.CONSTRAINT_NAME = 'ck_reviews_rating' AND tc.CONSTRAINT_TYPE = 'CHECK'`
    );
    if (constraints.length && (constraints[0].ENFORCED !== 'YES' ||
      String(constraints[0].CHECK_CLAUSE).replace(/[\s`()]/g, '').toLowerCase() !== 'ratingbetween1and5')) {
      throw new Error('评价评分约束定义不一致，请人工核对');
    }
    const changes: string[] = [];
    if (!index.length) changes.push('ADD UNIQUE KEY uk_review_order_product (order_id, product_id)');
    if (!constraints.length) changes.push('ADD CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5)');
    if (changes.length) await connection.query(`ALTER TABLE reviews ${changes.join(', ')}`);
    logger.info('评价唯一约束与评分约束迁移完成');
  } finally {
    try { if (acquired && lock) await connection.query('SELECT RELEASE_LOCK(?)', [lock]); }
    finally { connection.release(); }
  }
}

if (require.main === module) {
  connectDatabase().then(() => migrateReviewTables(getPool())).then(() => process.exit(0)).catch(error => {
    logger.error({ err: error }, '评价迁移失败');
    process.exit(1);
  });
}
