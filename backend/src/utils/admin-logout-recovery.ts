import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { jwtSecret } from './jwt-secret';
import { clearSessionCookie, readCookie, setSessionCookie } from './session-cookie';

export const ADMIN_LOGOUT_RETRY_COOKIE = 'admin_logout_retry';
const COOKIE_PATH = '/api/admin';
const PURPOSE = 'admin-logout-retry';
// An administrator token issued just before logout can still live for the full 24 hours.
const RETENTION_SECONDS = 24 * 60 * 60;
const MAX_RECEIPT_BYTES = 3000;

export interface AdminRevocationTarget { adminId: number; authVersion: number }
export interface AdminLogoutReceipt extends jwt.JwtPayload {
  type: typeof PURPOSE;
  targets: AdminRevocationTarget[];
  iat: number;
  exp: number;
}
export class AdminLogoutReceiptCapacityError extends Error {}

function validTarget(value: unknown): value is AdminRevocationTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as AdminRevocationTarget;
  return Number.isSafeInteger(target.adminId) && target.adminId > 0 &&
    Number.isSafeInteger(target.authVersion) && target.authVersion >= 0;
}

/** A revocation receipt is never an admin session, even when copied into its cookie or Bearer header. */
export function adminRevocationTarget(token: string | undefined): AdminRevocationTarget | undefined {
  try {
    const claims = jwt.verify(token || '', jwtSecret());
    if (typeof claims !== 'object' || claims.type !== 'admin') return undefined;
    const target = { adminId: claims.adminId, authVersion: claims.authVersion ?? 0 };
    return validTarget(target) ? target : undefined;
  } catch { return undefined; }
}

export function readAdminLogoutReceipt(req: Request): AdminLogoutReceipt | undefined {
  try {
    const claims = jwt.verify(readCookie(req, ADMIN_LOGOUT_RETRY_COOKIE) || '', jwtSecret(), { algorithms: ['HS256'] });
    if (typeof claims !== 'object' || claims.type !== PURPOSE || !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp) || !Array.isArray(claims.targets) || !claims.targets.length ||
        !claims.targets.every(validTarget)) return undefined;
    return claims as AdminLogoutReceipt;
  } catch { return undefined; }
}

/** Preserve earlier pending administrators when another valid session arrives in a concurrent tab. */
export function prepareAdminLogoutReceipt(receipt: AdminLogoutReceipt | undefined, target: AdminRevocationTarget | undefined): string | undefined {
  const targets = [...(receipt?.targets ?? [])];
  const added = target && !targets.some(item => item.adminId === target.adminId && item.authVersion === target.authVersion);
  if (added) targets.push(target);
  if (!targets.length) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ type: PURPOSE, targets, iat: receipt?.iat ?? now,
    // Retrying the same operation does not extend its lifetime.
    exp: added ? Math.max(receipt?.exp ?? 0, now + RETENTION_SECONDS) : receipt!.exp }, jwtSecret(), { algorithm: 'HS256' });
  if (Buffer.byteLength(token) > MAX_RECEIPT_BYTES) throw new AdminLogoutReceiptCapacityError();
  return token;
}

export function setAdminLogoutReceipt(res: Response, token: string): void {
  setSessionCookie(res, ADMIN_LOGOUT_RETRY_COOKIE, token, COOKIE_PATH);
}
export function clearAdminLogoutReceipt(res: Response): void {
  clearSessionCookie(res, ADMIN_LOGOUT_RETRY_COOKIE, COOKIE_PATH);
}

/** Exact version matching makes response-loss retries harmless to newly issued sessions. */
export async function revokeAdminTargets(pool: Pool, targets: AdminRevocationTarget[]): Promise<void> {
  const seen = new Set<string>();
  for (const target of targets) {
    const key = `${target.adminId}:${target.authVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [result] = await pool.query(
      'UPDATE admins SET auth_version = auth_version + 1 WHERE admin_id = ? AND auth_version = ?',
      [target.adminId, target.authVersion]
    );
    if (!result || !('affectedRows' in result) || (result.affectedRows !== 0 && result.affectedRows !== 1)) {
      throw new Error('Administrator session revocation was not confirmed');
    }
  }
}
