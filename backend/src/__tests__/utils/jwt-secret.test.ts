/**
 * JWT 密钥：顾客与管理员共用同一个密钥和开发默认值，并在调用时读取环境变量
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import { authMiddleware } from '../../middleware/auth';
import { authenticateAdmin } from '../../middleware/admin-auth';
import { DEV_JWT_SECRET, jwtSecret } from '../../utils/jwt-secret';

jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));

const OLD_SECRET = process.env.JWT_SECRET;

beforeEach(() => {
  (query as jest.Mock).mockResolvedValue([{ auth_version: 0 }]);
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async () => [[{ admin_id: 9, username: 'root', role_id: 1, status: 1, auth_version: 0 }]]),
  });
});
afterEach(() => { process.env.JWT_SECRET = OLD_SECRET; });

function app() {
  const server = express();
  server.get('/user', authMiddleware, (_req, res) => res.json({ ok: true }));
  server.get('/admin', authenticateAdmin, (_req, res) => res.json({ ok: true }));
  return server;
}

test('jwtSecret 在调用时读取 JWT_SECRET，未配置时回退到开发默认值', () => {
  process.env.JWT_SECRET = 'changed-after-import';
  expect(jwtSecret()).toBe('changed-after-import');
  delete process.env.JWT_SECRET;
  expect(jwtSecret()).toBe(DEV_JWT_SECRET);
});

test('未配置 JWT_SECRET 时，顾客与管理员认证都接受开发默认值签发的令牌', async () => {
  delete process.env.JWT_SECRET;
  const userToken = jwt.sign({ userId: 7, type: 'user', authVersion: 0 }, DEV_JWT_SECRET);
  const adminToken = jwt.sign({ adminId: 9, type: 'admin', authVersion: 0 }, DEV_JWT_SECRET);
  await request(app()).get('/user').set('Authorization', `Bearer ${userToken}`).expect(200);
  await request(app()).get('/admin').set('Authorization', `Bearer ${adminToken}`).expect(200);
});

test('共用密钥不会让顾客令牌通过管理员认证', async () => {
  const userToken = jwt.sign({ userId: 7, type: 'user', authVersion: 0 }, jwtSecret());
  await request(app()).get('/admin').set('Authorization', `Bearer ${userToken}`).expect(403);
});
