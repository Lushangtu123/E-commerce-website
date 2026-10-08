import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { getTopProducts } from '../../controllers/admin-dashboard.controller';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('dashboard counts orders independently of variant lines', () => {
  const database = `dashboard_count_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00' };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'orders', 'order_items'].includes(match[2])) await db.query(match[1]);
    }
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  test('two variants in one paid order count once, cancelled lines do not add revenue or volume', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Variants',10)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'PAID',1,50,1),(2,'CANCELLED',1,100,4)");
    await db.query('INSERT INTO order_items(order_id,product_id,sku_id,quantity,price) VALUES(1,1,11,1,10),(1,1,12,2,20),(2,1,11,10,10)');
    const res = { body: undefined as any, status(code: number) { throw new Error(`Unexpected HTTP ${code}`); }, json(body: any) { this.body = body; } };
    await getTopProducts({ query: { days: '7', limit: '5' } } as any, res as any);
    expect(res.body).toHaveLength(1);
    expect(Number(res.body[0].order_count)).toBe(1);
    expect(Number(res.body[0].total_sales)).toBe(3);
    expect(Number(res.body[0].total_revenue)).toBe(50);
  });
});
