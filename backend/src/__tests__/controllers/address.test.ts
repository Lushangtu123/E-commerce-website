jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import addressRoutes from '../../routes/address.routes';

const app = express(); app.use(express.json()); app.use('/api/addresses', addressRoutes);
const token = (userId = 1) => ({ Authorization: `Bearer ${jwt.sign({ userId }, 'test-jwt-secret')}` });
const fields = { receiver_name: '  收件人  ', phone: ' +86 138-0000-0000 ', province: ' 省 ', city: ' 市 ', district: ' 区 ', detail_address: ' 道路1号 ' };
let db: any;
let connection: any;
let rows: any[];

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue([{ auth_version: 0 }]);
  rows = [{ address_id: 3, user_id: 1, receiver_name: '收件人', phone: '13800000000', province: '省', city: '市', district: '区', detail_address: '道路1号', is_default: 1, created_at: '2026-10-02' }];
  connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM users')) return [[{ user_id: params[0] }], []];
      if (sql.startsWith('SELECT')) return [rows.filter(address => address.user_id === params[0]), []];
      return [{ insertId: 21, affectedRows: 1 }, []];
    }),
  };
  db = { getConnection: jest.fn().mockResolvedValue(connection), execute: jest.fn(async (_sql: string, params: any[]) => [rows.filter(address => address.user_id === params[0]), []]) };
  (getPool as jest.Mock).mockReturnValue(db);
});

test('全部地址端点都需要用户令牌，管理员令牌不能替代用户登录', async () => {
  await request(app).get('/api/addresses').expect(401);
  await request(app).post('/api/addresses').send(fields).expect(401);
  await request(app).put('/api/addresses/3').send(fields).expect(401);
  await request(app).delete('/api/addresses/3').expect(401);
  const admin = jwt.sign({ adminId: 1, type: 'admin' }, 'test-jwt-secret');
  await request(app).get('/api/addresses').set('Authorization', `Bearer ${admin}`).expect(401);
  expect(getPool).not.toHaveBeenCalled();
});

test('地址读取仅返回当前用户，default为boolean，空列表保持响应形状', async () => {
  const result = await request(app).get('/api/addresses').set(token()).expect(200);
  expect(result.body.addresses).toHaveLength(1);
  expect(result.body.addresses[0]).toMatchObject({ address_id: 3, user_id: 1, is_default: true });
  expect((await request(app).get('/api/addresses').set(token(2)).expect(200)).body).toEqual({ addresses: [] });
});

test('创建返回201和ID，严格trim后绑定服务端用户ID；完整更新与删除保持响应合同', async () => {
  const created = await request(app).post('/api/addresses').set(token()).send(fields).expect(201);
  expect(created.body).toMatchObject({ address_id: 21, message: expect.any(String) });
  const insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.startsWith('INSERT'));
  expect(insert[1]).toEqual([1, '收件人', '+86 138-0000-0000', '省', '市', '区', '道路1号']);
  await request(app).put('/api/addresses/3').set(token()).send({ ...fields, is_default: true }).expect(200);
  await request(app).delete('/api/addresses/3').set(token()).expect(200);
});

test.each([
  { receiver_name: '' }, { receiver_name: ' ' }, { receiver_name: 1 }, { receiver_name: 'x'.repeat(51) },
  { phone: 13800000000 }, { phone: '123456' }, { phone: '1234567890123456' }, { phone: '+1 (234) 5678' }, { phone: '12+34567' },
  { province: null }, { province: 'x'.repeat(51) }, { city: false }, { district: '' }, { detail_address: 'x'.repeat(201) },
  { is_default: 1 }, { is_default: 'false' }, { user_id: 2 }, { address_id: 3 }, { extra: true },
])('创建/完整更新拒绝非法地址值 %j，验证前不连接DB', async changes => {
  await request(app).post('/api/addresses').set(token()).send({ ...fields, ...changes }).expect(400);
  await request(app).put('/api/addresses/3').set(token()).send({ ...fields, ...changes }).expect(400);
  expect(getPool).not.toHaveBeenCalled();
});

test('创建/更新缺少任何一个字段或只设默认都拒绝', async () => {
  for (const key of Object.keys(fields)) {
    const incomplete: any = { ...fields }; delete incomplete[key];
    await request(app).post('/api/addresses').set(token()).send(incomplete).expect(400);
    await request(app).put('/api/addresses/3').set(token()).send(incomplete).expect(400);
  }
  await request(app).put('/api/addresses/3').set(token()).send({ is_default: true }).expect(400);
  expect(getPool).not.toHaveBeenCalled();
});

test.each(['0', '-1', '1x', '1e2', '1.5', '01', '9007199254740992'])('PUT/DELETE拒绝非法路径ID %s', async id => {
  await request(app).put(`/api/addresses/${id}`).set(token()).send(fields).expect(400);
  await request(app).delete(`/api/addresses/${id}`).set(token()).expect(400);
  expect(getPool).not.toHaveBeenCalled();
});

test.each([2147483648, Number.MAX_SAFE_INTEGER])('BIGINT历史地址在JS安全范围内可编辑 %p', async id => {
  rows[0].address_id = id;
  await request(app).put(`/api/addresses/${id}`).set(token()).send(fields).expect(200);
  await request(app).delete(`/api/addresses/${id}`).set(token()).expect(200);
});

test('其他用户地址与不存在地址统一404，任何写操作未执行', async () => {
  await request(app).put('/api/addresses/3').set(token(2)).send(fields).expect(404);
  await request(app).delete('/api/addresses/3').set(token(2)).expect(404);
  await request(app).put('/api/addresses/99').set(token()).send(fields).expect(404);
  expect(connection.execute.mock.calls.some(([sql]: [string]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
});

test.each(['1234567', '+123456789012345', '123-456 7890'])('电话接受7..15数字和常见分隔符 %s', async phone => {
  await request(app).post('/api/addresses').set(token()).send({ ...fields, phone }).expect(201);
});

test('未知数据库错误返回500并保留泛化响应', async () => {
  db.getConnection.mockRejectedValue(new Error('database password hidden'));
  const result = await request(app).post('/api/addresses').set(token()).send(fields).expect(500);
  expect(result.body).toEqual({ error: '创建收货地址失败' });
});
