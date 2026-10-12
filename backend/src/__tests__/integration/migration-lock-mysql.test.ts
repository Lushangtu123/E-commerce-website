import mysql, { Pool } from 'mysql2/promise';
import { withMigrationLock } from '../../database/migration-lock';

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;

integration('真实 MySQL 迁移锁', () => {
  const database = `migration_lock_test_${process.pid}`;
  const other = `${database}_other`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    connectionLimit: 3,
  };
  let server: Pool;
  let first: Pool;
  let second: Pool;
  let otherDb: Pool;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database}`);
    await server.query(`CREATE DATABASE ${other}`);
    first = mysql.createPool({ ...options, database });
    second = mysql.createPool({ ...options, database });
    otherDb = mysql.createPool({ ...options, database: other });
  });

  afterAll(async () => {
    await Promise.all([first?.end(), second?.end(), otherDb?.end()]);
    await server?.query(`DROP DATABASE IF EXISTS ${database}`);
    await server?.query(`DROP DATABASE IF EXISTS ${other}`);
    await server?.end();
  });

  test('同一数据库同时只允许一个迁移，锁释放后可再次运行', async () => {
    let finish!: () => void;
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const holder = withMigrationLock(first, () => { started(); return new Promise<void>(resolve => { finish = resolve; }); });
    await running;

    await expect(withMigrationLock(second, async () => 'second', 0)).rejects.toThrow('另一个数据库迁移正在运行');
    await expect(withMigrationLock(otherDb, async () => 'other database', 0)).resolves.toBe('other database');

    finish();
    await holder;
    await expect(withMigrationLock(second, async () => 'after release', 0)).resolves.toBe('after release');
  });

  test('迁移抛错后锁被释放', async () => {
    await expect(withMigrationLock(first, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withMigrationLock(second, async () => 'next', 0)).resolves.toBe('next');
  });
});
