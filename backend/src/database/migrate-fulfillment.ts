import { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Add shipment and request-review records without mutating legacy orders or claiming refunds. */
export async function migrateFulfillment(pool: Pool): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
  );
  if (!columns.length) throw new Error('请先运行基础迁移创建 orders 表');
  if (!columns.some(column => column.COLUMN_NAME === 'shipping_company')) {
    await pool.query('ALTER TABLE orders ADD COLUMN shipping_company VARCHAR(60) DEFAULT NULL');
  }
  if (!columns.some(column => column.COLUMN_NAME === 'tracking_number')) {
    await pool.query('ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100) DEFAULT NULL');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS after_sales_requests (
    request_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    type ENUM('refund', 'return') NOT NULL,
    reason VARCHAR(500) NOT NULL,
    status ENUM('requested', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'requested',
    review_note VARCHAR(500) DEFAULT NULL,
    reviewed_by BIGINT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL DEFAULT NULL,
    withdrawn_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY unique_after_sales_order (order_id),
    INDEX idx_after_sales_status_created (status, created_at, request_id),
    CONSTRAINT fk_after_sales_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  logger.info('物流及售后审核迁移完成');
}

if (require.main === module) {
  connectDatabase().then(() => migrateFulfillment(getPool())).then(() => process.exit(0)).catch(error => {
    logger.error({ err: error }, '物流及售后迁移失败');
    process.exit(1);
  });
}
