import express from 'express';
import cors from 'cors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuth, AuthRequest } from '../../middleware/auth';
import { corsOptions } from '../../utils/validate-env';
import { query } from '../../database/mysql';

jest.mock('../../database/mysql', () => ({ query: jest.fn() }));

const headerName = 'X-Expected-Customer-Id';
const handler = jest.fn();
const token = (userId: number) => jwt.sign({ userId, authVersion: 0, type: 'user' }, 'test-jwt-secret');

function app(optional = false) {
  const instance = express();
  instance.use(cors(corsOptions()));
  instance.all('/account', optional ? optionalAuth : authMiddleware, (req: AuthRequest, res) => {
    handler(req.userId);
    res.json({ userId: req.userId ?? null });
  });
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue([{ auth_version: 0, status: 1 }]);
});

describe('customer account request context', () => {
  test.each(['cookie', 'bearer'])('rejects a stale account context before reads or writes with %s auth', async source => {
    for (const method of ['get', 'post'] as const) {
      const response = await request(app())[method]('/account')
        .set(source === 'cookie' ? 'Cookie' : 'Authorization', source === 'cookie' ? `customer_session=${token(2)}` : `Bearer ${token(2)}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .set(headerName, '1').expect(409);
      expect(response.body.error).toBe('登录状态已变化，请刷新后重试');
    }
    expect(handler).not.toHaveBeenCalled();
  });

  test.each([undefined, '2'])('accepts the current account with expected id %p', async expected => {
    const call = request(app()).post('/account').set('Cookie', `customer_session=${token(2)}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    if (expected !== undefined) call.set(headerName, expected);
    const response = await call.expect(200);
    expect(response.body.userId).toBe(2);
    expect(handler).toHaveBeenCalledWith(2);
  });

  test.each(['0', '-1', '1.5', '01', '2, 2', '9007199254740992', 'invalid'])('rejects malformed expected id %p', async expected => {
    const response = await request(app()).get('/account').set('Cookie', `customer_session=${token(2)}`)
      .set(headerName, expected).expect(400);
    expect(response.body.error).toBe('请求格式无效');
    expect(handler).not.toHaveBeenCalled();
  });

  test('expected id alone does not authenticate or bypass CSRF', async () => {
    await request(app()).get('/account').set(headerName, '2').expect(401);
    await request(app()).get('/account').set(headerName, '2').set('Authorization', 'Bearer invalid').expect(401);
    await request(app()).post('/account').set(headerName, '2').set('Cookie', `customer_session=${token(2)}`).expect(403);
    expect(handler).not.toHaveBeenCalled();
  });

  test('expected id does not grant a revoked or admin identity', async () => {
    (query as jest.Mock).mockResolvedValue([{ auth_version: 1, status: 1 }]);
    await request(app()).get('/account').set(headerName, '2').set('Cookie', `customer_session=${token(2)}`).expect(401);
    await request(app()).get('/account').set(headerName, '2')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 2, type: 'admin', adminId: 9 }, 'test-jwt-secret')}`).expect(401);
    expect(handler).not.toHaveBeenCalled();
  });

  test('an optional authenticated read rejects the wrong expected account', async () => {
    await request(app(true)).get('/account').set(headerName, '1').set('Cookie', `customer_session=${token(2)}`).expect(409);
    expect(handler).not.toHaveBeenCalled();
  });

  test('an optional authenticated read rejects a malformed expected account', async () => {
    await request(app(true)).get('/account').set(headerName, 'invalid').set('Cookie', `customer_session=${token(2)}`).expect(400);
    expect(handler).not.toHaveBeenCalled();
  });

  test.each([undefined, '2'])('optional reads accept matching and legacy contexts %p', async expected => {
    const call = request(app(true)).get('/account').set('Cookie', `customer_session=${token(2)}`);
    if (expected !== undefined) call.set(headerName, expected);
    expect((await call.expect(200)).body.userId).toBe(2);
  });

  test('expected context cannot create an optional identity without valid authentication', async () => {
    expect((await request(app(true)).get('/account').set(headerName, '2').expect(200)).body.userId).toBeNull();
    expect((await request(app(true)).get('/account').set(headerName, '2').set('Authorization', 'Bearer invalid').expect(200)).body.userId).toBeNull();
  });

  test('cross-origin preflight permits the additional account context header', async () => {
    const previous = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'http://localhost:3000';
    try {
      const response = await request(app()).options('/account').set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', `content-type,x-requested-with,${headerName.toLowerCase()}`).expect(204);
      expect(response.headers['access-control-allow-headers']).toContain(headerName.toLowerCase());
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(handler).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = previous;
    }
  });
});
