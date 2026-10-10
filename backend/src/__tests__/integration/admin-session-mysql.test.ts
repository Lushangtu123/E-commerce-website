import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool } from '../../database/mysql';
import { migrateAccountSecurity } from '../../database/migrate-account-security';
import { authenticateAdmin } from '../../middleware/admin-auth';
import { adminLogout } from '../../controllers/admin.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

// Own only admin_session_test_${pid}; never run against the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 管理员会话版本', () => {
  const database = `admin_session_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    // 升级前的结构：users 已有，admins 没有 auth_version
    await db.query(`CREATE TABLE users (user_id BIGINT PRIMARY KEY AUTO_INCREMENT, password_hash VARCHAR(255) NOT NULL)`);
    await db.query(`CREATE TABLE admins (admin_id BIGINT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL, role_id INT, status TINYINT DEFAULT 1)`);
    await db.query("INSERT INTO admins (admin_id, username, password_hash, role_id) VALUES (9, 'root', 'x', 1)");
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  test('升级迁移为已有管理员补上 auth_version=0，可重复运行', async () => {
    await migrateAccountSecurity(db);
    await migrateAccountSecurity(db);
    const [rows] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
    expect(rows[0].auth_version).toBe(0);
  });

  test('升级前签发的令牌仍有效；退出后该令牌及其副本失效', async () => {
    const app = express();
    app.post('/logout', adminLogout);
    app.get('/me', authenticateAdmin, (req, res) => res.json({ adminId: req.admin?.adminId }));
    const legacy = `admin_session=${jwt.sign({ adminId: 9, type: 'admin' }, 'test-jwt-secret', { expiresIn: '1h' })}`;

    await request(app).get('/me').set('Cookie', legacy).expect(200);
    await request(app).post('/logout').set('Cookie', legacy).set('X-Requested-With', 'XMLHttpRequest').expect(200);
    await request(app).get('/me').set('Cookie', legacy).expect(401);
    const [rows] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
    expect(rows[0].auth_version).toBe(1);
  });

  test('Bearer 退出在真实数据库撤销令牌及 Cookie 副本', async () => {
    const app = express();
    app.post('/logout', adminLogout);
    app.get('/me', authenticateAdmin, (req, res) => res.json({ adminId: req.admin?.adminId }));
    const [before] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
    const token = jwt.sign({ adminId: 9, type: 'admin', authVersion: before[0].auth_version }, 'test-jwt-secret', { expiresIn: '1h' });

    await request(app).get('/me').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).post('/logout').set('Authorization', `Bearer ${token}`).set('X-Requested-With', 'XMLHttpRequest').expect(200);
    await request(app).get('/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app).get('/me').set('Cookie', `admin_session=${token}`).expect(401);
    const [after] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
    expect(after[0].auth_version).toBe(before[0].auth_version + 1);
  });

  test('同时携带另一管理员 Cookie 时，只撤销 Bearer 所属管理员', async () => {
    await db.query("INSERT INTO admins (admin_id, username, password_hash, role_id) VALUES (10, 'other', 'x', 1)");
    const app = express();
    app.post('/logout', adminLogout);
    app.get('/me', authenticateAdmin, (req, res) => res.json({ adminId: req.admin?.adminId }));
    const [before] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
    const token = jwt.sign({ adminId: 9, type: 'admin', authVersion: before[0].auth_version }, 'test-jwt-secret', { expiresIn: '1h' });
    const otherCookie = `admin_session=${jwt.sign({ adminId: 10, type: 'admin', authVersion: 0 }, 'test-jwt-secret', { expiresIn: '1h' })}`;

    await request(app).post('/logout').set('Authorization', `Bearer ${token}`).set('Cookie', otherCookie)
      .set('X-Requested-With', 'XMLHttpRequest').expect(200);
    await request(app).get('/me').set('Authorization', `Bearer ${token}`).expect(401);
    const other = await request(app).get('/me').set('Cookie', otherCookie).expect(200);
    expect(other.body.adminId).toBe(10);
    const [rows] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 10');
    expect(rows[0].auth_version).toBe(0);
  });

  test.each(['before-write', 'after-commit'] as const)('Cookie 清除后以撤销回执恢复真实 SQL：%s', async failure => {
    const [before] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
    const version = Number(before[0].auth_version);
    const token = jwt.sign({ adminId: 9, type: 'admin', authVersion: version }, 'test-jwt-secret', { expiresIn: '24h' });
    let interrupted = false;
    (getPool as jest.Mock).mockReturnValue({ query: async (sql: string, params: unknown[]) => {
      if (!interrupted && sql.startsWith('UPDATE admins SET auth_version')) {
        interrupted = true;
        if (failure === 'after-commit') await db.query(sql, params);
        throw new Error('Isolated one-time database response failure');
      }
      return db.query(sql, params);
    } });
    const app = express();
    app.get('/fixture-session', (_req, res) => { res.cookie('admin_session', token, { httpOnly: true, path: '/api' }); res.end(); });
    app.post('/api/admin/logout', adminLogout);
    app.get('/api/admin/profile', authenticateAdmin, (_req, res) => res.json({ authenticated: true }));
    const browser = request.agent(app);
    try {
      await browser.get('/fixture-session').expect(200);
      await browser.get('/api/admin/profile').expect(200);
      await browser.post('/api/admin/logout').set('X-Requested-With', 'XMLHttpRequest').expect(503);
      await browser.get('/api/admin/profile').expect(401);
      await browser.post('/api/admin/logout').set('X-Requested-With', 'XMLHttpRequest').expect(200);
      const [after] = await db.query<RowDataPacket[]>('SELECT auth_version FROM admins WHERE admin_id = 9');
      expect(Number(after[0].auth_version)).toBe(version + 1);
      await request(app).get('/api/admin/profile').set('Cookie', `admin_session=${token}`).expect(401);
      const fresh = jwt.sign({ adminId: 9, type: 'admin', authVersion: version + 1 }, 'test-jwt-secret', { expiresIn: '1h' });
      await request(app).get('/api/admin/profile').set('Cookie', `admin_session=${fresh}`).expect(200);
    } finally { (getPool as jest.Mock).mockReturnValue(db); }
  });
});
