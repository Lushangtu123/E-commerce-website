import { Request, Response } from 'express';
import express from 'express';
import supertest from 'supertest';

jest.mock('../../database/mysql', () => ({getPool: jest.fn(), query: jest.fn()}));
jest.mock('../../utils/logger', () => ({__esModule: true, default: {info: jest.fn(), warn: jest.fn(), error: jest.fn()}}));
jest.mock('../../controllers/admin-product-write', () => ({afterProductWrite: jest.fn()}));

import { getPool } from '../../database/mysql';
import { getAdminProducts } from '../../controllers/admin-product.controller';
import { getAdminOrders, getOrderStatistics } from '../../controllers/admin-order.controller';
import { getAdminUserDetail, getAdminUsers, getUserOrders, getUserStatistics } from '../../controllers/admin-user.controller';
import { getAdminLogs } from '../../controllers/admin-log.controller';
import { getDashboardStats, getRecentOrders, getSalesTrend, getTopProducts } from '../../controllers/admin-dashboard.controller';

type Handler = (req: Request, res: Response) => Promise<unknown>;
let query: jest.Mock;
function response() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const request = (query: unknown = {}, params: unknown = {}) => ({query, params} as Request);
beforeEach(() => {
  jest.clearAllMocks();
  query = jest.fn().mockResolvedValue([[{total: 0}], []]);
  (getPool as jest.Mock).mockReturnValue({query});
});

async function reject(handler: Handler, fields: unknown, params: unknown = {}) {
  const res = response();
  await handler(request(fields, params), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({error: '后台查询参数无效'});
  expect(getPool).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
}

const lists: Array<[string, Handler, Record<string, string>]> = [
  ['products', getAdminProducts, {}], ['orders', getAdminOrders, {}],
  ['users', getAdminUsers, {}], ['logs', getAdminLogs, {}],
  ['user orders', getUserOrders, {userId: '7'}],
];
describe.each(lists)('%s pagination', (_, handler, params) => {
  test.each([
    {page: '-1'}, {page: '0'}, {page: '1tail'}, {page: '1.5'}, {page: '1e2'},
    {page: '01'}, {page: ' 2'}, {page: '10001'}, {page: '9007199254740992'},
    {page: ['1', '2']}, {page: {value: '2'}}, {page: 2}, {page: ''},
    {limit: '-2'}, {limit: '0'}, {limit: '101'}, {limit: '3tail'},
    {limit: ['10']}, {limit: {value: '10'}}, {limit: '999999999999999999'},
    {unexpected: '1'},
  ])('rejects %p before retrieving the database pool', async fields => reject(handler, fields, params));

  test('rejects non-object and array query roots', async () => {
    for (const fields of [null, [], 'page=1']) await reject(handler, fields, params);
  });

  test('accepts bounded numeric strings and applies defaults', async () => {
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{total: 0}], []]);
    const res = response();
    await handler(request({page: '2', limit: '100'}, params), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(query.mock.calls[0][1].slice(-2)).toEqual([100, 100]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({pagination: {page: 2, limit: 100, total: 0, totalPages: 0}}));
    query.mockClear();
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{total: 0}], []]);
    await handler(request({}, params), response());
    expect(query.mock.calls[0][1].slice(-2)).toEqual([handler === getUserOrders ? 10 : 20, 0]);
  });
});

describe('domain-specific admin filters', () => {
  test.each([
    [getAdminProducts, {categoryId: '2tail'}], [getAdminProducts, {categoryId: '0'}],
    [getAdminProducts, {categoryId: '2147483648'}], [getAdminProducts, {categoryId: ['2']}],
    [getAdminProducts, {categoryId: {id: '2'}}], [getAdminProducts, {status: '2'}],
    [getAdminProducts, {status: ['1']}], [getAdminProducts, {status: '0tail'}],
    [getAdminProducts, {keyword: ['test']}], [getAdminProducts, {keyword: {text: 'test'}}],
    [getAdminProducts, {keyword: 'a'.repeat(101)}],
    [getAdminUsers, {status: '-1'}], [getAdminUsers, {status: '2'}],
    [getAdminUsers, {status: {value: '0'}}], [getAdminUsers, {keyword: ['test']}],
    [getAdminUsers, {keyword: 'a'.repeat(101)}],
    [getAdminOrders, {userId: '0'}], [getAdminOrders, {userId: '7suffix'}],
    [getAdminOrders, {userId: '9007199254740992'}], [getAdminOrders, {userId: {value: '7'}}],
    [getAdminOrders, {status: '-1'}], [getAdminOrders, {status: '5'}],
    [getAdminOrders, {status: '01'}], [getAdminOrders, {status: ['1', '4']}],
    [getAdminOrders, {orderNo: 'a'.repeat(33)}], [getAdminOrders, {orderNo: ['test']}],
    [getAdminLogs, {adminId: '-3'}], [getAdminLogs, {adminId: '3tail'}],
    [getAdminLogs, {adminId: ['3']}], [getAdminLogs, {action: {name: 'LOGIN'}}],
    [getAdminLogs, {action: 'a'.repeat(51)}],
  ] as Array<[Handler, unknown]>)('rejects malformed domain filters %#', async (handler, fields) => reject(handler, fields));

  test.each([
    [getAdminProducts, {keyword: ' phone ', categoryId: '2', status: '0'}, ['%phone%', '%phone%', '%phone%', '%phone%', '2', 0, 20, 0]],
    [getAdminProducts, {status: '-1'}, [-1, 20, 0]],
    [getAdminUsers, {keyword: ' user ', status: '0'}, ['%user%', '%user%', '%user%', 0, 20, 0]],
    [getAdminOrders, {orderNo: ' ORDER ', userId: '9007199254740991', status: '4'}, ['%ORDER%', '9007199254740991', 4, 20, 0]],
    [getAdminLogs, {action: ' LOGIN ', adminId: '3'}, ['LOGIN', '3', 20, 0]],
  ] as Array<[Handler, Record<string, string>, unknown[]]>)('retains normal normalized filters %#', async (handler, fields, expected) => {
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{total: 0}], []]);
    const res = response();
    await handler(request(fields), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(query.mock.calls[0][1]).toEqual(expected);
    expect(query.mock.calls[1][1]).toEqual(expected.slice(0, -2));
  });
});

