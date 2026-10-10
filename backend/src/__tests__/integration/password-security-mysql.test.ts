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
import { requestPasswordRecovery } from '../../services/password-recovery.service';
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
  /** The signed session a login set; it travels only in the httpOnly cookie, never in the body. */
  const sessionOf = (res: { headers: Record<string, unknown> }) =>
    /customer_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
  const model = () => require('../../models/password-reset.model').PasswordResetModel;
  const mailConfig = { apiKey: 'fixture-only', from: 'support@example.test', appOrigin: 'https://shop.example.test' };
  const clock = { now: () => 0, sleep: async () => {} };
  const sentDigest = (init?: RequestInit) => hash(/#token=([a-f0-9]{64})/.exec(JSON.parse(init!.body as string).text)![1]);
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
  afterEach(() => jest.restoreAllMocks());

  test('a definite mail refusal preserves the previous link without changing the account or another user', async () => {
    const previous = hash('previous-link');
    await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    const [before] = await db.query<RowDataPacket[]>('SELECT expires_at FROM password_reset_tokens WHERE user_id = 7');
    await model().issue(8, hash('other-link'));
    const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429 } as Response);
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(transport).toHaveBeenCalledTimes(1);
    const [after] = await db.query<RowDataPacket[]>('SELECT expires_at FROM password_reset_tokens WHERE user_id = 7');
    expect(after).toEqual(before);
    expect(await model().consume(previous, 'recovered-password')).toBe(true);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    expect(await UserModel.getAuthVersion(7)).toBe(1);
    expect(await model().consume(hash('other-link'), 'other-password')).toBe(true);
  });

  test('definite rejection permits a bounded ten-second retry while an immediate resend stays blocked', async () => {
    const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    const [failed] = await db.query<RowDataPacket[]>('SELECT token_hash FROM password_reset_tokens WHERE user_id = 7');
    expect(await model().consume(failed[0].token_hash, 'must-not-change')).toBe(false);
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(transport).toHaveBeenCalledTimes(1);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(created_at, INTERVAL 11 SECOND) WHERE user_id = 7');
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  test.each(['accepted', 'server-error', 'network-timeout'])('%s retains the new link and ordinary sixty-second cooldown', async outcome => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    let candidate = '';
    const transport = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      candidate = sentDigest(init);
      if (outcome === 'network-timeout') throw new Error('outcome unknown');
      return { ok: outcome === 'accepted', status: outcome === 'accepted' ? 200 : 503 } as Response;
    });
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(created_at, INTERVAL 11 SECOND) WHERE user_id = 7');
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    expect(await model().consume(candidate, 'new-password')).toBe(true);
    expect(await model().consume(candidate, 'must-not-change')).toBe(false);
  });

  test('a late rejection cannot revive previous links after an authenticated password change', async () => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      expect(await model().changePassword(7, 'old-hash', 'changed-password')).toBe(true);
      return { ok: false, status: 429 } as Response;
    });
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    expect(await UserModel.getAuthVersion(7)).toBe(1);
    const [tokens] = await db.query<RowDataPacket[]>('SELECT * FROM password_reset_tokens WHERE user_id = 7');
    expect(tokens).toHaveLength(0);
  });

  test('a changed auth version prevents recovery even when the same candidate row remains', async () => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    let candidate = '';
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      candidate = sentDigest(init);
      await db.query('UPDATE users SET auth_version = auth_version + 1 WHERE user_id = 7');
      return { ok: false, status: 429 } as Response;
    });
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    const [tokens] = await db.query<RowDataPacket[]>('SELECT token_hash FROM password_reset_tokens WHERE user_id = 7');
    expect(tokens).toEqual([{ token_hash: candidate }]);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
  });

  test('consuming a possibly delivered candidate before its rejection callback prevents old-link restoration', async () => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      expect(await model().consume(sentDigest(init), 'consumed-password')).toBe(true);
      return { ok: false, status: 429 } as Response;
    });
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    expect(await UserModel.getAuthVersion(7)).toBe(1);
  });

  test('a newer issuance wins over a delayed rejection for an older request', async () => {
    const previous = hash('previous-link'); const newer = hash('newer-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(created_at, INTERVAL 61 SECOND) WHERE user_id = 7');
      expect(await model().issue(7, newer)).toBeTruthy();
      return { ok: false, status: 429 } as Response;
    });
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    expect(await model().consume(newer, 'newer-password')).toBe(true);
  });

  test('restoration keeps the original expiry and never revives a link that expires during delivery', async () => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND), expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE user_id = 7');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await db.query('DO SLEEP(1.1)');
      return { ok: false, status: 429 } as Response;
    });
    const recover = jest.spyOn(model(), 'recoverRejectedIssuance');
    await requestPasswordRecovery('customer@example.test', mailConfig, clock);
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ tokenHash: previous }) }));
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    const [tokens] = await db.query<RowDataPacket[]>('SELECT token_hash FROM password_reset_tokens WHERE user_id = 7 AND expires_at > UTC_TIMESTAMP(3)');
    expect(tokens).toHaveLength(0);
    expect(await UserModel.getAuthVersion(7)).toBe(0);
  });

  test('a recovery commit failure rolls back restored data and keeps the public request uniform', async () => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    let candidate = '';
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      candidate = sentDigest(init);
      const conn = await db.getConnection();
      (getPool as jest.Mock).mockReturnValueOnce({ getConnection: async () => ({
        beginTransaction: conn.beginTransaction.bind(conn), query: conn.query.bind(conn),
        commit: async () => { throw new Error('fixture commit failure'); },
        rollback: conn.rollback.bind(conn), release: conn.release.bind(conn),
      }) });
      return { ok: false, status: 429 } as Response;
    });
    await expect(requestPasswordRecovery('customer@example.test', mailConfig, clock)).resolves.toBeUndefined();
    expect(await UserModel.getAuthVersion(7)).toBe(0);
    const [tokens] = await db.query<RowDataPacket[]>('SELECT token_hash FROM password_reset_tokens WHERE user_id = 7');
    expect(tokens).toEqual([{ token_hash: candidate }]);
    expect(await model().consume(previous, 'must-not-change')).toBe(false);
    expect(await model().consume(candidate, 'candidate-password')).toBe(true);
  });

  test('concurrent rejection recovery and token consumption never restore a link after a successful reset', async () => {
    const previous = hash('previous-link'); const candidate = hash('candidate-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    const receipt = await model().issue(7, candidate);
    const [recovered, consumed] = await Promise.all([
      model().recoverRejectedIssuance(receipt), model().consume(candidate, 'consumed-password'),
    ]);
    expect([recovered, consumed].sort()).toEqual([false, true]);
    expect(await model().consume(previous, 'previous-password')).toBe(!consumed);
    expect(await UserModel.getAuthVersion(7)).toBe(1);
  });

  test('a rejection receipt settles once and cannot extend the restored link or retry cooldown on replay', async () => {
    const previous = hash('previous-link'); await model().issue(7, previous);
    await db.query('UPDATE password_reset_tokens SET created_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = 7');
    const receipt = await model().issue(7, hash('candidate-link'));
    expect(await model().recoverRejectedIssuance(receipt)).toBe(true);
    const [before] = await db.query<RowDataPacket[]>('SELECT token_hash,expires_at,created_at FROM password_reset_tokens WHERE user_id = 7');
    expect(await model().recoverRejectedIssuance(receipt)).toBe(false);
    const [after] = await db.query<RowDataPacket[]>('SELECT token_hash,expires_at,created_at FROM password_reset_tokens WHERE user_id = 7');
    expect(after).toEqual(before);
    expect(await model().consume(previous, 'recovered-password')).toBe(true);
  });

  test('migration preserves legacy accounts with version0 and authenticates current version', async () => {
    expect(await UserModel.getAuthVersion(7)).toBe(0);
    expect(await UserModel.getAuthVersion(999)).toBeNull();
  });
  test('issuance stores only a digest, expires in30minutes, and account cooldown stops resends', async () => {
    const digest = hash('a'.repeat(64)); expect(await model().issue(7, digest)).toMatchObject({ userId: 7, tokenHash: digest, authVersion: 0 });
    expect(await model().issue(7, hash('b'.repeat(64)))).toBeNull();
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
    const login = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password: currentPassword }).expect(200);
    expect(login.body).not.toHaveProperty('token');
    await request(app).put('/api/users/password').set('Authorization', `Bearer ${sessionOf(login)}`)
      .send({ currentPassword, newPassword }).expect(200);
    for (const token of [legacy, sessionOf(login)]) {
      await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`).expect(401);
    }
    await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password: currentPassword }).expect(401);
    const newLogin = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password: newPassword }).expect(200);
    expect(jwt.verify(sessionOf(newLogin), process.env.JWT_SECRET!)).toMatchObject({ type: 'user', userId: 7, authVersion: 1 });
    await request(app).get('/api/users/profile').set('Authorization', `Bearer ${sessionOf(newLogin)}`).expect(200);
  });
  test('HTTP reset consumes the bearer secret once, revokes the customer session, and leaves another account unchanged', async () => {
    const rawToken = 'c'.repeat(64); await model().issue(7, hash(rawToken));
    const oldSession = jwt.sign({ userId: 7, type: 'user', authVersion: 0 }, process.env.JWT_SECRET!);
    const first = await request(app).post('/api/users/password/reset').set('X-Requested-With', 'XMLHttpRequest').send({ token: rawToken, newPassword: 'reset-http-password' }).expect(200);
    expect(first.body).toEqual({ message: '密码已重置，请重新登录', reauthenticate: true });
    const repeated = await request(app).post('/api/users/password/reset').set('X-Requested-With', 'XMLHttpRequest').send({ token: rawToken, newPassword: 'another-password' }).expect(400);
    expect(repeated.body.code).toBe('INVALID_RESET_TOKEN');
    await request(app).get('/api/users/profile').set('Authorization', `Bearer ${oldSession}`).expect(401);
    const newLogin = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'customer@example.test', password: 'reset-http-password' }).expect(200);
    expect(jwt.verify(sessionOf(newLogin), process.env.JWT_SECRET!)).toMatchObject({ userId: 7, authVersion: 1 });
    const [other] = await db.query<RowDataPacket[]>('SELECT password_hash,auth_version FROM users WHERE user_id = 8');
    expect(other).toEqual([{ password_hash: 'other-hash', auth_version: 0 }]);
  });
});
