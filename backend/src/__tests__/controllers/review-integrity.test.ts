jest.mock('../../database/mysql', () => ({ query: jest.fn(), getPool: jest.fn() }));

import { Response } from 'express';
import { getPool, query } from '../../database/mysql';
import { ReviewController } from '../../controllers/review.controller';
import { ReviewModel } from '../../models/review.model';

let connection: any;
let order: any;
let belongs: boolean;
let reviewed: boolean;
let failure: any;
const input = { product_id: 2147483650, order_id: 2147483651, rating: 5 };
function response() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res); res.json = jest.fn().mockReturnValue(res);
  return res;
}
function request(body: any = input, parameters: any = {}) {
  return { userId: 7, body, params: { id: '2147483650' }, query: {}, ...parameters } as any;
}
const inserts = () => connection.execute.mock.calls.filter(([sql]: [string]) => sql.startsWith('INSERT INTO reviews'));

beforeEach(() => {
  jest.clearAllMocks();
  order = { order_id: input.order_id, user_id: 7, status: 3 }; belongs = true; reviewed = false; failure = undefined;
  const execute = async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM orders')) return order ? [order] : [];
    if (sql.includes('FROM order_items')) return belongs ? [{ item_id: 1, product_id: input.product_id }] : [];
    if (sql.includes('FROM reviews') && sql.includes('COUNT(')) return [{ count: reviewed ? 1 : 0, total: 0 }];
    if (sql.includes('FROM reviews') && !sql.includes('LEFT JOIN')) return reviewed ? [{ review_id: 81 }] : [];
    if (sql.startsWith('INSERT INTO reviews')) {
      if (failure) throw failure;
      reviewed = true;
      return { insertId: 81, affectedRows: 1 };
    }
    return [];
  };
  connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined), commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined), release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[]) => [await execute(sql, params), []]),
  };
  (query as jest.Mock).mockImplementation(execute);
  (getPool as jest.Mock).mockReturnValue({ getConnection: jest.fn().mockResolvedValue(connection) });
});

test('a completed order cannot review a product absent from its purchased items', async () => {
  belongs = false;
  const res = response(); await ReviewController.create(request(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: '该商品不属于此订单' });
  expect(inserts()).toHaveLength(0);
});

