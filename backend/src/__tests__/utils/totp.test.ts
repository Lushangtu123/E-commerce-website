import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpCode, verifyTotp } from '../../utils/totp';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; the RFC lists 8 digits, we use the last 6.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test.each([
  [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'],
])('RFC 6238 test vector at %i s', (seconds, code) => {
  expect(totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
});

test('base32 round-trips and accepts lower case and spaces', () => {
  const bytes = Buffer.from('hello two factor');
  const encoded = base32Encode(bytes);
  expect(encoded).toMatch(/^[A-Z2-7]+$/);
  expect(base32Decode(encoded.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(bytes);
  expect(() => base32Decode('not base32!')).toThrow();
});

test('generated secrets are 160 random bits', () => {
  const a = generateTotpSecret(), b = generateTotpSecret();
  expect(base32Decode(a)).toHaveLength(20);
  expect(a).not.toBe(b);
});

describe('verifyTotp', () => {
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 1000 / 30);

  test('accepts the current step and one step of clock drift either way', () => {
    for (const offset of [-1, 0, 1]) expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + offset), null, now)).toBe(step + offset);
  });

  test('rejects codes two steps away', () => {
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), null, now)).toBeNull();
  });

  test('never accepts a step that was already used (replay)', () => {
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), step, now)).toBe(step + 1);
  });

  test('ignores spaces and rejects anything but six digits', () => {
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, null, now)).toBe(step);
    for (const bad of ['', '12345', '1234567', 'abcdef']) expect(verifyTotp(RFC_SECRET, bad, null, now)).toBeNull();
  });
});

test('otpauth URI for authenticator apps', () => {
  expect(otpauthUri('JBSWY3DPEHPK3PXP', 'admin', '电商平台')).toBe(
    'otpauth://totp/%E7%94%B5%E5%95%86%E5%B9%B3%E5%8F%B0%3Aadmin?secret=JBSWY3DPEHPK3PXP&issuer=%E7%94%B5%E5%95%86%E5%B9%B3%E5%8F%B0&algorithm=SHA1&digits=6&period=30');
});
