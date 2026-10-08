jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../models/product.model', () => ({ ProductModel: { getHotProducts: jest.fn(), findById: jest.fn(), getReviewStatistics: jest.fn(), findEnabledByIds: jest.fn() } }));
jest.mock('../../models/sku.model', () => ({ SKUModel: { findByProductId: jest.fn() } }));
jest.mock('../../models/review.model', () => ({ ReviewModel: { create: jest.fn() } }));
jest.mock('../../services/product-search.service', () => ({ syncProductsToSearchIndex: jest.fn() }));

import { ProductController } from '../../controllers/product.controller';
import { ReviewController } from '../../controllers/review.controller';
import { ProductModel } from '../../models/product.model';
import { ReviewModel } from '../../models/review.model';
import { getRedisClient } from '../../database/redis';
import { syncProductsToSearchIndex } from '../../services/product-search.service';
import { SKUModel } from '../../models/sku.model';
import { PRODUCT_HOT_CACHE_KEYS, productDetailCacheKeys } from '../../utils/product-cache-keys';

const product = { product_id: 1, title: 'Fixture', stock: 2, price: 10, rating: 4, review_count: 2 };
const response = () => ({ statusCode: 200, body: undefined as any,
  status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } });
let redis: any;
beforeEach(() => {
  jest.clearAllMocks();
  redis = { get: jest.fn().mockResolvedValue(null), setex: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
  (getRedisClient as jest.Mock).mockReturnValue(redis);
  (ProductModel.getHotProducts as jest.Mock).mockResolvedValue([product, { ...product, product_id: 2 }]);
  (ProductModel as any).findEnabledByIds.mockResolvedValue([product, { ...product, product_id: 2 }]);
  (ReviewModel.create as jest.Mock).mockResolvedValue(7);
  (ProductModel.findById as jest.Mock).mockResolvedValue({ ...product, status: 1 });
  (SKUModel.findByProductId as jest.Mock).mockResolvedValue([]);
});

test('hot ranking hydrates MySQL SUM stock strings without reloading the full catalog', async () => {
  redis.get.mockResolvedValue(JSON.stringify([{ ...product, stock: '2' }]));
  (ProductModel as any).findEnabledByIds.mockResolvedValue([{ ...product, stock: '2' }]);
  const res = response();
  await ProductController.getHotProducts({ query: {} } as any, res as any);
  expect(res.body).toMatchObject({ products: [{ product_id: 1, stock: '2' }], fromCache: true });
  expect(ProductModel.getHotProducts).not.toHaveBeenCalled();
});

test('hot cache ratings remain current even when an older cache fill finishes after review invalidation', async () => {
  const cache = new Map<string, string>();
  let finishFill!: () => void;
  const filling = new Promise<void>(resolve => { finishFill = resolve; });
  redis.get.mockImplementation(async (key: string) => cache.get(key));
  redis.del.mockImplementation(async (...keys: string[]) => keys.forEach(key => cache.delete(key)));
  redis.setex.mockImplementationOnce(async (key: string, _ttl: number, value: string) => { await filling; cache.set(key, value); });
  (ProductModel.getHotProducts as jest.Mock).mockResolvedValueOnce([{ ...product, rating: 0, review_count: 0 }]);
  const oldResponse = response();
  const first = ProductController.getHotProducts({ query: {} } as any, oldResponse as any);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(redis.setex).toHaveBeenCalledTimes(1);
  const created = response();
  await ReviewController.create({ userId: 1, body: { product_id: 1, order_id: 1, rating: 5 } } as any, created as any);
  (ProductModel as any).findEnabledByIds.mockResolvedValue([{ product_id: 1, rating: 5, review_count: 1 }]);
  finishFill(); await first;
  const current = response();
  await ProductController.getHotProducts({ query: {} } as any, current as any);
  expect(current.body).toMatchObject({ products: [{ product_id: 1, rating: 5, review_count: 1 }], fromCache: true });
  expect(ProductModel.getHotProducts).toHaveBeenCalledTimes(1);
});

test.each(['{}', 'null', '[]', JSON.stringify({ ...product, product_id: 2 })])('detail ignores parseable but damaged or wrong-product cache %s', async cached => {
  redis.get.mockResolvedValue(cached);
  const res = response();
  await ProductController.getDetail({ params: { id: '1' } } as any, res as any);
  expect(res.statusCode).toBe(200);
  expect(res.body.product).toMatchObject({ ...product, status: 1 });
  expect(res.body.fromCache).toBeUndefined();
  expect(SKUModel.findByProductId).toHaveBeenCalledWith(1, true);
});

test.each([{}, [null], [{ sku_id: 1 }], [{ sku_id: 1, product_id: 2, sku_code: 'WRONG', status: 1, price: 10, stock: 2, specs: {} }]])('detail rejects damaged or wrong-product SKU cache %p before it can crash the product page', async skus => {
  redis.get.mockResolvedValue(JSON.stringify({ ...product, has_sku: true, skus }));
  const res = response();
  await ProductController.getDetail({ params: { id: '1' } } as any, res as any);
  expect(res.body.product).toMatchObject({ ...product, has_sku: false });
  expect(res.body.fromCache).toBeUndefined();
  expect(SKUModel.findByProductId).toHaveBeenCalledWith(1, true);
});

test.each([{ title_en: 123 }, { description: {} }, { specs_en: { Color: { name: 123 } } }, { specs_en: { Color: { value: [] } } }])('hot and detail reject invalid render fields %p', async damaged => {
  redis.get.mockResolvedValue(JSON.stringify([{ ...product, ...damaged }]));
  const hot = response(); await ProductController.getHotProducts({ query: {} } as any, hot as any);
  expect(hot.body.fromCache).toBeUndefined();
  expect(hot.body.products[0]).toEqual(product);
  redis.get.mockResolvedValue(JSON.stringify({ ...product, ...damaged }));
  const detail = response(); await ProductController.getDetail({ params: { id: '1' } } as any, detail as any);
  expect(detail.body.fromCache).toBeUndefined();
  expect(detail.body.product.title).toBe('Fixture');
});

test('a cached bilingual SKU is refreshed from the current enabled variants', async () => {
  const sku = { sku_id: 11, product_id: 1, sku_code: 'RED', status: 1, price: '10.00', stock: 2,
    specs: { 颜色: '红色' }, specs_en: { 颜色: { name: 'Color', value: 'Red' } } };
  redis.get.mockResolvedValue(JSON.stringify({ ...product, has_sku: true, skus: [sku] }));
  (SKUModel.findByProductId as jest.Mock).mockResolvedValue([sku]);
  const res = response(); await ProductController.getDetail({ params: { id: '1' } } as any, res as any);
  expect(res.body.product.skus).toEqual([sku]);
  expect(res.body.fromCache).toBeUndefined();
  expect(SKUModel.findByProductId).toHaveBeenCalledWith(1, true);
});

test('current database review statistics override a still-valid older detail cache', async () => {
  redis.get.mockResolvedValue(JSON.stringify({ ...product, rating: 5, review_count: 1, status: 1 }));
  const res = response();
  await ProductController.getDetail({ params: { id: '1' } } as any, res as any);
  expect(res.body.product).toMatchObject({ rating: 4, review_count: 2 });
  expect(res.body.fromCache).toBeUndefined();
  expect(SKUModel.findByProductId).toHaveBeenCalledWith(1, true);
});

test.each(['client', 'read', 'write', 'json', 'object', 'invalid row'])('hot products survive %s cache failure with bounded database results', async mode => {
  if (mode === 'client') (getRedisClient as jest.Mock).mockImplementation(() => { throw new Error('Redis offline'); });
  if (mode === 'read') redis.get.mockRejectedValue(new Error('Redis offline'));
  if (mode === 'write') redis.setex.mockRejectedValue(new Error('Redis offline'));
  if (mode === 'json') redis.get.mockResolvedValue('{bad json');
  if (mode === 'object') redis.get.mockResolvedValue('{}');
  if (mode === 'invalid row') redis.get.mockResolvedValue('[null]');
  const res = response();
  await ProductController.getHotProducts({ query: { limit: '1' } } as any, res as any);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ products: [product] });
  expect(ProductModel.getHotProducts).toHaveBeenCalledWith(100);
});

