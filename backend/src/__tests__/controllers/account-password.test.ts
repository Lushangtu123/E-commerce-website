jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
import { getPool, query } from '../../database/mysql';
import { PasswordResetModel } from '../../models/password-reset.model';
import { UserController } from '../../controllers/user.controller';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import * as recovery from '../../services/password-recovery.service';

function response() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res); res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}
const req = (body: unknown) => ({ body, userId: 7 }) as any;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.APP_URL;
  jest.spyOn(recovery.passwordRecoveryClock, 'sleep').mockResolvedValue(undefined);
});
afterEach(() => { jest.restoreAllMocks(); });

function configureMail() {
  process.env.RESEND_API_KEY = 're_private_test_key'; process.env.EMAIL_FROM = 'Shop <security@example.test>';
  process.env.APP_URL = 'https://shop.example.test';
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
}
function connection() {
  const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), query: jest.fn() };
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT auth_version')) return [[{ auth_version: 0 }]];
    if (sql.startsWith('SELECT')) return [[]];
    return [{ affectedRows: 1 }];
  });
  (getPool as jest.Mock).mockReturnValue({ getConnection: async () => conn });
  return conn;
}

test('capabilities explicitly disable password recovery without a mail provider', async () => {
  const res = response(); await (UserController as any).passwordCapabilities(req({}), res);
  expect(res.json).toHaveBeenCalledWith({ passwordResetAvailable: false, passwordMinLength: 12, passwordMaxBytes: 72 });
});

test('unconfigured recovery returns safe unavailable response before any account lookup', async () => {
  const res = response(); await (UserController as any).forgotPassword(req({ email: 'user@example.test' }), res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.any(String), code: 'PASSWORD_RESET_UNAVAILABLE' });
  expect(query).not.toHaveBeenCalled();
});

test('login binds the session to the database authentication version', async () => {
  const password = 'old-password';
  (query as jest.Mock).mockResolvedValue([{ user_id: 7, username: 'customer', email: 'user@example.test',
    auth_version: 3, password_hash: await bcrypt.hash(password, 4) }]);
  const res = response(); await UserController.login(req({ email: 'user@example.test', password }), res);
  const token = res.json.mock.calls[0][0].token;
  expect(jwt.verify(token, process.env.JWT_SECRET!)).toMatchObject({ userId: 7, authVersion: 3, type: 'user' });
  // The same token also goes into an httpOnly cookie that expires with it, scoped to the API.
  const [name, value, options] = res.cookie.mock.calls[0];
  expect([name, value]).toEqual(['customer_session', token]);
  expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false, path: '/api' });
  expect(options.maxAge).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60_000);
  expect(options.maxAge).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
});

test('known recovery stores only a hash and sends one fragment link without exposing it publicly', async () => {
  const fetchMock = configureMail(); const conn = connection();
  (query as jest.Mock).mockResolvedValue([{ user_id: 7, email: 'user@example.test' }]);
  const res = response(); await (UserController as any).forgotPassword(req({ email: ' user@example.test ' }), res);
  const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  const link = body.text.match(/https:\/\/shop.example.test\/reset-password#token=([a-f0-9]{64})/);
  expect(link).not.toBeNull();
  const insert = conn.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO password_reset_tokens'));
  expect(insert).toBeDefined();
  expect(insert![1]).toEqual([createHash('sha256').update(link[1]).digest('hex'), 7]);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain(link[1]);
  expect(res.json).toHaveBeenCalledWith({ message: '如果该邮箱已注册，我们会发送密码重置邮件，请检查收件箱。' });
  expect(conn.commit).toHaveBeenCalledTimes(1);
});

test('unknown email uses the same public response and does not send an email', async () => {
  const fetchMock = configureMail(); (query as jest.Mock).mockResolvedValue([]);
  const res = response(); await (UserController as any).forgotPassword(req({ email: 'unknown@example.test' }), res);
  expect(res.json).toHaveBeenCalledWith({ message: '如果该邮箱已注册，我们会发送密码重置邮件，请检查收件箱。' });
  expect(fetchMock).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
});

test('provider errors never return account existence, reset links, or provider response details', async () => {
  const fetchMock = configureMail(); connection();
  fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => 'private provider details' } as any);
  (query as jest.Mock).mockResolvedValue([{ user_id: 7, email: 'user@example.test' }]);
  const res = response(); await (UserController as any).forgotPassword(req({ email: 'user@example.test' }), res);
  expect(res.status).not.toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ message: '如果该邮箱已注册，我们会发送密码重置邮件，请检查收件箱。' });
});

