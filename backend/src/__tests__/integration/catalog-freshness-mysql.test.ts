import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { ProductController } from '../../controllers/product.controller';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
const mockCache = new Map<string, string>();
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({
  get: async (key: string) => mockCache.get(key),
  setex: async (key: string, _ttl: number, value: string) => { mockCache.set(key, value); },
}) }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('current catalog data with stale ranking and detail caches', () => {
  const database = `catalog_freshness_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00' };
  let server: Pool, db: Pool, created = false;
  const response = () => ({ body: undefined as any, statusCode: 200,
    status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } });
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'product_skus', 'reviews'].includes(match[2])) await db.query(match[1]);
    }
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    mockCache.clear();
    for (const table of ['reviews', 'product_skus', 'products']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO products(product_id,title,title_en,price,stock,status,sales_count) VALUES(1,'一','One',10,5,1,30),(2,'二','Two',20,5,1,20),(3,'三','Three',30,5,1,10)");
  });
  test('cached ranking removes delisted products, fills the requested limit and refreshes SKU promotion pairs', async () => {
    const first = response(); await ProductController.getHotProducts({ query: { limit: '2' } } as any, first as any);
    expect(first.body.products.map((product: any) => product.product_id)).toEqual([1, 2]);
    await db.query('UPDATE products SET status=0 WHERE product_id=2');
    await db.query("UPDATE products SET title_en='Updated One',stock=0 WHERE product_id=1");
    await db.query("INSERT INTO product_skus(product_id,sku_code,specs,price,original_price,stock,status) VALUES(1,'A','{}',9,15,2,1),(1,'B','{}',9,12,3,1)");
    const next = response(); await ProductController.getHotProducts({ query: { limit: '2' } } as any, next as any);
    expect(next.body.products.map((product: any) => product.product_id)).toEqual([1, 3]);
    expect(next.body.products[0]).toMatchObject({ title_en: 'Updated One', has_sku: 1, stock: '5', price: '9.00', original_price: '15.00' });
  });
  test('detail refreshes SKU disabling and stock even when an old valid detail cache is restored', async () => {
    await db.query("INSERT INTO product_skus(sku_id,product_id,sku_code,specs,price,stock,status) VALUES(11,1,'A','{}',9,5,1),(12,1,'B','{}',12,2,1)");
    const first = response(); await ProductController.getDetail({ params: { id: '1' } } as any, first as any);
    mockCache.set('product:v3:1', JSON.stringify(first.body.product));
    await db.query('UPDATE product_skus SET status=0 WHERE sku_id=11');
    await db.query('UPDATE product_skus SET price=15,stock=0 WHERE sku_id=12');
    const next = response(); await ProductController.getDetail({ params: { id: '1' } } as any, next as any);
    expect(next.body.product).toMatchObject({ price: 15, stock: 0, skus: [{ sku_id: 12, price: '15.00', stock: 0, status: 1 }] });
  });
});
