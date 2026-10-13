jest.mock('../../services/data-retention.service', () => ({ purgeExpiredPersonalData: jest.fn() }));
jest.mock('../../services/order-timeout.service', () => ({ checkAndCancelTimeoutOrders: jest.fn() }));

import express from 'express';
import request from 'supertest';
import internalRoutes from '../../routes/internal.routes';
import { purgeExpiredPersonalData } from '../../services/data-retention.service';

const app = express();
app.use('/api/internal', internalRoutes);
const SECRET = 'c'.repeat(40);

beforeEach(() => { jest.clearAllMocks(); process.env.CRON_SECRET = SECRET; });
afterAll(() => { delete process.env.CRON_SECRET; });

test('需要 CRON_SECRET', async () => {
  await request(app).post('/api/internal/data-retention').expect(401);
  await request(app).post('/api/internal/data-retention').set('Authorization', 'Bearer wrong').expect(401);
  delete process.env.CRON_SECRET;
  await request(app).post('/api/internal/data-retention').set('Authorization', `Bearer ${SECRET}`).expect(401);
  expect(purgeExpiredPersonalData).not.toHaveBeenCalled();
});

test('返回各表删除的条数', async () => {
  (purgeExpiredPersonalData as jest.Mock).mockResolvedValue({ browse_history: 3, search_history: 0, password_reset_tokens: 1, page_visits: 0 });
  const res = await request(app).post('/api/internal/data-retention').set('Authorization', `Bearer ${SECRET}`).expect(200);
  expect(res.body).toEqual({ browse_history: 3, search_history: 0, password_reset_tokens: 1, page_visits: 0 });
});

test('失败时返回 503', async () => {
  (purgeExpiredPersonalData as jest.Mock).mockRejectedValue(new Error('db down'));
  const res = await request(app).post('/api/internal/data-retention').set('Authorization', `Bearer ${SECRET}`).expect(503);
  expect(res.body).toEqual({ error: '数据保留清理失败' });
});