test('a healthy ranking cache avoids the full catalog query and is sliced after hydration', async () => {
  redis.get.mockResolvedValue(JSON.stringify([product, { ...product, product_id: 2 }]));
  const res = response();
  await ProductController.getHotProducts({ query: { limit: '1' } } as any, res as any);
  expect(res.body).toEqual({ products: [product], fromCache: true });
  expect(ProductModel.getHotProducts).not.toHaveBeenCalled();
});

test('database failures still return a public error, and bad limits never touch storage', async () => {
  (ProductModel.getHotProducts as jest.Mock).mockRejectedValue(new Error('private SQL'));
  const res = response();
  await ProductController.getHotProducts({ query: {} } as any, res as any);
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ error: '获取热门商品失败' });
  jest.clearAllMocks();
  const bad = response();
  await ProductController.getHotProducts({ query: { limit: '101' } } as any, bad as any);
  expect(bad.statusCode).toBe(400);
  expect(getRedisClient).not.toHaveBeenCalled();
  expect(ProductModel.getHotProducts).not.toHaveBeenCalled();
});

test('a committed review invalidates every rating cache version and refreshes indexed ratings', async () => {
  const res = response();
  await ReviewController.create({ userId: 1, body: { product_id: 1, order_id: 1, rating: 4 } } as any, res as any);
  expect(res.statusCode).toBe(201);
  expect(redis.del).toHaveBeenCalledWith(...productDetailCacheKeys(1), ...PRODUCT_HOT_CACHE_KEYS);
  expect(syncProductsToSearchIndex).toHaveBeenCalledWith([1]);
});

test('post-commit cache/index failure never converts a saved review into a failed submission', async () => {
  redis.del.mockRejectedValue(new Error('cache offline'));
  (syncProductsToSearchIndex as jest.Mock).mockRejectedValueOnce(new Error('index offline'));
  const res = response();
  await ReviewController.create({ userId: 1, body: { product_id: 1, order_id: 1, rating: 4 } } as any, res as any);
  expect(res.statusCode).toBe(201);
  expect(res.body).toEqual({ message: '评论成功', review_id: 7 });
});

test('a rejected review does not invalidate caches or refresh the search index', async () => {
  (ReviewModel.create as jest.Mock).mockRejectedValueOnce(new Error('insert failed'));
  const res = response();
  await ReviewController.create({ userId: 1, body: { product_id: 1, order_id: 1, rating: 4 } } as any, res as any);
  expect(res.statusCode).toBe(500);
  expect(redis.del).not.toHaveBeenCalled();
  expect(syncProductsToSearchIndex).not.toHaveBeenCalled();
});
