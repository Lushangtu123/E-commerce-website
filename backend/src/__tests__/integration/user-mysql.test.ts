import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../../database/mysql';
import userRoutes from '../../routes/user.routes';

jest.mock('../../database/mysql', () => ({ query: jest.fn() }));

// Opt-in, isolated database. Never read or mutate the application's DB_NAME.
const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;
integration('真实 MySQL 账户HTTP契约', () => {
  const database = `ecom_user_validation_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } :
      { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    connectionLimit: 8, timezone: '+00:00',
  };
  let server: Pool;
  let db: Pool;
  let created = false;
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  const auth = (userId: number) => `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!)}`;
  const registration = { username: '新客户', email: 'new@example.test', password: '  exact 密码 password123  ' };

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const schema = [...source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)].find(match => match[2] === 'users');
    await db.query(schema![1]);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (created) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    await db.query('DELETE FROM users');
    await db.query("INSERT INTO users (user_id,username,email,password_hash,phone,avatar_url) VALUES (1,'existing','existing@example.test','private-hash','old phone','https://example.test/old.png'),(2,'other','other@example.test','other-hash','other phone',NULL)");
  });

  test('注册和登录保存完整密码并返回公开资料', async () => {
    const created = await request(app).post('/api/users/register').set('X-Requested-With', 'XMLHttpRequest').send({ ...registration, username: '  单 ', email: ' new@example.test ' });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ username: '单', email: 'new@example.test' });
    expect(created.body.user.password_hash).toBeUndefined();
    const [users] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE email = ?', [registration.email]);
    expect(await bcrypt.compare(registration.password, users[0].password_hash)).toBe(true);
    const login = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: ' new@example.test ', password: registration.password });
    expect(login.status).toBe(200);
    expect(login.body.user.user_id).toBe(users[0].user_id);
    expect(login.body.user.password_hash).toBeUndefined();
  });

  test('并发注册同一账户仅成功一次，冲突返回409', async () => {
    const results = await Promise.all([
      request(app).post('/api/users/register').set('X-Requested-With', 'XMLHttpRequest').send(registration),
      request(app).post('/api/users/register').set('X-Requested-With', 'XMLHttpRequest').send(registration),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(results.find(result => result.status === 409)?.body.error).toMatch(/已被/);
    expect((await db.query<RowDataPacket[]>('SELECT * FROM users WHERE email = ?', [registration.email]))[0]).toHaveLength(1);
  });

  test('无效注册和资料更新均不改变数据库记录', async () => {
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM users ORDER BY user_id');
    expect((await request(app).post('/api/users/register').set('X-Requested-With', 'XMLHttpRequest').send({ ...registration, password: '汉'.repeat(25) })).status).toBe(400);
    expect((await request(app).put('/api/users/profile').set('Authorization', auth(1)).send({})).status).toBe(400);
    expect((await request(app).put('/api/users/profile').set('Authorization', auth(1)).send({ email: 'other@example.test' })).status).toBe(400);
    expect((await db.query<RowDataPacket[]>('SELECT * FROM users ORDER BY user_id'))[0]).toEqual(before);
  });

  test('本人资料可清空、重复保存，冲突时原值保留且不影响其他账户', async () => {
    const response = await request(app).put('/api/users/profile').set('Authorization', auth(1)).send({ username: ' changed ', phone: ' ', avatar_url: null });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ user_id: 1, username: 'changed', phone: null, avatar_url: null });
    expect(response.body.user.password_hash).toBeUndefined();
    expect((await request(app).put('/api/users/profile').set('Authorization', auth(1)).send({ username: 'changed' })).status).toBe(200);
    expect((await request(app).put('/api/users/profile').set('Authorization', auth(1)).send({ username: 'other' })).status).toBe(409);
    const [users] = await db.query<RowDataPacket[]>('SELECT * FROM users ORDER BY user_id');
    expect(users[0]).toMatchObject({ username: 'changed', phone: null, avatar_url: null, email: 'existing@example.test', password_hash: 'private-hash' });
    expect(users[1]).toMatchObject({ username: 'other', phone: 'other phone', password_hash: 'other-hash' });
  });

  test.each([' 1 ', 'x'.repeat(80)])('旧账户密码长度保持兼容，原密码必须匹配', async password => {
    const password_hash = await bcrypt.hash(password, 4);
    await db.query('UPDATE users SET email = ?, password_hash = ? WHERE user_id = 1', ['legacy-email', password_hash]);
    const login = await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: ' legacy-email ', password });
    expect(login.status).toBe(200);
    expect(login.body.user.user_id).toBe(1);
    expect((await request(app).post('/api/users/login').set('X-Requested-With', 'XMLHttpRequest').send({ email: 'legacy-email', password: 'incorrect' })).status).toBe(401);
  });

  test('资料读取和更新要求有效用户令牌，已删除账户撤销会话返回401', async () => {
    expect((await request(app).get('/api/users/profile')).status).toBe(401);
    expect((await request(app).put('/api/users/profile').send({ username: 'changed' })).status).toBe(401);
    const profile = await request(app).get('/api/users/profile').set('Authorization', auth(1));
    expect(profile.status).toBe(200);
    expect(profile.body.user.password_hash).toBeUndefined();
    expect((await request(app).put('/api/users/profile').set('Authorization', auth(99)).send({ username: 'missing' })).status).toBe(401);
  });
});
