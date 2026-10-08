jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../models/product.model', () => ({ ProductModel: {
  findById: jest.fn(), getHotProducts: jest.fn(), getReviewStatistics: jest.fn(), findEnabledByIds: jest.fn(),
} }));
jest.mock('../../models/sku.model', () => ({ SKUModel: { findByProductId: jest.fn() } }));
import { ProductController } from '../../controllers/product.controller';
import { ProductModel } from '../../models/product.model';
import { SKUModel } from '../../models/sku.model';
import { getRedisClient } from '../../database/redis';

const old = { product_id: 1, title: 'Old', title_en: 'Old English', price: 10, stock: 5, status: 1, rating: 4, review_count: 1 };
const fresh = { ...old, title: 'Current', title_en: 'Current English', price: 20, stock: 0, rating: 5, review_count: 2 };
const response = () => ({ body: undefined as any, statusCode: 200,
  status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } });
let redis: any;
beforeEach(() => {
  jest.clearAllMocks();
  redis = { get: jest.fn().mockResolvedValue(JSON.stringify(old)), setex: jest.fn().mockResolvedValue('OK') };
  (getRedisClient as jest.Mock).mockReturnValue(redis);
  (ProductModel.findById as jest.Mock).mockResolvedValue(fresh);
  (SKUModel.findByProductId as jest.Mock).mockResolvedValue([]);
  (ProductModel.getHotProducts as jest.Mock).mockResolvedValue([fresh]);
  (ProductModel.getReviewStatistics as jest.Mock).mockResolvedValue([fresh]);
  (ProductModel as any).findEnabledByIds.mockResolvedValue([fresh]);
});

test('detail uses current content, price and stock even if an old valid cache survived invalidation', async () => {
  const res = response(); await ProductController.getDetail({ params: { id: '1' } } as any, res as any);
  expect(res.body.product).toMatchObject(fresh);
});

test('detail refreshes enabled SKU identity, prices and stock instead of accepting an old SKU cache', async () => {
  const staleSKU = { sku_id: 11, product_id: 1, sku_code: 'OLD', specs: {}, price: 10, stock: 5, status: 1 };
  const enabled = { ...staleSKU, sku_id: 12, sku_code: 'NEW', price: 30, stock: 2 };
  redis.get.mockResolvedValue(JSON.stringify({ ...old, has_sku: true, skus: [staleSKU] }));
  (SKUModel.findByProductId as jest.Mock).mockResolvedValue([{ ...staleSKU, status: 0 }, enabled]);
  const res = response(); await ProductController.getDetail({ params: { id: '1' } } as any, res as any);
  expect(res.body.product).toMatchObject({ ...fresh, has_sku: true, price: 30, stock: 2, skus: [enabled] });
});

test('hot cache preserves ranking but refreshes all fields and fills the limit after a product disappears', async () => {
  redis.get.mockResolvedValue(JSON.stringify([old, { ...old, product_id: 2 }, { ...old, product_id: 3 }]));
  (ProductModel as any).findEnabledByIds.mockResolvedValue([{ ...fresh, product_id: 3 }, fresh]);
  const res = response(); await ProductController.getHotProducts({ query: { limit: '2' } } as any, res as any);
  expect(res.body.products).toEqual([fresh, { ...fresh, product_id: 3 }]);
  expect((ProductModel as any).findEnabledByIds).toHaveBeenCalledWith([1, 2, 3]);
});

test('hot cache can return a successful empty result when all cached products have been removed', async () => {
  redis.get.mockResolvedValue(JSON.stringify([old]));
  (ProductModel as any).findEnabledByIds.mockResolvedValue([]);
  const res = response(); await ProductController.getHotProducts({ query: {} } as any, res as any);
  expect(res.body.products).toEqual([]);
});

test('a failed ranking hydration falls back to the complete current database query', async () => {
  redis.get.mockResolvedValue(JSON.stringify([old]));
  (ProductModel as any).findEnabledByIds.mockRejectedValue(new Error('Hydration unavailable'));
  const res = response(); await ProductController.getHotProducts({ query: {} } as any, res as any);
  expect(res.body).toEqual({ products: [fresh] });
});
