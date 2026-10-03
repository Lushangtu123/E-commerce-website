import { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/** Preserve new snapshots; recover legacy addresses only when they belong to the order's user. */
export async function migrateAddressTables(pool: Pool): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
  );
  if (!columns.length) throw new Error('请先运行基础迁移创建 orders 表');
  if (!columns.some(column => column.COLUMN_NAME === 'shipping_address_snapshot')) {
    await pool.query('ALTER TABLE orders ADD COLUMN shipping_address_snapshot JSON DEFAULT NULL');
  }
  // This is the address available at upgrade time, not a reconstruction of earlier edits.
  await pool.query(`UPDATE orders o
    JOIN shipping_addresses sa ON sa.address_id = o.shipping_address_id AND sa.user_id = o.user_id
    SET o.shipping_address_snapshot = JSON_OBJECT(
      'receiver_name', sa.receiver_name, 'phone', sa.phone, 'province', sa.province,
      'city', sa.city, 'district', sa.district, 'detail_address', sa.detail_address)
    WHERE o.shipping_address_snapshot IS NULL`);
  logger.info('订单收货地址快照迁移完成');
}

if (require.main === module) {
  connectDatabase().then(() => migrateAddressTables(getPool())).then(() => process.exit(0)).catch(error => {
    logger.error({ err: error }, '地址迁移失败');
    process.exit(1);
  });
}
