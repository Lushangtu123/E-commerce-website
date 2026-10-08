jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../database/elasticsearch', () => ({
  getESClient: jest.fn(), searchProductIds: jest.fn(), syncProductToES: jest.fn(), deleteProductFromES: jest.fn(),
}));
jest.mock('../../models/search-history.model', () => ({ SearchHistoryModel: { add: jest.fn() } }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../database/mysql';
import { getESClient, searchProductIds, syncProductToES, deleteProductFromES } from '../../database/elasticsearch';
import { SearchHistoryModel } from '../../models/search-history.model';
import searchRoutes from '../../routes/search.routes';
import { syncProductsToSearchIndex } from '../../services/product-search.service';

const app = express(); app.use(express.json()); app.use('/api/search', searchRoutes);
const auth = { Authorization: `Bearer ${jwt.sign({ userId: 7 }, 'test-jwt-secret')}` };
const row = (id: number) => ({ product_id: id, title: `商品${id}`, price: '9.90', stock: 5, status: 1 });
let mysqlRows: ReturnType<typeof row>[];

beforeEach(() => {
  jest.clearAllMocks();
  mysqlRows = [row(1), row(2)];
  (getESClient as jest.Mock).mockReturnValue(null);
  (query as jest.Mock).mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT auth_version')) return [{ auth_version: 0, status: 1 }];
    if (/^SELECT COUNT\(\*\)/.test(sql)) return [{ total: mysqlRows.length }];
    if (sql.includes('product_id IN')) return mysqlRows.filter(r => params.includes(r.product_id));
    return mysqlRows;
  });
});

const searchSql = () => (query as jest.Mock).mock.calls.map(([sql]) => sql as string).filter(sql => !sql.startsWith('SELECT auth_version'));

test('未配置 Elasticsearch 时用 MySQL 搜索，并返回分页信息', async () => {
  const res = await request(app).get('/api/search/es').query({ keyword: '耳机', brand: 'Acme', sort_by: 'price', sort_order: 'asc' }).expect(200);
  expect(res.body).toMatchObject({ success: true, engine: 'mysql', data: mysqlRows, pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 } });
  expect(searchProductIds).not.toHaveBeenCalled();
  const listSql = searchSql().find(sql => sql.includes('ORDER BY'))!;
  expect(listSql).toContain('brand = ?');
  expect(listSql).toContain('ORDER BY price ASC');
});

test('Elasticsearch 决定匹配和顺序，展示字段取自 MySQL，已下架商品被跳过', async () => {
  (getESClient as jest.Mock).mockReturnValue({});
  (searchProductIds as jest.Mock).mockResolvedValue({ ids: [2, 9, 1], total: 3 });
  const res = await request(app).get('/api/search/es').query({ keyword: '耳机', page_size: 3 }).expect(200);
  expect(res.body.engine).toBe('elasticsearch');
  expect(res.body.data.map((p: any) => p.product_id)).toEqual([2, 1]);
  expect(res.body.pagination).toEqual({ page: 1, page_size: 3, total: 3, total_pages: 1 });
  expect(searchProductIds).toHaveBeenCalledWith(expect.objectContaining({ keyword: '耳机', sort_by: 'sales', sort_order: 'desc', page: 1, page_size: 3 }));
  expect(searchSql().find(sql => sql.includes('product_id IN'))).toMatch(/WHERE product_id IN \(\?,\?,\?\) AND status = 1/);
});

test('Elasticsearch 出错时回退到 MySQL，仍返回 200', async () => {
  (getESClient as jest.Mock).mockReturnValue({});
  (searchProductIds as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
  const res = await request(app).get('/api/search/es').query({ keyword: '耳机' }).expect(200);
  expect(res.body.engine).toBe('mysql');
  expect(res.body.data).toEqual(mysqlRows);
});

test.each([
  ['page_size 超过 100', { page_size: 1000 }],
  ['非法排序方向', { sort_order: 'sideways' }],
  ['非法排序字段', { sort_by: 'rating' }],
  ['非数字页码', { page: 'abc' }],
  ['最高价低于最低价', { min_price: 50, max_price: 10 }],
  ['超出可分页的结果窗口', { page: 600, page_size: 20 }],
  ['未知参数', { status: 0 }],
])('参数无效返回 400 且不查询：%s', async (_name, params) => {
  (getESClient as jest.Mock).mockReturnValue({});
  await request(app).get('/api/search/es').query(params).expect(400);
  expect(searchProductIds).not.toHaveBeenCalled();
  expect(searchSql()).toHaveLength(0);
});

test('登录用户的搜索历史记在本人名下，匿名搜索不带用户', async () => {
  await request(app).get('/api/search/es').set(auth).query({ keyword: ' 耳机 ' }).expect(200);
  expect(SearchHistoryModel.add).toHaveBeenLastCalledWith('耳机', 7, 2);
  await request(app).get('/api/search/es').query({ keyword: '耳机' }).expect(200);
  expect(SearchHistoryModel.add).toHaveBeenLastCalledWith('耳机', undefined, 2);
});

test('无关键词或无结果时不记录历史，记录失败不影响搜索结果', async () => {
  await request(app).get('/api/search/es').expect(200);
  mysqlRows = [];
  await request(app).get('/api/search/es').query({ keyword: '不存在' }).expect(200);
  expect(SearchHistoryModel.add).not.toHaveBeenCalled();
  mysqlRows = [row(1)];
  (SearchHistoryModel.add as jest.Mock).mockRejectedValue(new Error('db down'));
  const res = await request(app).get('/api/search/es').query({ keyword: '耳机' }).expect(200);
  expect(res.body.data).toHaveLength(1);
});

describe('写入后同步搜索索引', () => {
  test('未配置 Elasticsearch 时不做任何事', async () => {
    await syncProductsToSearchIndex([1]);
    expect(query).not.toHaveBeenCalled();
  });

  test('存在的商品重新索引，已删除的从索引移除，单个失败不抛出', async () => {
    (getESClient as jest.Mock).mockReturnValue({});
    mysqlRows = [row(1), row(2)];
    (syncProductToES as jest.Mock).mockImplementation(async (p: any) => { if (p.product_id === 2) throw new Error('es down'); });
    await expect(syncProductsToSearchIndex([1, 2, 3, 1])).resolves.toBeUndefined();
    expect((syncProductToES as jest.Mock).mock.calls.map(([p]) => p.product_id).sort()).toEqual([1, 2]);
    expect(deleteProductFromES).toHaveBeenCalledWith(3);
    expect(deleteProductFromES).toHaveBeenCalledTimes(1);
    expect(searchSql().find(sql => sql.includes('product_id IN'))).toMatch(/WHERE product_id IN \(\?,\?,\?\)\s*$/);
  });
});
