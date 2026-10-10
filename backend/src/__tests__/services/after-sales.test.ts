jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
import { getPool } from '../../database/mysql';
// Dynamic loading makes the missing feature a runtime failure during the first red run.
const service = () => require('../../services/after-sales.service');
let order: any;
let existing: any;
let connection: any;
let pool: any;
beforeEach(() => {
  jest.clearAllMocks();
  order = { order_id: 10, user_id: 7, status: 1 };
  existing = undefined;
  connection = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM orders')) return [[{ ...order }], []];
      if (sql.includes('FROM after_sales_requests')) return [existing ? [{ ...existing }] : [], []];
      if (sql.includes('INSERT INTO after_sales_requests')) {
        existing = { request_id: 5, order_id: params[0], user_id: params[1], type: params[2], reason: params[3], status: 'requested' };
        return [{ insertId: 5, affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE after_sales_requests')) { existing.status = params[0]; return [{ affectedRows: 1 }, []]; }
      return [{ affectedRows: 1 }, []];
    }),
  };
  pool = { getConnection: jest.fn().mockResolvedValue(connection), execute: connection.execute, query: connection.execute };
  (getPool as jest.Mock).mockReturnValue(pool);
});

test('owned paid order creates one trimmed request with order row lock', async () => {
  const created = await service().createAfterSales(7, 10, { type: 'refund', reason: '  未收到商品  ' });
  expect(created).toMatchObject({ request_id: 5, order_id: 10, user_id: 7, type: 'refund', reason: '未收到商品', status: 'requested' });
  expect(connection.execute.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(connection.commit).toHaveBeenCalledTimes(1);
  await expect(service().createAfterSales(7, 10, { type: 'refund', reason: '重复' })).rejects.toThrow('已提交');
});

test.each([0, 4])('pending/cancelled order status %i rejects after-sales', async status => {
  order.status = status;
  await expect(service().createAfterSales(7, 10, { type: 'return', reason: '退货' })).rejects.toThrow('订单状态');
  expect(connection.commit).not.toHaveBeenCalled();
});

test('another customer cannot create or read request', async () => {
  await expect(service().createAfterSales(8, 10, { type: 'refund', reason: '退款' })).rejects.toMatchObject({ statusCode: 404 });
  await expect(service().getAfterSales(8, 10)).rejects.toMatchObject({ statusCode: 404 });
  expect(connection.commit).not.toHaveBeenCalled();
});

test.each([
  { type: 'exchange', reason: '更换' }, { type: 'refund', reason: ' ' },
  { type: 'return', reason: 'x'.repeat(501) }, { type: 'refund', reason: '退\u0000款' },
  { type: 'refund', reason: '退款', user_id: 8 },
  undefined, null, [],
])('rejects invalid request %p without starting transaction', async body => {
  await expect(service().createAfterSales(7, 10, body)).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('requested request may be withdrawn once, never re-created', async () => {
  existing = { request_id: 5, order_id: 10, user_id: 7, status: 'requested' };
  expect(await service().withdrawAfterSales(7, 10)).toMatchObject({ status: 'withdrawn' });
  await expect(service().withdrawAfterSales(7, 10)).rejects.toThrow('待审核');
  await expect(service().createAfterSales(7, 10, { type: 'return', reason: '退货' })).rejects.toThrow('已提交');
});

test('approval updates review only and writes an audit without customer reason/note', async () => {
  existing = { request_id: 5, order_id: 10, user_id: 7, status: 'requested', reason: 'PRIVATE-REASON' };
  expect(await service().reviewAfterSales(2, 5, { status: 'approved', note: ' PRIVATE-NOTE ' })).toMatchObject({ status: 'approved' });
  const queries = connection.execute.mock.calls as [string, unknown[]][];
  expect(queries.some(([sql]) => /UPDATE (orders|products|product_skus)/.test(sql))).toBe(false);
  expect(queries.filter(([sql]) => sql.includes('INSERT INTO admin_logs'))).toHaveLength(1);
  const audit = queries.find(([sql]) => sql.includes('INSERT INTO admin_logs'))!;
  expect(JSON.stringify(audit[1])).not.toMatch(/PRIVATE/);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  await expect(service().reviewAfterSales(2, 5, { status: 'rejected', note: '重复' })).rejects.toThrow('待审核');
});

test.each([{ status: 'refunded', note: 'test' }, { status: 'approved', note: '' }, { status: 'rejected', note: 'x'.repeat(501) }, undefined, null, []])('rejects review body %p', async body => {
  await expect(service().reviewAfterSales(2, 5, body)).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('audit failure rolls back approval together with review state', async () => {
  existing = { request_id: 5, order_id: 10, user_id: 7, status: 'requested' };
  const execute = connection.execute.getMockImplementation();
  connection.execute.mockImplementation((sql: string, params: any[]) => {
    if (sql.includes('INSERT INTO admin_logs')) throw new Error('audit unavailable');
    return execute(sql, params);
  });
  await expect(service().reviewAfterSales(2, 5, { status: 'approved', note: 'approved' })).rejects.toThrow('audit unavailable');
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('admin pagination rejects huge/negative/non-integer and unknown queries', async () => {
  for (const input of [{ page: '0' }, { page: '1e2' }, { limit: '101' }, { status: 'refunded' }, { user_id: '8' }]) {
    await expect(service().listAfterSales(input)).rejects.toMatchObject({ statusCode: 400 });
  }
});

test('admin detail selects one request by its own ID with paid context, without a pagination or status filter', async () => {
  existing = { request_id: 5, order_id: 10, user_id: 7, status: 'requested', total_amount: '29.99', payment_method: 'external' };
  expect(await service().getAfterSalesById(5)).toMatchObject(existing);
  expect(pool.query).toHaveBeenCalledTimes(1);
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toContain('WHERE a.request_id = ?');
  expect(sql).toContain('o.total_amount'); expect(sql).toContain('o.payment_method');
  expect(sql).not.toMatch(/LIMIT|OFFSET|a.status =/); expect(params).toEqual([5]);
  expect(pool.getConnection).not.toHaveBeenCalled();
});
test('admin detail reports a missing request as 404', async () => {
  await expect(service().getAfterSalesById(999)).rejects.toMatchObject({ message: '售后申请不存在', statusCode: 404 });
});
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('admin detail rejects invalid ID %s before SQL', async id => {
  await expect(service().getAfterSalesById(id)).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.query).not.toHaveBeenCalled();
});
test.each([
  undefined, null, [], {}, { company: ' ', tracking_number: '123' },
  { company: 'x'.repeat(61), tracking_number: '123' }, { company: 'carrier', tracking_number: 'x'.repeat(101) },
  { company: 'carrier', tracking_number: 'x\n123' }, { company: 'carrier', tracking_number: '123', user_id: 8 },
])('invalid tracking %p fails before database work', async body => {
  await expect(service().submitReturnTracking(7, 10, body)).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});
test.each([
  undefined, null, [], {}, { refund_amount: 0, note: 'test' }, { refund_amount: '0.00', note: ' ' },
  { refund_amount: '1.00', note: 'test' }, { refund_amount: '1.00', refund_reference: ' ', note: 'test' },
  { refund_amount: '1.00', refund_reference: 'x'.repeat(101), note: 'test' },
  { refund_amount: '0.00', note: 'x'.repeat(501) }, { refund_amount: '0.00', note: 'x\u0000' },
  { refund_amount: '0.00', note: 'test', completed_by: 999 }, { refund_amount: '99999999999999', note: 'test', refund_reference: 'test' },
])('invalid completion %p fails before database work', async body => {
  await expect(service().completeAfterSales(2, 5, body)).rejects.toMatchObject({ statusCode: 400 });
  expect(pool.getConnection).not.toHaveBeenCalled();
});
