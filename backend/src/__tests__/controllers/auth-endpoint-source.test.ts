/** Cookie-changing entry points must reject form posts before account or password work. */
jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../models/user.model', () => ({ UserModel: {
  findByEmail: jest.fn(), findByUsername: jest.fn(), create: jest.fn(),
} }));
jest.mock('../../models/password-reset.model', () => ({ PasswordResetModel: { consume: jest.fn() } }));
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn(), getAdminLogs: jest.fn() }));
jest.mock('../../middleware/rate-limit', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../app';
import { UserModel } from '../../models/user.model';
import { PasswordResetModel } from '../../models/password-reset.model';
import { getPool } from '../../database/mysql';
import { CSRF_ERROR } from '../../utils/session-cookie';

const endpoints = [
  ['/api/users/login', { email: 'customer@example.test', password: 'old' }, 200],
  ['/api/users/register', { username: 'New', email: 'new@example.test', password: 'new-password-123' }, 201],
  ['/api/users/password/reset', { token: 'a'.repeat(64), newPassword: 'new-password-123' }, 200],
  ['/api/admin/login', { username: 'root', password: 'old' }, 200],
  ['/api/users/logout', {}, 200],
  ['/api/admin/logout', {}, 200],
] as const;
const originalEnv = { ...process.env };
let databaseQuery: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); process.env.CORS_ORIGIN = 'https://shop.example.test,https://admin.example.test';
  process.env.NODE_ENV = 'test';
  (UserModel.findByEmail as jest.Mock).mockImplementation(async email => email === 'new@example.test' ? null :
    { user_id: 7, username: 'Customer', email, status: 1, auth_version: 0, password_hash: 'fixture' });
  (UserModel.findByUsername as jest.Mock).mockResolvedValue(null);
  (UserModel.create as jest.Mock).mockResolvedValue(8);
  (PasswordResetModel.consume as jest.Mock).mockResolvedValue(true);
  (bcrypt.compare as jest.Mock).mockResolvedValue(true); (bcrypt.hash as jest.Mock).mockResolvedValue('fixture');
  databaseQuery = jest.fn(async (sql: string) => sql.includes('FROM admins a') ? [[{
    admin_id: 9, username: 'root', role_id: 1, role_name: 'operator', status: 1, password_hash: 'fixture', auth_version: 0,
  }]] : [{ affectedRows: 1 }]);
  (getPool as jest.Mock).mockReturnValue({ query: databaseQuery });
});
afterEach(() => { process.env = { ...originalEnv }; });
function noSideEffects(res: request.Response) {
  expect(res.status).toBe(403); expect(res.body).toEqual({ error: CSRF_ERROR });
  expect(res.headers['set-cookie']).toBeUndefined();
  expect(UserModel.findByEmail).not.toHaveBeenCalled(); expect(UserModel.create).not.toHaveBeenCalled();
  expect(PasswordResetModel.consume).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
  expect(bcrypt.compare).not.toHaveBeenCalled(); expect(bcrypt.hash).not.toHaveBeenCalled();
}

test.each(endpoints)('cross-site form %s cannot issue or clear a cookie, even without an existing session', async (path, body) => {
  noSideEffects(await request(createApp()).post(path).set('Origin', 'https://attacker.example').type('form').send(body));
});
test.each(endpoints)('same-site form %s also requires the custom header', async (path, body) => {
  noSideEffects(await request(createApp()).post(path).set('Origin', 'https://shop.example.test').type('form').send(body));
});
test.each(endpoints)('disallowed Origin is rejected at %s even with the custom header', async (path, body) => {
  noSideEffects(await request(createApp()).post(path).set('Origin', 'https://attacker.example').set('X-Requested-With', 'XMLHttpRequest').send(body));
});
test.each(['null', 'https://shop.example.test/path', 'https://shop.example.test#fragment', 'https://user@shop.example.test',
  'https://shop.example.test/', 'HTTPS://SHOP.EXAMPLE.TEST', 'https://shop.example.test:443', 'https://shop.example.test,https://attacker.example'])
('malformed or noncanonical Origin %s is rejected with a valid header', async origin => {
  noSideEffects(await request(createApp()).post('/api/users/login').set('Origin', origin).set('X-Requested-With', 'XMLHttpRequest')
    .send(endpoints[0][1]));
});
test.each(endpoints)('allowed origin plus custom header retains legitimate %s', async (path, body, status) => {
  const res = await request(createApp()).post(path).set('Origin', 'https://shop.example.test').set('X-Requested-With', 'XMLHttpRequest').send(body);
  expect(res.status).toBe(status); expect(res.headers['set-cookie']).toBeDefined();
});
test('header-bearing API clients without Origin retain legacy short administrator passwords byte for byte', async () => {
  const password = ' 1 ';
  const res = await request(createApp()).post('/api/admin/login').set('X-Requested-With', 'XMLHttpRequest')
    .send({ username: ' root ', password }).expect(200);
  expect(res.headers['set-cookie']).toBeDefined(); expect(bcrypt.compare).toHaveBeenCalledWith(password, 'fixture');
  expect(databaseQuery.mock.calls[0][1]).toEqual(['root']);
});
test('same-origin deployments accept their own canonical origin without extending the external allowlist', async () => {
  const res = await request(createApp()).post('/api/users/login').set('Host', 'preview.example.test').set('Origin', 'http://preview.example.test')
    .set('X-Requested-With', 'XMLHttpRequest').send(endpoints[0][1]).expect(200);
  expect(res.headers['set-cookie']).toBeDefined();
});
test('cross-site Fetch Metadata cannot use the no-Origin API-client exception', async () => {
  noSideEffects(await request(createApp()).post('/api/users/login').set('Sec-Fetch-Site', 'cross-site')
    .set('X-Requested-With', 'XMLHttpRequest').send(endpoints[0][1]));
});
test('development loopback frontend remains usable without wildcard cookie trust', async () => {
  delete process.env.CORS_ORIGIN;
  await request(createApp()).post('/api/users/login').set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'XMLHttpRequest').send(endpoints[0][1]).expect(200);
});
test('production never grants the development localhost exception', async () => {
  process.env.NODE_ENV = 'production'; process.env.JWT_SECRET = 'a-strong-production-test-secret';
  noSideEffects(await request(createApp()).post('/api/users/login').set('Origin', 'http://localhost:3000')
    .set('X-Requested-With', 'XMLHttpRequest').send(endpoints[0][1]));
});
test.each([
  null, [], {}, { username: 'root', password: 1 }, { username: ['root'], password: 'old' },
  { username: { role: 'root' }, password: 'old' }, { username: 'root', password: {} },
  { username: 'root', password: ['old'] }, { username: ' ', password: 'old' },
  { username: 'x'.repeat(51), password: 'old' }, { username: 'root', password: 'x'.repeat(1025) },
  { username: 'root', password: 'old', role_id: 1 },
])('invalid administrator login %p fails with 400 before DB and password work', async body => {
  const res = await request(createApp()).post('/api/admin/login').set('X-Requested-With', 'XMLHttpRequest').send(body as any);
  expect(res.status).toBe(400); expect(getPool).not.toHaveBeenCalled(); expect(bcrypt.compare).not.toHaveBeenCalled();
  expect(res.headers['set-cookie']).toBeUndefined();
});