describe.each([getAdminOrders, getAdminLogs, getOrderStatistics])('strict calendar dates', handler => {
  test.each([
    {startDate: '2026-02-29'}, {endDate: '2026-04-31'}, {startDate: '2026-01-01suffix'},
    {endDate: '0000-01-01'}, {startDate: '2026-1-01'}, {startDate: ['2026-01-01']},
    {endDate: {value: '2026-01-01'}}, {startDate: ''},
    {startDate: '2026-03-01', endDate: '2026-02-28'}, {unexpected: 'test'},
  ])('rejects invalid dates %p', async fields => reject(handler, fields));

  test('accepts a real leap day and ordered inclusive range', async () => {
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{total: 0}], []]);
    const res = response();
    await handler(request({startDate: '2024-02-29', endDate: '2024-03-01'}), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(query.mock.calls[0][1].slice(0, 2)).toEqual(['2024-02-29', '2024-03-01']);
  });
});

describe('user path IDs and read query scopes', () => {
  test.each(['0', '-1', '2tail', '01', '9007199254740992', ['1'], {id: '1'}])('rejects invalid user path %p', async userId => {
    for (const handler of [getAdminUserDetail, getUserOrders]) {
      const res = response();
      await handler(request({}, {userId}), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({error: '用户ID无效'});
      expect(getPool).not.toHaveBeenCalled();
    }
  });

  test.each([getDashboardStats, getUserStatistics, getAdminUserDetail])('rejects unknown fields on queryless reads %#', async handler => {
    await reject(handler, {unexpected: '1'}, {userId: '7'});
  });
});

describe('dashboard numeric query bounds', () => {
  test.each([
    [getRecentOrders, {limit: '-1'}], [getRecentOrders, {limit: '101'}],
    [getRecentOrders, {limit: '10tail'}], [getRecentOrders, {limit: ['10']}],
    [getRecentOrders, {days: '7'}], [getTopProducts, {days: '0'}],
    [getTopProducts, {days: '366'}], [getTopProducts, {days: '7suffix'}],
    [getTopProducts, {days: {number: '7'}}], [getTopProducts, {limit: '999999999999999'}],
    [getSalesTrend, {days: '-2'}], [getSalesTrend, {days: ['7']}],
    [getSalesTrend, {limit: '10'}],
  ] as Array<[Handler, unknown]>)('rejects invalid dashboard values %#', async (handler, fields) => reject(handler, fields));

  test.each([
    [getRecentOrders, {limit: '100'}, [100]],
    [getTopProducts, {days: '365', limit: '100'}, [365, 100]],
    [getSalesTrend, {days: '365'}, [365]],
  ] as Array<[Handler, Record<string, string>, number[]]>)('accepts dashboard bounds %#', async (handler, fields, expected) => {
    const res = response();
    await handler(request(fields), res);
    expect(res.status).not.toHaveBeenCalled();
    expect(query.mock.calls[0][1]).toEqual(expected);
  });
});

describe('actual Express query parsing', () => {
  test.each([
    [getAdminProducts, '/read?page=1&page=2'],
    [getAdminOrders, '/read?userId[value]=7'],
    [getAdminLogs, '/read?startDate[]=2026-01-01'],
    [getTopProducts, '/read?days=10tail'],
  ] as Array<[Handler, string]>)('rejects HTTP duplicate, nested and malformed values %#', async (handler, url) => {
    const app = express();
    app.set('query parser', 'extended');
    app.get('/read', (req, res) => { void handler(req, res); });
    const result = await supertest(app).get(url).expect(400);
    expect(result.body).toEqual({error: '后台查询参数无效'});
    expect(getPool).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
