import { getPool } from '../../database/mysql';
import { CartModel } from '../../models/cart.model';
import { CartController } from '../../controllers/cart.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
const key = '00000000-0000-4000-8000-000000000001';
// The extra argument is the intended public contract, so this regression runs on the old model too.
const add = (user = 1, product = 1, quantity = 2, sku?: number, addKey = key) =>
  (CartModel.add as (...args: unknown[]) => Promise<unknown>)(user, product, quantity, sku, addKey);

describe('durable cart add receipts', () => {
  let quantities: Map<string, number>, receipts: Map<string, string>, stock: number;
  const connection = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(), execute: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks(); quantities = new Map(); receipts = new Map(); stock = 20;
    (getPool as jest.Mock).mockReturnValue({ getConnection: async () => connection });
    connection.execute.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM users')) return [[{ user_id: values[0] }]];
      if (sql.includes('FROM cart_add_receipts')) {
        const fingerprint = receipts.get(`${values[0]}:${values[1]}`);
        return [fingerprint ? [{ payload_fingerprint: fingerprint }] : []];
      }
      if (sql.includes('INTO cart_add_receipts')) { receipts.set(`${values[0]}:${values[1]}`, String(values[2])); return [{ affectedRows: 1 }]; }
      if (sql.includes('FROM products')) return [[{ product_id: values[0], title: 'Item', price: '10', stock, status: 1 }]];
      if (sql.includes('FROM product_skus')) return [[]];
      const cartKey = `${values[0]}:${values[1]}:0`;
      if (sql.startsWith('SELECT quantity FROM cart')) return [quantities.has(cartKey) ? [{ quantity: quantities.get(cartKey) }] : []];
      if (sql.includes('INSERT INTO cart')) { quantities.set(cartKey, Number(values[3])); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });
  test('a lost response replay increments once and stores a normalized fingerprint', async () => {
    await add(); await add();
    expect([...quantities.values()]).toEqual([2]);
    expect(receipts.get(`1:${key}`)).toMatch(/^[a-f0-9]{64}$/);
    expect(connection.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO cart '))).toHaveLength(1);
    expect(connection.execute.mock.calls[0][0]).toContain('SELECT user_id FROM users');
  });
  test.each(['remove', 'clear', 'change'])('a receipt replay after %s never restores the original quantity', async change => {
    await add(); quantities.clear(); if (change === 'change') quantities.set('1:1:0', 7);
    stock = 0;
    await expect(add()).resolves.toMatchObject({ replayed: true });
    expect([...quantities.values()]).toEqual(change === 'change' ? [7] : []);
  });
  test.each([[2, 2, undefined], [1, 3, undefined], [1, 2, 9]] as const)('reusing a key for changed product/quantity/SKU %j fails with 409', async (product, quantity, sku) => {
    await add();
    await expect(add(1, product, quantity, sku)).rejects.toMatchObject({ statusCode: 409 });
    expect([...quantities.values()]).toEqual([2]);
  });
  test('the same key belongs to its customer; a fresh key intentionally increments again', async () => {
    await add(); await add(2); await add(1, 1, 2, undefined, '00000000-0000-4000-8000-000000000002');
    expect([...quantities.values()]).toEqual([4, 2]); expect(receipts.size).toBe(3);
  });
  test.each(['', 'invalid', 5, null])('controller rejects invalid add_key %j before opening a transaction', async add_key => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await CartController.add({ userId: 1, body: { product_id: 1, quantity: 1, add_key } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400); expect(getPool).not.toHaveBeenCalled();
  });
  test('controller rejects unknown fields and returns a replay receipt', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await CartController.add({ userId: 1, body: { product_id: 1, quantity: 1, add_key: key, surprise: true } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400); expect(getPool).not.toHaveBeenCalled();
    res.status.mockClear();
    for (let i = 0; i < 2; i++) await CartController.add({ userId: 1, body: { product_id: 1, quantity: 1, add_key: key } } as never, res as never);
    expect(res.json).toHaveBeenLastCalledWith({ message: '添加成功', add_key: key, replayed: true });
  });
});
