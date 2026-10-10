import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticateAdmin } from '../../middleware/admin-auth';
import { getPool } from '../../database/mysql';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const query = jest.fn(), handler = jest.fn();
const token = (adminId = 2, authVersion = 0) => jwt.sign({ adminId, authVersion, type: 'admin' }, 'test-jwt-secret');
function app() {
  const instance = express();
  instance.all('/account', authenticateAdmin, (req, res) => { handler(req.admin?.adminId); res.json({ adminId: req.admin?.adminId }); });
  return instance;
}
beforeEach(() => {
  jest.clearAllMocks(); (getPool as jest.Mock).mockReturnValue({ query });
  query.mockResolvedValue([[{ admin_id: 2, username: 'Second administrator', role_id: 1, status: 1, auth_version: 0 }]]);
});
describe('administrator expected account context', () => {
  test.each(['cookie', 'bearer'])('rejects stale expected identity before writes/reads using %s', async source => {
    for (const method of ['get', 'post'] as const) {
      const response = await request(app())[method]('/account')
        .set(source === 'cookie' ? 'Cookie' : 'Authorization', source === 'cookie' ? `admin_session=${token()}` : `Bearer ${token()}`)
        .set('X-Requested-With', 'XMLHttpRequest').set('X-Expected-Admin-Id', '1').expect(409);
      expect(response.body.error).toBe('登录状态已变化，请刷新后重试');
    }
    expect(handler).not.toHaveBeenCalled();
  });
  test.each([undefined, '2'])('accepts matching and legacy contexts %p', async expected => {
    const call = request(app()).post('/account').set('Cookie', `admin_session=${token()}`).set('X-Requested-With', 'XMLHttpRequest');
    if (expected !== undefined) call.set('X-Expected-Admin-Id', expected);
    expect((await call.expect(200)).body.adminId).toBe(2); expect(handler).toHaveBeenCalledWith(2);
  });
  test.each(['0', '-1', '1.5', '01', '2, 2', '9007199254740992', 'invalid'])('rejects malformed expected identity %p', async expected => {
    const response = await request(app()).get('/account').set('Cookie', `admin_session=${token()}`).set('X-Expected-Admin-Id', expected).expect(400);
    expect(response.body.error).toBe('请求格式无效'); expect(handler).not.toHaveBeenCalled();
  });
  test('expected identity does not authenticate or bypass CSRF', async () => {
    await request(app()).get('/account').set('X-Expected-Admin-Id', '2').expect(401);
    await request(app()).post('/account').set('Cookie', `admin_session=${token()}`).set('X-Expected-Admin-Id', '2').expect(403);
    await request(app()).get('/account').set('Cookie', 'admin_session=invalid').set('X-Expected-Admin-Id', '2').expect(401);
    expect(handler).not.toHaveBeenCalled();
  });
  test('preserves customer/admin separation', async () => {
    const customer = jwt.sign({ userId: 2, type: 'user' }, 'test-jwt-secret');
    await request(app()).get('/account').set('Cookie', `customer_session=${customer}`).set('X-Expected-Admin-Id', '2').expect(401);
    await request(app()).get('/account').set('Cookie', `admin_session=${customer}`).set('X-Expected-Admin-Id', '2').expect(403);
    expect(handler).not.toHaveBeenCalled();
  });
  test.each(['missing', 'disabled', 'revoked'])('runs account validity checks before context validation: %s', async state => {
    query.mockResolvedValue([state === 'missing' ? [] : [{ admin_id: 2, username: 'Second administrator', role_id: 1, status: state === 'disabled' ? 0 : 1, auth_version: state === 'revoked' ? 1 : 0 }]]);
    await request(app()).get('/account').set('Cookie', `admin_session=${token()}`).set('X-Expected-Admin-Id', 'invalid').expect(state === 'disabled' ? 403 : 401);
    expect(handler).not.toHaveBeenCalled();
  });
});
