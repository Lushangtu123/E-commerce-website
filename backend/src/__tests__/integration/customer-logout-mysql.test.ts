/**
 * Customer logout revokes every session of the account on the server (auth_version + 1), so a
 * copied cookie or Bearer token stops working at once instead of living until the JWT expires.
 */
import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../database/mysql';
import { migrateAccountSecurity } from '../../database/migrate-account-security';
import userRoutes from '../../routes/user.routes';

jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));
jest.mock('../../middleware/rate-limit', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return new Proxy({}, { get: () => pass });
});

// Opt-in, isolated database. Never read or mutate the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 顾客退出撤销会话', () => {
  const database = `customer_logout_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } :
      { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    connectionLimit: 4, timezone: '+00:00',
  };
  let server: Pool;
  let db: Pool;
  let created = false;
  let failRevocation = false;
  const app = express(); app.use(express.json()); app.use('/api/users', userRoutes);
  const csrf = { 'X-Requested-With': 'XMLHttpRequest' };
  const PASSWORD = 'correct horse battery staple';
  const version = async () => Number((await db.query<RowDataPacket[]>('SELECT auth_version FROM users WHERE user_id = 1'))[0][0].auth_version);
  const cookieOf = (res: request.Response) => ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .map(value => value.split(';')[0]).find(value => value.startsWith('customer_session='));
  const signIn = async () => {
    const res = await request(app).post('/api/users/login').set(csrf).send({ email: 'one@example.test', password: PASSWORD }).expect(200);
    return cookieOf(res)!;
  };
  const profile = (cookie: string) => request(app).get('/api/users/profile').set('Cookie', cookie);
  const logout = (cookie?: string) => {
    const req = request(app).post('/api/users/logout').set(csrf);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const schema = [...source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)].find(match => match[2] === 'users');
    await db.query(schema![1]);
    await migrateAccountSecurity(db as never);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: unknown[]) => {
      if (failRevocation && (sql.startsWith('UPDATE users SET auth_version') || sql.includes('INTO customer_session_revocations'))) {
        throw new Error('database unavailable');
      }
      return (await db.query(sql, values))[0];
    });
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (created) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    failRevocation = false;
    await db.query('DELETE FROM customer_session_revocations');
    await db.query('DELETE FROM users');
    const hash = await require('bcryptjs').hash(PASSWORD, 4);
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'one','one@example.test',?)", [hash]);
  });

  test('退出后被复制的旧 Cookie 立即失效，其他设备的会话也一起失效', async () => {
    const copied = await signIn();
    const otherDevice = await signIn();
    await profile(copied).expect(200);
    const out = await logout(copied).expect(200);
    expect(out.body).toEqual({ message: '已退出登录' });
    expect(cookieOf(out)).toBe('customer_session=');
    expect(await version()).toBe(1);
    expect((await profile(copied).expect(401)).body.error).toBe('登录已过期，请重新登录');
    await profile(otherDevice).expect(401);
  });

  test('重复退出不会再撤销之后重新登录的新会话', async () => {
    const old = await signIn();
    await logout(old).expect(200);
    const fresh = await signIn();
    await logout(old).expect(200);
    expect(await version()).toBe(1);
    await profile(fresh).expect(200);
  });

  test('Bearer 令牌退出同样撤销', async () => {
    const token = (await signIn()).split('=')[1];
    await request(app).post('/api/users/logout').set(csrf).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/users/profile').set('Authorization', `Bearer ${token}`).expect(401);
  });

  test.each([
    ['伪造签名', `customer_session=${jwt.sign({ userId: 1, authVersion: 0 }, 'wrong-secret')}`],
    ['过期令牌', `customer_session=${jwt.sign({ userId: 1, authVersion: 0 }, process.env.JWT_SECRET!, { expiresIn: -10 })}`],
    ['管理员令牌', `customer_session=${jwt.sign({ adminId: 1, type: 'admin', authVersion: 0 }, process.env.JWT_SECRET!)}`],
    ['没有 Cookie', undefined],
  ])('%s：只清除 Cookie，不改动任何账号', async (_, cookie) => {
    const out = await logout(cookie).expect(200);
    expect(out.body).toEqual({ message: '已退出登录' });
    expect(await version()).toBe(0);
  });

  test('撤销失败时返回 503 且保留 Cookie，恢复后重试才确认退出', async () => {
    const cookie = await signIn();
    failRevocation = true;
    const failed = await logout(cookie).expect(503);
    expect(failed.body).toEqual({ error: '退出登录暂不可用，请稍后重试' });
    expect(cookieOf(failed)).toBeUndefined();
    expect(await version()).toBe(0);
    failRevocation = false;
    await logout(cookie).expect(200);
    await profile(cookie).expect(401);
  });

  test('没有 CSRF 头时拒绝退出且不撤销', async () => {
    const cookie = await signIn();
    await request(app).post('/api/users/logout').set('Cookie', cookie).expect(403);
    expect(await version()).toBe(0);
    await profile(cookie).expect(200);
  });

  describe('放弃一次未完成的登录（session/discard）', () => {
    const discard = (cookie?: string) => {
      const req = request(app).post('/api/users/session/discard').set(csrf);
      return cookie ? req.set('Cookie', cookie) : req;
    };

    test('只撤销这一次登录的会话，其他设备保持登录', async () => {
      const abandoned = await signIn();
      const otherDevice = await signIn();
      const out = await discard(abandoned).expect(200);
      expect(out.body).toEqual({ message: '已退出登录' });
      expect(cookieOf(out)).toBe('customer_session=');
      await profile(abandoned).expect(401);
      await profile(otherDevice).expect(200);
      expect(await version()).toBe(0);
      // Repeating it is harmless.
      await discard(abandoned).expect(200);
      await profile(otherDevice).expect(200);
    });

    test('之后的“退出所有设备”仍撤销全部会话', async () => {
      const abandoned = await signIn();
      const otherDevice = await signIn();
      await discard(abandoned).expect(200);
      await logout(otherDevice).expect(200);
      await profile(otherDevice).expect(401);
    });

    test('没有会话标识的旧令牌无法单独撤销，退回撤销全部会话', async () => {
      const legacy = `customer_session=${jwt.sign({ userId: 1, type: 'user', authVersion: 0 }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
      const otherDevice = await signIn();
      await discard(legacy).expect(200);
      expect(await version()).toBe(1);
      await profile(legacy).expect(401);
      await profile(otherDevice).expect(401);
    });

    test('撤销失败时返回 503 且保留 Cookie，恢复后重试才确认', async () => {
      const abandoned = await signIn();
      failRevocation = true;
      const failed = await discard(abandoned).expect(503);
      expect(failed.body).toEqual({ error: '退出登录暂不可用，请稍后重试' });
      expect(cookieOf(failed)).toBeUndefined();
      await profile(abandoned).expect(200);
      failRevocation = false;
      await discard(abandoned).expect(200);
      await profile(abandoned).expect(401);
    });

    test('撤销记录保存到令牌过期，没有 CSRF 头时拒绝', async () => {
      const abandoned = await signIn();
      await request(app).post('/api/users/session/discard').set('Cookie', abandoned).expect(403);
      await discard(abandoned).expect(200);
      const [rows] = await db.query<RowDataPacket[]>('SELECT user_id, expires_at > NOW() AS live FROM customer_session_revocations');
      expect(rows).toEqual([expect.objectContaining({ user_id: 1, live: 1 })]);
    });
  });
});
