import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getPool, query } from '../../database/mysql';
import { migrateAdminTwoFactor } from '../../database/migrate-admin-two-factor';
import adminRoutes from '../../routes/admin.routes';
import { resetTwoFactor, twoFactorKeyReport } from '../../services/admin-two-factor.service';
import { openSecret } from '../../utils/secret-box';
import { recoveryKeys } from '../../utils/recovery-code';
import { totpCode } from '../../utils/totp';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../middleware/rate-limit', () => ({
  apiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Own only admin_two_factor_test_${pid}; never run against the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 管理员两步验证', () => {
  const database = `admin_two_factor_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const PASSWORD = 'correct horse battery staple';
  const app = express(); app.use(express.json()); app.use('/api/admin', adminRoutes);
  const XRW = { 'X-Requested-With': 'XMLHttpRequest' };
  const step = () => Math.floor(Date.now() / 1000 / 30);
  const row = async () => ((await db.query<RowDataPacket[]>('SELECT * FROM admins WHERE admin_id = 1'))[0])[0];

  const KEY = randomBytes(32).toString('base64');
  beforeAll(async () => {
    process.env.ADMIN_TOTP_KEY = KEY;
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`\s*(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) await db.query(match[1]);
    await migrateAdminTwoFactor(db);
  });

  afterAll(async () => {
    delete process.env.ADMIN_TOTP_KEY; delete process.env.ADMIN_TOTP_KEY_PREVIOUS;
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    process.env.ADMIN_TOTP_KEY = KEY; delete process.env.ADMIN_TOTP_KEY_PREVIOUS;
    for (const table of ['admin_recovery_codes', 'admin_logs', 'admins', 'roles']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO roles (role_id, role_name) VALUES (1, 'super_admin')");
    await db.query('INSERT INTO admins (admin_id, username, password_hash, role_id, status) VALUES (1, ?, ?, 1, 1)', ['boss', await bcrypt.hash(PASSWORD, 4)]);
  });

  const passwordStep = async (agent = request.agent(app)) => {
    const res = await agent.post('/api/admin/login').set(XRW).send({ username: 'boss', password: PASSWORD }).expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    return { agent, body: res.body as { two_factor: string; challenge: string } };
  };

  async function enroll() {
    const { agent, body } = await passwordStep();
    expect(body.two_factor).toBe('setup');
    const setup = await agent.post('/api/admin/login/2fa/setup').set(XRW).send({ challenge: body.challenge }).expect(200);
    const activated = await agent.post('/api/admin/login/2fa/activate').set(XRW).send({ challenge: body.challenge, code: totpCode(setup.body.secret, step()) }).expect(200);
    return { agent, secret: setup.body.secret as string, recoveryCodes: activated.body.recovery_codes as string[] };
  }

  test('首次登录必须绑定验证器：密码只换来挑战，确认后才有会话和 10 个恢复码', async () => {
    const { agent, body } = await passwordStep();
    expect(body).toEqual({ two_factor: 'setup', challenge: expect.any(String) });
    await agent.get('/api/admin/profile').expect(401);
    // A setup challenge cannot be used to sign in directly.
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: '000000' }).expect(401);

    const setup = await agent.post('/api/admin/login/2fa/setup').set(XRW).send({ challenge: body.challenge }).expect(200);
    expect(setup.headers['cache-control']).toBe('no-store');
    expect(setup.body.otpauth_uri).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]+&issuer=/);
    const stored = await row();
    expect(stored.totp_secret).toMatch(/^v1:/);
    expect(stored.totp_secret).not.toContain(setup.body.secret);
    expect(stored.totp_enabled_at).toBeNull();

    await agent.post('/api/admin/login/2fa/activate').set(XRW).send({ challenge: body.challenge, code: '000000' }).expect(401);
    const activated = await agent.post('/api/admin/login/2fa/activate').set(XRW)
      .send({ challenge: body.challenge, code: totpCode(setup.body.secret, step()) }).expect(200);
    expect(activated.body.recovery_codes).toHaveLength(10);
    expect(new Set(activated.body.recovery_codes).size).toBe(10);
    expect(activated.body.admin).toMatchObject({ admin_id: 1, username: 'boss' });
    expect(activated.headers['set-cookie'][0]).toMatch(/^admin_session=/);
    await agent.get('/api/admin/profile').expect(200);
    // 160 random bits each, stored only as a keyed HMAC under the current key.
    for (const code of activated.body.recovery_codes) expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){7}$/);
    const hashes = (await db.query<RowDataPacket[]>('SELECT code_hash, key_id FROM admin_recovery_codes WHERE admin_id = 1'))[0];
    expect(hashes).toHaveLength(10);
    expect(new Set(hashes.map(hash => hash.key_id))).toEqual(new Set([recoveryKeys()[0].id]));
    const plainDigest = createHash('sha256').update(activated.body.recovery_codes[0].replace(/-/g, '')).digest('hex');
    expect(hashes.map(hash => hash.code_hash)).not.toContain(plainDigest);
    expect(JSON.stringify(hashes)).not.toContain(activated.body.recovery_codes[0]);
  });

  test('已绑定：动态码登录，同一个时间步不能重放', async () => {
    const { secret } = await enroll();
    const { agent, body } = await passwordStep();
    expect(body.two_factor).toBe('verify');
    // The activation consumed the current step; the next step is within the allowed drift.
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: totpCode(secret, step()) }).expect(401);
    const next = totpCode(secret, step() + 1);
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: next }).expect(200);
    await agent.get('/api/admin/profile').expect(200);
    const again = await passwordStep();
    const replay = await again.agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: again.body.challenge, code: next }).expect(401);
    expect(replay.body).toEqual({ error: '验证码错误' });
  });

  test('恢复码只能用一次，并报告剩余数量', async () => {
    const { recoveryCodes } = await enroll();
    const first = await passwordStep();
    const typed = recoveryCodes[0].toUpperCase().replace(/-/g, ' ');
    const used = await first.agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: first.body.challenge, code: typed }).expect(200);
    expect(used.body.recovery_codes_remaining).toBe(9);
    expect(used.body.recovery_codes).toBeUndefined();
    const second = await passwordStep();
    await second.agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: second.body.challenge, code: recoveryCodes[0] }).expect(401);
    const logs = (await db.query<RowDataPacket[]>("SELECT description FROM admin_logs WHERE action = 'TWO_FACTOR_RECOVERY'"))[0];
    expect(logs).toEqual([expect.objectContaining({ description: '使用恢复码登录，剩余 9 个' })]);
  });

  test('当前密钥下没有可用恢复码时（迁移作废、用完），登录同时发放新的一组，旧码作废', async () => {
    const { secret, recoveryCodes } = await enroll();
    await db.query('UPDATE admin_recovery_codes SET used_at = NOW() WHERE admin_id = 1');
    const { agent, body } = await passwordStep();
    const res = await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: totpCode(secret, step() + 1) }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.recovery_codes).toHaveLength(10);
    expect(res.body.recovery_codes).not.toContain(recoveryCodes[0]);
    expect((await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM admin_recovery_codes WHERE used_at IS NULL'))[0][0].n).toBe(10);
    const logs = (await db.query<RowDataPacket[]>("SELECT description FROM admin_logs WHERE action = 'TWO_FACTOR_RECOVERY_CODES'"))[0];
    expect(logs).toEqual([expect.objectContaining({ description: '发放新的恢复码' })]);
  });

  test('早期 40 位恢复码格式一律拒绝', async () => {
    await enroll();
    const { agent, body } = await passwordStep();
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: 'a1b2c-d3e4f' }).expect(401);
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: 'x'.repeat(65) }).expect(401);
  });

  test('平滑轮换 ADMIN_TOTP_KEY：过渡期旧数据可用，登录后迁到新密钥，检查命令确认可删除旧密钥', async () => {
    const { secret, recoveryCodes } = await enroll();
    process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
    process.env.ADMIN_TOTP_KEY_PREVIOUS = KEY;
    expect(await twoFactorKeyReport(false)).toEqual({ resealed: [], staleSecrets: ['boss'], unreadableSecrets: [], staleRecoveryCodes: ['boss'] });

    // A recovery code hashed with the previous key still signs in, and the sign-in moves everything to the new key.
    const { agent, body } = await passwordStep();
    const res = await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: recoveryCodes[1] }).expect(200);
    expect(res.body.recovery_codes_remaining).toBe(0);
    expect(res.body.recovery_codes).toHaveLength(10);
    expect(await twoFactorKeyReport(false)).toEqual({ resealed: [], staleSecrets: [], unreadableSecrets: [], staleRecoveryCodes: [] });

    // Without the previous key the authenticator and the new codes keep working.
    delete process.env.ADMIN_TOTP_KEY_PREVIOUS;
    expect(openSecret((await row()).totp_secret)).toBe(secret);
    const next = await passwordStep();
    await next.agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: next.body.challenge, code: res.body.recovery_codes[0] }).expect(200);
  });

  test('轮换检查 --rekey 直接把验证器密钥迁到新密钥；两把密钥都解不开时列为需要重置', async () => {
    const { secret } = await enroll();
    process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
    process.env.ADMIN_TOTP_KEY_PREVIOUS = KEY;
    expect((await twoFactorKeyReport(true)).resealed).toEqual(['boss']);
    delete process.env.ADMIN_TOTP_KEY_PREVIOUS;
    expect(openSecret((await row()).totp_secret)).toBe(secret);
    process.env.ADMIN_TOTP_KEY = randomBytes(32).toString('base64');
    expect((await twoFactorKeyReport(false)).unreadableSecrets).toEqual(['boss']);
  });

  test('迁移作废早期无密钥恢复码并补上 key_id，可重复执行', async () => {
    await db.query('DROP TABLE admin_recovery_codes');
    await db.query(`CREATE TABLE admin_recovery_codes (admin_id BIGINT NOT NULL, code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      used_at TIMESTAMP NULL DEFAULT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (admin_id, code_hash),
      FOREIGN KEY (admin_id) REFERENCES admins(admin_id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query("INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES (1, REPEAT('a', 64))");
    await migrateAdminTwoFactor(db);
    await migrateAdminTwoFactor(db);
    expect((await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM admin_recovery_codes'))[0][0].n).toBe(0);
    const [columns] = await db.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_recovery_codes' AND COLUMN_NAME = 'key_id'");
    expect(columns).toHaveLength(1);
  });

  test('没有经过两步验证的会话（包括升级前签发的）一律拒绝', async () => {
    await enroll();
    const legacy = jwt.sign({ adminId: 1, username: 'boss', roleId: 1, authVersion: 0, type: 'admin' }, 'test-jwt-secret', { expiresIn: '1h' });
    const res = await request(app).get('/api/admin/profile').set('Cookie', `admin_session=${legacy}`).expect(401);
    expect(res.body).toEqual({ error: '需要两步验证，请重新登录' });
  });

  test('挑战令牌：过期、被篡改、或管理员已退出后都无效', async () => {
    await enroll();
    const { agent, body } = await passwordStep();
    const forged = jwt.sign({ type: 'admin-challenge', purpose: 'verify', adminId: 1, authVersion: 0 }, 'not-the-secret');
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: forged, code: '123456' }).expect(401);
    const expired = jwt.sign({ type: 'admin-challenge', purpose: 'verify', adminId: 1, authVersion: 0, exp: Math.floor(Date.now() / 1000) - 1 }, 'test-jwt-secret');
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: expired, code: '123456' }).expect(401);
    await db.query('UPDATE admins SET auth_version = auth_version + 1 WHERE admin_id = 1');
    const stale = await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: '123456' }).expect(401);
    expect(stale.body).toEqual({ error: '验证已过期，请重新输入密码' });
  });

  test('禁用的管理员在第二步也被拒绝', async () => {
    const { secret } = await enroll();
    const { agent, body } = await passwordStep();
    await db.query('UPDATE admins SET status = 0 WHERE admin_id = 1');
    await agent.post('/api/admin/login/2fa').set(XRW).send({ challenge: body.challenge, code: totpCode(secret, step() + 1) }).expect(403);
  });

  test('运维重置后旧会话失效，下次登录重新绑定', async () => {
    const { agent } = await enroll();
    expect(await resetTwoFactor('boss')).toBe(true);
    await agent.get('/api/admin/profile').expect(401);
    expect((await passwordStep()).body.two_factor).toBe('setup');
    expect((await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM admin_recovery_codes'))[0][0].n).toBe(0);
    expect(await resetTwoFactor('nobody')).toBe(false);
  });

  test('第二步需要可信来源头', async () => {
    const { body } = await passwordStep();
    await request(app).post('/api/admin/login/2fa/setup').send({ challenge: body.challenge }).expect(403);
  });
});
