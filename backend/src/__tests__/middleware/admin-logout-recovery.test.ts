import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool } from '../../database/mysql';
import { adminLogin, adminLogout } from '../../controllers/admin.controller';
import { authenticateAdmin } from '../../middleware/admin-auth';

jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));

const SECRET = 'test-jwt-secret';
const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
const RETRY_COOKIE = 'admin_logout_retry';
const issued = (adminId = 9, authVersion = 0) => jwt.sign({ adminId, type: 'admin', authVersion }, SECRET, { expiresIn: '1h' });
let versions: Map<number, number>;
let failRevocation: boolean;
let unknownRevocationResult: boolean;
let revocations: unknown[][];
let commitThenFail: boolean;
let failAdministrator: number | undefined;

beforeEach(() => {
  versions = new Map([[9, 0], [10, 0]]);
  failRevocation = false;
  unknownRevocationResult = false;
  revocations = [];
  commitThenFail = false;
  failAdministrator = undefined;
  const password_hash = bcrypt.hashSync('fixture-password', 4);
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async (sql: string, params: number[]) => {
      if (sql.startsWith('UPDATE admins SET auth_version')) {
        revocations.push(params);
        if (failRevocation || params[0] === failAdministrator) throw new Error('simulated database outage');
        if (unknownRevocationResult) return [{}];
        const matches = versions.get(params[0]) === params[1];
        if (matches) versions.set(params[0], params[1] + 1);
        if (commitThenFail) { commitThenFail = false; throw new Error('response lost after commit'); }
        return [{ affectedRows: matches ? 1 : 0 }];
      }
      if (sql.includes('FROM admins')) {
        const id = typeof params[0] === 'string' ? 9 : params[0];
        const version = versions.get(id);
        return [version === undefined ? [] : [{ admin_id: id, username: 'fixture', role_id: 1, status: 1, auth_version: version, password_hash }]];
      }
      if (sql.startsWith('UPDATE admins SET last_login_at')) return [{}];
      throw new Error('Unexpected SQL in isolated logout fixture');
    }),
  });
});

function app(session = issued(), receipt?: string) {
  const server = express();
  server.use(express.json());
  server.get('/fixture-session', (_req, res) => {
    res.cookie('admin_session', session, { httpOnly: true, path: '/api' });
    if (receipt) res.cookie(RETRY_COOKIE, receipt, { httpOnly: true, path: '/api/admin' });
    res.end();
  });
  server.get('/fixture-other-session', (_req, res) => {
    res.cookie('admin_session', issued(10), { httpOnly: true, path: '/api' });
    res.end();
  });
  server.post('/api/admin/login', adminLogin);
  server.post('/api/admin/logout', adminLogout);
  server.get('/api/admin/profile', authenticateAdmin, (req, res) => res.json({ adminId: req.admin?.adminId }));
  return server;
}

function receiptCookie(response: request.Response): string {
  return (response.headers['set-cookie'] as unknown as string[]).find(value => value.startsWith(`${RETRY_COOKIE}=`))!.split(';')[0];
}

function receiptClaims(cookie: string): jwt.JwtPayload {
  return jwt.verify(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)), SECRET) as jwt.JwtPayload;
}

function fixtureReceipt(targets = [{ adminId: 9, authVersion: 0 }], options: jwt.SignOptions = { expiresIn: '24h' }) {
  return jwt.sign({ type: 'admin-logout-retry', targets }, SECRET, options);
}

test('a browser retries failed logout after its normal cookie was cleared, and revokes every original copy', async () => {
  const session = issued();
  const server = app(session);
  const browser = request.agent(server);
  await browser.get('/fixture-session').expect(200);
  await browser.get('/api/admin/profile').expect(200);
  failRevocation = true;
  const failed = await browser.post('/api/admin/logout').set(csrf).expect(503);
  expect(failed.headers['set-cookie'][0]).toMatch(/^admin_session=;/);
  const retained = (failed.headers['set-cookie'] as unknown as string[]).find(value => value.startsWith(`${RETRY_COOKIE}=`))!;
  expect(retained).toContain('HttpOnly');
  expect(retained).toContain('SameSite=Lax');
  expect(retained).toContain('Path=/api/admin;');
  expect(retained).toMatch(/Max-Age=(86399|86400);/);
  await browser.get('/api/admin/profile').expect(401);
  // Only the browser jar's HttpOnly cookies survive navigation; no JWT is retained by page scripts.
  failRevocation = false;
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  expect(versions.get(9)).toBe(1);
  expect(revocations).toEqual([[9, 0], [9, 0]]);
  await request(server).get('/api/admin/profile').set('Cookie', `admin_session=${session}`).expect(401);
});

