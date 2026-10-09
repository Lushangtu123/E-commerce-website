import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminCouponRoutes from '../../routes/admin-coupon.routes';
import { getPool } from '../../database/mysql';
import runAdminMigrations from '../../database/admin-migrate';
import { CouponModel } from '../../models/coupon.model';
import { logAdminAction } from '../../controllers/admin-log.controller';

jest.mock('../../database/mysql', () => ({ connectDatabase: jest.fn(), getPool: jest.fn() }));
jest.mock('../../models/coupon.model', () => ({
  CouponModel: {
    getList: jest.fn(), findById: jest.fn(), findByCode: jest.fn(),
    create: jest.fn(), updateStatus: jest.fn(),
  },
  CouponStatus: { DISABLED: 0, ENABLED: 1 },
}));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));

const coupon = {
  coupon_id: 7, code: 'TEST', name: '测试券', description: null, type: 3,
  discount_value: 10, min_amount: 0, max_discount: null, total_quantity: 100,
  remain_quantity: 100, per_user_limit: 1, status: 1,
  start_time: new Date('2026-01-01'), end_time: new Date('2027-01-01'),
  created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
};
const createBody = {
  code: 'TEST', name: '测试券', type: 3, discount_value: 10, total_quantity: 100,
  start_time: '2026-01-01', end_time: '2027-01-01',
};
const endpoints = [
  { method: 'get', path: '/', permission: 'coupon:view' },
  { method: 'get', path: '/7', permission: 'coupon:view' },
  { method: 'get', path: '/by-code/TEST', permission: 'coupon:view' },
  { method: 'post', path: '/', permission: 'coupon:create' },
  { method: 'put', path: '/7/status', permission: 'coupon:edit' },
] as const;
type Endpoint = typeof endpoints[number];

let permissions: string[];
let role: string;
let admin: { admin_id: number; username: string; role_id: number | null; status: number; auth_version: number };

beforeEach(() => {
  jest.clearAllMocks();
  permissions = [];
  role = 'data_analyst';
  admin = { admin_id: 2, username: 'limited', role_id: 4, status: 1, auth_version: 0 };
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM admins')) return [[admin]];
    if (sql.includes('FROM role_permissions')) return [permissions.map(permission_code => ({ permission_code }))];
    if (sql.includes('FROM roles')) return [admin.role_id === null ? [] : [{ role_name: role }]];
    throw new Error('Unexpected authorization query');
  }) });
  (CouponModel.getList as jest.Mock).mockResolvedValue({ coupons: [coupon], total: 1 });
  (CouponModel.findById as jest.Mock).mockResolvedValue(coupon);
  (CouponModel.findByCode as jest.Mock).mockResolvedValue(null);
  (CouponModel.create as jest.Mock).mockResolvedValue(7);
  (CouponModel.updateStatus as jest.Mock).mockResolvedValue(true);
  (logAdminAction as jest.Mock).mockResolvedValue(undefined);
});

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/admin/coupons', adminCouponRoutes);
  return server;
}

const authorization = () => `Bearer ${jwt.sign({
  adminId: 2, type: 'admin', authVersion: 0, roleId: 1,
}, 'test-jwt-secret')}`;

function call(endpoint: Endpoint, bearer: string | null = authorization()) {
  const operation = request(app())[endpoint.method]('/api/admin/coupons' + endpoint.path);
  if (bearer) operation.set('Authorization', bearer);
  if (endpoint.method === 'post') operation.send(createBody);
  if (endpoint.method === 'put') operation.send({ status: 0 });
  return operation;
}

function expectNoCouponAccess() {
  for (const method of [CouponModel.getList, CouponModel.findById, CouponModel.findByCode, CouponModel.create, CouponModel.updateStatus]) {
    expect(method).not.toHaveBeenCalled();
  }
  expect(logAdminAction).not.toHaveBeenCalled();
}

