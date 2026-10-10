import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/mysql';

function validateIdentity(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError('用户ID无效');
}
function validateDigest(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new RangeError('重置凭据摘要无效');
}

export interface PasswordResetIssuance {
  userId: number;
  tokenHash: string;
  authVersion: number;
  previous?: { tokenHash: string; expiresAt: string };
}

// Successful/unknown sends retain the ordinary 60-second cooldown. A definite
// refusal permits one retry after 10 seconds, still bounded per user and by IP.
const REJECTED_RETRY_BACKDATE_SECONDS = 50;

export class PasswordResetModel {
  /** A user row lock serializes issuance, password changes and reset consumption. */
  static async issue(userId: number, tokenHash: string): Promise<PasswordResetIssuance | null> {
    validateIdentity(userId); validateDigest(tokenHash);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [users] = await conn.query<RowDataPacket[]>('SELECT auth_version FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (!users.length) { await conn.rollback(); return null; }
      const [tokens] = await conn.query<RowDataPacket[]>(
        `SELECT token_hash, DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s.%f') AS expires_at,
         expires_at > UTC_TIMESTAMP(3) AS unexpired,
         created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) AS recent
         FROM password_reset_tokens WHERE user_id = ? FOR UPDATE`, [userId]
      );
      if (tokens.some(token => token.recent)) { await conn.commit(); return null; }
      const previous = tokens.find(token => token.unexpired);
      const issuance: PasswordResetIssuance = {
        userId, tokenHash, authVersion: Number(users[0].auth_version),
        ...(previous ? { previous: { tokenHash: previous.token_hash, expiresAt: previous.expires_at } } : {}),
      };
      await conn.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      await conn.query(
        'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), UTC_TIMESTAMP(3))',
        [tokenHash, userId]
      );
      await conn.commit(); return issuance;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }

  /** A request-local receipt restores only this definitely rejected issuance. */
  static async recoverRejectedIssuance(issuance: PasswordResetIssuance): Promise<boolean> {
    const { userId, tokenHash, authVersion, previous } = issuance;
    validateIdentity(userId); validateDigest(tokenHash);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const [users] = await conn.query<RowDataPacket[]>('SELECT auth_version FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (!users.length || Number(users[0].auth_version) !== authVersion) { await conn.rollback(); return false; }
      const [tokens] = await conn.query<RowDataPacket[]>(
        'SELECT token_hash FROM password_reset_tokens WHERE user_id = ? AND token_hash = ? AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE',
        [userId, tokenHash]
      );
      if (!tokens.length) { await conn.rollback(); return false; }
      let restored = false;
      if (previous) {
        const [updated] = await conn.query<ResultSetHeader>(
          `UPDATE password_reset_tokens SET token_hash = ?, expires_at = ?,
           created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
           WHERE user_id = ? AND token_hash = ? AND CAST(? AS DATETIME(3)) > UTC_TIMESTAMP(3)`,
          [previous.tokenHash, previous.expiresAt, REJECTED_RETRY_BACKDATE_SECONDS, userId, tokenHash, previous.expiresAt]
        );
        restored = updated.affectedRows === 1;
      }
      if (!restored) {
        // No usable previous link: keep one expired row solely for retry throttling.
        await conn.query(
          `UPDATE password_reset_tokens SET expires_at = UTC_TIMESTAMP(3),
           created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND) WHERE user_id = ? AND token_hash = ?`,
          [REJECTED_RETRY_BACKDATE_SECONDS, userId, tokenHash]
        );
      }
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
