jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));

import { getPool, query } from '../../database/mysql';
import { getRedisClient } from '../../database/redis';
import { updateProductStatus, batchUpdateProductStatus, updateProduct, deleteProduct } from '../../controllers/admin-product.controller';
import { createSKU, batchCreateSKUs, updateSKU, deleteSKU, getProductSKUs } from '../../controllers/admin-sku.controller';
import { ProductController } from '../../controllers/product.controller';

let connection: any;
let db: any;
let redis: any;
let product: any;
let skus: any[];
let insertError: any;

beforeEach(() => {
  jest.clearAllMocks();
  product = { product_id: 1, title: '商品', status: 1, price: 100, stock: 100 };
  skus = [{ sku_id: 11, product_id: 1, sku_code: 'RED', specs: { color: 'red' }, price: 12.5, stock: 2, status: 1 }];
  insertError = undefined;
  connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM products')) return [product ? [product] : [], []];
      if (sql.includes('FROM product_skus')) return [skus.filter(sku => sku.product_id === params[0]), []];
      if (sql.includes('INSERT INTO product_skus') && insertError) throw insertError;
      return [{ insertId: 12, affectedRows: 1 }, []];
    }),
  };
  db = {
    getConnection: jest.fn().mockResolvedValue(connection),
    execute: jest.fn(async () => [[{ product_id: 1 }], []]),
    query: jest.fn().mockResolvedValue([{ affectedRows: 1 }, []]),
  };
  (getPool as jest.Mock).mockReturnValue(db);
  (query as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM products')) return product ? [product] : [];
    if (sql.includes('FROM product_skus')) return sql.includes('status = 1') ? skus.filter(sku => sku.status === 1) : skus;
    return { affectedRows: 1 };
  });
  redis = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
  (getRedisClient as jest.Mock).mockReturnValue(redis);
});

async function call(handler: any, body = {}, params: any = { productId: '1' }) {
  const req = { body, params, admin: { adminId: 1 }, get: () => 'jest', ip: '127.0.0.1' };
  const res: any = { statusCode: 200, status: jest.fn(function(this: any, code: number) { this.statusCode = code; return this; }), json: jest.fn(function(this: any, value: any) { this.body = value; return this; }) };
  await handler(req, res);
  return res;
}

const valid = { sku_code: 'BLUE', specs: { color: 'blue' }, price: 0, stock: 0 };

test('创建允许零价格库存，忽略缓存和审计外部故障且只返回一次成功', async () => {
  redis.del.mockRejectedValue(new Error('redis down'));
  db.query.mockRejectedValue(new Error('audit down'));
  const res = await call(createSKU, valid);
  expect(res.statusCode).toBe(201);
  expect(res.body.sku_id).toBe(12);
  expect(res.json).toHaveBeenCalledTimes(1);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(redis.del).toHaveBeenCalledWith('product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3');
});

test.each([
  { product_id: 2 }, { stock: -1 }, { stock: 1.5 }, { price: 1.001 },
  { price: '2' }, { specs: [] }, { status: 2 }, { sku_code: 'BAD CODE' }, { extra: true },
])('创建拒绝非法字段 %j，不连接数据库', async fields => {
  const res = await call(createSKU, { ...valid, ...fields });
  expect(res.statusCode).toBe(400);
  expect(getPool).not.toHaveBeenCalled();
});

test.each(['1x', '-1', '0', '2147483648'])('创建拒绝不完整的路径ID %s', async productId => {
  expect((await call(createSKU, valid, { productId })).statusCode).toBe(400);
  expect(getPool).not.toHaveBeenCalled();
});

test('不存在父商品返回404，重复code返回409，未知DB错误500', async () => {
  product = null;
  expect((await call(createSKU, { ...valid, price: 1 })).statusCode).toBe(404);
  product = { product_id: 1, status: 1 };
  insertError = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  expect((await call(createSKU, { ...valid, price: 1 })).statusCode).toBe(409);
  insertError = new Error('db down');
  expect((await call(createSKU, { ...valid, price: 1 })).statusCode).toBe(500);
});

test('批量创建拒绝嵌入商品ID；正常写入路径商品并失效缓存', async () => {
  expect((await call(batchCreateSKUs, { skus: [{ ...valid, product_id: 2 }] })).statusCode).toBe(400);
  expect(getPool).not.toHaveBeenCalled();
  expect((await call(batchCreateSKUs, { skus: [valid] })).statusCode).toBe(201);
  const insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.startsWith('INSERT'));
  expect(insert[1][0]).toBe(1);
  expect(redis.del).toHaveBeenCalledWith('product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3');
});

