jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import userRoutes from '../../routes/user.routes';
import { query } from '../../database/mysql';
import { passwordRecoveryClock } from '../../services/password-recovery.service';

const app = express(); app.use(express.json()); app.use('/api/users', userRoutes);
beforeEach(() => { jest.clearAllMocks(); (query as jest.Mock).mockResolvedValue([{ auth_version: 0 }]);
  jest.spyOn(passwordRecoveryClock, 'sleep').mockResolvedValue(undefined);
  delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.APP_URL; });
afterEach(() => jest.restoreAllMocks());

test('capabilities are public and password updates require a current customer session', async () => {
  expect((await request(app).get('/api/users/password/capabilities')).body).toMatchObject({ passwordResetAvailable: false });
  await request(app).put('/api/users/password').send({ currentPassword: 'old', newPassword: 'new-long-password' }).expect(401);
  const admin = jwt.sign({ type: 'admin', adminId: 1, userId: 7 }, process.env.JWT_SECRET!);
  await request(app).put('/api/users/password').set('Authorization', `Bearer ${admin}`).send({ currentPassword: 'old', newPassword: 'new-long-password' }).expect(401);
});
test('valid customer may change password but extra fields are rejected', async () => {
  const token = jwt.sign({ userId: 7, authVersion: 0, type: 'user' }, process.env.JWT_SECRET!);
  await request(app).put('/api/users/password').set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'old', newPassword: 'new-long-password', role: 'admin' }).expect(400);
});
test('forgot requests remain unavailable without mail and successful statuses count toward anti-spam limit', async () => {
  const unavailable = await request(app).post('/api/users/password/forgot').send({ email: 'customer@example.test' });
  expect(unavailable.status).toBe(503); expect(unavailable.body.code).toBe('PASSWORD_RESET_UNAVAILABLE');
  process.env.RESEND_API_KEY = 're_test'; process.env.EMAIL_FROM = 'support@example.test'; process.env.APP_URL = 'https://shop.example.test';
  (query as jest.Mock).mockResolvedValue([]);
  for (let index = 0; index < 4; index++) {
    await request(app).post('/api/users/password/forgot').send({ email: 'unknown@example.test' }).expect(200);
  }
  await request(app).post('/api/users/password/forgot').send({ email: 'customer@example.test' }).expect(429);
});
