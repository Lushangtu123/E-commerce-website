jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
import { query } from '../../database/mysql';
import { UserModel } from '../../models/user.model';

beforeEach(() => { jest.clearAllMocks(); (query as jest.Mock).mockResolvedValue({ affectedRows: 1 }); });

test.each([{}, { phone: undefined }, { username: 123 }, { email: 'x@test' }, { password_hash: 'x' }, { 'username = 1 WHERE 1 --': 'x' }])('direct profile model rejects unsafe updates %p without SQL', async updates => {
  await expect(UserModel.update(1, updates as any)).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});

test('direct model normalizes clearable fields and binds values instead of SQL fields', async () => {
  expect(await UserModel.update(1, { username: ' 名称 ', phone: '  ', avatar_url: null })).toBe(true);
  expect(query).toHaveBeenCalledWith('UPDATE users SET username = ?, phone = ?, avatar_url = ? WHERE user_id = ?', ['名称', null, null, 1]);
});

test.each([0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])('model rejects invalid user identity %p', async userId => {
  await expect(UserModel.update(userId as any, { username: 'valid' })).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
