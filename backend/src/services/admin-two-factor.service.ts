/**
 * 管理员两步验证（所有管理员强制）。
 *
 * 登录流程：密码正确后不签发会话，而是返回 5 分钟有效的一次性挑战（challenge）：
 * - 已绑定验证器：提交 6 位动态码或恢复码（verify）后签发会话；
 * - 未绑定：先取得密钥与二维码（setup），提交一次动态码确认绑定（activate），同时领取 10 个恢复码，然后签发会话。
 * 挑战令牌绑定管理员的 auth_version，退出或重置后旧挑战失效。动态码按时间步防重放，恢复码只存 SHA-256、每个只能用一次。
 */
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import { jwtSecret, verifyJwt } from '../utils/jwt-secret';
import { openSecret, sealSecret } from '../utils/secret-box';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../utils/totp';

export class TwoFactorError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'TwoFactorError';
  }
}

export type ChallengePurpose = 'verify' | 'setup';
export const RECOVERY_CODE_COUNT = 10;
const CHALLENGE_TTL = '5m';
const ISSUER = '电商平台管理后台';

export interface AdminLoginRow extends RowDataPacket {
  admin_id: number;
  username: string;
  real_name: string | null;
  email: string | null;
  role_id: number;
  role_name: string | null;
  status: number;
  auth_version: number;
  totp_secret: string | null;
  totp_enabled_at: Date | null;
  totp_last_step: number | null;
}

const ADMIN_COLUMNS = `a.admin_id, a.username, a.real_name, a.email, a.role_id, r.role_name, a.status, a.auth_version,
  a.totp_secret, a.totp_enabled_at, a.totp_last_step`;

/** What the password step returns instead of a session. */
export function issueChallenge(admin: Pick<AdminLoginRow, 'admin_id' | 'auth_version' | 'totp_enabled_at'>) {
  const purpose: ChallengePurpose = admin.totp_enabled_at ? 'verify' : 'setup';
  const challenge = jwt.sign({ type: 'admin-challenge', purpose, adminId: admin.admin_id, authVersion: Number(admin.auth_version ?? 0) },
    jwtSecret(), { expiresIn: CHALLENGE_TTL });
  return { two_factor: purpose, challenge };
}

/** Reads and locks the administrator a challenge belongs to; any mismatch reads as an expired sign-in. */
async function challengedAdmin(conn: PoolConnection, challenge: unknown, purpose: ChallengePurpose): Promise<AdminLoginRow> {
  let claims: jwt.JwtPayload;
  try {
    const verified = typeof challenge === 'string' ? verifyJwt(challenge) : null;
    if (!verified || typeof verified !== 'object') throw new Error('invalid');
    claims = verified;
  } catch {
    throw new TwoFactorError('验证已过期，请重新输入密码', 401);
  }
  if (claims.type !== 'admin-challenge' || claims.purpose !== purpose || !Number.isSafeInteger(claims.adminId)) {
    throw new TwoFactorError('验证已过期，请重新输入密码', 401);
  }
  const [rows] = await conn.query<AdminLoginRow[]>(
    `SELECT ${ADMIN_COLUMNS} FROM admins a LEFT JOIN roles r ON a.role_id = r.role_id WHERE a.admin_id = ? FOR UPDATE`, [claims.adminId]);
  const admin = rows[0];
  if (!admin || Number(admin.auth_version ?? 0) !== claims.authVersion) throw new TwoFactorError('验证已过期，请重新输入密码', 401);
  if (admin.status === 0) throw new TwoFactorError('账号已被禁用', 403);
  // The binding state may have changed since the password step (e.g. activated in another tab).
  if ((purpose === 'verify') !== !!admin.totp_enabled_at) throw new TwoFactorError('验证已过期，请重新输入密码', 401);
  return admin;
}

async function inTransaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

const hashRecoveryCode = (code: string) => createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const text = randomBytes(5).toString('hex'); // 40 bits each
    return `${text.slice(0, 5)}-${text.slice(5)}`;
  });
}

/** Starts (or restarts) binding: a fresh secret replaces any unconfirmed one. */
export async function beginSetup(challenge: unknown): Promise<{ secret: string; otpauth_uri: string }> {
  return inTransaction(async conn => {
    const admin = await challengedAdmin(conn, challenge, 'setup');
    const secret = generateTotpSecret();
    await conn.query('UPDATE admins SET totp_secret = ?, totp_last_step = NULL WHERE admin_id = ? AND totp_enabled_at IS NULL',
      [sealSecret(secret), admin.admin_id]);
    return { secret, otpauth_uri: otpauthUri(secret, admin.username, ISSUER) };
  });
}

/** Confirms binding with one code; returns the administrator and their new recovery codes (shown once). */
export async function activate(challenge: unknown, code: unknown): Promise<{ admin: AdminLoginRow; recoveryCodes: string[] }> {
  return inTransaction(async conn => {
    const admin = await challengedAdmin(conn, challenge, 'setup');
    if (!admin.totp_secret) throw new TwoFactorError('请先获取验证器密钥');
    const step = typeof code === 'string' ? verifyTotp(openSecret(admin.totp_secret), code, null) : null;
    if (step === null) throw new TwoFactorError('验证码错误', 401);
    const recoveryCodes = newRecoveryCodes();
    await conn.query('UPDATE admins SET totp_enabled_at = NOW(), totp_last_step = ? WHERE admin_id = ?', [step, admin.admin_id]);
    await conn.query('DELETE FROM admin_recovery_codes WHERE admin_id = ?', [admin.admin_id]);
    await conn.query('INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ?',
      [recoveryCodes.map(value => [admin.admin_id, hashRecoveryCode(value)])]);
    return { admin, recoveryCodes };
  });
}

/** Checks a dynamic code, or else a recovery code; `recovery` tells the caller which one was used. */
export async function verify(challenge: unknown, code: unknown): Promise<{ admin: AdminLoginRow; recovery: { remaining: number } | null }> {
  return inTransaction(async conn => {
    const admin = await challengedAdmin(conn, challenge, 'verify');
    if (typeof code !== 'string' || code.length > 32) throw new TwoFactorError('验证码错误', 401);
    const step = verifyTotp(openSecret(admin.totp_secret!), code, admin.totp_last_step === null ? null : Number(admin.totp_last_step));
    if (step !== null) {
      await conn.query('UPDATE admins SET totp_last_step = ? WHERE admin_id = ?', [step, admin.admin_id]);
      return { admin, recovery: null };
    }
    const [used] = await conn.query<ResultSetHeader>(
      'UPDATE admin_recovery_codes SET used_at = NOW() WHERE admin_id = ? AND code_hash = ? AND used_at IS NULL',
      [admin.admin_id, hashRecoveryCode(code)]);
    if (used.affectedRows !== 1) throw new TwoFactorError('验证码错误', 401);
    const [left] = await conn.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS remaining FROM admin_recovery_codes WHERE admin_id = ? AND used_at IS NULL', [admin.admin_id]);
    return { admin, recovery: { remaining: Number(left[0].remaining) } };
  });
}

/** Operator recovery (CLI): the administrator binds again at the next sign-in; every session ends. */
export async function resetTwoFactor(username: string): Promise<boolean> {
  return inTransaction(async conn => {
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE admins SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, auth_version = auth_version + 1
       WHERE username = ?`, [username]);
    if (result.affectedRows !== 1) return false;
    await conn.query('DELETE c FROM admin_recovery_codes c JOIN admins a ON a.admin_id = c.admin_id WHERE a.username = ?', [username]);
    return true;
  });
}