test.each([
  ['product string', { product_id: '2147483650' }], ['order string', { order_id: '2147483651' }],
  ['zero product', { product_id: 0 }], ['fractional order', { order_id: 1.5 }], ['unsafe product', { product_id: Number.MAX_SAFE_INTEGER + 1 }],
  ['fractional rating', { rating: 2.5 }], ['rating string', { rating: '5' }], ['rating boolean', { rating: true }],
  ['rating array', { rating: [5] }], ['rating zero', { rating: 0 }], ['rating high', { rating: 6 }],
  ['long content', { content: 'x'.repeat(2001) }], ['object content', { content: {} }],
  ['too many images', { images: Array(10).fill('https://example.test/image.png') }],
  ['image object', { images: [{}] }], ['image text', { images: 'https://example.test/image.png' }],
  ['script image', { images: ['javascript:alert(1)'] }], ['relative image', { images: ['/image.png'] }],
  ['long image URL', { images: ['https://example.test/' + 'x'.repeat(2048)] }],
  ['unknown owner field', { user_id: 8 }], ['unknown field', { unknown: true }],
])('strict body rejects %s before database access', async (_name, fields) => {
  const res = response(); await ReviewController.create(request({ ...input, ...fields }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(query).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
});

test.each([undefined, null, [], {}, { product_id: 1 }, { ...input, rating: null }])('missing or malformed review body %p is rejected', async body => {
  const res = response(); await ReviewController.create(request(body, { body }), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(query).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
});

test.each([undefined, '', null, 'x'.repeat(2000)])('owned completed purchase allows optional/boundary content %p and valid image limits', async content => {
  const res = response();
  await ReviewController.create(request({ ...input, content, images: Array(9).fill('https://example.test/image.png') }), res);
  expect(res.status).toHaveBeenCalledWith(201); expect(res.json).toHaveBeenCalledWith({ message: '评论成功', review_id: 81 });
  expect(connection.beginTransaction).toHaveBeenCalledTimes(1); expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled(); expect(connection.release).toHaveBeenCalledTimes(1);
  expect(connection.execute.mock.calls[0]).toEqual([expect.stringMatching(/FROM orders.*FOR UPDATE/s), [input.order_id]]);
  expect(inserts()).toHaveLength(1);
  expect(inserts()[0][1]).toEqual([input.product_id, 7, input.order_id, 5, content ?? null, JSON.stringify(Array(9).fill('https://example.test/image.png'))]);
  expect(query).not.toHaveBeenCalled();
});

test.each([[undefined, 404], [{ user_id: 8, status: 3 }, 403], [{ user_id: 7, status: 2 }, 400]])('missing, foreign or incomplete orders reject before inserting', async (value, status) => {
  order = value;
  const res = response(); await ReviewController.create(request(), res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(inserts()).toHaveLength(0); expect(connection.rollback).toHaveBeenCalledTimes(1); expect(connection.release).toHaveBeenCalledTimes(1);
});

test('duplicate purchase review returns 409 under the transaction even without unique constraint', async () => {
  reviewed = true;
  const res = response(); await ReviewController.create(request(), res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(inserts()).toHaveLength(0); expect(connection.rollback).toHaveBeenCalledTimes(1); expect(connection.release).toHaveBeenCalledTimes(1);
});

test('unique-key conflicts return a friendly 409 and roll back/release', async () => {
  failure = Object.assign(new Error('duplicate key detail'), { code: 'ER_DUP_ENTRY' });
  const res = response(); await ReviewController.create(request(), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith({ error: '评论已存在，请勿重复提交' });
  expect(connection.commit).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledTimes(1); expect(connection.release).toHaveBeenCalledTimes(1);
});

test('unexpected insert failure rolls back/releases and exposes only the public failure', async () => {
  failure = new Error('private database detail');
  const res = response(); await ReviewController.create(request(), res);
  expect(res.status).toHaveBeenCalledWith(500); expect(res.json).toHaveBeenCalledWith({ error: '创建评论失败' });
  expect(connection.commit).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledTimes(1); expect(connection.release).toHaveBeenCalledTimes(1);
});

test.each([
  { page: '0' }, { page: '01' }, { page: '1x' }, { page: '1.5' }, { page: '' }, { page: ['1', '2'] }, { page: 1 }, { page: '2147483648' },
  { limit: '0' }, { limit: '101' }, { limit: '' }, { limit: ['10'] }, { user_id: '8' }, { unknown: 'true' },
])('both review listings reject malformed query %p without DB access', async parameters => {
  for (const action of [ReviewController.listByProduct, ReviewController.listByUser]) {
    const res = response(); await action(request(input, { query: parameters }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  }
  expect(query).not.toHaveBeenCalled(); expect(getPool).not.toHaveBeenCalled();
});

test.each(['0', '-1', '01', '1x', '1.5', '9007199254740992'])('public product list rejects malformed path %s', async id => {
  const res = response(); await ReviewController.listByProduct(request(input, { params: { id } }), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});

test('list contract preserves default page1/limit10 and bound safe BIGINT IDs with stable ordering', async () => {
  const res = response(); await ReviewController.listByProduct(request(), res);
  expect(res.json).toHaveBeenCalledWith({ reviews: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('r.review_id DESC'), [input.product_id, 10, 0]);
  await ReviewController.listByUser(request(input, { query: { page: '2147483647', limit: '100' } }), response());
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('r.review_id DESC'), [7, 100, 214748364600]);
});

test('direct model calls cannot bypass input validation', async () => {
  await expect(ReviewModel.create(input.product_id, 7, input.order_id, 2.5)).rejects.toMatchObject({ statusCode: 400 });
  expect(getPool).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
});
