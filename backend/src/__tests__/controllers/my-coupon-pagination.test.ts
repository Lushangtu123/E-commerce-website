import type { Response } from 'express';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
import { getPool } from '../../database/mysql';
import { CouponController } from '../../controllers/coupon.controller';

const res = () => {
  const response = {} as Response;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
};

test('owned coupon page returns bounded rows and pagination instead of rejecting page parameters', async () => {
  const row = { user_coupon_id: 1, user_id: 7, coupon_id: 1, status: 1 };
  const db = { execute: jest.fn().mockResolvedValue([[{ total: 21 }], []]), query: jest.fn().mockResolvedValue([[row], []]) };
  (getPool as jest.Mock).mockReturnValue(db);
  const response = res();
  await CouponController.getUserCoupons({ userId: 7, query: { status: '1', page: '2', page_size: '20' } } as never, response);
  expect(response.status).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalledWith({ success: true, data: [row], pagination: { page: 2, page_size: 20, total: 21, total_pages: 2 } });
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT ? OFFSET ?'), [7, 1, 20, 20]);
});

test.each([
  { page: '0' }, { page: '-1' }, { page: '2x' }, { page: '01' }, { page: '1e2' }, { page: '10001' },
  { page: ['1', '2'] }, { page: '1', page_size: '101' }, { page: '1', page_size: '0' },
  { page: '1', page_size: '20x' }, { page_size: '20' }, { page: '1', unknown: 'x' },
])('invalid owned coupon pagination %p is rejected before querying', async query => {
  const db = { execute: jest.fn(), query: jest.fn() }; (getPool as jest.Mock).mockReturnValue(db);
  const response = res();
  await CouponController.getUserCoupons({ userId: 7, query } as never, response);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(db.execute).not.toHaveBeenCalled(); expect(db.query).not.toHaveBeenCalled();
});

test('old consumers without page still receive the full response without pagination', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ user_coupon_id: i + 1, user_id: 7 }));
  const db = { execute: jest.fn().mockResolvedValue([rows, []]), query: jest.fn() };
  (getPool as jest.Mock).mockReturnValue(db);
  const response = res(); await CouponController.getUserCoupons({ userId: 7, query: {} } as never, response);
  expect(response.json).toHaveBeenCalledWith({ success: true, data: rows });
  expect(db.query).not.toHaveBeenCalled(); expect(db.execute).toHaveBeenCalledTimes(1);
});