test('管理列表包含停用规格以便重新启用', async () => {
  skus[0].status = 0;
  const res = await call(getProductSKUs);
  expect(res.statusCode).toBe(200);
  expect(res.body.skus).toHaveLength(1);
  expect(res.body.skus[0].status).toBe(0);
});

test('已软删除的商品不再列出规格', async () => {
  product.status = -1;
  const res = await call(getProductSKUs);
  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({ error: '商品不存在' });
});

test('更新和删除检查可选路径商品归属；全局删除软删并失效缓存', async () => {
  expect((await call(updateSKU, { stock: 1 }, { skuId: '11', productId: '2' })).statusCode).toBe(404);
  expect((await call(deleteSKU, {}, { skuId: '11', productId: '2' })).statusCode).toBe(404);
  expect((await call(deleteSKU, {}, { skuId: '11' })).statusCode).toBe(200);
  expect(connection.execute.mock.calls.some(([sql]: [string]) => sql.startsWith('DELETE'))).toBe(false);
  expect(redis.del).toHaveBeenCalledWith('product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3');
});

test('更新支持SKU编码并拒绝未知字段', async () => {
  expect((await call(updateSKU, { sku_code: 'NEW-CODE' }, { skuId: '11' })).statusCode).toBe(200);
  expect((await call(updateSKU, { product_id: 2, stock: 3 }, { skuId: '11' })).statusCode).toBe(400);
});

test('SKU list exposes explicit parent identity for its management screen', async () => {
  const res = await call(getProductSKUs);
  expect(res.body.product).toEqual({ product_id: 1, title: '商品', title_en: null, status: 1 });
});

test('详情只显示启用规格，使用启用规格价格和库存汇总', async () => {
  skus.push({ ...skus[0], sku_id: 12, price: 9, stock: 3 });
  skus.push({ ...skus[0], sku_id: 13, status: 0, price: 1, stock: 50 });
  const res = await call(ProductController.getDetail, {}, { id: '1' });
  expect(res.statusCode).toBe(200);
  expect(res.body.product).toMatchObject({ has_sku: true, stock: 5, price: 9 });
  expect(res.body.product.skus).toHaveLength(2);
});

test('全部规格停用仍为规格商品且库存0；缓存故障不影响读取', async () => {
  skus[0].status = 0;
  redis.get.mockRejectedValue(new Error('redis down'));
  redis.setex.mockRejectedValue(new Error('redis down'));
  const res = await call(ProductController.getDetail, {}, { id: '1' });
  expect(res.statusCode).toBe(200);
  expect(res.body.product).toMatchObject({ has_sku: true, stock: 0, skus: [] });
});

test('下架或软删除商品即便还有旧缓存也返回404', async () => {
  redis.get.mockResolvedValue(JSON.stringify(product));
  for (const status of [0, -1]) {
    product.status = status;
    expect((await call(ProductController.getDetail, {}, { id: '1' })).statusCode).toBe(404);
  }
});


test('批量请求重复SKU编码返回409且无写入', async () => {
  const res = await call(batchCreateSKUs, { skus: [valid, valid] });
  expect(res.statusCode).toBe(409);
  expect(connection.execute).not.toHaveBeenCalled();
});

test('商品后台更新、上下架、批量与删除都清详情和热榜缓存，审计失败不改成功结果', async () => {
  for (const [handler, body, params, cacheKeys] of [
    [updateProduct, { title: '新标题' }, { productId: '1' }, ['product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3']],
    [updateProductStatus, { status: 0 }, { productId: '1' }, ['product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3']],
    [batchUpdateProductStatus, { productIds: [1,2], status: 0 }, {}, ['product:1', 'product:v2:1', 'product:2', 'product:v2:2', 'products:hot', 'products:hot:v2', 'products:hot:v3']],
    [deleteProduct, {}, { productId: '1' }, ['product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3']],
  ] as const) {
    redis.del.mockClear();
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT')) return [[product], []];
      if (sql.includes('admin_logs')) throw new Error('audit down');
      return [{ affectedRows: 1 }, []];
    });
    expect((await call(handler, body, params)).statusCode).toBe(200);
    expect(redis.del).toHaveBeenCalledWith(...cacheKeys);
  }
});
