import { randomBytes } from 'crypto';
import { newRecoveryCode, normalizeRecoveryCode, recoveryCodeHash, recoveryKeys } from '../../utils/recovery-code';

const KEY = randomBytes(32).toString('base64');
const OLD_ENV = { ...process.env };
beforeEach(() => { process.env.ADMIN_TOTP_KEY = KEY; delete process.env.ADMIN_TOTP_KEY_PREVIOUS; });
afterAll(() => { process.env = OLD_ENV; });

test('codes carry 160 random bits as eight groups of four base32 characters', () => {
  const codes = new Set(Array.from({ length: 50 }, newRecoveryCode));
  expect(codes.size).toBe(50);
  for (const code of codes) expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){7}$/);
});

test('normalization ignores spaces, hyphens and case and rejects anything else', () => {
  const code = newRecoveryCode();
  expect(normalizeRecoveryCode(` ${code.toUpperCase().replace(/-/g, ' ')} `)).toBe(code.replace(/-/g, ''));
  expect(normalizeRecoveryCode('a1b2c-d3e4f')).toBeNull();
  expect(normalizeRecoveryCode('1'.repeat(32))).toBeNull();
});

test('hashes are keyed by ADMIN_TOTP_KEY and bound to the administrator', () => {
  const code = normalizeRecoveryCode(newRecoveryCode())!;
  const [current] = recoveryKeys();
  const hash = recoveryCodeHash(current, 1, code);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(recoveryCodeHash(current, 2, code)).not.toBe(hash);
  process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
  process.env.ADMIN_TOTP_KEY_PREVIOUS = KEY;
  const [rotated, previous] = recoveryKeys();
  expect(previous).toEqual(current);
  expect(rotated.id).not.toBe(current.id);
  expect(recoveryCodeHash(rotated, 1, code)).not.toBe(hash);
});
