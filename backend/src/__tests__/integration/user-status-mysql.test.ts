import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool, query } from '../../database/mysql';
import { migrateAccountSecurity } from '../../database/migrate-account-security';
import { updateUserStatus } from '../../controllers/admin-user.controller';
import userRoutes from '../../routes/user.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));

// Own a disposable test database only; never use the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('MySQL customer disable and migration compatibility', () => {
  const database = `customer_status_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool; let db: Pool; let created = false; let passwordHash: string;
  const password = 'customer-password';
  const app = express(); app.use(express.json()); app.use('/api/users', userRoutes);
  app.put('/admin/users/:userId/status', (req, _res, next) => {
    req.admin = { adminId: 1, username: 'fixture', roleId: 1, type: 'admin' }; next();
  }, updateUserStatus);
  const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const users = [...source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)].find(match => match[2] === 'users')![1];
    await db.query(users.replace(/\s*status TINYINT NOT NULL DEFAULT 1[^\n]*,/, '')
      .replace(/\s*auth_version INT UNSIGNED NOT NULL DEFAULT 0,/, ''));
    await db.query('CREATE TABLE admins (admin_id BIGINT PRIMARY KEY, password_hash VARCHAR(255) NOT NULL)');
    await db.query("INSERT INTO admins VALUES (1, 'legacy-admin-hash')");
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (99,'legacy','legacy@example.test','legacy-customer-hash')");
    await migrateAccountSecurity(db); await migrateAccountSecurity(db);
    const [legacy] = await db.query<RowDataPacket[]>('SELECT password_hash,status,auth_version FROM users WHERE user_id = 99');
    expect(legacy).toEqual([{ password_hash: 'legacy-customer-hash', status: 1, auth_version: 0 }]);
    const [admin] = await db.query<RowDataPacket[]>('SELECT password_hash,auth_version FROM admins');
    expect(admin).toEqual([{ password_hash: 'legacy-admin-hash', auth_version: 0 }]);
    // Execute the new base schema as well, rather than asserting source text alone.
    await db.query(users.replace('users (', 'users_fresh ('));
    await db.query("INSERT INTO users_fresh (username,email,password_hash) VALUES ('new','new@example.test','new-hash')");
    const [fresh] = await db.query<RowDataPacket[]>('SELECT status,auth_version FROM users_fresh');
    expect(fresh).toEqual([{ status: 1, auth_version: 0 }]);
    passwordHash = await bcrypt.hash(password, 4);
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: unknown[]) => (await db.query(sql, values))[0]);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM users');
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (7,'customer','customer@example.test',?)", [passwordHash]);
  });

  test('repeated migration preserves disabled status, password hashes and current versions', async () => {
    await db.query('UPDATE users SET status = 0, auth_version = 4 WHERE user_id = 7');
    await db.query('UPDATE admins SET auth_version = 3');
    await migrateAccountSecurity(db); await migrateAccountSecurity(db);
    const [users] = await db.query<RowDataPacket[]>('SELECT status,auth_version,password_hash FROM users WHERE user_id = 7');
    expect(users).toEqual([{ status: 0, auth_version: 4, password_hash: passwordHash }]);
    const [admins] = await db.query<RowDataPacket[]>('SELECT auth_version,password_hash FROM admins');
    expect(admins).toEqual([{ auth_version: 3, password_hash: 'legacy-admin-hash' }]);
  });

  test('disable rejects login and active cookie/bearer sessions; re-enable never revives old or legacy sessions', async () => {
    const login = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password }).expect(200);
    const cookie = cookieOf(login); const token = cookie.split('=')[1];
    const legacy = jwt.sign({ userId: 7 }, process.env.JWT_SECRET!);
    for (const session of [token, legacy]) await request(app).get('/api/users/profile').set('Authorization', `Bearer ${session}`).expect(200);
    await request(app).get('/api/users/profile').set('Cookie', cookie).expect(200);

    await request(app).put('/admin/users/7/status').send({ status: 0 }).expect(200);
    const [disabled] = await db.query<RowDataPacket[]>('SELECT status,auth_version FROM users WHERE user_id = 7');
    expect(disabled).toEqual([{ status: 0, auth_version: 1 }]);
    // Even a token with the current version cannot authenticate a disabled account.
    const current = jwt.sign({ userId: 7, type: 'user', authVersion: 1 }, process.env.JWT_SECRET!);
    for (const session of [token, legacy, current]) await request(app).get('/api/users/profile').set('Authorization', `Bearer ${session}`).expect(401);
    await request(app).get('/api/users/profile').set('Cookie', cookie).expect(401);
    await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password }).expect(403);

    await request(app).put('/admin/users/7/status').send({ status: 1 }).expect(200);
    for (const session of [token, legacy]) await request(app).get('/api/users/profile').set('Authorization', `Bearer ${session}`).expect(401);
    await request(app).get('/api/users/profile').set('Cookie', cookie).expect(401);
    const freshLogin = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password }).expect(200);
    const freshCookie = cookieOf(freshLogin);
    expect(jwt.verify(freshCookie.split('=')[1], process.env.JWT_SECRET!)).toMatchObject({ authVersion: 1 });
    await request(app).get('/api/users/profile').set('Cookie', freshCookie).expect(200);
  });
});
