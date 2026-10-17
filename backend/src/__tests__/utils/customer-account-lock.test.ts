import { lockCustomerAccount } from '../../utils/customer-account-lock';

class Failure extends Error { constructor(message: string, readonly statusCode: number) { super(message); } }
const lock = (rows: object[]) => {
  const execute = jest.fn(async () => [rows, []]);
  return { execute, run: () => lockCustomerAccount({ execute } as any, 7, (message, status) => new Failure(message, status)) };
};

test('locks the account row and lets an active account write', async () => {
  const { execute, run } = lock([{ status: 1, deleted_at: null }]);
  await expect(run()).resolves.toBeUndefined();
  expect(execute).toHaveBeenCalledWith('SELECT status, deleted_at FROM users WHERE user_id = ? FOR UPDATE', [7]);
});

test.each([
  ['deleted', { status: 0, deleted_at: new Date() }],
  ['disabled', { status: 0, deleted_at: null }],
])('rejects a %s account with the session-expired 401', async (_, row) => {
  await expect(lock([row]).run()).rejects.toMatchObject({ message: '登录已过期，请重新登录', statusCode: 401 });
});

test('a missing user keeps the domain 404', async () => {
  await expect(lock([]).run()).rejects.toMatchObject({ message: '用户不存在', statusCode: 404 });
});
