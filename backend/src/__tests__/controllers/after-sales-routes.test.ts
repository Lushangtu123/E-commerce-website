import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
jest.mock('../../services/after-sales.service', () => ({
  getAfterSales: jest.fn(), createAfterSales: jest.fn(), withdrawAfterSales: jest.fn(), reviewAfterSales: jest.fn(), listAfterSales: jest.fn(),
  submitReturnTracking: jest.fn(), completeAfterSales: jest.fn(), getAfterSalesById: jest.fn(),
  validAfterSalesId: (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0,
  AfterSalesError: class extends Error { constructor(message: string, public statusCode = 400) { super(message); } },
}));
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../models/user.model', () => ({ UserModel: { getAuthVersion: jest.fn().mockResolvedValue(0) } }));
import * as service from '../../services/after-sales.service';
import { getPool } from '../../database/mysql';
const detail = (): jest.Mock => require('../../services/after-sales.service').getAfterSalesById;
let allowed: boolean;
const app = () => {
  const application = express(); application.use(express.json());
  application.use('/api/orders', require('../../routes/after-sales.routes').default);
  application.use('/api/admin/after-sales', require('../../routes/admin-after-sales.routes').default);
  return application;
};
const customer = () => ({ Authorization: `Bearer ${jwt.sign({ userId: 7 }, 'test-jwt-secret')}` });
const admin = () => ({ Authorization: `Bearer ${jwt.sign({ type: 'admin', adminId: 2 }, 'test-jwt-secret')}` });
beforeEach(() => {
  jest.clearAllMocks(); allowed = true;
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM admins')) return [[{ admin_id: 2, username: 'operator', role_id: 2, status: 1 }], []];
    if (sql.includes('FROM role_permissions')) return [allowed ? [{ permission_code: 'order:view' }, { permission_code: 'order:edit' }] : [], []];
    if (sql.includes('FROM roles')) return [[{ role_name: 'operator' }], []];
    return [[], []];
  }) });
  (service.getAfterSales as jest.Mock).mockResolvedValue(null);
  (service.createAfterSales as jest.Mock).mockResolvedValue({ request_id: 9, status: 'requested' });
  (service.withdrawAfterSales as jest.Mock).mockResolvedValue({ request_id: 9, status: 'withdrawn' });
  (service.listAfterSales as jest.Mock).mockResolvedValue({ requests: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  (service.reviewAfterSales as jest.Mock).mockResolvedValue({ request_id: 9, status: 'approved' });
  (service.submitReturnTracking as jest.Mock).mockResolvedValue({ request_id: 9, status: 'approved' });
  (service.completeAfterSales as jest.Mock).mockResolvedValue({ request_id: 9, status: 'approved' });
  (detail() as jest.Mock).mockResolvedValue({ request_id: 9, status: 'requested' });
});

test('admin request detail requires authentication and order view permission', async () => {
  await request(app()).get('/api/admin/after-sales/9').expect(401);
  await request(app()).get('/api/admin/after-sales/9').set(customer()).expect(403);
  allowed = false;
  await request(app()).get('/api/admin/after-sales/9').set(admin()).expect(403);
  expect(detail()).not.toHaveBeenCalled();
  allowed = true;
  await request(app()).get('/api/admin/after-sales/9').set(admin()).expect(200, { after_sales: { request_id: 9, status: 'requested' } });
  expect(detail()).toHaveBeenCalledWith(9);
});
test.each(['0', '-1', '1e2', '999999999999999999999'])('admin request detail rejects invalid path ID %s', async id => {
  await request(app()).get(`/api/admin/after-sales/${id}`).set(admin()).expect(400);
  expect(detail()).not.toHaveBeenCalled();
});
test('admin request detail maps missing records and hides internal errors', async () => {
  (detail() as jest.Mock).mockRejectedValue(new service.AfterSalesError('售后申请不存在', 404));
  await request(app()).get('/api/admin/after-sales/9').set(admin()).expect(404, { error: '售后申请不存在' });
  (detail() as jest.Mock).mockRejectedValue(new Error('database private detail'));
  await request(app()).get('/api/admin/after-sales/9').set(admin()).expect(500, { error: '获取售后申请失败' });
});