test('an unrecognized database result cannot acknowledge global revocation or discard retry state', async () => {
  const browser = request.agent(app());
  await browser.get('/fixture-session').expect(200);
  unknownRevocationResult = true;
  await browser.post('/api/admin/logout').set(csrf).expect(503);
  unknownRevocationResult = false;
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  expect(versions.get(9)).toBe(1);
});

test('a pending administrator A and a newly selected administrator B are both retained across another failure', async () => {
  const server = app();
  const browser = request.agent(server);
  await browser.get('/fixture-session').expect(200);
  failRevocation = true;
  await browser.post('/api/admin/logout').set(csrf).expect(503);
  await browser.get('/fixture-other-session').expect(200);
  const failed = await browser.post('/api/admin/logout').set(csrf).expect(503);
  expect(receiptClaims(receiptCookie(failed)).targets).toEqual([{ adminId: 9, authVersion: 0 }, { adminId: 10, authVersion: 0 }]);
  await browser.get('/api/admin/profile').expect(401);
  failRevocation = false;
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  expect(versions).toEqual(new Map([[9, 1], [10, 1]]));
  for (const id of [9, 10]) await request(server).get('/api/admin/profile').set('Cookie', `admin_session=${issued(id)}`).expect(401);
});

test('a committed revocation with a lost response can be retried without invalidating a newer session', async () => {
  const server = app();
  const browser = request.agent(server);
  await browser.get('/fixture-session').expect(200);
  commitThenFail = true;
  const failed = await browser.post('/api/admin/logout').set(csrf).expect(503);
  const retained = receiptCookie(failed);
  expect(versions.get(9)).toBe(1);
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  await request(server).post('/api/admin/logout').set('Cookie', retained).set(csrf).expect(200);
  expect(versions.get(9)).toBe(1);
  await request(server).get('/api/admin/profile').set('Cookie', `admin_session=${issued(9, 1)}`).expect(200);
});

test('a partial multi-administrator revocation keeps both targets until the remaining one is confirmed', async () => {
  const browser = request.agent(app(issued(10), fixtureReceipt()));
  await browser.get('/fixture-session').expect(200);
  failAdministrator = 10;
  const failed = await browser.post('/api/admin/logout').set(csrf).expect(503);
  expect(versions).toEqual(new Map([[9, 1], [10, 0]]));
  expect(receiptClaims(receiptCookie(failed)).targets).toEqual([{ adminId: 9, authVersion: 0 }, { adminId: 10, authVersion: 0 }]);
  failAdministrator = undefined;
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  expect(versions).toEqual(new Map([[9, 1], [10, 1]]));
  expect(revocations).toEqual([[9, 0], [10, 0], [9, 0], [10, 0]]);
});

test('when a newer normal session coexists with a stale receipt, explicit logout also revokes the selected newer version', async () => {
  versions.set(9, 1);
  const browser = request.agent(app(issued(9, 1), fixtureReceipt()));
  await browser.get('/fixture-session').expect(200);
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  expect(versions.get(9)).toBe(2);
  expect(revocations).toEqual([[9, 0], [9, 1]]);
});

test('repeated failed retries do not extend the receipt lifetime', async () => {
  const browser = request.agent(app());
  await browser.get('/fixture-session').expect(200);
  failRevocation = true;
  const first = receiptClaims(receiptCookie(await browser.post('/api/admin/logout').set(csrf).expect(503)));
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 60_000);
  try {
    const second = receiptClaims(receiptCookie(await browser.post('/api/admin/logout').set(csrf).expect(503)));
    expect(second.exp).toBe(first.exp);
    expect(second.iat).toBe(first.iat);
  } finally { clock.mockRestore(); }
});

test('when the browser receipt expires, even the latest pre-logout 24-hour session copy has expired', async () => {
  const session = jwt.sign({ adminId: 9, type: 'admin', authVersion: 0 }, SECRET, { expiresIn: '24h' });
  const server = app(session);
  const browser = request.agent(server);
  await browser.get('/fixture-session').expect(200);
  failRevocation = true;
  const receipt = receiptClaims(receiptCookie(await browser.post('/api/admin/logout').set(csrf).expect(503)));
  const clock = jest.spyOn(Date, 'now').mockReturnValue((receipt.exp! + 1) * 1000);
  try {
    failRevocation = false;
    await browser.post('/api/admin/logout').set(csrf).expect(200);
    expect(revocations).toEqual([[9, 0]]);
    await request(server).get('/api/admin/profile').set('Cookie', `admin_session=${session}`).expect(401);
  } finally { clock.mockRestore(); }
});

