jest.mock('../../database/mysql', () => ({ connectDatabase: jest.fn(), getPool: jest.fn() }));
import { getPool } from '../../database/mysql';
import runAdminMigrations from '../../database/admin-migrate';
import bcrypt from 'bcryptjs';

test('生产建表不创建默认弱密码管理员，强初始化密码只以哈希写入', async () => {
  const env = { ...process.env };
  const connection = { query: jest.fn().mockResolvedValue([[]]), release: jest.fn() };
  (getPool as jest.Mock).mockReturnValue({ getConnection: async () => connection });
  try {
    process.env.NODE_ENV = 'production'; delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    await runAdminMigrations();
    expect(connection.query.mock.calls.some(([sql]) => sql.includes('INSERT IGNORE INTO admins'))).toBe(false);
    connection.query.mockClear();
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'strong-fixture-password-123';
    await runAdminMigrations();
    const inserted = connection.query.mock.calls.find(([sql]) => sql.includes('INSERT IGNORE INTO admins'))!;
    expect(await bcrypt.compare(process.env.ADMIN_BOOTSTRAP_PASSWORD, inserted[1][0])).toBe(true);
    expect(await bcrypt.compare('admin123', inserted[1][0])).toBe(false);
  } finally { process.env = env; }
});
