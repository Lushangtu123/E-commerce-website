/**
 * httpOnly session cookies: reading, CSRF header, Bearer precedence, logout and CORS credentials.
 */
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware, optionalAuth, AuthRequest } from '../../middleware/auth';
import { authenticateAdmin } from '../../middleware/admin-auth';
import { UserController } from '../../controllers/user.controller';
import { adminLogin, adminLogout } from '../../controllers/admin.controller';
import bcrypt from 'bcryptjs';
import { getPool, query } from '../../database/mysql';
import { readCookie, setSessionCookie } from '../../utils/session-cookie';
import { corsOptions } from '../../utils/validate-env';

jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));

const SECRET = 'test-jwt-secret'; // 与 setup.ts 中的 JWT_SECRET 一致
const customer = (userId: number) => jwt.sign({ userId, type: 'user', authVersion: 0 }, SECRET, { expiresIn: '1h' });
const admin = (adminId: number) => jwt.sign({ adminId, type: 'admin' }, SECRET, { expiresIn: '1h' });

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue([{ auth_version: 0, status: 1 }]);
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => [[{ admin_id: 9, username: 'root', role_id: 1, status: 1 }]]) });
});

function customerApp(middleware = authMiddleware) {
  const app = express();
  app.all('/me', middleware, (req: AuthRequest, res) => res.json({ userId: req.userId ?? null }));
  return app;
}

function adminApp() {
  const app = express();
  app.all('/admin', authenticateAdmin, (req, res) => res.json({ adminId: req.admin?.adminId ?? null }));
  return app;
}

describe('readCookie', () => {
  const read = (cookie: string | undefined, name: string) => readCookie({ headers: { cookie } } as any, name);

  test('finds one cookie among several and decodes it', () => {
    expect(read('a=1; customer_session=x%2Ey; b=2', 'customer_session')).toBe('x.y');
  });
  test.each([undefined, '', 'other=1', 'customer_session=', 'customer_session=%E0%A4%A', 'xcustomer_session=1'])('reads %p as absent', cookie => {
    expect(read(cookie, 'customer_session')).toBeUndefined();
  });
});

describe('customer session cookie', () => {
  test('authenticates a read from the cookie alone', async () => {
    const res = await request(customerApp()).get('/me').set('Cookie', `customer_session=${customer(5)}`).expect(200);
    expect(res.body.userId).toBe(5);
  });

  test('refuses a cookie-authenticated write without the CSRF header, and accepts it with one', async () => {
    const cookie = `customer_session=${customer(5)}`;
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const refused = await request(customerApp())[method]('/me').set('Cookie', cookie).expect(403);
      expect(refused.body.error).toBe('请求来源校验失败，请刷新页面后重试');
      await request(customerApp())[method]('/me').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(200);
    }
    expect(query).toHaveBeenCalledTimes(4);
  });

  test('lets an explicit Bearer header win over the cookie and needs no CSRF header', async () => {
    const res = await request(customerApp()).post('/me')
      .set('Authorization', `Bearer ${customer(1)}`).set('Cookie', `customer_session=${customer(2)}`).expect(200);
    expect(res.body.userId).toBe(1);
  });

  test('never falls back to the cookie when the Bearer token is invalid', async () => {
    await request(customerApp()).get('/me')
      .set('Authorization', 'Bearer not-a-token').set('Cookie', `customer_session=${customer(2)}`).expect(401);
  });

  test('rejects an administrator token placed in the customer cookie', async () => {
    await request(customerApp()).get('/me').set('Cookie', `customer_session=${admin(9)}`).expect(401);
  });

  test('still rejects a cookie whose account version was revoked', async () => {
    (query as jest.Mock).mockResolvedValue([{ auth_version: 1, status: 1 }]);
    await request(customerApp()).get('/me').set('Cookie', `customer_session=${customer(5)}`).expect(401);
  });

  test('optional auth reads the cookie, but treats a write without the CSRF header as anonymous', async () => {
    const cookie = `customer_session=${customer(5)}`;
    expect((await request(customerApp(optionalAuth)).get('/me').set('Cookie', cookie).expect(200)).body.userId).toBe(5);
    expect((await request(customerApp(optionalAuth)).post('/me').set('Cookie', cookie).expect(200)).body.userId).toBeNull();
  });
});

