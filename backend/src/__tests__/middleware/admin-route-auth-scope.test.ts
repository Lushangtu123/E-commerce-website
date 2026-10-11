import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRoutes from '../../routes/admin.routes';
import adminCouponRoutes from '../../routes/admin-coupon.routes';
import { getPool } from '../../database/mysql';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../controllers/admin.controller', () => ({
  adminLogin: (_req: unknown, res: express.Response) => res.json({ public: 'login' }),
  adminLogout: (_req: unknown, res: express.Response) => res.json({ public: 'logout' }),
  getAdminProfile: (_req: unknown, res: express.Response) => res.json({ allowed: true }),
}));
jest.mock('../../controllers/admin-dashboard.controller', () => {
  const handler = (_req: unknown, res: express.Response) => res.json({ allowed: true });
  return { getDashboardStats: handler, getRecentOrders: handler, getTopProducts: handler, getSalesTrend: handler };
});
jest.mock('../../controllers/admin-log.controller', () => ({
  getAdminLogs: (_req: unknown, res: express.Response) => res.json({ allowed: true }),
}));
jest.mock('../../controllers/admin-coupon.controller', () => {
  const handler = (_req: unknown, res: express.Response) => res.json({ allowed: true });
  return { AdminCouponController: {
    createCoupon: handler, getCouponList: handler, getCouponDetail: handler,
    getCouponByCode: handler, updateCouponStatus: handler,
  } };
});
jest.mock('../../middleware/rate-limit', () => ({
  authLimiter: (_req: unknown, _res: unknown, next: express.NextFunction) => next(),
}));

let admin: { admin_id: number; username: string; role_id: number; status: number; auth_version: number };
let permissions: string[];
let role: string;
let query: jest.Mock;
let failDatabase: boolean;
const verification = jest.spyOn(jwt, 'verify');
const identityReads = () => query.mock.calls.filter(([sql]: [string]) => sql.includes('FROM admins')).length;
const authorization = () => `Bearer ${jwt.sign({ adminId: 2, type: 'admin', authVersion: 0, roleId: 1 }, 'test-jwt-secret')}`;

function app() {
  const server = express();
  // Match the production mount order: the broad router precedes specialty routers.
  server.use('/api/admin', adminRoutes);
  server.use('/api/admin/coupons', adminCouponRoutes);
  return server;
}

beforeEach(() => {
  verification.mockClear(); failDatabase = false;
  admin = { admin_id: 2, username: 'limited', role_id: 4, status: 1, auth_version: 0 };
  permissions = ['coupon:view', 'coupon:create', 'statistics:view', 'order:view', 'log:view'];
  role = 'limited_admin';
  query = jest.fn(async (sql: string) => {
    if (failDatabase) throw new Error('Database unavailable');
    if (sql.includes('FROM admins')) return [[{ ...admin }]];
    if (sql.includes('FROM role_permissions')) return [permissions.map(permission_code => ({ permission_code }))];
    if (sql.includes('FROM roles')) return [[{ role_name: role }]];
    throw new Error('Unexpected authorization query');
  });
  (getPool as jest.Mock).mockReturnValue({ query });
});
afterAll(() => verification.mockRestore());

test('a specialty request validates the JWT and administrator exactly once', async () => {
  const response = await request(app()).get('/api/admin/coupons').set('Authorization', authorization()).expect(200);
  expect(response.body).toEqual({ allowed: true });
  expect(identityReads()).toBe(1);
  expect(verification).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(3); // identity, current permissions, current role
});

test.each(['/profile', '/dashboard/stats', '/dashboard/recent-orders', '/dashboard/top-products', '/dashboard/sales-trend', '/logs'])('%s retains its own administrator guard', async path => {
  await request(app()).get('/api/admin' + path).expect(401);
  expect(query).not.toHaveBeenCalled();
  await request(app()).get('/api/admin' + path).set('Authorization', authorization()).expect(200);
  expect(identityReads()).toBe(1);
  expect(verification).toHaveBeenCalledTimes(1);
});

test.each(['login', 'logout'])('%s still reaches its public session handler', async path => {
  const response = await request(app()).post('/api/admin/' + path).expect(200);
  expect(response.body).toEqual({ public: path });
  expect(query).not.toHaveBeenCalled();
  expect(verification).not.toHaveBeenCalled();
});

test('a specialty route still rejects missing credentials before accessing the database', async () => {
  await request(app()).get('/api/admin/coupons').expect(401);
  expect(query).not.toHaveBeenCalled();
});

test.each(['revoked', 'disabled'] as const)('a %s administrator is rejected on the next request', async condition => {
  const bearer = authorization();
  await request(app()).get('/api/admin/coupons').set('Authorization', bearer).expect(200);
  query.mockClear();
  if (condition === 'revoked') admin.auth_version = 1;
  else admin.status = 0;
  await request(app()).get('/api/admin/coupons').set('Authorization', bearer).expect(condition === 'revoked' ? 401 : 403);
  expect(identityReads()).toBe(1);
  expect(query).toHaveBeenCalledTimes(1);
});

test('permissions and role are read again rather than inherited from a previous request or token', async () => {
  const bearer = authorization();
  await request(app()).get('/api/admin/coupons').set('Authorization', bearer).expect(200);
  permissions = [];
  await request(app()).get('/api/admin/coupons').set('Authorization', bearer).expect(403);
  role = 'super_admin';
  await request(app()).get('/api/admin/coupons').set('Authorization', bearer).expect(200);
  expect(query.mock.calls.some(([sql, params]: [string, number[]]) => sql.includes('FROM role_permissions') && params[0] === 4)).toBe(true);
});

test('expected administrator identity remains a constraint on the authenticated session', async () => {
  await request(app()).get('/api/admin/coupons').set('Authorization', authorization()).set('X-Expected-Admin-Id', '3').expect(409);
  expect(query).toHaveBeenCalledTimes(1);
});

test('specialty cookie writes still require the CSRF header', async () => {
  const cookie = `admin_session=${authorization().slice('Bearer '.length)}`;
  await request(app()).post('/api/admin/coupons').set('Cookie', cookie).expect(403);
  expect(query).not.toHaveBeenCalled();
  await request(app()).post('/api/admin/coupons').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(200);
  expect(identityReads()).toBe(1);
});

test('an authentication database failure cannot reach a specialty controller', async () => {
  failDatabase = true;
  const response = await request(app()).get('/api/admin/coupons').set('Authorization', authorization()).expect(500);
  expect(response.body).toEqual({ error: '认证失败' });
});
