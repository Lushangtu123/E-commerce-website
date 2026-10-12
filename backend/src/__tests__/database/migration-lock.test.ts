import type { Pool } from 'mysql2/promise';
import { withMigrationLock } from '../../database/migration-lock';

function fakePool(acquired: number | null) {
  const conn = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => [[sql.includes('GET_LOCK') ? { acquired } : { released: 1 }]]),
    release: jest.fn(),
  };
  return { pool: { getConnection: jest.fn(async () => conn) } as unknown as Pool, conn };
}

test('取得锁后执行迁移，结束后释放锁和连接', async () => {
  const { pool, conn } = fakePool(1);
  await expect(withMigrationLock(pool, async () => 'done')).resolves.toBe('done');
  expect(conn.query.mock.calls[0][0]).toContain('GET_LOCK');
  expect(conn.query.mock.calls[0][1]).toEqual([30]);
  expect(conn.query.mock.calls[1][0]).toContain('RELEASE_LOCK');
  expect(conn.release).toHaveBeenCalledTimes(1);
});

test.each([0, null])('拿不到锁（GET_LOCK=%s）时不执行迁移', async acquired => {
  const { pool, conn } = fakePool(acquired);
  const run = jest.fn();
  await expect(withMigrationLock(pool, run, 5)).rejects.toThrow('另一个数据库迁移正在运行');
  expect(run).not.toHaveBeenCalled();
  expect(conn.query).toHaveBeenCalledTimes(1);
  expect(conn.release).toHaveBeenCalledTimes(1);
});

test('迁移失败时仍释放锁，并抛出原始错误', async () => {
  const { pool, conn } = fakePool(1);
  await expect(withMigrationLock(pool, async () => { throw new Error('ALTER failed'); })).rejects.toThrow('ALTER failed');
  expect(conn.query.mock.calls[1][0]).toContain('RELEASE_LOCK');
  expect(conn.release).toHaveBeenCalledTimes(1);
});
