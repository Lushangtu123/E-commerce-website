/**
 * Encrypts small secrets at rest (administrators' TOTP secrets) with AES-256-GCM.
 * Key: ADMIN_TOTP_KEY, 32 random bytes in base64 (`openssl rand -base64 32`). Format: v1:<iv>:<tag>:<ciphertext>.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Why the key cannot be used, or null when it is valid. */
export function secretBoxKeyProblem(value: string | undefined): string | null {
  if (!value) return '未配置 ADMIN_TOTP_KEY';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.trim()) return 'ADMIN_TOTP_KEY 必须是 32 字节随机数的 base64 编码（openssl rand -base64 32）';
  return null;
}

function key(): Buffer {
  const problem = secretBoxKeyProblem(process.env.ADMIN_TOTP_KEY);
  if (problem) throw new Error(problem);
  return Buffer.from(process.env.ADMIN_TOTP_KEY!, 'base64');
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function openSecret(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported sealed secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
