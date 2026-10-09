import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { getAdminProducts, updateProductStatus, batchUpdateProductStatus, updateProduct, deleteProduct } from '../../controllers/admin-product.controller';
import { ProductController } from '../../controllers/product.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../controllers/admin-product-write', () => ({ afterProductWrite: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('deleted product publication boundaries', () => {
  const database = `product_lifecycle_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 6 };
  let server: Pool, db: Pool, created = false;
  const response = () => ({ body: undefined as any, statusCode: 200,
    status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } });
  async function call(handler: any, body = {}, input = {}) {
    const res = response(); await handler({ params: { productId: '1', id: '1' }, body, query: input,
      admin: { adminId: 1 }, get: () => 'fixture', ip: '127.0.0.1' } as any, res as any); return res;
  }
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'categories', 'orders', 'order_items', 'product_skus'].includes(match[2])) await db.query(match[1]);
    }
    const adminSource = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    for (const match of adminSource.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['roles', 'admins', 'admin_logs'].includes(match[2])) await db.query(match[1]);
    }
    await db.query("INSERT INTO admins(admin_id,username,password_hash) VALUES(1,'fixture','fixture')");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM admin_logs');
    await db.query('DELETE FROM products');
    await db.query("INSERT INTO products(product_id,title,price,stock,status) VALUES(1,'Deleted',10,5,-1),(2,'Active',20,6,1),(3,'Disabled',30,7,0)");
  });
  async function rows() { return (await db.query<RowDataPacket[]>('SELECT product_id,title,status FROM products ORDER BY product_id'))[0]; }
  test('default admin list excludes deleted products while explicit deleted filter retains history', async () => {
    const normal = await call(getAdminProducts);
    expect(normal.body.products.map((row: any) => row.product_id).sort()).toEqual([2, 3]);
    expect(normal.body.pagination.total).toBe(2);
    const deleted = await call(getAdminProducts, {}, { status: '-1' });
    expect(deleted.body.products.map((row: any) => row.product_id)).toEqual([1]);
  });
  test('single publication and both product update routes cannot revive deleted products', async () => {
    for (const handler of [updateProductStatus, updateProduct, ProductController.update]) {
      const res = await call(handler, { status: 1 });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect((await rows())[0]).toMatchObject({ status: -1, title: 'Deleted' });
    }
  });
  test('mixed batch is rejected atomically and reports no successful publication', async () => {
    const res = await call(batchUpdateProductStatus, { productIds: [1, 2, 3], status: 1 });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((await rows()).map(row => row.status)).toEqual([-1, 1, 0]);
  });
  test('valid deduplicated batch still publishes active and disabled products', async () => {
    const res = await call(batchUpdateProductStatus, { productIds: [2, 3, 3], status: 1 });
    expect(res.statusCode).toBe(200); expect(res.body.count).toBe(2);
    expect((await rows()).map(row => row.status)).toEqual([-1, 1, 1]);
  });
  test('soft delete remains idempotent and preserves the product row', async () => {
    expect((await call(deleteProduct)).statusCode).toBe(200);
    expect((await call(deleteProduct)).statusCode).toBe(200);
    expect(await rows()).toHaveLength(3);
  });
});
