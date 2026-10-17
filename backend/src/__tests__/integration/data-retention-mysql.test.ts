import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { migrateAccountSecurity } from '../../database/migrate-account-security';
import { purgeExpiredPersonalData, RETENTION } from '../../services/data-retention.service';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

// Tests own and clean only data_retention_test_${pid}; DB_NAME is never used.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 数据保留期清理', () => {
  const database = `data_retention_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 2,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const count = async (table: string) => Number(((await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0])[0].n);

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'browse_history', 'search_history'].includes(match[2])) await db.query(match[1]);
    }
    const admin = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    await db.query(admin.match(/(CREATE TABLE IF NOT EXISTS page_visits[\s\S]*?ENGINE[^`]*)/)![1]);
    await migrateAccountSecurity(db);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    for (const table of ['browse_history', 'search_history', 'password_reset_tokens', 'page_visits', 'customer_session_revocations', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'one','one@example.test','x'),(2,'two','two@example.test','x')");
  });

  test('只删除超过保留期的记录，保留期内的不动', async () => {
    await db.query(`INSERT INTO browse_history (user_id,product_id,browsed_at) VALUES
      (1,1,NOW() - INTERVAL 181 DAY),(1,2,NOW() - INTERVAL 179 DAY),(2,3,NOW())`);
    await db.query(`INSERT INTO search_history (user_id,keyword,created_at) VALUES
      (1,'old',NOW() - INTERVAL 181 DAY),(1,'recent',NOW() - INTERVAL 1 DAY)`);
    await db.query(`INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES
      (REPEAT('a',64),1,NOW() - INTERVAL 1 MINUTE),(REPEAT('b',64),2,NOW() + INTERVAL 1 HOUR)`);
    await db.query(`INSERT INTO page_visits (user_id,session_id,page_url,created_at) VALUES
      (1,'s','/',NOW() - INTERVAL 91 DAY),(1,'s','/',NOW() - INTERVAL 89 DAY)`);
    await db.query(`INSERT INTO customer_session_revocations (session_id,user_id,expires_at) VALUES
      (UUID(),1,NOW() - INTERVAL 1 MINUTE),(UUID(),1,NOW() + INTERVAL 1 DAY)`);

    const result = await purgeExpiredPersonalData();
    expect(result).toEqual({ browse_history: 1, search_history: 1, password_reset_tokens: 1, customer_session_revocations: 1, page_visits: 1 });
    expect(await count('customer_session_revocations')).toBe(1);
    expect((await db.query<RowDataPacket[]>('SELECT product_id FROM browse_history ORDER BY product_id'))[0].map(row => row.product_id)).toEqual([2, 3]);
    expect((await db.query<RowDataPacket[]>('SELECT keyword FROM search_history'))[0].map(row => row.keyword)).toEqual(['recent']);
    expect((await db.query<RowDataPacket[]>('SELECT user_id FROM password_reset_tokens'))[0].map(row => row.user_id)).toEqual([2]);
    expect(await count('page_visits')).toBe(1);
  });

  test('大批量分批删除，结果为总数', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => [1, `k${i}`]);
    await db.query('INSERT INTO search_history (user_id,keyword) VALUES ?', [rows]);
    await db.query('UPDATE search_history SET created_at = NOW() - INTERVAL 200 DAY');
    const result = await purgeExpiredPersonalData({ batchSize: 1000 });
    expect(result.search_history).toBe(2500);
    expect(await count('search_history')).toBe(0);
  });

  test('再次运行没有可删除的记录', async () => {
    expect(await purgeExpiredPersonalData()).toEqual({ browse_history: 0, search_history: 0, password_reset_tokens: 0, customer_session_revocations: 0, page_visits: 0 });
  });

  test('保留期与隐私政策一致', () => {
    expect(RETENTION).toEqual({ browseHistoryDays: 180, searchHistoryDays: 180, pageVisitDays: 90 });
  });
});
