import { Pool, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

export async function migrateAccountSecurity(pool: Pool): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
  );
  if (!columns.length) throw new Error('请先运行基础迁移创建 users 表');
  if (!columns.some(column => column.COLUMN_NAME === 'auth_version')) {
    await pool.query('ALTER TABLE users ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_password_reset_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  logger.info('账户安全迁移完成');
}

if (require.main === module) {
  connectDatabase().then(() => migrateAccountSecurity(getPool())).then(() => process.exit(0)).catch(() => {
    logger.error('账户安全迁移失败');
    process.exit(1);
  });
}
