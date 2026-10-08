import express from 'express';
import request from 'supertest';
jest.mock('../../services/order-timeout.service', () => ({ checkAndCancelTimeoutOrders: jest.fn() }));
import jobs from '../../routes/internal.routes';
import { checkAndCancelTimeoutOrders } from '../../services/order-timeout.service';

const app = express(); app.use('/api/internal', jobs);
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'a'.repeat(64);
  (checkAndCancelTimeoutOrders as jest.Mock).mockResolvedValue({ checked: 0, cancelled: 0, failed: 0, skipped: 0 });
});
afterEach(() => { delete process.env.CRON_SECRET; });

test('订单定时任务拒绝缺失或错误的密钥，仅接受授权的 POST', async () => {
  await request(app).post('/api/internal/order-timeouts').expect(401);
  await request(app).post('/api/internal/order-timeouts').set('Authorization', 'Bearer wrong').expect(401);
  expect(checkAndCancelTimeoutOrders).not.toHaveBeenCalled();
  const response = await request(app).post('/api/internal/order-timeouts').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(200);
  expect(response.body).toEqual({ checked: 0, cancelled: 0, failed: 0, skipped: 0 });
  expect(checkAndCancelTimeoutOrders).toHaveBeenCalledWith(50);
  await request(app).get('/api/internal/order-timeouts').expect(404);
});

test('逐单取消部分失败返回503及完整批次计数', async () => {
  const result = { checked: 3, cancelled: 1, failed: 1, skipped: 1 };
  (checkAndCancelTimeoutOrders as jest.Mock).mockResolvedValue(result);
  const response = await request(app).post('/api/internal/order-timeouts').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(503);
  expect(response.body).toEqual(result);
});

test('并发已改变的订单只计跳过，不误报任务失败', async () => {
  const result = { checked: 2, cancelled: 0, failed: 0, skipped: 2 };
  (checkAndCancelTimeoutOrders as jest.Mock).mockResolvedValue(result);
  const response = await request(app).post('/api/internal/order-timeouts').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(200);
  expect(response.body).toEqual(result);
});

test('数据库查询失败仍返回503', async () => {
  (checkAndCancelTimeoutOrders as jest.Mock).mockRejectedValue(new Error('database unavailable'));
  const response = await request(app).post('/api/internal/order-timeouts').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(503);
  expect(response.body).toEqual({ error: '订单超时任务失败' });
});
