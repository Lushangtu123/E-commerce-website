jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
import { Response } from 'express';
import { query } from '../../database/mysql';
import { UserController } from '../../controllers/user.controller';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const valid = { username: '客户', email: 'customer@example.test', password: 'valid-password' };
const profile = { user_id: 7, username: '客户', email: 'customer@example.test', phone: null, avatar_url: null, password_hash: 'private-hash', status: 1, role: 'private' };
function response() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res); res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}
const req = (body: unknown) => ({ body, userId: 7 }) as any;
beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.startsWith('INSERT')) return { insertId: 7 };
    if (sql.startsWith('UPDATE')) return { affectedRows: 1 };
    if (sql.includes('WHERE user_id')) return [profile];
    return [];
  });
});

test('invalid registration is rejected before any database work', async () => {
  const res = response();
  await UserController.register(req({ ...valid, email: 'not-an-email', password: '1' }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(query).not.toHaveBeenCalled();
});

test('empty profile update is rejected without emitting empty SET SQL', async () => {
  const res = response(); await UserController.updateProfile(req({}), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(query).not.toHaveBeenCalled();
});

test('profile fields can be cleared to NULL and response excludes private account fields', async () => {
  const res = response(); await UserController.updateProfile(req({ phone: '', avatar_url: null }), res);
  expect(query).toHaveBeenCalledWith('UPDATE users SET phone = ?, avatar_url = ? WHERE user_id = ?', [null, null, 7]);
  expect(res.json).toHaveBeenCalledWith({ message: '更新成功', user: expect.objectContaining({ user_id: 7, phone: null, avatar_url: null }) });
  const output = (res.json as jest.Mock).mock.calls[0][0];
  expect(output.user.password_hash).toBeUndefined(); expect(output.user.role).toBeUndefined();
});

test.each([
  { username: 123 }, { username: '   ' }, { username: 'x'.repeat(51) },
  { email: {} }, { email: 'not-email' }, { email: `${'x'.repeat(90)}@example.test` },
  { password: 123456 }, { password: ['valid-password'] }, { password: '12345' },
  { password: 'x'.repeat(73) }, { password: '汉'.repeat(25) }, { role: 'admin' },
])('registration rejects invalid fields %p before SQL', async fields => {
  const res = response(); await UserController.register(req({ ...valid, ...fields }), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});

test.each([null, undefined, [], 'text'])('malformed registration %p is a client error', async body => {
  const res = response(); await UserController.register(req(body), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});

test.each([' ' + 'x'.repeat(70) + ' ', '汉'.repeat(24)])('registration preserves the complete valid 72-byte password', async password => {
  const res = response(); await UserController.register(req({ username: '  单 ', email: ' customer@example.test ', password }), res);
  expect(res.status).toHaveBeenCalledWith(201);
  const insert = (query as jest.Mock).mock.calls.find(([sql]) => sql.startsWith('INSERT'));
  expect(insert[1].slice(0, 2)).toEqual(['单', 'customer@example.test']);
  expect(await bcrypt.compare(password, insert[1][2])).toBe(true);
  const output = (res.json as jest.Mock).mock.calls[0][0];
  expect(output.user).toEqual({ user_id: 7, username: '单', email: 'customer@example.test' });
  // The signed session goes only into the httpOnly cookie, never into the readable body.
  expect(output).not.toHaveProperty('token');
  const [name, token] = (res.cookie as jest.Mock).mock.calls[0];
  expect(name).toBe('customer_session');
  expect(jwt.verify(token, process.env.JWT_SECRET!)).toMatchObject({ userId: 7, type: 'user', authVersion: 0 });
  expect(JSON.stringify(output)).not.toContain(token);
});

test.each([
  {}, null, [], { username: 123 }, { username: ' ' }, { username: 'x'.repeat(51) },
  { phone: 123 }, { phone: [] }, { phone: 'x'.repeat(21) },
  { avatar_url: 'javascript:alert(1)' }, { avatar_url: '/image.png' }, { avatar_url: {} },
  { avatar_url: 'https://example.test/' + 'x'.repeat(255) },
  { email: 'another@example.test' }, { user_id: 9 }, { password_hash: 'private' },
])('profile rejects unsupported or invalid fields %p without SQL', async body => {
  const res = response(); await UserController.updateProfile(req(body), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});

test('unchanged profile is still a successful update; missing user returns 404', async () => {
  (query as jest.Mock).mockImplementation(async sql => sql.startsWith('UPDATE') ? { affectedRows: 0 } : [profile]);
  const existing = response(); await UserController.updateProfile(req({ username: '客户' }), existing);
  expect(existing.json).toHaveBeenCalledWith(expect.objectContaining({ message: '更新成功' }));
  (query as jest.Mock).mockImplementation(async sql => sql.startsWith('UPDATE') ? { affectedRows: 0 } : []);
  const missing = response(); await UserController.updateProfile(req({ username: '客户' }), missing);
  expect(missing.status).toHaveBeenCalledWith(404);
});

test('registration races and profile username conflicts return 409 without database details', async () => {
  (query as jest.Mock).mockImplementation(async sql => {
    if (sql.startsWith('INSERT') || sql.startsWith('UPDATE')) throw Object.assign(new Error('private duplicate detail'), { code: 'ER_DUP_ENTRY' });
    return [];
  });
  const registration = response(); await UserController.register(req(valid), registration);
  expect(registration.status).toHaveBeenCalledWith(409);
  expect(registration.json).toHaveBeenCalledWith({ error: '用户名或邮箱已被使用' });
  const update = response(); await UserController.updateProfile(req({ username: 'occupied' }), update);
  expect(update.status).toHaveBeenCalledWith(409); expect(update.json).toHaveBeenCalledWith({ error: '用户名已被使用' });
});

test('existing username and email conflicts retain friendly messages with 409', async () => {
  for (const duplicate of ['username', 'email']) {
    (query as jest.Mock).mockImplementation(async sql => sql.includes(`WHERE ${duplicate} =`) ? [profile] : []);
    const res = response(); await UserController.register(req(valid), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: duplicate === 'username' ? '用户名已被使用' : '邮箱已被注册' });
  }
});

test.each([{ email: {} }, { email: [] }, { password: {} }, { password: 1 }, { password: '' }, { user_id: 9 }])('login rejects malformed %p before SQL', async fields => {
  const res = response(); await UserController.login(req({ email: valid.email, password: 'old', ...fields }), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});

test('legacy short passwords and historical email remain usable without trimming the password', async () => {
  const password = ' 1 ';
  const password_hash = await bcrypt.hash(password, 4);
  (query as jest.Mock).mockResolvedValue([{ ...profile, email: 'legacy-local-email', password_hash }]);
  const res = response(); await UserController.login(req({ email: ' legacy-local-email ', password }), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ user_id: 7 }) }));
  expect((res.json as jest.Mock).mock.calls[0][0]).not.toHaveProperty('token');
  expect((res.cookie as jest.Mock).mock.calls[0][0]).toBe('customer_session');
  expect((res.json as jest.Mock).mock.calls[0][0].user.password_hash).toBeUndefined();
  expect(query).toHaveBeenCalledWith(expect.any(String), ['legacy-local-email']);
});

test('a disabled account cannot log in with its correct password', async () => {
  const password = 'valid-password';
  (query as jest.Mock).mockResolvedValue([{ ...profile, status: 0, password_hash: await bcrypt.hash(password, 4) }]);
  const res = response(); await UserController.login(req({ email: valid.email, password }), res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ error: '账号已被禁用' });
  expect(res.cookie).not.toHaveBeenCalled();
});

test('wrong passwords do not reveal that an account is disabled', async () => {
  (query as jest.Mock).mockResolvedValue([{ ...profile, status: 0, password_hash: await bcrypt.hash('valid-password', 4) }]);
  const res = response(); await UserController.login(req({ email: valid.email, password: 'wrong' }), res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: '邮箱或密码错误' });
});

test('profile GET projects public fields even if a future model returns private columns', async () => {
  const res = response(); await UserController.getProfile(req(undefined), res);
  const output = (res.json as jest.Mock).mock.calls[0][0].user;
  expect(output.user_id).toBe(7); expect(output.password_hash).toBeUndefined(); expect(output.role).toBeUndefined();
});