describe('administrator session cookie', () => {
  test('authenticates from the cookie and guards writes with the CSRF header', async () => {
    const cookie = `admin_session=${admin(9)}`;
    expect((await request(adminApp()).get('/admin').set('Cookie', cookie).expect(200)).body.adminId).toBe(9);
    await request(adminApp()).put('/admin').set('Cookie', cookie).expect(403);
    await request(adminApp()).put('/admin').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(200);
  });

  test('ignores an administrator token in the customer cookie and a customer token in the admin cookie', async () => {
    await request(adminApp()).get('/admin').set('Cookie', `customer_session=${admin(9)}`).expect(401);
    await request(adminApp()).get('/admin').set('Cookie', `admin_session=${customer(5)}`).expect(403);
  });
});

describe('login', () => {
  test('an administrator login sets the admin session cookie without exposing the token in the body', async () => {
    const password_hash = await bcrypt.hash('admin-password', 4);
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async (sql: string) => sql.includes('FROM admins a')
      ? [[{ admin_id: 9, username: 'root', role_id: 1, role_name: '超级管理员', status: 1, password_hash }]] : [{}]) });
    const app = express();
    app.use(express.json());
    app.post('/api/admin/login', adminLogin);

    const res = await request(app).post('/api/admin/login').set('X-Requested-With', 'XMLHttpRequest').send({ username: 'root', password: 'admin-password' }).expect(200);
    const [cookie] = res.headers['set-cookie'] as unknown as string[];
    const token = /^admin_session=([^;]+);/.exec(cookie)![1];
    expect(jwt.verify(token, SECRET)).toMatchObject({ adminId: 9, type: 'admin' });
    expect(res.body).not.toHaveProperty('token');
    expect(res.body.admin).toMatchObject({ admin_id: 9, username: 'root' });
    expect(res.text).not.toContain(token);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/Max-Age=(86399|86400);/);
  });
});

describe('logout', () => {
  function logoutApp() {
    const app = express();
    app.post('/api/users/logout', UserController.logout);
    app.post('/api/admin/logout', adminLogout);
    return app;
  }

  test.each([['/api/users/logout', 'customer_session'], ['/api/admin/logout', 'admin_session']])('%s clears %s only with the CSRF header', async (path, name) => {
    const refused = await request(logoutApp()).post(path).expect(403);
    expect(refused.headers['set-cookie']).toBeUndefined();

    const res = await request(logoutApp()).post(path).set('X-Requested-With', 'XMLHttpRequest').expect(200);
    const [cleared] = res.headers['set-cookie'] as unknown as string[];
    expect(cleared).toMatch(new RegExp(`^${name}=;`));
    expect(cleared).toContain('Path=/api');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    expect(cleared).toContain('HttpOnly');
  });
});

describe('cookie attributes', () => {
  function issue() {
    const app = express();
    app.get('/issue', (_req, res) => { setSessionCookie(res, 'customer_session', customer(5)); res.end(); });
    return request(app).get('/issue');
  }

  test('marks the cookie Secure only in production', async () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(((await issue()).headers['set-cookie'] as unknown as string[])[0]).toContain('Secure');
      process.env.NODE_ENV = 'test';
      const cookie = ((await issue()).headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).not.toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toMatch(/Max-Age=(3599|3600);/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

describe('CORS credentials', () => {
  const original = process.env.CORS_ORIGIN;
  afterEach(() => { process.env.CORS_ORIGIN = original; });

  async function preflight(origin: string) {
    const app = express();
    app.use(cors(corsOptions()));
    return request(app).options('/api/users/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
  }

  test('lets only a listed origin send credentials', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000, http://127.0.0.1:3100';
    const allowed = await preflight('http://127.0.0.1:3100');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3100');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
  });

  test.each([undefined, '*', 'http://localhost:3000,*'])('allows any origin without credentials for CORS_ORIGIN=%p', async value => {
    if (value === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = value;
    const res = await preflight('https://anywhere.example');
    expect(res.headers['access-control-allow-origin']).toBe('https://anywhere.example');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
