jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { userId?: number }, _res: unknown, next: () => void) => { req.userId = 7; next(); },
}));
jest.mock('../../services/personal-data.service', () => ({
  exportPersonalData: jest.fn(),
  PersonalDataError: class PersonalDataError extends Error { statusCode = 404; },
}));

import express from 'express';
import request from 'supertest';
import userRoutes from '../../routes/user.routes';
import { exportPersonalData, PersonalDataError } from '../../services/personal-data.service';

const app = express();
app.use('/api/users', userRoutes);

beforeEach(() => jest.clearAllMocks());

test('导出当前登录用户的数据', async () => {
  (exportPersonalData as jest.Mock).mockResolvedValue({ format_version: 1, account: { user_id: 7 } });
  const res = await request(app).get('/api/users/data-export').expect(200);
  expect(exportPersonalData).toHaveBeenCalledWith(7);
  expect(res.body).toEqual({ format_version: 1, account: { user_id: 7 } });
  expect(res.headers['cache-control']).toBe('no-store');
});

test('用户不存在返回 404', async () => {
  (exportPersonalData as jest.Mock).mockRejectedValue(new PersonalDataError('用户不存在'));
  const res = await request(app).get('/api/users/data-export').expect(404);
  expect(res.body).toEqual({ error: '用户不存在' });
});

test('数据库错误返回 500，不泄露细节', async () => {
  (exportPersonalData as jest.Mock).mockRejectedValue(new Error('ER_SOMETHING secret'));
  const res = await request(app).get('/api/users/data-export').expect(500);
  expect(res.body).toEqual({ error: '导出个人信息失败，请稍后重试' });
});
