import fs from 'fs';
import path from 'path';
import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { CartModel } from '../../models/cart.model';
import { CartController } from '../../controllers/cart.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
function latch() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
async function wait(promise: Promise<void>, label: string) {
  let timer: ReturnType<typeof setTimeout>;
  try { await Promise.race([promise, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 2000); })]); }
  finally { clearTimeout(timer!); }
}

integration('real MySQL cart write serialization', () => {
  const database = `cart_concurrency_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8 };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database}`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'products', 'product_skus', 'cart'].includes(match[2])) await db.query(match[1]);
    }
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'A','a@test','test'),(2,'B','b@test','test')");
    await db.query("INSERT INTO products(product_id,title,price,stock,status) VALUES(1,'A',10,10,1),(2,'B',10,10,1)");
  });
  beforeEach(async () => {
    await db.query('TRUNCATE TABLE cart');
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  const add = async (productId: number) => {
    const res = { statusCode: 200, body: undefined as any,
      status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
    await CartController.add({ userId: 1, body: { product_id: productId, quantity: 1 } } as any, res as any);
    return res;
  };
  test('same user can concurrently first-add distinct products without a missing-row deadlock', async () => {
    const firstRead = latch(), secondBoundary = latch(), release = latch(); let connectionIndex = 0;
    (getPool as jest.Mock).mockReturnValue({ getConnection: async () => {
      const connection = await db.getConnection(), index = connectionIndex++;
      return new Proxy(connection, { get(target, property) {
        if (property === 'execute') return async (sql: string, values: any[]) => {
          // A serialized implementation may wait on the user mutex instead of reaching the cart read.
          if (index === 1 && sql.startsWith('SELECT user_id FROM users')) secondBoundary.resolve();
          const result = await target.execute(sql, values);
          if (sql.startsWith('SELECT quantity FROM cart')) {
            (index === 0 ? firstRead : secondBoundary).resolve();
            await release.promise;
          }
          return result;
        };
        const value = target[property as keyof PoolConnection];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } });
    const first = add(1); let second: Promise<Awaited<ReturnType<typeof add>>> | undefined;
    try {
      await wait(firstRead.promise, 'first cart read not reached');
      second = add(2);
      await wait(secondBoundary.promise, 'second cart write boundary not reached');
    } finally { release.resolve(); }
    const results = await Promise.all([first, second!]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT product_id,quantity FROM cart ORDER BY product_id');
    expect(rows.map(row => [row.product_id, row.quantity])).toEqual([[1, 1], [2, 1]]);
  });
  test('concurrent increments keep one identity and reject quantities exceeding live stock', async () => {
    expect(await Promise.all(Array.from({ length: 6 }, () => CartModel.add(1, 1, 1)))).toEqual(Array(6).fill(true));
    await expect(CartModel.add(1, 1, 5)).rejects.toMatchObject({ message: '商品库存不足', statusCode: 400 });
    const [rows] = await db.query<RowDataPacket[]>('SELECT quantity FROM cart');
    expect(rows.map(row => row.quantity)).toEqual([6]);
    const [products] = await db.query<RowDataPacket[]>('SELECT stock FROM products WHERE product_id=1');
    expect(products[0].stock).toBe(10);
  });
  test.each(['remove', 'clear'] as const)('%s waits for an in-flight quantity update and cannot restore stale inventory', async action => {
    await CartModel.add(1, 1, 2); await CartModel.add(2, 1, 3);
    const read = latch(), deletion = latch(), release = latch();
    (getPool as jest.Mock).mockReturnValue({ getConnection: async () => {
      const connection = await db.getConnection();
      return new Proxy(connection, { get(target, property) {
        if (property === 'execute') return async (sql: string, values: any[]) => {
          if (sql.startsWith('DELETE FROM cart')) deletion.resolve();
          const result = await target.execute(sql, values);
          if (sql.startsWith('SELECT quantity FROM cart')) { read.resolve(); await release.promise; }
          return result;
        };
        const value = target[property as keyof PoolConnection];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } });
    const update = CartModel.add(1, 1, 1);
    await wait(read.promise, 'cart read not reached');
    const remove = action === 'remove' ? CartModel.remove(1, 1) : CartModel.clear(1);
    try { expect(await Promise.race([deletion.promise.then(() => true), new Promise<boolean>(accept => setTimeout(() => accept(false), 40))])).toBe(false); }
    finally { release.resolve(); }
    expect(await Promise.all([update, remove])).toEqual([true, true]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT user_id,quantity FROM cart');
    expect(rows.map(row => [row.user_id, row.quantity])).toEqual([[2, 3]]);
  });
  test('quantity-zero removal and clear preserve other users and allow a fresh add', async () => {
    await CartModel.add(1, 1, 2); await CartModel.add(1, 2, 1); await CartModel.add(2, 1, 3);
    expect(await CartModel.updateQuantity(1, 1, 0)).toBe(true);
    expect(await CartModel.clear(1)).toBe(true);
    await CartModel.add(1, 1, 1);
    const [rows] = await db.query<RowDataPacket[]>('SELECT user_id,product_id,quantity FROM cart ORDER BY user_id');
    expect(rows.map(row => [row.user_id, row.product_id, row.quantity])).toEqual([[1, 1, 1], [2, 1, 3]]);
  });
});
