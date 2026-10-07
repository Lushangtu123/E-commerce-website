import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRoutes from '../../routes/admin.routes';
import { getPool } from '../../database/mysql';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../controllers/admin-dashboard.controller', () => {
  const handler = (_req: unknown, res: { json(value: unknown): unknown }) => res.json({ allowed: true });
  return { getDashboardStats: handler, getRecentOrders: handler, getTopProducts: handler, getSalesTrend: handler };
});

let permissions: string[];
let role: string;
beforeEach(() => {
  permissions = []; role = 'product_admin';
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM admins')) return [[{ admin_id: 2, username: 'limited', role_id: 2, status: 1, auth_version: 0 }]];
    if (sql.includes('FROM role_permissions')) return [permissions.map(permission_code => ({ permission_code }))];
    if (sql.includes('FROM roles')) return [[{ role_name: role }]];
    throw new Error('Unexpected authorization query');
  }) });
});

function app() {
  const server = express(); server.use('/api/admin', adminRoutes); return server;
}
const authorization = () => `Bearer ${jwt.sign({ adminId: 2, type: 'admin', authVersion: 0 }, 'test-jwt-secret')}`;
const statistics = ['/dashboard/stats', '/dashboard/top-products', '/dashboard/sales-trend'];

test.each([...statistics, '/dashboard/recent-orders'])('%s rejects an unauthenticated caller', async path => {
  await request(app()).get('/api/admin' + path).expect(401);
});
test.each([...statistics, '/dashboard/recent-orders'])('%s denies an administrator with no relevant permission', async path => {
  await request(app()).get('/api/admin' + path).set('Authorization', authorization()).expect(403);
});
test('an order viewer can read recent orders but cannot read sales statistics', async () => {
  role = 'order_admin'; permissions = ['order:view'];
  await request(app()).get('/api/admin/dashboard/recent-orders').set('Authorization', authorization()).expect(200);
  for (const path of statistics) await request(app()).get('/api/admin' + path).set('Authorization', authorization()).expect(403);
});
test('an analyst can read statistics but cannot read customer order details', async () => {
  role = 'data_analyst'; permissions = ['statistics:view'];
  for (const path of statistics) await request(app()).get('/api/admin' + path).set('Authorization', authorization()).expect(200);
  await request(app()).get('/api/admin/dashboard/recent-orders').set('Authorization', authorization()).expect(403);
});
test.each([...statistics, '/dashboard/recent-orders'])('%s remains available to a super administrator', async path => {
  role = 'super_admin';
  await request(app()).get('/api/admin' + path).set('Authorization', authorization()).expect(200);
});
