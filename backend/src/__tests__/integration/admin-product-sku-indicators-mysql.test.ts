import fs from 'node:fs';
import path from 'node:path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { getAdminProducts } from '../../controllers/admin-product.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('administrator product variant inventory indicators in MySQL', () => {
  const database = `admin_sku_indicators_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 3 };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'categories', 'orders', 'product_skus', 'order_items'].includes(match[2])) await db.query(match[1]);
    }
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue(db);
    await db.query('DELETE FROM product_skus'); await db.query('DELETE FROM products');
    await db.query(`INSERT INTO products(product_id,title,price,stock,status) VALUES
      (1,'Simple',50,7,1),(2,'Variants',100,99,1),(3,'Inactive variants',80,88,0)`);
    await db.query(`INSERT INTO product_skus(sku_id,product_id,sku_code,price,stock,status) VALUES
      (21,2,'A',12.50,3,1),(22,2,'B',15,4,1),(23,2,'DISABLED',1,200,0),(31,3,'ONLY-DISABLED',2,300,0)`);
  });
  async function list(query: Record<string, string> = {}) {
    const res = { statusCode: 200, body: undefined as any,
      status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
    await getAdminProducts({ query } as any, res as any); expect(res.statusCode).toBe(200); return res.body;
  }
  test('simple products preserve their base price and stock with a numeric inventory indicator', async () => {
    const row = (await list()).products.find((p: any) => p.product_id === 1);
    expect(row).toMatchObject({ has_sku: 0, sellable_stock: 7, sku_min_price: null, price: '50.00', stock: 7 });
    expect(typeof row.sellable_stock).toBe('number');
  });
  test('enabled variants supply the inventory and minimum price without changing base fields', async () => {
    const row = (await list()).products.find((p: any) => p.product_id === 2);
    expect(row).toMatchObject({ has_sku: 1, sellable_stock: 7, sku_min_price: '12.50', price: '100.00', stock: 99 });
  });
  test('all disabled variants have zero usable inventory and no active price', async () => {
    const row = (await list()).products.find((p: any) => p.product_id === 3);
    expect(row).toMatchObject({ has_sku: 1, sellable_stock: 0, sku_min_price: null, price: '80.00', stock: 88 });
  });
  test('a fresh read reflects variant changes while retaining filters, pagination and distinct rows', async () => {
    await db.query('UPDATE product_skus SET price=11,stock=8 WHERE sku_id=21');
    const first = await list({ status: '1', limit: '1', page: '1' });
    const second = await list({ status: '1', limit: '1', page: '2' });
    expect(first.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect([first.products[0].product_id, second.products[0].product_id].sort()).toEqual([1, 2]);
    const row = [...first.products, ...second.products].find(p => p.product_id === 2);
    expect(row).toMatchObject({ sellable_stock: 12, sku_min_price: '11.00', price: '100.00', stock: 99 });
  });
});
