import { Request, Response } from 'express';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../controllers/admin-product-write', () => ({ afterProductWrite: jest.fn() }));

import { getPool } from '../../database/mysql';
import { getAdminProducts } from '../../controllers/admin-product.controller';
import { getAdminUsers } from '../../controllers/admin-user.controller';
import { getAdminOrders } from '../../controllers/admin-order.controller';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const searches: [string, Handler, string, number][] = [
  ['products', getAdminProducts, 'keyword', 4],
  ['users', getAdminUsers, 'keyword', 3],
  ['orders', getAdminOrders, 'orderNo', 1],
];

describe.each(searches)('admin %s literal substring search', (_name, handler, field, columns) => {
  test.each([
    ['40%', '%40!%%'],
    ['u_1', '%u!_1%'],
    ['sale!tag', '%sale!!tag%'],
    ['a\\b', '%a\\b%'],
    ['  sale!_%\\tag  ', '%sale!!!_!%\\tag%'],
    ['red blue', '%red blue%'],
  ])('treats %j as a single literal substring in both rows and count', async (input, expected) => {
    const query = jest.fn().mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ total: 0 }], []]);
    (getPool as jest.Mock).mockReturnValue({ query });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    await handler({ query: { [field]: input, page: '2', limit: '10' } } as unknown as Request, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ pagination: { page: 2, limit: 10, total: 0, totalPages: 0 } }));
    expect(query.mock.calls[0][1]).toEqual([...Array(columns).fill(expected), 10, 10]);
    expect(query.mock.calls[1][1]).toEqual(Array(columns).fill(expected));
    for (const [sql] of query.mock.calls) expect((sql.match(/LIKE \? ESCAPE '!'/g) || []).length).toBe(columns);
  });
});
