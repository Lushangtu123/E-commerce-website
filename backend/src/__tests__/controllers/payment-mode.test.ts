import express from 'express';
import request from 'supertest';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../services/order.service', () => ({
  transitionOrder: jest.fn().mockResolvedValue({ productIds: [] }),
  invalidateOrderProductCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/message-queue.service', () => ({ sendOrderTimeoutCheckMessage: jest.fn() }));
import { OrderController } from '../../controllers/order.controller';
import { transitionOrder } from '../../services/order.service';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; jest.clearAllMocks(); });
function app() {
  const server = express();
  server.post('/pay', (req, res) => OrderController.pay(Object.assign(req, { userId: 1, params: { id: '12' } }), res));
  return server;
}

test('missing explicit payment mode cannot mark an order paid', async () => {
  delete process.env.PAYMENT_MODE;
  const result = await request(app()).post('/pay');
  expect(result.status).toBe(503);
  expect(transitionOrder).not.toHaveBeenCalled();
});
test.each(['production', undefined])('production blocks demo payments with VERCEL_ENV=%s', async environment => {
  process.env.NODE_ENV = 'production';
  process.env.PAYMENT_MODE = 'demo';
  if (environment) process.env.VERCEL_ENV = environment;
  else delete process.env.VERCEL_ENV;
  const result = await request(app()).post('/pay');
  expect(result.status).toBe(503);
  expect(transitionOrder).not.toHaveBeenCalled();
});
test('explicit protected preview demo labels success as no actual charge', async () => {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL_ENV = 'preview';
  process.env.PAYMENT_MODE = 'demo';
  const result = await request(app()).post('/pay');
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ message: '模拟支付完成，未实际扣款', payment_mode: 'demo' });
  expect(transitionOrder).toHaveBeenCalledWith(12, 1, { userId: 1 });
});
