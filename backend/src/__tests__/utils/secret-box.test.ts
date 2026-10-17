import { randomBytes } from 'crypto';
import { openSecret, openSecretWithRotation, sealSecret, secretBoxKeyProblem } from '../../utils/secret-box';

const KEY = randomBytes(32).toString('base64');
const OLD_ENV = { ...process.env };
beforeEach(() => { process.env.ADMIN_TOTP_KEY = KEY; delete process.env.ADMIN_TOTP_KEY_PREVIOUS; });
afterAll(() => { process.env = OLD_ENV; });

test('seals and opens a secret; each seal is different', () => {
  const a = sealSecret('JBSWY3DPEHPK3PXP'), b = sealSecret('JBSWY3DPEHPK3PXP');
  expect(a).toMatch(/^v1:/);
  expect(a).not.toBe(b);
  expect(a).not.toContain('JBSWY3DPEHPK3PXP');
  expect(openSecret(a)).toBe('JBSWY3DPEHPK3PXP');
});

test('a tampered value or another key fails', () => {
  const sealed = sealSecret('JBSWY3DPEHPK3PXP');
  const parts = sealed.split(':');
  const flipped = Buffer.from(parts[3], 'base64'); flipped[0] ^= 1;
  expect(() => openSecret([...parts.slice(0, 3), flipped.toString('base64')].join(':'))).toThrow();
  process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
  expect(() => openSecret(sealed)).toThrow();
});

test('the key must decode to exactly 32 bytes', () => {
  expect(secretBoxKeyProblem(KEY)).toBeNull();
  expect(secretBoxKeyProblem(undefined)).toMatch(/ADMIN_TOTP_KEY/);
  expect(secretBoxKeyProblem(randomBytes(16).toString('base64'))).toMatch(/32/);
  delete process.env.ADMIN_TOTP_KEY;
  expect(() => sealSecret('x')).toThrow(/ADMIN_TOTP_KEY/);
});

test('during a rotation the previous key still opens old secrets, which report stale; new seals use the current key', () => {
  const old = sealSecret('JBSWY3DPEHPK3PXP');
  process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
  expect(() => openSecret(old)).toThrow();
  process.env.ADMIN_TOTP_KEY_PREVIOUS = KEY;
  expect(openSecretWithRotation(old)).toEqual({ value: 'JBSWY3DPEHPK3PXP', stale: true });
  const fresh = sealSecret('JBSWY3DPEHPK3PXP');
  expect(openSecretWithRotation(fresh)).toEqual({ value: 'JBSWY3DPEHPK3PXP', stale: false });
  delete process.env.ADMIN_TOTP_KEY_PREVIOUS;
  expect(openSecret(fresh)).toBe('JBSWY3DPEHPK3PXP');
});

test('an invalid previous key is ignored', () => {
  const sealed = sealSecret('x');
  process.env.ADMIN_TOTP_KEY_PREVIOUS = 'not-a-key';
  expect(openSecretWithRotation(sealed)).toEqual({ value: 'x', stale: false });
});
