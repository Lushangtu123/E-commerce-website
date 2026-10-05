import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/mysql';

function validateIdentity(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError('用户ID无效');
}
function validateDigest(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new RangeError('重置凭据摘要无效');
}

export class PasswordResetModel {
  /** A user row lock serializes issuance, password changes and reset consumption. */
  static async issue(userId: number, tokenHash: string): Promise<boolean> {
    validateIdentity(userId); validateDigest(tokenHash);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [users] = await conn.query<RowDataPacket[]>('SELECT auth_version FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (!users.length) { await conn.rollback(); return false; }
      const [recent] = await conn.query<RowDataPacket[]>(
        'SELECT token_hash FROM password_reset_tokens WHERE user_id = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND)', [userId]
      );
      if (recent.length) { await conn.commit(); return false; }
      await conn.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      await conn.query(
        'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), UTC_TIMESTAMP(3))',
        [tokenHash, userId]
      );
      await conn.commit(); return true;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }

  static async changePassword(userId: number, expectedHash: string, newHash: string): Promise<boolean> {
    validateIdentity(userId);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [updated] = await conn.query<ResultSetHeader>(
        'UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE user_id = ? AND password_hash = ?',
        [newHash, userId, expectedHash]
      );
      if (updated.affectedRows !== 1) { await conn.rollback(); return false; }
      await conn.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      await conn.commit(); return true;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }

  static async consume(tokenHash: string, newHash: string): Promise<boolean> {
    validateDigest(tokenHash);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      // Discover the owner without locking tokens first; every mutation locks users before tokens.
      const [owners] = await conn.query<RowDataPacket[]>('SELECT user_id FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
      if (!owners.length) { await conn.rollback(); return false; }
      const userId = Number(owners[0].user_id); validateIdentity(userId);
      const [users] = await conn.query<RowDataPacket[]>('SELECT auth_version FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (!users.length) { await conn.rollback(); return false; }
      const [tokens] = await conn.query<RowDataPacket[]>(
        'SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND user_id = ? AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE',
        [tokenHash, userId]
      );
      if (!tokens.length) { await conn.rollback(); return false; }
      await conn.query('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE user_id = ?', [newHash, userId]);
      await conn.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      await conn.commit(); return true;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }
}
