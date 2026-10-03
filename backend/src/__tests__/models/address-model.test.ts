jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));

import { getPool } from '../../database/mysql';
import { AddressModel } from '../../models/address.model';

const fields = { receiver_name: ' 收件人 ', phone: ' +86 138-0000-0000 ', province: ' 省 ', city: ' 市 ', district: ' 区 ', detail_address: ' 道路1号 ' };
let rows: any[];
let connection: any;
let db: any;
let userExists: boolean;
let defaultFailure: boolean;

beforeEach(() => {
  jest.clearAllMocks(); rows = []; userExists = true; defaultFailure = false;
  connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM users')) return [userExists ? [{ user_id: 1 }] : [], []];
      if (sql.startsWith('SELECT') && sql.includes('FROM shipping_addresses')) return [rows, []];
      if (sql.startsWith('INSERT')) return [{ insertId: 21, affectedRows: 1 }, []];
      if (sql.includes('is_default = CASE') && defaultFailure) throw new Error('default write failed');
      return [{ affectedRows: 1 }, []];
    }),
  };
  db = { getConnection: jest.fn().mockResolvedValue(connection), execute: jest.fn(async () => [rows, []]) };
  (getPool as jest.Mock).mockReturnValue(db);
});

const statements = () => connection.execute.mock.calls.map(([sql]: [string]) => sql);
const defaultWrite = () => connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('is_default = CASE'));

test('首次创建自动默认，先锁用户再按地址ID锁，完整字段trim且只提交一次', async () => {
  expect(await AddressModel.create(1, fields)).toBe(21);
  expect(statements()[0]).toMatch(/FROM users.+FOR UPDATE/);
  expect(statements()[1]).toMatch(/FROM shipping_addresses.+ORDER BY address_id FOR UPDATE/);
  const insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.startsWith('INSERT'));
  expect(insert[1]).toEqual([1, '收件人', '+86 138-0000-0000', '省', '市', '区', '道路1号']);
  expect(defaultWrite()[1]).toEqual([21, 1]);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('新增非默认保持旧默认，显式设默认选择新地址', async () => {
  rows = [{ address_id: 3, is_default: 1 }, { address_id: 5, is_default: 0 }];
  await AddressModel.create(1, { ...fields, is_default: false });
  expect(defaultWrite()[1]).toEqual([3, 1]);
  connection.execute.mockClear();
  await AddressModel.create(1, { ...fields, is_default: true });
  expect(defaultWrite()[1]).toEqual([21, 1]);
});

test('每用户20条上限和不存在用户在同事务中拒绝，不插入', async () => {
  rows = Array.from({ length: 20 }, (_, id) => ({ address_id: id + 1, is_default: id === 0 ? 1 : 0 }));
  await expect(AddressModel.create(1, fields)).rejects.toMatchObject({ statusCode: 400 });
  expect(statements().some(sql => sql.startsWith('INSERT'))).toBe(false);
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  rows = []; userExists = false;
  await expect(AddressModel.create(1, fields)).rejects.toMatchObject({ statusCode: 404 });
});

test('更新和删除不存在或其他用户的地址返回404且不写入', async () => {
  rows = [{ address_id: 3, is_default: 1 }];
  await expect(AddressModel.update(1, 9, fields)).rejects.toMatchObject({ statusCode: 404 });
  await expect(AddressModel.remove(1, 9)).rejects.toMatchObject({ statusCode: 404 });
  expect(statements().some(sql => /^(UPDATE|DELETE)/.test(sql))).toBe(false);
  expect(connection.rollback).toHaveBeenCalledTimes(2);
});

test('取消默认选择其他最小地址，只有一条时保持默认', async () => {
  rows = [{ address_id: 3, is_default: 1 }, { address_id: 5, is_default: 0 }];
  await AddressModel.update(1, 3, { ...fields, is_default: false });
  expect(defaultWrite()[1]).toEqual([5, 1]);
  connection.execute.mockClear(); rows = [{ address_id: 3, is_default: 1 }];
  await AddressModel.update(1, 3, { ...fields, is_default: false });
  expect(defaultWrite()[1]).toEqual([3, 1]);
});

test('删除默认提升最小剩余地址，删除最后一条不写订单', async () => {
  rows = [{ address_id: 3, is_default: 1 }, { address_id: 5, is_default: 0 }, { address_id: 8, is_default: 0 }];
  await AddressModel.remove(1, 3);
  expect(defaultWrite()[1]).toEqual([5, 1]);
  const deletion = connection.execute.mock.calls.find(([sql]: [string]) => sql.startsWith('DELETE'));
  expect(deletion[1]).toEqual([3, 1]);
  expect(statements().some(sql => /\borders\b/.test(sql))).toBe(false);
  connection.execute.mockClear(); rows = [{ address_id: 3, is_default: 1 }];
  await AddressModel.remove(1, 3);
  expect(defaultWrite()).toBeUndefined();
});

test('默认标志写入失败回滚整个地址写入，未知错误不伪装成输入错误', async () => {
  defaultFailure = true;
  await expect(AddressModel.create(1, fields)).rejects.toThrow('default write failed');
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('读取只返回当前用户的地址，default投影为boolean', async () => {
  rows = [{ address_id: 3, user_id: 1, is_default: 1, ...fields }, { address_id: 5, user_id: 1, is_default: 0, ...fields }];
  const addresses = await AddressModel.list(1);
  expect(addresses.map(address => address.is_default)).toEqual([true, false]);
  expect(db.execute).toHaveBeenCalledWith(expect.stringMatching(/WHERE user_id = \? ORDER BY is_default DESC, address_id/), [1]);
});
