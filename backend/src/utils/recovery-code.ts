/**
 * Administrator recovery codes: 160 random bits each, shown once, stored only as a keyed HMAC.
 *
 * The HMAC key is derived (HKDF) from ADMIN_TOTP_KEY, so a database copy alone cannot test guesses.
 * Each row records which key hashed it; while ADMIN_TOTP_KEY_PREVIOUS is set, codes hashed with the
 * previous key still verify, and the next sign-in replaces them with codes under the current key.
 */
import { createHash, createHmac, hkdfSync, randomBytes } from 'crypto';
import { secretBoxKeys } from './secret-box';
import { base32Encode } from './totp';

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 20;

export interface RecoveryKey { id: string; key: Buffer }

/** Lowercase base32 in eight groups of four, e.g. `abcd-efgh-...`. */
export function newRecoveryCode(): string {
  return base32Encode(randomBytes(RECOVERY_CODE_BYTES)).toLowerCase().match(/.{4}/g)!.join('-');
}

/** Spaces, hyphens and case do not matter; anything else that is not a code is null. */
export function normalizeRecoveryCode(code: string): string | null {
  const value = code.replace(/[\s-]/g, '').toLowerCase();
  return /^[a-z2-7]{32}$/.test(value) ? value : null;
}

/** HMAC keys for the current ADMIN_TOTP_KEY first, then for the previous one during a rotation. */
export function recoveryKeys(): RecoveryKey[] {
  return secretBoxKeys().map(master => {
    const key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'admin-recovery-code-v2', 32));
    return { id: createHash('sha256').update(key).digest('hex').slice(0, 16), key };
  });
}

/** Bound to the administrator, so equal codes of two administrators never share a hash. */
export function recoveryCodeHash(key: RecoveryKey, adminId: number, normalized: string): string {
  return createHmac('sha256', key.key).update(`${adminId}:${normalized}`).digest('hex');
}
