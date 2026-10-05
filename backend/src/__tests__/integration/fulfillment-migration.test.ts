const migration = () => require('../../database/migrate-fulfillment');
test('fulfillment migration adds only missing shipping columns and retains existing order data', async () => {
  const columns = new Set(['order_id', 'status']);
  const pool = { query: jest.fn(async (sql: string) => {
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[...columns].map(COLUMN_NAME => ({ COLUMN_NAME })), []];
    const added = sql.match(/ADD COLUMN (\w+)/);
    if (added) columns.add(added[1]);
    return [{ affectedRows: 0 }, []];
  }) };
  await migration().migrateFulfillment(pool);
  await migration().migrateFulfillment(pool);
  expect(pool.query.mock.calls.filter(([sql]) => sql.includes('ALTER TABLE'))).toHaveLength(2);
  const statements = pool.query.mock.calls.map(([sql]) => sql).join('\n');
  expect(statements).toContain('shipping_company VARCHAR(60)');
  expect(statements).toContain('tracking_number VARCHAR(100)');
  expect(statements).toContain('UNIQUE KEY');
  expect(pool.query.mock.calls.some(([sql]) => /^\s*(DROP|DELETE|TRUNCATE|UPDATE)\b/.test(sql))).toBe(false);
});
test('missing base orders schema fails explicitly before any schema change', async () => {
  const pool = { query: jest.fn().mockResolvedValue([[], []]) };
  await expect(migration().migrateFulfillment(pool)).rejects.toThrow('基础迁移');
  expect(pool.query).toHaveBeenCalledTimes(1);
});
