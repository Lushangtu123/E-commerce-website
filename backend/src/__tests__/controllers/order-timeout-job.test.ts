import express from 'express';
import request from 'supertest';
jest.mock('../../services/order-timeout.service', () => ({ checkAndCancelTimeoutOrders: jest.fn().mockResolvedValue({ checked: 0, cancelled: 0 }) }));
test('订单定时任务拒绝缺失或错误的密钥，仅接受授权的 POST', async () => {
  process.env.CRON_SECRET = 'a'.repeat(64);
  const { default: jobs } = require('../../routes/internal.routes');
  const { checkAndCancelTimeoutOrders } = require('../../services/order-timeout.service');
  const app = express(); app.use('/api/internal', jobs);
  await request(app).post('/api/internal/order-timeouts').expect(401);
  await request(app).post('/api/internal/order-timeouts').set('Authorization', 'Bearer wrong').expect(401);
  expect(checkAndCancelTimeoutOrders).not.toHaveBeenCalled();
  const response = await request(app).post('/api/internal/order-timeouts').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(200);
  expect(response.body).toEqual({ checked: 0, cancelled: 0 });
  expect(checkAndCancelTimeoutOrders).toHaveBeenCalledWith(50);
  await request(app).get('/api/internal/order-timeouts').expect(404);
  delete process.env.CRON_SECRET;
});
