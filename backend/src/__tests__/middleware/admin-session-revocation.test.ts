/**
 * Administrator sessions carry auth_version; logout bumps it so every copy of the old token stops working.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool } from '../../database/mysql';
import { authenticateAdmin } from '../../middleware/admin-auth';
import { adminLogin, adminLogout } from '../../controllers/admin.controller';

jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));

const SECRET = 'test-jwt-secret';
const token = (claims: object, options: jwt.SignOptions = { expiresIn: '1h' }) =>
  jwt.sign({ adminId: 9, type: 'admin', ...claims }, SECRET, options);
const csrf = { 'X-Requested-With': 'XMLHttpRequest' };

let authVersion: number;
let failRevocation: boolean;
let queries: { sql: string; params: unknown[] }[];

beforeEach(async () => {
  authVersion = 0; failRevocation = false; queries = [];
  const password_hash = await bcrypt.hash('admin-password', 4);
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('UPDATE admins SET auth_version')) {
        if (failRevocation) throw new Error('db down');
        const matches = params[1] === authVersion;
        if (matches) authVersion += 1;
        return [{ affectedRows: matches ? 1 : 0 }];
      }
      if (sql.includes('FROM admins')) {
        return [[{ admin_id: 9, username: 'root', role_id: 1, role_name: '超级管理员', status: 1, auth_version: authVersion, password_hash }]];
      }
      return [{}];
    }),
  });
});

function app() {
  const server = express();
  server.use(express.json());
  server.post('/api/admin/login', adminLogin);
  server.post('/api/admin/logout', adminLogout);
  server.get('/api/admin/profile', authenticateAdmin, (req, res) => res.json({ adminId: req.admin?.adminId }));
  return server;
}

const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

test('登录令牌携带当前 auth_version', async () => {
  authVersion = 4;
  const res = await request(app()).post('/api/admin/login').send({ username: 'root', password: 'admin-password' }).expect(200);
  const issued = jwt.verify(cookieOf(res).split('=')[1], SECRET) as jwt.JwtPayload;
  expect(issued.authVersion).toBe(4);
});

test('退出登录后，同一令牌的其他副本立即失效', async () => {
  const login = await request(app()).post('/api/admin/login').send({ username: 'root', password: 'admin-password' }).expect(200);
  const cookie = cookieOf(login);
  await request(app()).get('/api/admin/profile').set('Cookie', cookie).expect(200);

  const out = await request(app()).post('/api/admin/logout').set('Cookie', cookie).set(csrf).expect(200);
  expect(cookieOf(out)).toBe('admin_session=');
  expect(authVersion).toBe(1);

  const reused = await request(app()).get('/api/admin/profile').set('Cookie', cookie).expect(401);
  expect(reused.body.error).toBe('登录已过期，请重新登录');
});

test('旧版本令牌（无 authVersion）在版本仍为 0 时有效，版本变化后失效', async () => {
  const legacy = `admin_session=${token({})}`;
  await request(app()).get('/api/admin/profile').set('Cookie', legacy).expect(200);
  authVersion = 1;
  await request(app()).get('/api/admin/profile').set('Cookie', legacy).expect(401);
});

test('已失效、过期或伪造的令牌退出时只清除 Cookie，不改动版本', async () => {
  authVersion = 2;
  for (const stale of [token({ authVersion: 1 }), token({ authVersion: 2 }, { expiresIn: -10 }), jwt.sign({ adminId: 9, type: 'admin', authVersion: 2 }, 'wrong')]) {
    const out = await request(app()).post('/api/admin/logout').set('Cookie', `admin_session=${stale}`).set(csrf).expect(200);
    expect(cookieOf(out)).toBe('admin_session=');
  }
  expect(authVersion).toBe(2);
});

test('顾客令牌放进管理员 Cookie 时退出不会改动任何管理员', async () => {
  const customer = jwt.sign({ userId: 9, type: 'user', authVersion: 0 }, SECRET);
  await request(app()).post('/api/admin/logout').set('Cookie', `admin_session=${customer}`).set(csrf).expect(200);
  expect(queries.some(q => q.sql.startsWith('UPDATE admins'))).toBe(false);
});

test('撤销失败时仍清除 Cookie，但返回 503 提示未能注销其他会话', async () => {
  failRevocation = true;
  const out = await request(app()).post('/api/admin/logout').set('Cookie', `admin_session=${token({ authVersion: 0 })}`).set(csrf).expect(503);
  expect(cookieOf(out)).toBe('admin_session=');
});

test('没有 CSRF 头时拒绝退出且不撤销', async () => {
  await request(app()).post('/api/admin/logout').set('Cookie', `admin_session=${token({ authVersion: 0 })}`).expect(403);
  expect(authVersion).toBe(0);
});
