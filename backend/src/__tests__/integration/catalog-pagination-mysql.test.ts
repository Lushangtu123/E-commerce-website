import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import { query } from '../../database/mysql';
import { ProductModel } from '../../models/product.model';
import { searchProducts } from '../../services/product-search.service';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/elasticsearch', () => ({ getESClient: () => null }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
const sorts = ['created_at DESC', 'created_at ASC', 'price ASC', 'price DESC', 'sales_count DESC', 'sales_count ASC', 'rating DESC', 'price', 'sales'];

integration('customer catalog pagination with tied sort values', () => {
  const database = `catalog_pagination_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00',
  };
  let server: Pool, db: Pool, created = false;
  const tiedIds = Array.from({ length: 50 }, (_, index) => 50 - index);

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'product_skus', 'reviews'].includes(match[2])) await db.query(match[1]);
    }
    for (let id = 1; id <= 50; id++) {
      await db.query("INSERT INTO products(product_id,title,brand,price,stock,sales_count,status,created_at) VALUES(?,?,'tied',10,5,0,1,'2026-10-01 00:00:00')", [id, `Product ${id}`]);
    }
    await db.query(`INSERT INTO products(product_id,title,brand,price,stock,sales_count,status,created_at) VALUES
      (101,'Low','different',5,5,1,1,'2026-09-01 00:00:00'),
      (102,'High','different',20,5,4,1,'2026-09-04 00:00:00'),
      (103,'Middle low','different',10,5,2,1,'2026-09-02 00:00:00'),
      (104,'Middle high','different',15,5,3,1,'2026-09-03 00:00:00')`);
    for (const [id, rating] of [[101, 1], [102, 4], [103, 2], [104, 3]]) {
      await db.query('INSERT INTO reviews(product_id,user_id,order_id,rating) VALUES(?,1,?,?)', [id, id, rating]);
    }
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });

  test.each(sorts)('%s returns every tied product once across three pages', async sort => {
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await ProductModel.list({ sort, brand: 'tied', page, limit: 20 });
      expect(result.total).toBe(50);
      ids.push(...result.products.map(product => product.product_id));
    }
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual(tiedIds);
  });

  test('default chronological pagination uses the same deterministic tie order', async () => {
    const first = await ProductModel.list({ brand: 'tied', page: 1, limit: 20 });
    const second = await ProductModel.list({ brand: 'tied', page: 2, limit: 20 });
    expect([...first.products, ...second.products].map(product => product.product_id)).toEqual(tiedIds.slice(0, 40));
  });

  test.each(sorts)('%s keeps the requested primary order when values differ', async sort => {
    const result = await ProductModel.list({ sort, brand: 'different' });
    const ascending = sort.endsWith('ASC') || sort === 'price';
    expect(result.products.map(product => product.product_id)).toEqual(ascending ? [101, 103, 104, 102] : [102, 104, 103, 101]);
  });

  test.each([
    ['price', 'asc'], ['price', 'desc'], ['sales', 'asc'], ['sales', 'desc'], ['created_at', 'asc'], ['created_at', 'desc'],
  ] as const)('MySQL search with %s %s shares stable catalog pagination', async (sort_by, sort_order) => {
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await searchProducts({ keyword: '', brand: 'tied', sort_by, sort_order, page, page_size: 20 });
      expect(result.engine).toBe('mysql');
      expect(result.total).toBe(50);
      ids.push(...result.products.map(product => product.product_id));
    }
    expect(ids).toEqual(tiedIds);
  });
});
