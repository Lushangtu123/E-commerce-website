import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mysql, { Pool, ResultSetHeader } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { getAdminProducts } from '../../controllers/admin-product.controller';
import { getAdminUsers } from '../../controllers/admin-user.controller';
import { getAdminOrders } from '../../controllers/admin-order.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));

// The suite owns only this random database on an explicitly supplied test server.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('admin literal searches against MySQL', () => {
  const database = `admin_search_literal_test_${randomUUID().replace(/-/g, '')}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 3,
  };
  const timestamp = '2026-10-01 12:00:00';
  const terms = [
    ['n0-40%', 'n0-400'], ['n1-u_1', 'n1-ua1'], ['n2-sale!tag', 'n2-saletag'],
    ['n3-a\\b', 'n3-ab'], ['n4-!_%\\tag', 'n4-xxtag'], ['n5-red blue', 'n5-red---blue'],
  ];
  type Controller = (req: any, res: any) => Promise<any>;
  type Search = { name: string; handler: Controller; field: string; id: string; columns: string[]; filters: Record<string, string> };
  const searches: Search[] = [
    { name: 'products', handler: getAdminProducts, field: 'keyword', id: 'product_id', columns: ['title', 'description', 'title_en', 'description_en'], filters: { status: '1', categoryId: '1' } },
    { name: 'users', handler: getAdminUsers, field: 'keyword', id: 'user_id', columns: ['username', 'email', 'phone'], filters: { status: '1' } },
    { name: 'orders', handler: getAdminOrders, field: 'orderNo', id: 'order_id', columns: ['order_no'], filters: { status: '1', userId: '1', startDate: '2026-10-01', endDate: '2026-10-01' } },
  ];
  const expectedIds = new Map<string, number[]>();
  let server: Pool, db: Pool, created = false, fixture = 0;

  async function insert(search: Search, column: string, value: string, included = true): Promise<number> {
    fixture++;
    const values: Record<string, string | number> = search.name === 'products'
      ? { title: `Other product ${fixture}`, category_id: 1, price: 10, stock: 5, status: included ? 1 : 0, created_at: timestamp }
      : search.name === 'users'
        ? { username: `other-user-${fixture}`, email: `other-${fixture}@example.test`, password_hash: 'synthetic-test', status: included ? 1 : 0, created_at: timestamp }
        : { order_no: `OTHER-${fixture}`, user_id: 1, total_amount: 10, status: included ? 1 : 4, created_at: timestamp };
    values[column] = value;
    const keys = Object.keys(values);
    const [result] = await db.query<ResultSetHeader>(`INSERT INTO ${search.name} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(values));
    return result.insertId;
  }

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    const names = ['users', 'categories', 'products', 'product_skus', 'orders', 'order_items'];
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const found = new Set<string>();
    for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (names.includes(match[2])) { await db.query(match[1]); found.add(match[2]); }
    }
    expect([...found].sort()).toEqual([...names].sort());
    await db.query("INSERT INTO categories(category_id,name) VALUES(1,'Synthetic category')");
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'fixture-owner','owner@example.test','synthetic-test')");
    for (const search of searches) {
      for (const [term, decoy] of terms) {
        const ids: number[] = [];
        for (const column of search.columns) {
          ids.push(await insert(search, column, `A-${term}-A`), await insert(search, column, `B-${term}-B`));
          await insert(search, column, `X-${decoy}-X`);
          await insert(search, column, `Z-${term}-Z`, false);
        }
        expectedIds.set(`${search.name}:${term}`, ids.sort((left, right) => right - left));
      }
    }
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (created) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  describe.each(searches)('$name', search => {
    test.each(terms)('finds only literal %j across searchable fields and page counts', async term => {
      const expected = expectedIds.get(`${search.name}:${term}`)!;
      const ids: number[] = [], limit = 3, pages = Math.ceil(expected.length / limit);
      for (let page = 1; page <= pages + 1; page++) {
        const res = { body: undefined as any, statusCode: 200,
          status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
        await search.handler({ query: { ...search.filters, [search.field]: `  ${term}  `, page: String(page), limit: String(limit) } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.pagination).toEqual({ page, limit, total: expected.length, totalPages: pages });
        const actual = res.body[search.name].map((row: any) => Number(row[search.id]));
        expect(actual).toEqual(expected.slice((page - 1) * limit, page * limit));
        ids.push(...actual);
      }
      expect(ids).toEqual(expected);
    });
  });
});
