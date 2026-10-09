import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import addressRoutes from '../../routes/address.routes';
import { migrateAddressCreations } from '../../database/migrate-address-creations';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 地址新增收据', () => {
  const database = `address_creations_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 10,
  };
  let server: Pool, db: Pool;
  let created = false;
  const key = '861dc7fb-0207-4b9a-98c3-95e6d28acb28';
  const fields = { receiver_name: ' 收件人 ', phone: ' +86 138-0000-0000 ', province: ' 省 ', city: ' 市 ', district: ' 区 ', detail_address: ' 道路1号 ' };
  const app = express(); app.use(express.json()); app.use('/api/addresses', addressRoutes);
  const auth = (userId = 1) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });
  const post = (body: object = { ...fields, create_key: key }, userId = 1) => request(app).post('/api/addresses').set(auth(userId)).send(body);
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'shipping_addresses'].includes(match[2])) await db.query(match[1]);
    }
    await migrateAddressCreations(db);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM address_creation_receipts');
    await db.query('DELETE FROM shipping_addresses');
    await db.query('DELETE FROM users');
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'one','one@example.test','x'),(2,'two','two@example.test','x')");
  });
  const rows = async (table: string) => (await db.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY user_id,address_id`))[0];

  test('相同用户请求号并发仅插入一次，首次201、重放200均返回同一ID', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => post()));
    expect(responses.map(response => response.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map(response => response.body.address_id)).size).toBe(1);
    expect(responses.find(response => response.status === 201)!.body.creation_status).toBe('created');
    expect(responses.filter(response => response.status === 200).every(response => response.body.creation_status === 'replayed')).toBe(true);
    expect(await rows('shipping_addresses')).toHaveLength(1);
    expect(await rows('address_creation_receipts')).toHaveLength(1);
  });
  test('标准化原字段重放不改地址或默认值，变更载荷409；同key对其他用户独立', async () => {
    const first = await post().expect(201);
    await request(app).put(`/api/addresses/${first.body.address_id}`).set(auth()).send({ ...fields, detail_address: '编辑后地址' }).expect(200);
    const trimmed = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.trim()]));
    await post({ ...trimmed, is_default: false, create_key: key }).expect(200);
    await post({ ...fields, detail_address: '另一地址', create_key: key }).expect(409);
    await post({ ...fields, create_key: key }, 2).expect(201);
    expect((await rows('shipping_addresses'))[0].detail_address).toBe('编辑后地址');
  });
  test('物理删除后重放返回typed deleted原ID且不重建，变更内容仍409', async () => {
    const first = await post().expect(201);
    await request(app).delete(`/api/addresses/${first.body.address_id}`).set(auth()).expect(200);
    const replay = await post().expect(200);
    expect(replay.body).toMatchObject({ address_id: first.body.address_id, creation_status: 'deleted' });
    await post({ ...fields, receiver_name: '变更姓名', create_key: key }).expect(409);
    expect(await rows('shipping_addresses')).toHaveLength(0);
    expect(await rows('address_creation_receipts')).toHaveLength(1);
  });
  test('20地址上限先识别旧请求收据，默认写失败回滚地址及收据', async () => {
    await post().expect(201);
    for (let index = 0; index < 19; index++) await post(fields).expect(201);
    await post().expect(200);
    await post({ ...fields, create_key: '0272a762-b4f9-43da-8e56-79405f7dab36' }).expect(400);
    await db.query('DELETE FROM shipping_addresses');
    await db.query('DELETE FROM address_creation_receipts');
    await db.query("CREATE TRIGGER address_receipt_fail BEFORE UPDATE ON shipping_addresses FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'default fail'");
    try { await post().expect(500); } finally { await db.query('DROP TRIGGER address_receipt_fail'); }
    expect(await rows('shipping_addresses')).toHaveLength(0);
    expect(await rows('address_creation_receipts')).toHaveLength(0);
  });
  test('可选key保留历史API，非法key/未知字段400，编辑不得接受create_key', async () => {
    await post(fields).expect(201);
    for (const create_key of ['', 'bad', 123, null]) await post({ ...fields, create_key }).expect(400);
    await post({ ...fields, create_key: key, surprise: true }).expect(400);
    await request(app).put('/api/addresses/1').set(auth()).send({ ...fields, create_key: key }).expect(400);
    expect(await rows('address_creation_receipts')).toHaveLength(0);
  });
  test('云库要求主键时仍可新建收据表并通过结构检查', async () => {
    const connection = await db.getConnection();
    try {
      await connection.query('DROP TABLE address_creation_receipts');
      await connection.query('SET SESSION sql_require_primary_key = ON');
      await migrateAddressCreations(connection as unknown as Pool);
      await migrateAddressCreations(connection as unknown as Pool, true);
    } finally {
      try {
        await connection.query('SET SESSION sql_require_primary_key = OFF');
        await migrateAddressCreations(connection as unknown as Pool);
      } finally { connection.release(); }
    }
    const created = await post().expect(201);
    const replay = await post().expect(200);
    expect(replay.body.address_id).toBe(created.body.address_id);
    expect(await rows('shipping_addresses')).toHaveLength(1);
  });
  test('迁移可重跑且原地址/收据不变，--check识别缺失表和不兼容索引', async () => {
    await post().expect(201);
    const addresses = await rows('shipping_addresses'), receipts = await rows('address_creation_receipts');
    await migrateAddressCreations(db); await migrateAddressCreations(db, true);
    expect(await rows('shipping_addresses')).toEqual(addresses);
    expect(await rows('address_creation_receipts')).toEqual(receipts);
    await db.query('ALTER TABLE address_creation_receipts DROP INDEX unique_user_create_key');
    await expect(migrateAddressCreations(db, true)).rejects.toThrow('唯一索引结构不兼容');
    await db.query('DROP TABLE address_creation_receipts');
    await expect(migrateAddressCreations(db, true)).rejects.toThrow('尚未迁移');
    await migrateAddressCreations(db);
    await migrateAddressCreations(db, true);
    expect(await rows('shipping_addresses')).toEqual(addresses);
  });
});
