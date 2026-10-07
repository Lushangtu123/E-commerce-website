import type { Pool } from 'mysql2/promise';
import { migrateAccountSecurity } from '../../database/migrate-account-security';

test('upgrades legacy customer and admin tables once without overwriting existing data', async () => {
  const columns: Record<string, Set<string>> = { users: new Set(['user_id', 'password_hash']), admins: new Set(['admin_id']) };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
      const table = sql.includes("TABLE_NAME = 'admins'") ? 'admins' : 'users';
      return [[...columns[table]].map(COLUMN_NAME => ({ COLUMN_NAME }))];
    }
    const added = sql.match(/ALTER TABLE (users|admins) ADD COLUMN (\w+)/);
    if (added) columns[added[1]].add(added[2]);
    return [{}];
  });
  const pool = { query } as unknown as Pool;
  await migrateAccountSecurity(pool); await migrateAccountSecurity(pool);
  expect(columns.users.has('status')).toBe(true);
  expect(columns.users.has('auth_version')).toBe(true);
  expect(columns.admins.has('auth_version')).toBe(true);
  const alterations = query.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith('ALTER'));
  expect(alterations).toHaveLength(3);
  expect(alterations.find(sql => sql.includes('ADD COLUMN status'))).toContain('DEFAULT 1');
  expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE') || sql.startsWith('DELETE'))).toBe(false);
});

test('already migrated status and auth versions are preserved', async () => {
  const query = jest.fn(async (sql: string) => [sql.includes('INFORMATION_SCHEMA')
    ? ['user_id', 'status', 'auth_version'].map(COLUMN_NAME => ({ COLUMN_NAME })) : {}]);
  await migrateAccountSecurity({ query } as unknown as Pool);
  expect(query.mock.calls.some(([sql]) => sql.startsWith('ALTER'))).toBe(false);
});
