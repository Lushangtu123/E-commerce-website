jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
jest.mock('../../models/search-history.model', () => ({ SearchHistoryModel: {
  add: jest.fn(), getUserHistory: jest.fn(), getHotKeywords: jest.fn(), getSuggestions: jest.fn(),
  clearUserHistory: jest.fn(), deleteKeyword: jest.fn(),
} }));
jest.mock('../../services/product-search.service', () => ({ searchProducts: jest.fn() }));

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../../database/mysql';
import { SearchHistoryModel } from '../../models/search-history.model';
import { searchProducts } from '../../services/product-search.service';
import searchRoutes from '../../routes/search.routes';
import { productQuerySchema } from '../../utils/product-validation';

const app = express(); app.use(express.json()); app.use('/api/search', searchRoutes);
const auth = { Authorization: `Bearer ${jwt.sign({ userId: 7 }, 'test-jwt-secret')}` };
const methods = Object.values(SearchHistoryModel) as jest.Mock[];

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue([{ auth_version: 0, status: 1 }]);
  (SearchHistoryModel.add as jest.Mock).mockResolvedValue(50);
  (SearchHistoryModel.getUserHistory as jest.Mock).mockResolvedValue([{ keyword: 'Nike' }]);
  (SearchHistoryModel.getHotKeywords as jest.Mock).mockResolvedValue([{ keyword: 'Nike', search_count: 2 }]);
  (SearchHistoryModel.getSuggestions as jest.Mock).mockResolvedValue(['Nike']);
  (SearchHistoryModel.deleteKeyword as jest.Mock).mockResolvedValue(true);
  (searchProducts as jest.Mock).mockResolvedValue({ products: [], total: 2, engine: 'mysql' });
});

const noHistoryAccess = () => methods.forEach(method => expect(method).not.toHaveBeenCalled());

test.each([
  {}, { keyword: null }, { keyword: 123 }, { keyword: [] }, { keyword: {} },
  { keyword: '' }, { keyword: '  \t\n ' }, { keyword: 'x'.repeat(101) },
  { keyword: 'Nike', result_count: -1 }, { keyword: 'Nike', result_count: 1.5 },
  { keyword: 'Nike', result_count: '2' }, { keyword: 'Nike', result_count: null },
  { keyword: 'Nike', result_count: 2147483648 }, { keyword: 'Nike', user_id: 8 },
])('无效搜索记录返回 400 且不访问历史模型：%j', async body => {
  await request(app).post('/api/search/record').set(auth).send(body).expect(400);
  noHistoryAccess();
});

test('没有请求体也返回 400，未登录的记录请求仍返回 401', async () => {
  await request(app).post('/api/search/record').set(auth).expect(400);
  await request(app).post('/api/search/record').send({ keyword: 'Nike' }).expect(401);
  noHistoryAccess();
});

test.each([undefined, 0, 2147483647])('合法记录修剪关键词，保留本人和整数结果数量：%s', async count => {
  await request(app).post('/api/search/record').set(auth)
    .send({ keyword: '  ' + '中'.repeat(100) + '  ', ...(count !== undefined && { result_count: count }) })
    .expect(200, { message: '记录成功', id: 50 });
  expect(SearchHistoryModel.add).toHaveBeenCalledWith('中'.repeat(100), 7, count ?? 0);
});

const invalidLimits = ['0', '-1', '101', '1000000', '2.5', 'abc', '01', '1e2', '9007199254740993'];
test.each(['/history', '/hot', '/suggestions'])('%s 的数量参数有严格上限，非法请求不查询', async path => {
  for (const limit of invalidLimits) {
    jest.clearAllMocks();
    await request(app).get('/api/search' + path).set(auth).query({ limit, ...(path === '/suggestions' && { keyword: 'Nike' }) }).expect(400);
    noHistoryAccess();
  }
  await request(app).get('/api/search' + path + '?limit=1&limit=2&keyword=Nike').set(auth).expect(400);
  noHistoryAccess();
});

test.each(['0', '-1', '366', '1e2', '1.5', 'abc'])('热搜拒绝非法统计天数 %s', async days => {
  await request(app).get('/api/search/hot').query({ days }).expect(400);
  noHistoryAccess();
});

test.each(['/hot', '/history', '/suggestions'])('%s 拒绝未知查询字段', async path => {
  await request(app).get('/api/search' + path).set(auth).query({ unexpected: 1, keyword: 'Nike' }).expect(400);
  noHistoryAccess();
});

test('查询默认值和边界值传给模型，公开接口保持匿名可用', async () => {
  await request(app).get('/api/search/history').set(auth).expect(200);
  expect(SearchHistoryModel.getUserHistory).toHaveBeenLastCalledWith(7, 10);
  await request(app).get('/api/search/history?limit=100').set(auth).expect(200);
  expect(SearchHistoryModel.getUserHistory).toHaveBeenLastCalledWith(7, 100);
  await request(app).get('/api/search/hot').expect(200);
  expect(SearchHistoryModel.getHotKeywords).toHaveBeenLastCalledWith(7, 10);
  await request(app).get('/api/search/hot?days=365&limit=100').expect(200);
  expect(SearchHistoryModel.getHotKeywords).toHaveBeenLastCalledWith(365, 100);
  await request(app).get('/api/search/suggestions').query({ keyword: ' Nike ', limit: 100 }).expect(200);
  expect(SearchHistoryModel.getSuggestions).toHaveBeenLastCalledWith('Nike', 100);
});

test.each([{}, { keyword: '' }, { keyword: '  ' }])('空前缀继续返回空建议，不访问模型：%j', async params => {
  await request(app).get('/api/search/suggestions').query(params).expect(200, { suggestions: [] });
  noHistoryAccess();
});

test.each([{ keyword: 'x'.repeat(101) }, { keyword: ['a', 'b'] }, { keyword: { nested: 'a' } }])('拒绝过长或非字符串建议关键词：%j', async params => {
  await request(app).get('/api/search/suggestions').query(params).expect(400);
  noHistoryAccess();
});

test.each([' ', 'x'.repeat(101)])('删除时拒绝非法关键词：%s', async keyword => {
  await request(app).delete('/api/search/history/' + encodeURIComponent(keyword)).set(auth).expect(400);
  noHistoryAccess();
});

test('删除有效关键词只操作当前用户，数据库故障仍返回 500', async () => {
  await request(app).delete('/api/search/history/Nike').set(auth).expect(200);
  expect(SearchHistoryModel.deleteKeyword).toHaveBeenCalledWith(7, 'Nike');
  (SearchHistoryModel.add as jest.Mock).mockRejectedValueOnce(new Error('db unavailable'));
  await request(app).post('/api/search/record').set(auth).send({ keyword: 'Nike' }).expect(500);
});

test('商品搜索、普通商品查询和历史字段长度一致，100 字符合法，101 字符不查询', async () => {
  const keyword = '中'.repeat(100);
  await request(app).get('/api/search/es').set(auth).query({ keyword }).expect(200);
  expect(SearchHistoryModel.add).toHaveBeenCalledWith(keyword, 7, 2);
  expect(productQuerySchema.validate({ keyword }).error).toBeUndefined();
  jest.clearAllMocks();
  await request(app).get('/api/search/es').query({ keyword: keyword + '中' }).expect(400);
  expect(searchProducts).not.toHaveBeenCalled();
  noHistoryAccess();
  expect(productQuerySchema.validate({ keyword: keyword + '中' }).error).toBeDefined();
});
