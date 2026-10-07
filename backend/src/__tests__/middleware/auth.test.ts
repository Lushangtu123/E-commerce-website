/**
 * JWT 认证中间件测试
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuth, AuthRequest } from '../../middleware/auth';
import { query } from '../../database/mysql';

jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); (query as jest.Mock).mockResolvedValue([{ auth_version: 0, status: 1 }]); });

const SECRET = 'test-jwt-secret'; // 与 setup.ts 中的 JWT_SECRET 一致

function buildApp(mw: any) {
  const app = express();
  app.get('/protected', mw, (req: AuthRequest, res) => {
    res.json({ userId: req.userId ?? null });
  });
  return app;
}

describe('authMiddleware', () => {
  test.each(['bearer', 'cookie'])('rejects a disabled account with a current %s session', async source => {
    (query as jest.Mock).mockResolvedValue([{ auth_version: 0, status: 0 }]);
    const token = jwt.sign({ userId: 42, authVersion: 0, type: 'user' }, SECRET);
    const header = source === 'cookie' ? { Cookie: `customer_session=${token}` } : { Authorization: `Bearer ${token}` };
    await request(buildApp(authMiddleware)).get('/protected').set(header).expect(401);
  });
  test('rejects a previously valid token after password revokes version 0', async () => {
    (query as jest.Mock).mockResolvedValue([{ auth_version: 1, status: 1 }]);
    await request(buildApp(authMiddleware)).get('/protected')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 42 }, SECRET)}`).expect(401);
  });
  test('accepts the latest explicit authentication version', async () => {
    (query as jest.Mock).mockResolvedValue([{ auth_version: 2, status: 1 }]);
    await request(buildApp(authMiddleware)).get('/protected')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 42, authVersion: 2, type: 'user' }, SECRET)}`).expect(200);
  });
  test.each([-1, 1.5, '0', null])('rejects malformed authVersion %p', async authVersion => {
    await request(buildApp(authMiddleware)).get('/protected')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 42, authVersion }, SECRET)}`).expect(401);
  });
  test('missing users and unavailable database never authorize a protected request', async () => {
    (query as jest.Mock).mockResolvedValue([]);
    await request(buildApp(authMiddleware)).get('/protected')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 42 }, SECRET)}`).expect(401);
    (query as jest.Mock).mockRejectedValue(new Error('private db error'));
    await request(buildApp(authMiddleware)).get('/protected')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 42 }, SECRET)}`).expect(503);
  });
  test.each([{ type: 'admin', adminId: 1 }, { userId: 0 }, { userId: '1' }, { userId: 1.5 }])('拒绝非用户身份 %j', async payload => {
    const token = jwt.sign(payload, SECRET);
    await request(buildApp(authMiddleware)).get('/protected').set('Authorization', `Bearer ${token}`).expect(401);
  });
  test('无 token 返回 401', async () => {
    const res = await request(buildApp(authMiddleware)).get('/protected').expect(401);
    expect(res.body.error).toBe('未登录，请先登录');
  });

  test('无效 token 返回 401', async () => {
    const res = await request(buildApp(authMiddleware))
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
    expect(res.body.error).toBe('登录已过期，请重新登录');
  });

  test('过期 token 返回 401', async () => {
    const token = jwt.sign({ userId: 1 }, SECRET, { expiresIn: '-1s' });
    await request(buildApp(authMiddleware))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  test('有效 token 放行并注入 userId', async () => {
    const token = jwt.sign({ userId: 42 }, SECRET);
    const res = await request(buildApp(authMiddleware))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.userId).toBe(42);
  });
});

describe('optionalAuth', () => {
  test('a disabled account remains anonymous during optional browsing', async () => {
    (query as jest.Mock).mockResolvedValue([{ auth_version: 0, status: 0 }]);
    const token = jwt.sign({ userId: 7, authVersion: 0, type: 'user' }, SECRET);
    const result = await request(buildApp(optionalAuth)).get('/protected').set('Cookie', `customer_session=${token}`).expect(200);
    expect(result.body.userId).toBeNull();
  });
  test('revoked tokens and database failures never inject an optional identity', async () => {
    const authorization = `Bearer ${jwt.sign({ userId: 7, authVersion: 0 }, SECRET)}`;
    (query as jest.Mock).mockResolvedValue([{ auth_version: 1, status: 1 }]);
    expect((await request(buildApp(optionalAuth)).get('/protected').set('Authorization', authorization)).body.userId).toBeNull();
    (query as jest.Mock).mockRejectedValue(new Error('unavailable'));
    expect((await request(buildApp(optionalAuth)).get('/protected').set('Authorization', authorization)).body.userId).toBeNull();
  });
  test('管理员令牌不会注入普通用户身份', async () => {
    const token = jwt.sign({ type: 'admin', adminId: 1, userId: 99 }, SECRET);
    const res = await request(buildApp(optionalAuth)).get('/protected').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.userId).toBeNull();
  });
  test('无 token 直接放行', async () => {
    const res = await request(buildApp(optionalAuth)).get('/protected').expect(200);
    expect(res.body.userId).toBeNull();
  });

  test('无效 token 也放行（不抛 401）', async () => {
    const res = await request(buildApp(optionalAuth))
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token')
      .expect(200);
    expect(res.body.userId).toBeNull();
  });

  test('有效 token 注入 userId', async () => {
    const token = jwt.sign({ userId: 7 }, SECRET);
    const res = await request(buildApp(optionalAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.userId).toBe(7);
  });
});
