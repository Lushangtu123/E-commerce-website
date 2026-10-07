import type { IncomingMessage, ServerResponse } from 'http';
import request from 'supertest';
import { ProductModel } from '../../models/product.model';
import handler from '../../serverless';

jest.mock('../../utils/logger', () => ({ __esModule: true, default: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
} }));
jest.mock('../../database/mysql', () => ({ connectDatabase: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../database/redis', () => ({ connectRedis: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../models/product.model', () => ({ ProductModel: { list: jest.fn() } }));

// Next.js hands the API route a plain Node request with its own catch-all parameter already in query.
const bridge = (req: IncomingMessage & { query?: unknown }, res: ServerResponse) => {
  req.query = { path: ['products'] };
  return handler(req, res);
};

beforeEach(() => {
  jest.mocked(ProductModel.list).mockResolvedValue({ products: [], total: 0 });
});

test('Next.js 路由参数不进入业务查询，保留 URL 上的筛选和分页', async () => {
  const response = await request(bridge).get('/api/products?sort=created_at%20DESC&limit=8').expect(200);
  expect(response.body.limit).toBe(8);
  expect(ProductModel.list).toHaveBeenCalledWith({ sort: 'created_at DESC', page: 1, limit: 8 });
});

test('URL 中的未知参数仍被业务校验拒绝', async () => {
  await request(bridge).get('/api/products?unexpected=value').expect(400);
});
