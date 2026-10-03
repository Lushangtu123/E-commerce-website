import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool } from '../../database/mysql';
import { AddressModel } from '../../models/address.model';
import addressRoutes from '../../routes/address.routes';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));

// Opt in to the isolated local test server; this suite never connects to the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 地址事务及并发', () => {
  const database = `address_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 8,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const fields = { receiver_name: ' 收件人 ', phone: ' +86 138-0000-0000 ', province: ' 省 ', city: ' 市 ', district: ' 区 ', detail_address: ' 道路1号 ' };
  const app = express(); app.use(express.json()); app.use('/api/addresses', addressRoutes);
  const auth = (userId = 1) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const tables = new Set(['users', 'shipping_addresses']);
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (tables.has(match[2])) await db.query(match[1]);
    }
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    await db.query('DELETE FROM shipping_addresses');
    await db.query('DELETE FROM users');
    await db.query(`INSERT INTO users (user_id,username,email,password_hash)
      VALUES (1,'one','one@example.test','test'),(2,'two','two@example.test','test')`);
  });

  async function rows(userId = 1) {
    const [addresses] = await db.query<RowDataPacket[]>('SELECT * FROM shipping_addresses WHERE user_id = ? ORDER BY address_id', [userId]);
    return addresses;
  }

  function expectOneDefault(addresses: RowDataPacket[]) {
    expect(addresses.filter(address => address.is_default === 1)).toHaveLength(addresses.length ? 1 : 0);
  }

  test('真实HTTP CRUD完整trim、返回合同、跨用户404，默认删除提升最小ID', async () => {
    const first = await request(app).post('/api/addresses').set(auth()).send(fields).expect(201);
    const second = await request(app).post('/api/addresses').set(auth()).send({ ...fields, receiver_name: '第二人' }).expect(201);
    const listed = await request(app).get('/api/addresses').set(auth()).expect(200);
    expect(listed.body.addresses).toHaveLength(2);
    expect(listed.body.addresses[0]).toMatchObject({ address_id: first.body.address_id, receiver_name: '收件人', phone: '+86 138-0000-0000', is_default: true });
    await request(app).put(`/api/addresses/${second.body.address_id}`).set(auth(2)).send(fields).expect(404);
    await request(app).delete(`/api/addresses/${first.body.address_id}`).set(auth(2)).expect(404);
    await request(app).delete(`/api/addresses/${first.body.address_id}`).set(auth()).expect(200);
    expect(await rows()).toEqual([expect.objectContaining({ address_id: second.body.address_id, is_default: 1 })]);
    await request(app).put(`/api/addresses/${second.body.address_id}`).set(auth()).send({ ...fields, is_default: false }).expect(200);
    expectOneDefault(await rows());
    await request(app).delete(`/api/addresses/${second.body.address_id}`).set(auth()).expect(200);
    expect(await rows()).toHaveLength(0);
  });

  test('空列表并发新增也只保留一个默认地址', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, (_, index) => AddressModel.create(1, { ...fields, receiver_name: `收件人${index}` })));
    expect(new Set(ids).size).toBe(8);
    const addresses = await rows();
    expect(addresses).toHaveLength(8);
    expectOneDefault(addresses);
    expect(addresses[0].is_default).toBe(1);
  });

  test('19条时并发新增只成功一次，20条上限按用户独立', async () => {
    for (let index = 0; index < 19; index++) await AddressModel.create(1, fields);
    const attempts = await Promise.allSettled([AddressModel.create(1, fields), AddressModel.create(1, fields)]);
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    const failure: any = attempts.find(attempt => attempt.status === 'rejected');
    expect(failure.reason).toMatchObject({ statusCode: 400 });
    const addresses = await rows(); expect(addresses).toHaveLength(20); expectOneDefault(addresses);
    await AddressModel.create(2, fields);
    expectOneDefault(await rows(2));
  });

  test('并发设置不同默认地址与删除默认后仍恰好一个默认项', async () => {
    const first = await AddressModel.create(1, fields);
    const second = await AddressModel.create(1, fields);
    const third = await AddressModel.create(1, fields);
    await Promise.all([AddressModel.update(1, second, { ...fields, is_default: true }), AddressModel.update(1, third, { ...fields, is_default: true })]);
    const beforeDelete = await rows(); expectOneDefault(beforeDelete);
    const defaultId = beforeDelete.find(address => address.is_default === 1)!.address_id;
    await Promise.all([AddressModel.remove(1, defaultId), AddressModel.update(1, first, { ...fields, is_default: true })]);
    const remaining = await rows(); expect(remaining).toHaveLength(2); expectOneDefault(remaining);
    expect(remaining.find(address => address.address_id === first)?.is_default).toBe(1);
  });

  test('false切换到其他最小地址，删除默认提升最小地址；零或多个旧默认写入时修复', async () => {
    const first = await AddressModel.create(1, fields);
    const second = await AddressModel.create(1, fields);
    const third = await AddressModel.create(1, fields);
    await AddressModel.update(1, first, { ...fields, is_default: false });
    expect((await rows()).find(address => address.is_default === 1)?.address_id).toBe(second);
    await AddressModel.remove(1, second);
    expect((await rows()).find(address => address.is_default === 1)?.address_id).toBe(first);
    await db.query('UPDATE shipping_addresses SET is_default = 0 WHERE user_id = 1');
    await AddressModel.update(1, third, fields); expectOneDefault(await rows());
    await db.query('UPDATE shipping_addresses SET is_default = 1 WHERE user_id = 1');
    await AddressModel.update(1, third, fields); expectOneDefault(await rows());
    expect((await rows())[0].is_default).toBe(1);
  });

  test('默认写入数据库异常完整回滚新增地址', async () => {
    await db.query("CREATE TRIGGER address_test_fail BEFORE UPDATE ON shipping_addresses FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'default update fail'");
    try {
      await expect(AddressModel.create(1, fields)).rejects.toThrow('default update fail');
      expect(await rows()).toHaveLength(0);
    } finally { await db.query('DROP TRIGGER address_test_fail'); }
    await AddressModel.create(1, fields); expectOneDefault(await rows());
  });

  test('BIGINT历史地址超过INT上限仍可通过接口编辑删除，不存在用户拒绝写入', async () => {
    await db.query(`INSERT INTO shipping_addresses (address_id,user_id,receiver_name,phone,province,city,district,detail_address,is_default)
      VALUES (2147483648,1,'历史人','13800000000','省','市','区','原地址',1)`);
    await request(app).put('/api/addresses/2147483648').set(auth()).send({ ...fields, detail_address: '新地址' }).expect(200);
    expect((await rows())[0]).toMatchObject({ address_id: 2147483648, detail_address: '新地址', is_default: 1 });
    await request(app).delete('/api/addresses/2147483648').set(auth()).expect(200);
    await expect(AddressModel.create(999, fields)).rejects.toMatchObject({ statusCode: 404 });
    expect(await rows()).toHaveLength(0);
  });
});
