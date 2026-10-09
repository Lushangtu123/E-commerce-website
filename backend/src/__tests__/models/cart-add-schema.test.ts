import type { Pool } from 'mysql2/promise';

// A missing migration is itself an actionable regression, rather than an import-time crash.
let migrate: ((pool: Pool, check?: boolean) => Promise<void>) | undefined;
try { migrate = require('../../database/migrate-cart-adds').migrateCartAdds; } catch { /* Not implemented yet. */ }
const columns = Object.entries({ user_id: 'bigint', add_key: 'char(36)', payload_fingerprint: 'char(64)', created_at: 'timestamp' })
  .map(([COLUMN_NAME, COLUMN_TYPE]) => ({ COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE: 'NO', CHARACTER_SET_NAME: COLUMN_TYPE.startsWith('char') ? 'ascii' : null, COLLATION_NAME: COLUMN_TYPE.startsWith('char') ? 'ascii_bin' : null }));
const primary = ['user_id', 'add_key'].map(COLUMN_NAME => ({ COLUMN_NAME, NON_UNIQUE: 0, SUB_PART: null as null | number }));
function database({ exists = true, engine = 'InnoDB', index = primary, fields = columns, foreign = [] as object[] } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [[{ TABLE_NAME: 'users', ENGINE: 'InnoDB' }, { TABLE_NAME: 'cart', ENGINE: 'InnoDB' }, ...(exists ? [{ TABLE_NAME: 'cart_add_receipts', ENGINE: engine }] : [])]];
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [fields];
    if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return [index];
    if (sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')) return [foreign];
    if (sql.startsWith('CREATE TABLE')) return [{}];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query, pool: { query } as unknown as Pool };
}
describe('cart add schema preflight', () => {
  test('provides a dedicated migration and read-only check', () => { expect(typeof migrate).toBe('function'); });
  test('an existing composite primary key passes without requiring redundant unique indexes', async () => {
    const db = database(); await migrate!(db.pool, true); await migrate!(db.pool);
    expect(db.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  test('new tables have an explicit primary key for managed MySQL and no cart-row dependency', async () => {
    const db = database({ exists: false }); await migrate!(db.pool);
    const ddl = db.query.mock.calls.find(([sql]) => sql.startsWith('CREATE TABLE'))?.[0];
    expect(ddl).toContain('PRIMARY KEY (user_id, add_key)'); expect(ddl).toContain('ENGINE=InnoDB'); expect(ddl).not.toMatch(/FOREIGN KEY|UNIQUE KEY/);
    const check = database({ exists: false }); await expect(migrate!(check.pool, true)).rejects.toThrow('尚未迁移');
    expect(check.query).toHaveBeenCalledTimes(1);
  });
  test.each([
    { engine: 'MyISAM' }, { index: primary.slice(0, 1) },
    { index: [...primary].reverse() }, { index: primary.map(row => ({ ...row, SUB_PART: 10 })) },
    { fields: columns.map(row => row.COLUMN_NAME === 'add_key' ? { ...row, COLLATION_NAME: 'ascii_general_ci' } : row) },
    { foreign: [{ REFERENCED_TABLE_NAME: 'cart' }] },
  ])('incompatible existing schemas fail before any mutation: %j', async options => {
    const db = database(options); await expect(migrate!(db.pool)).rejects.toThrow();
    expect(db.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
});
