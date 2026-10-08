jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../services/order.service', () => ({
  transitionOrder: jest.fn(), invalidateOrderProductCache: jest.fn(),
  OrderError: class extends Error { statusCode = 400; },
}));
jest.mock('../../services/message-queue.service', () => ({ sendOrderTimeoutCheckMessage: jest.fn() }));
jest.mock('../../services/order-timeout.service', () => ({ getOrderRemainingTime: jest.fn(async () => 10) }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import { transitionOrder, invalidateOrderProductCache } from '../../services/order.service';
import { getOrderRemainingTime } from '../../services/order-timeout.service';
import { logAdminAction } from '../../controllers/admin-log.controller';
import { getAdminOrderDetail, updateOrderStatus } from '../../controllers/admin-order.controller';
import orderRoutes from '../../routes/order.routes';

const app = express(); app.use(express.json()); app.use('/orders', orderRoutes);
// Admin role checks have separate route tests; this router isolates the ID boundary.
app.use('/admin/orders', (req, _res, next) => { (req as any).admin = { adminId: 1 }; next(); });
app.get('/admin/orders/:orderId', getAdminOrderDetail);
app.put('/admin/orders/:orderId/status', updateOrderStatus);
const auth = { Authorization: `Bearer ${jwt.sign({ userId: 7 }, 'test-jwt-secret')}` };
const order = (id: number) => ({ order_id: id, user_id: 7, status: 0, created_at: new Date('2026-10-02T00:00:00Z') });
const pool = { query: jest.fn(async (sql: string, values: number[]) => sql.includes('FROM orders') ? [[order(values[0])]] : [[]]) };
const endpoints = [
  ['get', '/orders/ID'], ['get', '/orders/ID/remaining-time'],
  ['post', '/orders/ID/cancel'], ['post', '/orders/ID/pay'], ['post', '/orders/ID/confirm'],
  ['get', '/admin/orders/ID'], ['put', '/admin/orders/ID/status'],
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PAYMENT_MODE = 'demo';
  (getPool as jest.Mock).mockReturnValue(pool);
  (query as jest.Mock).mockImplementation(async (sql: string, values: number[]) =>
    sql.startsWith('SELECT auth_version') ? [{ auth_version: 0, status: 1 }]
      : sql.includes('FROM orders') ? [order(values[0])] : []);
  (transitionOrder as jest.Mock).mockResolvedValue({ productIds: [], orderNo: 'ID-TEST' });
});

const invalidIds = ['1e3', '1abc', '0', '-1', '01', '+1', '1.5', '0x10', ' 1', '1 ', '1\n', '１', 'NaN', 'Infinity', '9007199254740992'];
test.each(endpoints)('%s %s rejects malformed IDs before reading or mutating data', async (method, template) => {
  for (const id of invalidIds) {
    jest.clearAllMocks();
    const route = template.replace('ID', encodeURIComponent(id));
    const result = await request(app)[method](route).set(auth).send(method === 'put' ? { status: 4 } : undefined);
    expect({ route, status: result.status, body: result.body }).toEqual({ route, status: 400, body: { error: '订单ID无效' } });
    expect((query as jest.Mock).mock.calls.filter(([sql]) => !sql.startsWith('SELECT auth_version'))).toHaveLength(0);
    expect(getPool).not.toHaveBeenCalled();
    expect(transitionOrder).not.toHaveBeenCalled();
    expect(getOrderRemainingTime).not.toHaveBeenCalled();
    expect(invalidateOrderProductCache).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  }
});

test.each(endpoints)('%s %s accepts ordinary and safe BIGINT IDs consistently', async (method, template) => {
  for (const id of ['1', '2147483648', '9007199254740991']) {
    jest.clearAllMocks();
    const result = await request(app)[method](template.replace('ID', id)).set(auth).send(method === 'put' ? { status: 4 } : undefined);
    expect(result.status).toBe(200);
    if (method === 'get' && template.startsWith('/orders')) {
      expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM orders'), [Number(id)]);
    } else if (method === 'get') {
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM orders'), [Number(id)]);
    } else {
      expect(transitionOrder).toHaveBeenCalledWith(Number(id), expect.any(Number), expect.any(Object));
    }
  }
});

test('malformed payment ID still returns 400 when payment is disabled; a valid ID remains disabled', async () => {
  process.env.PAYMENT_MODE = 'disabled';
  await request(app).post('/orders/1e3/pay').set(auth).expect(400);
  await request(app).post('/orders/1/pay').set(auth).expect(503);
  expect(transitionOrder).not.toHaveBeenCalled();
});

test('missing or forbidden valid orders retain their existing errors', async () => {
  (query as jest.Mock).mockImplementation(async (sql: string) => sql.startsWith('SELECT auth_version') ? [{ auth_version: 0, status: 1 }] : []);
  await request(app).get('/orders/99').set(auth).expect(404);
  (query as jest.Mock).mockImplementation(async (sql: string) => sql.startsWith('SELECT auth_version') ? [{ auth_version: 0, status: 1 }] : [{ ...order(99), user_id: 8 }]);
  await request(app).get('/orders/99').set(auth).expect(403);
});