test.each(endpoints)('$method $path rejects an unauthenticated caller', async endpoint => {
  await call(endpoint, null).expect(401);
  expectNoCouponAccess();
});

test.each([
  ['product_admin', 2], ['order_admin', 3], ['data_analyst', 4], ['roleless', null],
] as const)('%s has no default coupon permissions', async (name, id) => {
  role = name; admin.role_id = id;
  for (const endpoint of endpoints) await call(endpoint).expect(403);
  expectNoCouponAccess();
});

test.each(['coupon:view', 'coupon:create', 'coupon:edit'])('%s permits only its own operation', async permission => {
  permissions = [permission];
  for (const endpoint of endpoints) {
    jest.clearAllMocks();
    const permitted = endpoint.permission === permission;
    const response = await call(endpoint).expect(permitted ? 200 : 403);
    if (!permitted) {
      expectNoCouponAccess();
    } else {
      expect(response.body.success).toBe(true);
      if (endpoint.method === 'post') {
        expect(CouponModel.create).toHaveBeenCalledTimes(1);
        expect(CouponModel.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'TEST' }),
          { adminId: 2, ip: expect.any(String), userAgent: undefined });
      } else if (endpoint.method === 'put') {
        expect(CouponModel.updateStatus).toHaveBeenCalledWith(7, 0, { adminId: 2, ip: expect.any(String), userAgent: undefined });
      } else {
        expect(CouponModel.create).not.toHaveBeenCalled();
        expect(CouponModel.updateStatus).not.toHaveBeenCalled();
        expect(logAdminAction).not.toHaveBeenCalled();
      }
    }
  }
});

test('unrelated permissions and a stale super-admin role claim do not allow coupon access', async () => {
  admin.role_id = 1;
  permissions = ['product:create', 'product:edit', 'order:edit', 'statistics:view'];
  for (const endpoint of endpoints) await call(endpoint).expect(403);
  expectNoCouponAccess();
});

test('existing super administrators need no coupon permission rows', async () => {
  role = 'super_admin'; admin.role_id = 7;
  for (const endpoint of endpoints) await call(endpoint).expect(200);
  expect(CouponModel.create).toHaveBeenCalledTimes(1);
  expect(CouponModel.updateStatus).toHaveBeenCalledWith(7, 0, { adminId: 2, ip: expect.any(String), userAgent: undefined });
  expect(logAdminAction).not.toHaveBeenCalled();
});

test.each(endpoints)('$method $path rejects disabled super administrators before coupon access', async endpoint => {
  role = 'super_admin'; admin.status = 0;
  await call(endpoint).expect(403);
  expectNoCouponAccess();
});

test.each(endpoints)('$method $path rejects revoked super-admin sessions before coupon access', async endpoint => {
  role = 'super_admin'; admin.auth_version = 1;
  await call(endpoint).expect(401);
  expectNoCouponAccess();
});

test('coupon initialization defines permissions and grants defaults by super-admin role name', async () => {
  const env = { ...process.env };
  const connection = { query: jest.fn().mockResolvedValue([[]]), release: jest.fn() };
  (getPool as jest.Mock).mockReturnValue({ getConnection: async () => connection });
  try {
    process.env.NODE_ENV = 'production'; delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    await runAdminMigrations();
    const statements = connection.query.mock.calls.map(([sql]) => sql as string);
    const permissionSeed = statements.find(sql => sql.includes('INSERT IGNORE INTO permissions'))!;
    for (const permission of ['coupon:view', 'coupon:create', 'coupon:edit']) expect(permissionSeed).toContain(`'${permission}'`);
    const grants = statements.filter(sql => sql.includes('INSERT IGNORE INTO role_permissions'));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/SELECT\s+r\.role_id,\s*p\.permission_id/);
    expect(grants[0]).toMatch(/WHERE\s+r\.role_name\s*=\s*'super_admin'/);
    expect(connection.release).toHaveBeenCalledTimes(1);
  } finally { process.env = env; }
});