test('issuance failures use the same generic public reply as an unknown email', async () => {
  configureMail(); const conn = connection(); conn.query.mockRejectedValue(new Error('private database detail'));
  (query as jest.Mock).mockResolvedValue([{ user_id: 7, email: 'user@example.test' }]);
  const res = response(); await UserController.forgotPassword(req({ email: 'user@example.test' }), res);
  expect(res.json).toHaveBeenCalledWith({ message: '如果该邮箱已注册，我们会发送密码重置邮件，请检查收件箱。' });
  expect(recovery.passwordRecoveryClock.sleep).toHaveBeenCalledTimes(1);
});

test.each([
  { newPassword: 'short' }, { newPassword: '汉'.repeat(25) }, { newPassword: 123456789012 },
  { newPassword: 'valid-long-password', role: 'admin' }, { newPassword: '            ' },
])('new password rejects weak, truncated, and unsupported input %p before SQL', async fields => {
  const res = response(); await (UserController as any).changePassword(req({ currentPassword: 'old', ...fields }), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
});

test('incorrect current password never mutates or revokes an account', async () => {
  (query as jest.Mock).mockResolvedValue([{ user_id: 7, password_hash: await bcrypt.hash('right-password', 4) }]);
  const res = response(); await (UserController as any).changePassword(req({ currentPassword: 'wrong', newPassword: 'new-long-password' }), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(getPool).not.toHaveBeenCalled();
});

test('changing a password stores a complete bcrypt hash and invalidates outstanding reset tokens', async () => {
  const conn = connection(); const oldHash = await bcrypt.hash('old-password', 4);
  (query as jest.Mock).mockResolvedValue([{ user_id: 7, password_hash: oldHash }]);
  const res = response(); const newPassword = '  new-password-123  ';
  await (UserController as any).changePassword(req({ currentPassword: 'old-password', newPassword }), res);
  const update = conn.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE users'))!;
  expect(update[0]).toContain('auth_version = auth_version + 1');
  expect(await bcrypt.compare(newPassword, update[1][0])).toBe(true);
  expect(update[1].slice(1)).toEqual([7, oldHash]);
  expect(conn.query).toHaveBeenCalledWith('DELETE FROM password_reset_tokens WHERE user_id = ?', [7]);
  expect(res.json).toHaveBeenCalledWith({ message: '密码已修改，请重新登录', reauthenticate: true });
  // The revoked session cookie leaves the browser with the response that revokes it.
  expect(res.clearCookie).toHaveBeenCalledWith('customer_session', expect.objectContaining({ httpOnly: true, path: '/api' }));
});

test.each(['bad', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)])('reset rejects malformed token %p without database work', async token => {
  const res = response(); await (UserController as any).resetPassword(req({ token, newPassword: 'new-long-password' }), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(getPool).not.toHaveBeenCalled();
});

test('a completed reset clears the session cookie, and a rejected one leaves it alone', async () => {
  const consume = jest.spyOn(PasswordResetModel, 'consume').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const done = response(); await (UserController as any).resetPassword(req({ token: 'a'.repeat(64), newPassword: 'new-long-password' }), done);
  expect(done.json).toHaveBeenCalledWith({ message: '密码已重置，请重新登录', reauthenticate: true });
  expect(done.clearCookie).toHaveBeenCalledWith('customer_session', expect.objectContaining({ path: '/api' }));
  const rejected = response(); await (UserController as any).resetPassword(req({ token: 'a'.repeat(64), newPassword: 'new-long-password' }), rejected);
  expect(rejected.clearCookie).not.toHaveBeenCalled();
  consume.mockRestore();
});

test('expired or consumed reset link cannot change the password', async () => {
  const conn = connection();
  const res = response(); await (UserController as any).resetPassword(req({ token: 'a'.repeat(64), newPassword: 'new-long-password' }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: '密码重置链接无效或已过期', code: 'INVALID_RESET_TOKEN' });
  expect(conn.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  expect(conn.rollback).toHaveBeenCalledTimes(1);
});
