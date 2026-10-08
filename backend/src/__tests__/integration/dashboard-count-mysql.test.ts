import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { getDashboardStats, getSalesTrend, getTopProducts } from '../../controllers/admin-dashboard.controller';
import { getOrderStatistics } from '../../controllers/admin-order.controller';
jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
jest.mock('../../services/order.service', () => ({}));
jest.mock('../../controllers/admin-log.controller', () => ({}));
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
      if (['users', 'products', 'orders', 'order_items'].includes(match[2])) await db.query(match[1]);
    }
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  afterEach(async () => {
    for (const table of ['order_items', 'orders', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
  });
  const response = () => ({ body: undefined as any, status(code: number) { throw new Error(`Unexpected HTTP ${code}`); }, json(body: any) { this.body = body; } });
  test.each([1, 2, 3])('revenue and sales rankings exclude demo orders at status %i, retaining historical NULL payments', async status => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Paid product',10),(2,'Demo product',100)");
    await db.query(`INSERT INTO orders(order_id,order_no,user_id,total_amount,status,payment_method) VALUES
      (1,'LEGACY',1,10,?,NULL),(2,'NONDEMO',1,20,?,'manual'),(3,'DEMO',1,100,?,'demo'),(4,'CANCELLED',1,900,4,'manual')`, [status, status, status]);
    await db.query('INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(1,1,1,10),(2,1,2,10),(3,2,1,100),(4,1,90,10)');
    const stats = response(); await getDashboardStats({ query: {} } as any, stats as any);
    expect(stats.body.today_orders).toBe(4); // Operational counts still include every order.
    expect(stats.body.today_revenue).toBe(30);
    const trend = response(); await getSalesTrend({ query: { days: '7' } } as any, trend as any);
    expect(Number(trend.body[0].revenue)).toBe(30); expect(Number(trend.body[0].order_count)).toBe(4);
    const top = response(); await getTopProducts({ query: { days: '7' } } as any, top as any);
    expect(top.body).toHaveLength(1); expect(Number(top.body[0].product_id)).toBe(1);
    expect(Number(top.body[0].total_sales)).toBe(3); expect(Number(top.body[0].order_count)).toBe(2);
    expect(Number(top.body[0].total_revenue)).toBe(30);
    const aggregate = response(); await getOrderStatistics({ query: {} } as any, aggregate as any);
    expect(Number(aggregate.body.total_revenue)).toBe(30); expect(Number(aggregate.body.avg_order_value)).toBe(15);
    expect(Number(aggregate.body.total_orders)).toBe(4);
    // The excluded record remains available for fulfilment and after-sales.
    const [stored] = await db.query<any[]>('SELECT status,total_amount,payment_method FROM orders WHERE order_id=3');
    expect(stored[0]).toEqual(expect.objectContaining({ status, total_amount: '100.00', payment_method: 'demo' }));
  });
  test('demo-only revenue and average are zero and yesterday growth excludes demo amounts', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Demo',10)");
    await db.query(`INSERT INTO orders(order_id,order_no,user_id,total_amount,status,payment_method,created_at) VALUES
      (1,'DEMO-TODAY',1,10,1,'demo',UTC_TIMESTAMP()),(2,'DEMO-YESTERDAY',1,100,3,'demo',UTC_DATE()-INTERVAL 1 DAY)`);
    await db.query('INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(1,1,1,10),(2,1,10,10)');
    const stats = response(); await getDashboardStats({ query: {} } as any, stats as any);
    expect(stats.body.today_revenue).toBe(0); expect(stats.body.revenue_growth).toBe(0);
    const aggregate = response(); await getOrderStatistics({ query: {} } as any, aggregate as any);
    expect(Number(aggregate.body.total_revenue)).toBe(0); expect(Number(aggregate.body.avg_order_value)).toBe(0);
    const trend = response(); await getSalesTrend({ query: { days: '7' } } as any, trend as any);
    expect(trend.body.every((point: any) => Number(point.revenue) === 0)).toBe(true);
    const top = response(); await getTopProducts({ query: { days: '7' } } as any, top as any); expect(top.body).toEqual([]);
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
