import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { migrateFulfillment } from '../../database/migrate-fulfillment';
import { createAfterSales, getAfterSales, withdrawAfterSales, reviewAfterSales, listAfterSales } from '../../services/after-sales.service';
import { transitionOrder } from '../../services/order.service';
import { OrderModel, OrderStatus } from '../../models/order.model';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ del: jest.fn().mockResolvedValue(1) }) }));
const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;
integration('real MySQL shipment and after-sales locks', () => {
  const database = `ecommerce_fulfillment_test_${process.pid}`;
  let server: Pool, db: Pool;
  let created = false;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8,
  };
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql: string, values: unknown[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'products', 'orders', 'order_items'].includes(match[2])) await db.query(match[1]);
    }
    const adminSource = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    for (const match of adminSource.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['roles', 'admins', 'admin_logs'].includes(match[2])) await db.query(match[1]);
    }
    await db.query('ALTER TABLE orders DROP COLUMN shipping_company, DROP COLUMN tracking_number');
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status) VALUES (100,'legacy',7,29.99,2)");
    await migrateFulfillment(db);
    await migrateFulfillment(db);
    const [legacy] = await db.query<RowDataPacket[]>('SELECT * FROM orders WHERE order_id=100');
    expect(legacy[0]).toMatchObject({ status: 2, shipping_company: null, tracking_number: null, total_amount: '29.99' });
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue(db);
    for (const table of ['after_sales_requests', 'admin_logs', 'admins', 'roles', 'order_items', 'orders', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO roles (role_id,role_name) VALUES (1,'operator')");
    await db.query("INSERT INTO admins (admin_id,username,password_hash,role_id) VALUES (2,'operator','test',1)");
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (7,'customer','customer@example.test','test'),(8,'other','other@example.test','test')");
    await db.query("INSERT INTO products (product_id,title,price,stock,sales_count) VALUES (1,'product',10,5,1)");
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status,payment_method) VALUES (10,'order10',7,10,1,'demo')");
    await db.query("INSERT INTO order_items (item_id,order_id,product_id,product_name,price,quantity) VALUES (1,10,1,'product',10,1)");
  });
  async function order() { const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM orders WHERE order_id=10'); return rows[0]; }
  async function audit() { const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM admin_logs'); return rows; }
  async function product() { const [rows] = await db.query<RowDataPacket[]>('SELECT stock,sales_count FROM products WHERE product_id=1'); return rows[0]; }

  test('duplicate concurrent requests have one winner and preserve request history', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => createAfterSales(7, 10, { type: 'return', reason: '  商品破损  ' })));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [requests] = await db.query<RowDataPacket[]>('SELECT * FROM after_sales_requests');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ user_id: 7, type: 'return', reason: '商品破损', status: 'requested' });
    await expect(getAfterSales(8, 10)).rejects.toMatchObject({ statusCode: 404 });
    expect(await getAfterSales(7, 10)).toMatchObject({ request_id: requests[0].request_id });
  });
  test.each([0, 4])('ineligible status %i cannot create after-sales', async status => {
    await db.query('UPDATE orders SET status=? WHERE order_id=10', [status]);
    await expect(createAfterSales(7, 10, { type: 'refund', reason: '退款' })).rejects.toMatchObject({ statusCode: 400 });
    const [requests] = await db.query<RowDataPacket[]>('SELECT * FROM after_sales_requests');
    expect(requests).toHaveLength(0);
  });
  test('withdrawal races review with exactly one final state and matching audit', async () => {
    const request = await createAfterSales(7, 10, { type: 'return', reason: 'private reason' });
    const results = await Promise.allSettled([
      withdrawAfterSales(7, 10), reviewAfterSales(2, request.request_id, { status: 'approved', note: 'private review' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const final = await getAfterSales(7, 10);
    expect(['withdrawn', 'approved']).toContain(final?.status);
    expect(await audit()).toHaveLength(final?.status === 'approved' ? 1 : 0);
    await expect(createAfterSales(7, 10, { type: 'refund', reason: 'duplicate' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await order()).toMatchObject({ status: 1 });
    expect(await product()).toMatchObject({ stock: 5, sales_count: 1 });
  });
  test('different orders can create their first after-sales requests concurrently', async () => {
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status) VALUES (11,'order11',8,10,1)");
    let arrivals = 0;
    let release!: () => void;
    let timer!: ReturnType<typeof setTimeout>;
    const barrier = new Promise<void>((resolve, reject) => {
      release = resolve;
      timer = setTimeout(() => reject(new Error('Concurrent test barrier timed out')), 2000);
    });
    (getPool as jest.Mock).mockReturnValue({ getConnection: async () => {
      const connection = await db.getConnection();
      return {
        beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(),
        rollback: () => connection.rollback(), release: () => connection.release(),
        execute: async (sql: string, values: any[]) => {
          const result = await connection.execute(sql, values);
          if (sql.startsWith('SELECT * FROM after_sales_requests')) {
            if (++arrivals === 2) release();
            if (arrivals <= 2) await barrier;
          }
          return result;
        },
      };
    } });
    const results = await Promise.allSettled([
      createAfterSales(7, 10, { type: 'refund', reason: 'one' }),
      createAfterSales(8, 11, { type: 'return', reason: 'two' }),
    ]).finally(() => clearTimeout(timer));
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect((await db.query<RowDataPacket[]>('SELECT order_id FROM after_sales_requests ORDER BY order_id'))[0]).toEqual([{ order_id: 10 }, { order_id: 11 }]);
  });

  test('two conflicting reviews have one winner, one audit, no refund or stock mutation', async () => {
    const request = await createAfterSales(7, 10, { type: 'refund', reason: 'PRIVATE-REASON' });
    const reviews = await Promise.allSettled([
      reviewAfterSales(2, request.request_id, { status: 'approved', note: 'PRIVATE-APPROVE' }),
      reviewAfterSales(2, request.request_id, { status: 'rejected', note: 'PRIVATE-REJECT' }),
    ]);
    expect(reviews.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await audit()).toHaveLength(1);
    expect(JSON.stringify(await audit())).not.toContain('PRIVATE');
    expect(await order()).toMatchObject({ status: 1, total_amount: '10.00' });
    expect(await product()).toMatchObject({ stock: 5, sales_count: 1 });
    const [requests] = await db.query<RowDataPacket[]>('SELECT reviewed_at,reviewed_by FROM after_sales_requests');
    expect(requests[0].reviewed_at).toBeInstanceOf(Date);
    expect(requests[0].reviewed_by).toBe(2);
  });
  test('invalid audit actor rolls back approval state in actual transaction', async () => {
    const request = await createAfterSales(7, 10, { type: 'refund', reason: '退款' });
    await expect(reviewAfterSales(999, request.request_id, { status: 'approved', note: '错误操作员' })).rejects.toThrow();
    expect(await getAfterSales(7, 10)).toMatchObject({ status: 'requested', review_note: null, reviewed_at: null });
    expect(await audit()).toHaveLength(0);
  });
  test('parallel shipments save only winning tracking number and cannot be overwritten', async () => {
    const attempts = await Promise.allSettled(['SF001', 'SF002'].map(tracking_number => transitionOrder(10, OrderStatus.SHIPPED, { shipment: { shipping_company: '顺丰', tracking_number } })));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const shipped = await OrderModel.findById(10);
    expect(shipped).toMatchObject({ status: 2, shipping_company: '顺丰' });
    expect(['SF001', 'SF002']).toContain(shipped?.tracking_number);
    expect(shipped?.shipped_at).toBeInstanceOf(Date);
    await expect(transitionOrder(10, OrderStatus.SHIPPED, { shipment: { shipping_company: 'Other', tracking_number: 'OVERWRITE' } })).rejects.toThrow('订单状态');
    expect((await order()).tracking_number).toBe(shipped?.tracking_number);
    expect(await product()).toMatchObject({ stock: 5, sales_count: 1 });
  });
  test('admin list applies stable bounded pagination and payment mode without unnecessary user data', async () => {
    await createAfterSales(7, 10, { type: 'return', reason: '测试' });
    const list = await listAfterSales({ page: '1', limit: '1', status: 'requested' });
    expect(list.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(list.requests[0]).toMatchObject({ order_no: 'order10', payment_method: 'demo' });
    expect(list.requests[0]).not.toHaveProperty('email');
    expect((await listAfterSales({ page: '2', limit: '1' })).requests).toHaveLength(0);
  });
});