test.each([
  ['tampered', jwt.sign({ type: 'admin-logout-retry', targets: [{ adminId: 9, authVersion: 0 }] }, 'wrong-secret', { expiresIn: '24h' })],
  ['wrong purpose', jwt.sign({ type: 'admin', targets: [{ adminId: 9, authVersion: 0 }] }, SECRET, { expiresIn: '24h' })],
  ['expired', fixtureReceipt(undefined, { expiresIn: -10 })],
  ['invalid target', fixtureReceipt([{ adminId: 9, authVersion: -1 }])],
])('%s receipt cannot revoke an administrator', async (_description, receipt) => {
  const server = app();
  await request(server).post('/api/admin/logout').set('Cookie', `${RETRY_COOKIE}=${receipt}`).set(csrf).expect(200);
  expect(revocations).toEqual([]);
  expect(versions.get(9)).toBe(0);
});

test('a receipt cannot authenticate from its own cookie, the admin cookie, or a Bearer header', async () => {
  const server = app();
  const receipt = fixtureReceipt();
  await request(server).get('/api/admin/profile').set('Cookie', `${RETRY_COOKIE}=${receipt}`).expect(401);
  await request(server).get('/api/admin/profile').set('Cookie', `admin_session=${receipt}`).expect(403);
  await request(server).get('/api/admin/profile').set('Authorization', `Bearer ${receipt}`).expect(403);
  expect(revocations).toEqual([]);
});

test.each([
  {},
  { ...csrf, Origin: 'https://untrusted.example' },
  { ...csrf, 'Sec-Fetch-Site': 'cross-site' },
])('a retry still requires a trusted source: %p', async headers => {
  const response = await request(app()).post('/api/admin/logout').set('Cookie', `${RETRY_COOKIE}=${fixtureReceipt()}`).set(headers).expect(403);
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(revocations).toEqual([]);
});

test('a successful new login settles a pending receipt before issuing the fresh auth version', async () => {
  const browser = request.agent(app(issued(), fixtureReceipt()));
  await browser.get('/fixture-session').expect(200);
  await browser.post('/api/admin/login').set(csrf).send({ username: 'fixture', password: 'fixture-password' }).expect(200);
  expect(versions.get(9)).toBe(1);
  await browser.get('/api/admin/profile').expect(200);
  expect(revocations).toEqual([[9, 0]]);
});

test('a failed pending cleanup cannot be overwritten by a new login, or by invalid credentials', async () => {
  const browser = request.agent(app(issued(), fixtureReceipt()));
  await browser.get('/fixture-session').expect(200);
  failRevocation = true;
  await browser.post('/api/admin/login').set(csrf).send({ username: 'fixture', password: 'wrong-password' }).expect(401);
  expect(revocations).toEqual([]);
  const failed = await browser.post('/api/admin/login').set(csrf).send({ username: 'fixture', password: 'fixture-password' }).expect(503);
  expect(failed.body.error).toBe('退出尚未完成，请重试');
  expect(failed.headers['set-cookie']).toBeUndefined();
  failRevocation = false;
  await browser.post('/api/admin/logout').set(csrf).expect(200);
  expect(versions.get(9)).toBe(1);
});

test('a capacity guard preserves every existing target and the normal credential instead of claiming local logout', async () => {
  let receipt = '';
  for (let count = 1; count <= 100; count++) {
    const candidate = fixtureReceipt(Array.from({ length: count }, (_, index) => ({ adminId: index + 1, authVersion: 0 })));
    if (Buffer.byteLength(candidate) > 3000) break;
    receipt = candidate;
  }
  const id = Number.MAX_SAFE_INTEGER;
  versions.set(id, 0);
  const browser = request.agent(app(issued(id), receipt));
  await browser.get('/fixture-session').expect(200);
  const refused = await browser.post('/api/admin/logout').set(csrf).expect(503);
  expect(refused.body.error).toBe('退出尚未完成，请重试');
  expect(refused.headers['set-cookie']).toBeUndefined();
  expect(revocations).toEqual([]);
  await browser.get('/api/admin/profile').expect(200);
});