test('return tracking requires customer authentication and forwards the authenticated owner', async () => {
  const body = { company: 'carrier', tracking_number: 'return123' };
  await request(app()).post('/api/orders/10/after-sales/return-tracking').send(body).expect(401);
  await request(app()).post('/api/orders/10/after-sales/return-tracking').set(admin()).send(body).expect(401);
  await request(app()).post('/api/orders/10/after-sales/return-tracking').set(customer()).send(body).expect(200);
  expect(service.submitReturnTracking).toHaveBeenCalledTimes(1);
  expect(service.submitReturnTracking).toHaveBeenCalledWith(7, 10, body);
});
test('manual completion requires order edit permission and passes audit context without claiming a payment', async () => {
  const body = { refund_amount: '0.00', note: 'demo' };
  await request(app()).post('/api/admin/after-sales/9/complete').send(body).expect(401);
  allowed = false;
  await request(app()).post('/api/admin/after-sales/9/complete').set(admin()).send(body).expect(403);
  expect(service.completeAfterSales).not.toHaveBeenCalled();
  allowed = true;
  const response = await request(app()).post('/api/admin/after-sales/9/complete').set(admin()).set('User-Agent', 'test-agent').send(body).expect(200);
  expect(service.completeAfterSales).toHaveBeenCalledWith(2, 9, body, expect.objectContaining({ userAgent: 'test-agent' }));
  expect(response.body.message).toContain('记录');
  expect(response.body.message).not.toContain('退款成功');
});

test('customer after-sales routes require user JWT, including reads', async () => {
  await request(app()).get('/api/orders/10/after-sales').expect(401);
  await request(app()).post('/api/orders/10/after-sales').set(admin()).send({ type: 'return', reason: 'test' }).expect(401);
  expect(service.getAfterSales).not.toHaveBeenCalled();
  expect(service.createAfterSales).not.toHaveBeenCalled();
});

test('customer can read, request and withdraw own after-sales using authenticated user ID', async () => {
  const application = app();
  await request(application).get('/api/orders/10/after-sales').set(customer()).expect(200, { after_sales: null });
  await request(application).post('/api/orders/10/after-sales').set(customer()).send({ type: 'return', reason: 'test' }).expect(201);
  expect(service.createAfterSales).toHaveBeenCalledWith(7, 10, { type: 'return', reason: 'test' });
  await request(application).post('/api/orders/10/after-sales/withdraw').set(customer()).send({}).expect(200);
  expect(service.withdrawAfterSales).toHaveBeenCalledWith(7, 10);
});

test.each(['0', '1e2', '999999999999999999999', '-1'])('rejects invalid route order ID %s', async id => {
  await request(app()).get(`/api/orders/${id}/after-sales`).set(customer()).expect(400);
  expect(service.getAfterSales).not.toHaveBeenCalled();
});

test('ownership/service errors preserve their status without internal details', async () => {
  (service.getAfterSales as jest.Mock).mockRejectedValue(new service.AfterSalesError('订单不存在', 404));
  await request(app()).get('/api/orders/10/after-sales').set(customer()).expect(404, { error: '订单不存在' });
  (service.getAfterSales as jest.Mock).mockRejectedValue(new Error('password=secret'));
  await request(app()).get('/api/orders/10/after-sales').set(customer()).expect(500, { error: '获取售后申请失败' });
});

test('admin after-sales routes require authentication and correct permissions', async () => {
  const application = app();
  await request(application).get('/api/admin/after-sales').expect(401);
  await request(application).get('/api/admin/after-sales').set(customer()).expect(403);
  allowed = false;
  await request(application).get('/api/admin/after-sales').set(admin()).expect(403);
  await request(application).post('/api/admin/after-sales/9/review').set(admin()).send({ status: 'approved', note: 'test' }).expect(403);
  expect(service.reviewAfterSales).not.toHaveBeenCalled();
});

test('admin review forwards actor and audit context, and says review rather than refund', async () => {
  const response = await request(app()).post('/api/admin/after-sales/9/review').set(admin()).set('User-Agent', 'test-agent')
    .send({ status: 'approved', note: 'test' }).expect(200);
  expect(service.reviewAfterSales).toHaveBeenCalledWith(2, 9, { status: 'approved', note: 'test' }, expect.objectContaining({ userAgent: 'test-agent' }));
  expect(response.body.message).toContain('审核');
  expect(response.body.message).not.toContain('退款成功');
});
