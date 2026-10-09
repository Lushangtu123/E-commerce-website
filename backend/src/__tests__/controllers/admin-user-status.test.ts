import { updateUserStatus } from '../../controllers/admin-user.controller';
import { getPool } from '../../database/mysql';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
function response() {
  const res: any = {}; res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res); return res;
}
const req = (body: unknown, userId = '7') => ({ body, params: { userId }, admin: { adminId: 1 }, get: jest.fn() }) as any;
let query: jest.Mock;
let connection: any;
beforeEach(() => {
  query = jest.fn(async (sql: string) => sql.startsWith('SELECT') ? [[{ user_id: 7, username: 'customer' }]] : [{ affectedRows: 1 }]);
  connection = { execute: query, beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  (getPool as jest.Mock).mockReturnValue({ getConnection: jest.fn().mockResolvedValue(connection) });
});
test('disabling revokes sessions atomically with the status write', async () => {
  const res = response(); await updateUserStatus(req({ status: 0 }), res);
  const update = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
  expect(update?.[0]).toContain('auth_version = auth_version +');
  expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO admin_logs'))).toBe(true);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(res.json).toHaveBeenCalledWith({ message: '更新成功', status: 0 });
});
test('audit failure rolls back status and session revocation before returning failure', async () => {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('admin_logs')) throw new Error('audit unavailable');
    return sql.startsWith('SELECT') ? [[{ user_id: 7, username: 'customer' }]] : [{ affectedRows: 1 }];
  });
  const res = response(); await updateUserStatus(req({ status: 0 }), res);
  expect(res.status).toHaveBeenCalledWith(500); expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled(); expect(connection.release).toHaveBeenCalledTimes(1);
});
test.each([null, [], { status: 0, auth_version: 0 }, { status: '0' }])('invalid status body %p is rejected before SQL', async body => {
  const res = response(); await updateUserStatus(req(body), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});
test.each(['0', '-1', '7junk', '7.5', '9007199254740992'])('invalid user id %s is rejected before SQL', async userId => {
  const res = response(); await updateUserStatus(req({ status: 0 }, userId), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});
