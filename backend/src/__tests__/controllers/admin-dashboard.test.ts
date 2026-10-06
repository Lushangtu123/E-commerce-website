/**
 * 管理后台仪表盘、操作日志与管理员信息接口测试
 * 用模拟的连接池核对每个接口发出的查询参数和返回的数据形状
 */
import { Request, Response } from 'express';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getPool } from '../../database/mysql';
import { getAdminProfile } from '../../controllers/admin.controller';
import { getDashboardStats, getRecentOrders, getSalesTrend, getTopProducts } from '../../controllers/admin-dashboard.controller';
import { getAdminLogs, logAdminAction } from '../../controllers/admin-log.controller';

let query: jest.Mock;

/** Answers the pool's queries in order; each entry is the `rows` of one query. */
function answer(...results: unknown[]) {
  query = jest.fn();
  for (const rows of results) query.mockResolvedValueOnce([rows, []]);
  (getPool as jest.Mock).mockReturnValue({ query });
}

function response() {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response & { status: jest.Mock; json: jest.Mock };
}

const req = (query: Record<string, string> = {}, admin?: { adminId: number }) => ({ query, admin } as unknown as Request);

describe('dashboard', () => {
  it('reports today against yesterday, with growth rounded to one decimal', async () => {
    answer(
      [{ today_orders: 6, today_revenue: '150.50' }],
      [{ new_users: 3 }],
      [{ pending_orders: 2 }],
      [{ total_products: 40, active_products: '35' }],
      [{ yesterday_orders: 4, yesterday_revenue: '100.00' }],
    );
    const res = response();
    await getDashboardStats(req(), res);

    expect(res.json).toHaveBeenCalledWith({
      today_orders: 6, today_revenue: 150.5, new_users: 3, pending_orders: 2,
      total_products: 40, active_products: '35', order_growth: 50, revenue_growth: 50.5,
    });
    const today = new Date().toISOString().split('T')[0];
    expect(query.mock.calls[0][1]).toEqual([today]);
    expect(query.mock.calls[1][1]).toEqual([today]);
    expect(query.mock.calls[4][1]).toEqual([new Date(Date.now() - 86400000).toISOString().split('T')[0]]);
  });

  it('reports no growth when yesterday had nothing', async () => {
    answer(
      [{ today_orders: 2, today_revenue: '20.00' }], [{ new_users: 0 }], [{ pending_orders: 0 }],
      [{ total_products: 1, active_products: 1 }], [{ yesterday_orders: 0, yesterday_revenue: 0 }],
    );
    const res = response();
    await getDashboardStats(req(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order_growth: 0, revenue_growth: 0 }));
  });

  it.each([
    ['recent orders', getRecentOrders, { limit: '5' }, [5], [10]],
    ['top products', getTopProducts, { days: '30', limit: '3' }, [30, 3], [7, 10]],
    ['sales trend', getSalesTrend, { days: '14' }, [14], [7]],
  ] as const)('returns the %s rows for the requested window and defaults it', async (_, handler, params, sent, defaults) => {
    answer([{ row: 1 }]);
    const res = response();
    await handler(req(params), res);
    expect(query.mock.calls[0][1]).toEqual(sent);
    expect(res.json).toHaveBeenCalledWith([{ row: 1 }]);

    answer([]);
    await handler(req(), response());
    expect(query.mock.calls[0][1]).toEqual(defaults);
  });

  it.each([
    ['stats', getDashboardStats, '获取数据失败'],
    ['recent orders', getRecentOrders, '获取订单失败'],
    ['top products', getTopProducts, '获取商品失败'],
    ['sales trend', getSalesTrend, '获取趋势失败'],
  ] as const)('answers 500 when the %s query fails', async (_, handler, message) => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('down')) });
    const res = response();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: message });
  });
});

describe('admin logs', () => {
  it('filters, pages and counts the log', async () => {
    answer([{ log_id: 1 }], [{ total: 45 }]);
    const res = response();
    await getAdminLogs(req({ page: '2', limit: '20', action: 'LOGIN', adminId: '3', startDate: '2026-01-01', endDate: '2026-01-31' }), res);

    const filters = ['LOGIN', '3', '2026-01-01', '2026-01-31'];
    expect(query.mock.calls[0][0]).toContain('al.action = ? AND al.admin_id = ? AND DATE(al.created_at) >= ? AND DATE(al.created_at) <= ?');
    expect(query.mock.calls[0][1]).toEqual([...filters, 20, 20]);
    expect(query.mock.calls[1][1]).toEqual(filters);
    expect(res.json).toHaveBeenCalledWith({ logs: [{ log_id: 1 }], pagination: { page: 2, limit: 20, total: 45, totalPages: 3 } });
  });

  it('lists the first page of every entry without filters', async () => {
    answer([], [{ total: 0 }]);
    const res = response();
    await getAdminLogs(req(), res);
    expect(query.mock.calls[0][0]).toContain('WHERE 1=1\n');
    expect(query.mock.calls[0][1]).toEqual([20, 0]);
    expect(res.json).toHaveBeenCalledWith({ logs: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it('records an action with the request origin, and never throws', async () => {
    answer({});
    await logAdminAction(1, 'UPDATE', 'product', '9', '更新商品', '127.0.0.1', 'jest');
    expect(query.mock.calls[0][1]).toEqual([1, 'UPDATE', 'product', '9', '更新商品', '127.0.0.1', 'jest']);

    answer({});
    await logAdminAction(1, 'LOGIN', null, null, '管理员登录');
    expect(query.mock.calls[0][1]).toEqual([1, 'LOGIN', null, null, '管理员登录', null, null]);

    (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(logAdminAction(1, 'LOGIN', null, null, '管理员登录')).resolves.toBeUndefined();
  });
});

describe('admin profile', () => {
  it("returns the signed-in administrator with their role's permissions", async () => {
    answer([{ admin_id: 4, username: 'ops', role_id: 2 }], [{ permission_code: 'order:read' }]);
    const res = response();
    await getAdminProfile(req({}, { adminId: 4 }), res);
    expect(query.mock.calls.map(([, params]) => params)).toEqual([[4], [2]]);
    expect(res.json).toHaveBeenCalledWith({ admin: { admin_id: 4, username: 'ops', role_id: 2 }, permissions: [{ permission_code: 'order:read' }] });
  });

  it('answers 404 for an administrator that no longer exists', async () => {
    answer([]);
    const res = response();
    await getAdminProfile(req({}, { adminId: 4 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
