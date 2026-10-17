/**
 * Encrypts small secrets at rest (administrators' TOTP secrets) with AES-256-GCM.
 * Key: ADMIN_TOTP_KEY, 32 random bytes in base64 (`openssl rand -base64 32`). Format: v1:<iv>:<tag>:<ciphertext>.
 *
 * Rotation (docs/KEY_ROTATION.md): during a transition ADMIN_TOTP_KEY_PREVIOUS still opens secrets sealed
 * with the old key; callers re-seal what only the previous key opens. Sealing always uses the current key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Why the key cannot be used, or null when it is valid. */
export function secretBoxKeyProblem(value: string | undefined, name = 'ADMIN_TOTP_KEY'): string | null {
  if (!value) return `未配置 ${name}`;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.trim()) return `${name} 必须是 32 字节随机数的 base64 编码（openssl rand -base64 32）`;
  return null;
}

/** The current key first, then the previous one while a rotation is in progress. */
export function secretBoxKeys(): Buffer[] {
  const problem = secretBoxKeyProblem(process.env.ADMIN_TOTP_KEY);
  if (problem) throw new Error(problem);
  const keys = [Buffer.from(process.env.ADMIN_TOTP_KEY!, 'base64')];
  const previous = process.env.ADMIN_TOTP_KEY_PREVIOUS;
  if (previous && !secretBoxKeyProblem(previous, 'ADMIN_TOTP_KEY_PREVIOUS') && previous !== process.env.ADMIN_TOTP_KEY) {
    keys.push(Buffer.from(previous, 'base64'));
  }
  return keys;
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretBoxKeys()[0], iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Opens a sealed secret; `stale` means only the previous key opened it, so it should be re-sealed. */
export function openSecretWithRotation(sealed: string): { value: string; stale: boolean } {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported sealed secret');
  const keys = secretBoxKeys();
  for (const [index, key] of keys.entries()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const value = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
      return { value, stale: index > 0 };
    } catch { /* GCM authentication failed: try the next key. */ }
  }
  throw new Error('Sealed secret does not open with the configured keys');
}

export function openSecret(sealed: string): string {
  return openSecretWithRotation(sealed).value;
}
