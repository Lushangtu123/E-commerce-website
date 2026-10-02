/**
 * JWT 认证中间件测试
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuth, AuthRequest } from '../../middleware/auth';

const SECRET = 'test-jwt-secret'; // 与 setup.ts 中的 JWT_SECRET 一致

function buildApp(mw: any) {
  const app = express();
  app.get('/protected', mw, (req: AuthRequest, res) => {
    res.json({ userId: req.userId ?? null });
  });
  return app;
}

describe('authMiddleware', () => {
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
