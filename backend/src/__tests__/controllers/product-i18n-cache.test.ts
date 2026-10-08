jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../services/product-search.service', () => ({ syncProductsToSearchIndex: jest.fn() }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));
jest.mock('../../models/product.model', () => ({ ProductModel: { findById: jest.fn(), getHotProducts: jest.fn(), update: jest.fn() } }));
jest.mock('../../models/sku.model', () => ({ SKUModel: { findByProductId: jest.fn() } }));

import { getRedisClient } from '../../database/redis';
import { ProductModel } from '../../models/product.model';
import { SKUModel } from '../../models/sku.model';
import { ProductController } from '../../controllers/product.controller';
import { afterProductWrite } from '../../controllers/admin-product-write';
import { invalidateOrderProductCache } from '../../services/order.service';

let cache: Map<string, string>;
let redis: any;
const product = { product_id: 1, title: '衬衫', title_en: 'Shirt', price: 10, stock: 3, status: 1, rating: 4, review_count: 1 };
const req: any = { params: { id: '1' }, query: {}, admin: { adminId: 1 }, get: () => 'test' };
const response = () => ({ body: undefined as any, json(value: any) { this.body = value; return this; }, status() { return this; } });

beforeEach(() => {
  jest.clearAllMocks();
  cache = new Map();
  redis = { get: jest.fn(async (key: string) => cache.get(key)),
    setex: jest.fn(async (key: string, _ttl: number, value: string) => cache.set(key, value)),
    del: jest.fn(async (...keys: string[]) => keys.forEach(key => cache.delete(key))) };
  (getRedisClient as jest.Mock).mockReturnValue(redis);
  (ProductModel.findById as jest.Mock).mockResolvedValue(product);
  (ProductModel.getHotProducts as jest.Mock).mockResolvedValue([product]);
  (ProductModel.update as jest.Mock).mockResolvedValue(true);
  (SKUModel.findByProductId as jest.Mock).mockResolvedValue([]);
});

test('商品详情跳过旧缓存并缓存包含英文字段的新版本', async () => {
  cache.set('product:1', JSON.stringify({ ...product, title_en: undefined }));
  const res = response();
  await ProductController.getDetail(req, res as any);
  expect(res.body.product.title_en).toBe('Shirt');
  expect(redis.setex).toHaveBeenCalledWith('product:v3:1', 300, expect.any(String));
  const hit = response();
  await ProductController.getDetail(req, hit as any);
  expect(hit.body.fromCache).toBe(true);
  expect(hit.body.product.title_en).toBe('Shirt');
});

test('热榜跳过两个旧版本并使用英文字段缓存', async () => {
  for (const key of ['products:hot', 'products:hot:v2', 'products:hot:v3']) cache.set(key, JSON.stringify([{ title: '旧商品' }]));
  const res = response();
  await ProductController.getHotProducts(req, res as any);
  expect(res.body.products[0].title_en).toBe('Shirt');
  expect(redis.setex).toHaveBeenCalledWith('products:hot:v4', 600, expect.any(String));
});

test('后台和结算写入清除新旧详情及热榜版本', async () => {
  const keys = ['product:1', 'product:v2:1', 'product:v3:1', 'products:hot', 'products:hot:v2', 'products:hot:v3', 'products:hot:v4'];
  for (const write of [
    () => afterProductWrite(req, [1], 'UPDATE_PRODUCT', 'product', '1', 'test'),
    () => invalidateOrderProductCache([1]),
    () => ProductController.update({ ...req, body: { title_en: 'Changed shirt' } }, response() as any),
  ]) {
    keys.forEach(key => cache.set(key, 'stale'));
    await write();
    expect(keys.filter(key => cache.has(key))).toEqual([]);
  }
});
