import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, getPool } from './mysql';
import logger from '../utils/logger';

/**
 * 管理员两步验证：加密的 TOTP 密钥、启用时间、最后使用的时间步（防重放），以及一次性恢复码
 * （只存带密钥的 HMAC，key_id 记录所用密钥，见 utils/recovery-code.ts）。
 * 早期恢复码只有 40 位且只存 SHA-256：补 key_id 列时一并作废，管理员下次登录时领取新的一组。
 * 管理员表由 admin-migrate 创建；尚未创建时跳过，留给 admin-migrate。可重复执行。
 */
export async function migrateAdminTwoFactor(pool: Pool | PoolConnection): Promise<void> {
  const [columns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins'"
  );
  if (!columns.length) return;
  const has = (name: string) => columns.some(column => column.COLUMN_NAME === name);
  if (!has('totp_secret')) await pool.query("ALTER TABLE admins ADD COLUMN totp_secret VARCHAR(255) NULL DEFAULT NULL COMMENT 'AES-256-GCM 加密的 TOTP 密钥'");
  if (!has('totp_enabled_at')) await pool.query('ALTER TABLE admins ADD COLUMN totp_enabled_at TIMESTAMP NULL DEFAULT NULL');
  if (!has('totp_last_step')) await pool.query("ALTER TABLE admins ADD COLUMN totp_last_step BIGINT NULL DEFAULT NULL COMMENT '最后接受的时间步，更早的动态码不再有效'");
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_recovery_codes (
    admin_id BIGINT NOT NULL,
    code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    key_id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    used_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (admin_id, code_hash),
    FOREIGN KEY (admin_id) REFERENCES admins(admin_id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [codeColumns] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_recovery_codes'"
  );
  if (!codeColumns.some(column => column.COLUMN_NAME === 'key_id')) {
    // Legacy unkeyed 40-bit codes are invalidated rather than carried over.
    await pool.query('DELETE FROM admin_recovery_codes');
    await pool.query('ALTER TABLE admin_recovery_codes ADD COLUMN key_id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER code_hash');
  }
}

if (require.main === module) {
  connectDatabase().then(() => migrateAdminTwoFactor(getPool())).then(() => {
    logger.info('管理员两步验证迁移完成'); process.exit(0);
  }).catch(() => { logger.error('管理员两步验证迁移失败'); process.exit(1); });
}
