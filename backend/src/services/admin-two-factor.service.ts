/**
 * 管理员两步验证（所有管理员强制）。
 *
 * 登录流程：密码正确后不签发会话，而是返回 5 分钟有效的一次性挑战（challenge）：
 * - 已绑定验证器：提交 6 位动态码或恢复码（verify）后签发会话；
 * - 未绑定：先取得密钥与二维码（setup），提交一次动态码确认绑定（activate），同时领取 10 个恢复码，然后签发会话。
 * 挑战令牌绑定管理员的 auth_version，退出或重置后旧挑战失效。动态码按时间步防重放。
 * 恢复码 160 位随机、只存带密钥的 HMAC（utils/recovery-code.ts），每个只能用一次；当前密钥下没有可用恢复码时
 * （迁移作废旧码、密钥轮换或全部用完），登录成功同时发放新的一组。轮换期间用旧密钥加密的 TOTP 密钥在登录时改用新密钥。
 */
import jwt from 'jsonwebtoken';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../database/mysql';
import { jwtSecret, verifyJwt } from '../utils/jwt-secret';
import { openSecretWithRotation, sealSecret } from '../utils/secret-box';
import { RECOVERY_CODE_COUNT, newRecoveryCode, normalizeRecoveryCode, recoveryCodeHash, recoveryKeys } from '../utils/recovery-code';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../utils/totp';

export class TwoFactorError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'TwoFactorError';
  }
}

export type ChallengePurpose = 'verify' | 'setup';
export { RECOVERY_CODE_COUNT } from '../utils/recovery-code';
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

/** Replaces every recovery code of the administrator with a new set under the current key. */
async function issueRecoveryCodes(conn: PoolConnection, adminId: number): Promise<string[]> {
  const [current] = recoveryKeys();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await conn.query('DELETE FROM admin_recovery_codes WHERE admin_id = ?', [adminId]);
  await conn.query('INSERT INTO admin_recovery_codes (admin_id, code_hash, key_id) VALUES ?',
    [codes.map(code => [adminId, recoveryCodeHash(current, adminId, normalizeRecoveryCode(code)!), current.id])]);
  return codes;
}

/** Spends one unused recovery code, hashed with the current or (during a rotation) the previous key. */
async function spendRecoveryCode(conn: PoolConnection, adminId: number, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return false;
  for (const key of recoveryKeys()) {
    const [used] = await conn.query<ResultSetHeader>(
      'UPDATE admin_recovery_codes SET used_at = NOW() WHERE admin_id = ? AND key_id = ? AND code_hash = ? AND used_at IS NULL',
      [adminId, key.id, recoveryCodeHash(key, adminId, normalized)]);
    if (used.affectedRows === 1) return true;
  }
  return false;
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
    const secret = openSecretWithRotation(admin.totp_secret);
    const step = typeof code === 'string' ? verifyTotp(secret.value, code, null) : null;
    if (step === null) throw new TwoFactorError('验证码错误', 401);
    await conn.query('UPDATE admins SET totp_secret = ?, totp_enabled_at = NOW(), totp_last_step = ? WHERE admin_id = ?',
      [secret.stale ? sealSecret(secret.value) : admin.totp_secret, step, admin.admin_id]);
    return { admin, recoveryCodes: await issueRecoveryCodes(conn, admin.admin_id) };
  });
}

export interface VerifyResult {
  admin: AdminLoginRow;
  /** Set when a recovery code signed in: how many unused codes under the current key remain. */
  recovery: { remaining: number } | null;
  /** A new set, shown once, when no usable code remained under the current key. */
  recoveryCodes: string[] | null;
}

/** Checks a dynamic code, or else a recovery code; `recovery` tells the caller which one was used. */
export async function verify(challenge: unknown, code: unknown): Promise<VerifyResult> {
  return inTransaction(async conn => {
    const admin = await challengedAdmin(conn, challenge, 'verify');
    if (typeof code !== 'string' || code.length > 64) throw new TwoFactorError('验证码错误', 401);
    const secret = openSecretWithRotation(admin.totp_secret!);
    const step = verifyTotp(secret.value, code, admin.totp_last_step === null ? null : Number(admin.totp_last_step));
    const usedRecovery = step === null;
    if (usedRecovery && !await spendRecoveryCode(conn, admin.admin_id, code)) throw new TwoFactorError('验证码错误', 401);
    // A secret only the previous key opens moves to the current key at this sign-in.
    await conn.query('UPDATE admins SET totp_secret = ?, totp_last_step = ? WHERE admin_id = ?',
      [secret.stale ? sealSecret(secret.value) : admin.totp_secret, usedRecovery ? admin.totp_last_step : step, admin.admin_id]);
    const [left] = await conn.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS remaining FROM admin_recovery_codes WHERE admin_id = ? AND key_id = ? AND used_at IS NULL',
      [admin.admin_id, recoveryKeys()[0].id]);
    const remaining = Number(left[0].remaining);
    return {
      admin,
      recovery: usedRecovery ? { remaining } : null,
      recoveryCodes: remaining === 0 ? await issueRecoveryCodes(conn, admin.admin_id) : null,
    };
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

export interface TwoFactorKeyReport {
  /** TOTP secrets moved to the current key by this run (`rekey`). */
  resealed: string[];
  /** Administrators whose TOTP secret still only opens with ADMIN_TOTP_KEY_PREVIOUS. */
  staleSecrets: string[];
  /** Administrators whose TOTP secret opens with neither key: they must be reset. */
  unreadableSecrets: string[];
  /** Administrators with unused recovery codes under another key; their next sign-in replaces them. */
  staleRecoveryCodes: string[];
}

/**
 * Rotation check (CLI): what still depends on a key other than the current ADMIN_TOTP_KEY.
 * With `rekey`, TOTP secrets that only the previous key opens are re-sealed now. Recovery codes cannot be
 * re-hashed without the codes themselves; they are replaced at the administrator's next sign-in.
 */
export async function twoFactorKeyReport(rekey: boolean): Promise<TwoFactorKeyReport> {
  const pool = getPool();
  const report: TwoFactorKeyReport = { resealed: [], staleSecrets: [], unreadableSecrets: [], staleRecoveryCodes: [] };
  const [admins] = await pool.query<RowDataPacket[]>('SELECT admin_id, username, totp_secret FROM admins WHERE totp_secret IS NOT NULL ORDER BY admin_id');
  for (const admin of admins) {
    let secret: { value: string; stale: boolean };
    try { secret = openSecretWithRotation(admin.totp_secret); }
    catch { report.unreadableSecrets.push(admin.username); continue; }
    if (!secret.stale) continue;
    if (!rekey) { report.staleSecrets.push(admin.username); continue; }
    // Only replace the exact sealed value read above; a concurrent sign-in may already have re-sealed it.
    const [result] = await pool.query<ResultSetHeader>('UPDATE admins SET totp_secret = ? WHERE admin_id = ? AND totp_secret = ?',
      [sealSecret(secret.value), admin.admin_id, admin.totp_secret]);
    if (result.affectedRows === 1) report.resealed.push(admin.username);
  }
  const [codes] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT a.username FROM admin_recovery_codes c JOIN admins a ON a.admin_id = c.admin_id
     WHERE c.used_at IS NULL AND c.key_id <> ? ORDER BY a.username`, [recoveryKeys()[0].id]);
  report.staleRecoveryCodes = codes.map(row => row.username);
  return report;
}
