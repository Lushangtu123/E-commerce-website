import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { createHash } from 'crypto';
import { getPool, query } from '../../database/mysql';
import { UserModel } from '../../models/user.model';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import userRoutes from '../../routes/user.routes';
jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn(), connectDatabase: jest.fn() }));

const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;
integration('isolated MySQL password revocation and single-use reset', () => {
  const database = `ecommerce_password_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } :
    { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8, timezone: '+00:00' };
  let server: Pool; let db: Pool; let created = false;
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const model = () => require('../../models/password-reset.model').PasswordResetModel;
  const app = express(); app.use(express.json()); app.use('/api/users', userRoutes);

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const schema = [...source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)].find(match => match[2] === 'users');
    // Upgrade an actual legacy users table even when the new base schema includes auth_version.
    await db.query(schema![1].replace(/\s*auth_version INT UNSIGNED NOT NULL DEFAULT 0,/, ''));
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (99,'legacy','legacy@example.test','legacy-hash')");
    await require('../../database/migrate-account-security').migrateAccountSecurity(db);
    await require('../../database/migrate-account-security').migrateAccountSecurity(db);
    const [legacy] = await db.query<RowDataPacket[]>('SELECT user_id,password_hash,auth_version FROM users WHERE user_id = 99');
    expect(legacy).toEqual([{ user_id: 99, password_hash: 'legacy-hash', auth_version: 0 }]);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    (getPool as jest.Mock).mockReturnValue(db);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM password_reset_tokens'); await db.query('DELETE FROM users');
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (7,'customer','customer@example.test','old-hash'),(8,'other','other@example.test','other-hash')");
  });

  test('migration preserves legacy accounts with version0 and authenticates current version', async () => {
    expect(await UserModel.getAuthVersion(7)).toBe(0);
    expect(await UserModel.getAuthVersion(999)).toBeNull();
  });
  test('issuance stores only a digest, expires in30minutes, and account cooldown stops resends', async () => {
    const digest = hash('a'.repeat(64)); expect(await model().issue(7, digest)).toBe(true);
    expect(await model().issue(7, hash('b'.repeat(64)))).toBe(false);
    const [rows] = await db.query<RowDataPacket[]>('SELECT token_hash, TIMESTAMPDIFF(SECOND,created_at,expires_at) AS duration FROM password_reset_tokens');
    expect(rows).toEqual([{ token_hash: digest, duration: 1800 }]);
  });
  test('two concurrent uses of one link change the account exactly once', async () => {
    const digest = hash('a'.repeat(64)); await model().issue(7, digest);
    const used = await Promise.all([model().consume(digest, 'new-hash-one'), model().consume(digest, 'new-hash-two')]);
    expect(used.sort()).toEqual([false, true]);
    expect(await UserModel.getAuthVersion(7)).toBe(1);
    expect(await model().consume(digest, 'must-not-change')).toBe(false);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM users ORDER BY user_id');
    expect(['new-hash-one', 'new-hash-two']).toContain(rows[0].password_hash);
    expect(rows[1].password_hash).toBe('other-hash');
  });
  test('expired links never change account credentials or auth version', async () => {
    const digest = hash('a'.repeat(64)); await model().issue(7, digest);
    await db.query('UPDATE password_reset_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)');
    expect(await model().consume(digest, 'must-not-change')).toBe(false);
    expect(await UserModel.getAuthVersion(7)).toBe(0);
  });
  test('password change revokes resets and compare-and-swap rejects stale current passwords', async () => {
    const digest = hash('a'.repeat(64)); await model().issue(7, digest);
    expect(await model().changePassword(7, 'old-hash', 'changed-hash')).toBe(true);
    expect(await model().changePassword(7, 'old-hash', 'must-not-change')).toBe(false);
    expect(await model().consume(digest, 'must-not-change')).toBe(false);
    expect(await UserModel.getAuthVersion(7)).toBe(1);
  });
  test('authenticated HTTP password change revokes legacy and version0 sessions while login accepts only the new password', async () => {
    const currentPassword = 'legacy-password'; const newPassword = 'new-http-password';
    await db.query('UPDATE users SET password_hash = ? WHERE user_id = 7', [await bcrypt.hash(currentPassword, 4)]);
    const legacy = jwt.sign({ userId: 7 }, process.env.JWT_SECRET!);
    const login = await request(app).post('/api/users/login').send({ email: 'customer@example.test', password: currentPassword }).expect(200);
    await request(app).put('/api/users/password').set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword, newPassword }).expect(200);
    for (const token of [legacy, login.body.token]) {
      await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`).expect(401);
    }
    await request(app).post('/api/users/login').send({ email: 'customer@example.test', password: currentPassword }).expect(401);
    const newLogin = await request(app).post('/api/users/login').send({ email: 'customer@example.test', password: newPassword }).expect(200);
    expect(jwt.verify(newLogin.body.token, process.env.JWT_SECRET!)).toMatchObject({ type: 'user', userId: 7, authVersion: 1 });
    await request(app).get('/api/users/profile').set('Authorization', `Bearer ${newLogin.body.token}`).expect(200);
  });
  test('HTTP reset consumes the bearer secret once, revokes the customer session, and leaves another account unchanged', async () => {
    const rawToken = 'c'.repeat(64); await model().issue(7, hash(rawToken));
    const oldSession = jwt.sign({ userId: 7, type: 'user', authVersion: 0 }, process.env.JWT_SECRET!);
    const first = await request(app).post('/api/users/password/reset').send({ token: rawToken, newPassword: 'reset-http-password' }).expect(200);
    expect(first.body).toEqual({ message: '密码已重置，请重新登录', reauthenticate: true });
    const repeated = await request(app).post('/api/users/password/reset').send({ token: rawToken, newPassword: 'another-password' }).expect(400);
    expect(repeated.body.code).toBe('INVALID_RESET_TOKEN');
    await request(app).get('/api/users/profile').set('Authorization', `Bearer ${oldSession}`).expect(401);
    const newLogin = await request(app).post('/api/users/login').send({ email: 'customer@example.test', password: 'reset-http-password' }).expect(200);
    expect(jwt.verify(newLogin.body.token, process.env.JWT_SECRET!)).toMatchObject({ userId: 7, authVersion: 1 });
    const [other] = await db.query<RowDataPacket[]>('SELECT password_hash,auth_version FROM users WHERE user_id = 8');
    expect(other).toEqual([{ password_hash: 'other-hash', auth_version: 0 }]);
  });
});
