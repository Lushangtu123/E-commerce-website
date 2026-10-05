jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
import { getPool } from '../../database/mysql';
import { transitionOrder } from '../../services/order.service';
import { updateOrderStatus } from '../../controllers/admin-order.controller';
import { OrderStatus } from '../../models/order.model';

let connection: any;
let order: any;
beforeEach(() => {
  jest.clearAllMocks();
  order = { order_id: 1, order_no: 'o1', user_id: 9, status: OrderStatus.PAID };
  connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM orders')) return [[{ ...order }], []];
      if (sql.includes('UPDATE orders')) { order.status = params[0]; return [{ affectedRows: 1 }, []]; }
      return [[], []];
    }),
  };
  (getPool as jest.Mock).mockReturnValue({ getConnection: async () => connection, query: jest.fn() });
});

test('shipment cannot be created through the order transition without carrier and tracking', async () => {
  await expect(transitionOrder(1, OrderStatus.SHIPPED)).rejects.toThrow('物流');
  expect(connection.commit).not.toHaveBeenCalled();
});

test.each([
  { shipping_company: '', tracking_number: 'SF1' },
  { shipping_company: 'SF', tracking_number: '' },
  { shipping_company: 'SF\n', tracking_number: 'SF1' },
  { shipping_company: 'SF', tracking_number: 'SF\t1' },
  { shipping_company: 'x'.repeat(61), tracking_number: 'SF1' },
  { shipping_company: 'SF', tracking_number: 'x'.repeat(101) },
])('rejects malformed shipment %p before acquiring a database connection', async shipment => {
  await expect(transitionOrder(1, OrderStatus.SHIPPED, { shipment } as any)).rejects.toThrow('物流');
  expect(connection.beginTransaction).not.toHaveBeenCalled();
});

test('valid shipment is saved in the same conditional update as the status and timestamp', async () => {
  await transitionOrder(1, OrderStatus.SHIPPED, { shipment: { shipping_company: '  顺丰  ', tracking_number: ' SF123 ' } } as any);
  const update = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE orders'));
  expect(update[0]).toContain('shipping_company = ?');
  expect(update[0]).toContain('tracking_number = ?');
  expect(update[0]).toContain('shipped_at = NOW()');
  expect(update[1]).toEqual([2, '顺丰', 'SF123', 1, 1]);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  await expect(transitionOrder(1, OrderStatus.SHIPPED, { shipment: { shipping_company: 'Other', tracking_number: 'OTHER' } } as any)).rejects.toThrow('订单状态');
});

test('legacy admin status endpoint rejects shipment without logistics fields', async () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await updateOrderStatus({ params: { orderId: '1' }, body: { status: 2 }, admin: { adminId: 1 }, get: jest.fn() } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(connection.commit).not.toHaveBeenCalled();
});

test('admin cannot mark unpaid orders paid when collection is disabled', async () => {
  const oldMode = process.env.PAYMENT_MODE;
  delete process.env.PAYMENT_MODE;
  order.status = 0;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  try {
    await updateOrderStatus({ params: { orderId: '1' }, body: { status: 1 }, admin: { adminId: 1 }, get: jest.fn() } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(connection.commit).not.toHaveBeenCalled();
  } finally { process.env.PAYMENT_MODE = oldMode; }
});

test('explicit demo payment records payment_method in the same update', async () => {
  order.status = 0;
  connection.execute.mockImplementation(async (sql: string, params: any[]) => {
    if (sql.includes('FROM orders')) return [[{ ...order }], []];
    if (sql.includes('FROM order_items')) return [[], []];
    return [{ affectedRows: 1 }, []];
  });
  await transitionOrder(1, OrderStatus.PAID);
  const update = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE orders'));
  expect(update[0]).toContain("payment_method = 'demo'");
});
