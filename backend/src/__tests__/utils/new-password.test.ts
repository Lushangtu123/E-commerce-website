import { normalizeRegistration, normalizeLogin } from '../../utils/user-validation';
import { normalizePasswordReset, normalizePasswordChange } from '../../utils/password-validation';

const registration = (password: string) => normalizeRegistration({ username: 'customer', email: 'customer@example.test', password });
const reset = (newPassword: string) => normalizePasswordReset({ token: 'a'.repeat(64), newPassword });
const change = (newPassword: string) => normalizePasswordChange({ currentPassword: 'old', newPassword });

test.each(['abc123', 'x'.repeat(11), ' '.repeat(12), '\t'.repeat(12), '\u3000'.repeat(12), 'x'.repeat(73), '汉'.repeat(25), '\ud800'.repeat(12), '\u0085'.repeat(12), ' \t\u0085\u3000'.repeat(3)])('all new-password flows reject invalid values %p', password => {
  for (const normalize of [registration, reset, change]) expect(() => normalize(password)).toThrow();
});
test.each(['x'.repeat(12), 'x'.repeat(72), '汉'.repeat(24), '  exact password  ', 'password 😀😀😀', '😀'.repeat(6), '\u0085 exact password \u0085'])('all new-password flows preserve valid bytes %p', password => {
  expect(registration(password).password).toBe(password);
  expect(reset(password).newPassword).toBe(password);
  expect(change(password).newPassword).toBe(password);
});
test('legacy login retains short and whitespace-bearing passwords unchanged', () => {
  for (const password of ['old', ' old ', ' '.repeat(6)]) expect(normalizeLogin({ email: 'customer@example.test', password }).password).toBe(password);
});
