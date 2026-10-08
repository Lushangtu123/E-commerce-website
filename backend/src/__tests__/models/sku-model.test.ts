jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

import { getPool, query } from '../../database/mysql';
import { SKUModel } from '../../models/sku.model';

const SKU = { sku_id: 11, product_id: 1, sku_code: 'RED-M', specs: { color: 'red' }, price: 19.99, stock: 3, status: 1 };
let connection: any;
let db: any;
let parentExists: boolean;
let skus: any[];
let failInsert: number;
let insertCount: number;

beforeEach(() => {
  jest.clearAllMocks();
  parentExists = true;
  skus = [SKU];
  failInsert = 0;
  insertCount = 0;
  connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM products')) return [parentExists ? [{ product_id: params[0], status: 1 }] : [], []];
      if (sql.includes('FROM product_skus')) return [skus.filter(sku => sku.product_id === params[0]), []];
      if (sql.includes('INSERT INTO product_skus')) {
        if (++insertCount === failInsert) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        return [{ insertId: 12, affectedRows: 1 }, []];
      }
      return [{ affectedRows: 1 }, []];
    }),
  };
  db = { getConnection: jest.fn().mockResolvedValue(connection), execute: jest.fn().mockResolvedValue([[SKU], []]) };
  (getPool as jest.Mock).mockReturnValue(db);
  (query as jest.Mock).mockImplementation(async (sql: string, params: any[]) => (await connection.execute(sql, params))[0]);
});

function mutation(overrides = {}) {
  return { product_id: 1, sku_code: 'BLUE-M', specs: { color: 'blue' }, price: 0, stock: 0, ...overrides };
}

function sqlCalls() {
  return connection.execute.mock.calls.map(([sql]: [string]) => sql);
}

test('SKU创建先锁父商品再按ID锁SKU，同连接提交且不覆盖基础库存', async () => {
  expect(await SKUModel.create(mutation())).toBe(12);
  expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
  expect(sqlCalls()[0]).toMatch(/FROM products.+FOR UPDATE/);
  expect(sqlCalls()[1]).toMatch(/FROM product_skus.+ORDER BY sku_id FOR UPDATE/);
  const insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO product_skus'));
  expect(insert[1]).toEqual([1, 'BLUE-M', '{"color":"blue"}', null, 0, null, 0, null, 1]);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
  expect(sqlCalls().some((sql: string) => sql.includes('UPDATE products'))).toBe(false);
});

test('不存在父商品时回滚并返回404', async () => {
  parentExists = false;
  await expect(SKUModel.create(mutation())).rejects.toMatchObject({ statusCode: 404 });
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('批量创建中途重复code时全部回滚并返回409', async () => {
  failInsert = 2;
  await expect(SKUModel.createBatch([mutation(), mutation({ sku_code: 'GREEN-M' })])).rejects.toMatchObject({ statusCode: 409 });
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('嵌套更新拒绝其他商品的SKU，不写入', async () => {
  await expect((SKUModel.update as any)(11, { stock: 1 }, 2)).rejects.toMatchObject({ statusCode: 404 });
  expect(sqlCalls().some((sql: string) => sql.includes('UPDATE product_skus'))).toBe(false);
});

test('SKU删除及整商品删除都只停用，保留库存和历史记录', async () => {
  expect(await (SKUModel.delete as any)(11, 1)).toBe(true);
  expect(await SKUModel.deleteByProductId(1)).toBe(true);
  const writes = sqlCalls().filter((sql: string) => /^(UPDATE|DELETE)/.test(sql));
  expect(writes).toHaveLength(2);
  expect(writes.every((sql: string) => sql.includes('UPDATE product_skus SET status = 0'))).toBe(true);
  expect(writes.some((sql: string) => sql.includes('stock ='))).toBe(false);
});

test('模型拒绝非法库存/价格/规格和字段，数据库不写入', async () => {
  for (const overrides of [{ stock: -1 }, { price: 1.001 }, { specs: [] }, { sku_code: 'BAD CODE' }, { extra: 'x' }]) {
    await expect(SKUModel.create(mutation(overrides))).rejects.toMatchObject({ statusCode: 400 });
  }
  expect(connection.execute).not.toHaveBeenCalled();
});

test('更新支持code whitelist并拒绝任意字段', async () => {
  expect(await (SKUModel.update as any)(11, { sku_code: 'NEW-CODE', status: 0 }, 1)).toBe(true);
  expect(sqlCalls().find((sql: string) => sql.startsWith('UPDATE product_skus'))).toContain('sku_code = ?');
  await expect(SKUModel.update(11, { product_id: 2 })).rejects.toMatchObject({ statusCode: 400 });
});
