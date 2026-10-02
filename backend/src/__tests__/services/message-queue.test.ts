import { handleOrderCreated, handleOrderPaid, handleOrderCancelled, handleStockDeduction, handleStockRecovery } from '../../services/message-queue.service';
import { publishMessage, QUEUES } from '../../database/rabbitmq';
import { pool } from '../../database/mysql';

jest.mock('../../database/rabbitmq', () => ({
  publishMessage: jest.fn().mockResolvedValue(true), publishOrderTimeoutCheck: jest.fn(), consumeQueue: jest.fn(),
  QUEUES: { EMAIL_NOTIFICATION: 'email', STOCK_DEDUCTION: 'deduct', STOCK_RECOVERY: 'recover' },
}));
jest.mock('../../database/mysql', () => ({
  getPool: jest.fn(),
  pool: {
    execute: jest.fn().mockResolvedValue([[{ sku_id: 1, quantity: 2 }]]),
    getConnection: jest.fn().mockResolvedValue({
      execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]), beginTransaction: jest.fn(),
      commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    }),
  },
}));

beforeEach(() => jest.clearAllMocks());

test.each([handleOrderCreated, handleOrderPaid, handleOrderCancelled])('订单消息重投不会再次修改库存或销量', async handler => {
  const message = { order_id: 1, user_id: 1, items: [{ product_id: 1, sku_id: 1, quantity: 2 }] };
  await handler(message);
  await handler(message);
  expect(pool.execute).not.toHaveBeenCalled();
  expect(pool.getConnection).not.toHaveBeenCalled();
  expect(publishMessage).toHaveBeenCalledTimes(2);
  expect(publishMessage).toHaveBeenCalledWith(QUEUES.EMAIL_NOTIFICATION, expect.objectContaining({ order_id: 1 }));
});

test.each([handleStockDeduction, handleStockRecovery])('历史库存队列不会绕过订单事务再次修改库存', async handler => {
  await handler({ order_id: 1, sku_id: 1, quantity: 2 });
  expect(pool.execute).not.toHaveBeenCalled();
  expect(pool.getConnection).not.toHaveBeenCalled();
});
