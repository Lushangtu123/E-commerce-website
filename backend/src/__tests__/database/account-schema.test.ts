import type { Pool } from 'mysql2/promise';
import { missingAccountColumns } from '../../utils/account-schema';

const pool = (columns: Array<[string, string]>) => ({ query: jest.fn().mockResolvedValue([
  columns.map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME })), []
]) }) as unknown as Pool;

test('已升级账户结构通过，缺失列按实际差异报告而不执行DDL', async () => {
  const current = pool([['users', 'auth_version'], ['users', 'status'], ['admins', 'auth_version']]);
  expect(await missingAccountColumns(current)).toEqual([]);
  const old = pool([['users', 'auth_version']]);
  expect(await missingAccountColumns(old)).toEqual(['users.status', 'admins.auth_version']);
  expect(old.query).toHaveBeenCalledTimes(1);
  expect((old.query as jest.Mock).mock.calls[0][0]).toMatch(/^SELECT /);
});

test('未初始化库不会误报准备就绪', async () => {
  expect(await missingAccountColumns(pool([]))).toEqual(['users.auth_version', 'users.status', 'admins.auth_version']);
});
