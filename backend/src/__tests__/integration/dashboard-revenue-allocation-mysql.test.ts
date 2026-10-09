import fs from 'node:fs';
import path from 'node:path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { getDashboardStats, getTopProducts } from '../../controllers/admin-dashboard.controller';
import { couponMoneyToCents } from '../../utils/coupon-discount';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;

integration('dashboard allocates actual paid revenue across order lines', () => {
  const database = `dashboard_allocation_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00',
  };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
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
    for (const table of ['order_items', 'orders', 'products']) await db.query(`DELETE FROM ${table}`);
  });

  const response = () => ({
    body: undefined as any,
    status(code: number) { throw new Error(`Unexpected HTTP ${code}`); },
    json(body: any) { this.body = body; },
  });
  const top = async (query: Record<string, string> = {}) => {
    const res = response(); await getTopProducts({ query } as any, res as any); return res.body as any[];
  };
  const revenues = (products: any[]): Record<string, number> => Object.fromEntries(products.map(product => [product.product_id, couponMoneyToCents(product.total_revenue)]));

  test('a 100.00 order with a 20.00 discount reports the 80.00 paid amount', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Discounted',100)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,original_amount,discount_amount,total_amount,status,payment_method) VALUES(1,'DISCOUNTED',1,100,20,80,1,'manual')");
    await db.query('INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(1,1,1,100)');
    const products = await top();
    expect(revenues(products)).toEqual({ 1: 8000 });
    expect(Number(products[0].total_sales)).toBe(1); expect(Number(products[0].order_count)).toBe(1);
    const stats = response(); await getDashboardStats({ query: {} } as any, stats as any);
    expect(couponMoneyToCents(stats.body.today_revenue)).toBe(8000);
  });

  test.each([1, 2, 3])('paid status %i splits a discounted order by historical price times quantity, excluding ineligible orders', async status => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Changed price',1000),(2,'Also changed',2000)");
    await db.query(`INSERT INTO orders(order_id,order_no,user_id,original_amount,discount_amount,total_amount,status,payment_method) VALUES
      (1,'DISCOUNTED-MULTI',1,100,20,80,?,'manual'),(2,'UNPAID',1,100,0,100,0,'manual'),
      (3,'CANCELLED',1,100,0,100,4,'manual'),(4,'DEMO',1,100,0,100,?,'demo')`, [status, status]);
    await db.query(`INSERT INTO order_items(order_id,product_id,quantity,price) VALUES
      (1,1,3,20),(1,2,2,20),(2,1,10,10),(3,1,10,10),(4,1,10,10)`);
    const products = await top(), amounts = revenues(products);
    expect(amounts).toEqual({ 1: 4800, 2: 3200 });
    expect(products.map(product => [Number(product.total_sales), Number(product.order_count)])).toEqual([[3, 1], [2, 1]]);
    const stats = response(); await getDashboardStats({ query: {} } as any, stats as any);
    expect(Object.values(amounts).reduce((sum, cents) => sum + cents, 0)).toBe(couponMoneyToCents(stats.body.today_revenue));
  });

  test('remaining cents go to the largest fractional shares, with item_id breaking ties', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'First',9),(2,'Second',9),(3,'Third',9)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'UNEQUAL',1,0.02,2),(2,'TIED',1,0.02,3)");
    // UNEQUAL shares are .4, .6, 1 cent: the second line must win the remaining cent.
    await db.query(`INSERT INTO order_items(item_id,order_id,product_id,quantity,price) VALUES
      (10,1,1,1,0.02),(11,1,2,1,0.03),(12,1,3,1,0.05),
      (22,2,1,1,0.01),(21,2,2,1,0.01),(20,2,3,1,0.01)`);
    const products = await top();
    expect(revenues(products)).toEqual({ 1: 0, 2: 2, 3: 2 });
    expect(Object.values(revenues(products)).reduce((sum, cents) => sum + cents, 0)).toBe(4);
    expect(products.every(product => Number(product.order_count) === 2 && Number(product.total_sales) === 2)).toBe(true);
  });

  test('top limit and date window cannot redistribute other products shares', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'High volume',100),(2,'Low volume',100),(3,'Other day',100)");
    await db.query(`INSERT INTO orders(order_id,order_no,user_id,total_amount,status,created_at) VALUES
      (1,'TODAY',1,0.01,1,UTC_TIMESTAMP()),(2,'OLDER',1,20,1,UTC_TIMESTAMP()-INTERVAL 10 DAY)`);
    await db.query(`INSERT INTO order_items(item_id,order_id,product_id,quantity,price) VALUES
      (2,1,1,2,0.01),(1,1,2,1,0.02),(3,2,1,1,10),(4,2,3,1,10)`);
    expect(revenues(await top({ days: '7', limit: '1' }))).toEqual({ 1: 0 });
    expect(revenues(await top({ days: '7', limit: '3' }))).toEqual({ 1: 0, 2: 1 });
    expect(revenues(await top({ days: '30', limit: '3' }))).toEqual({ 1: 1000, 2: 1, 3: 1000 });
  });

  test('variant lines and deleted or NULL product references participate before grouping live products', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Variants',100),(2,'Deleted',100)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'VARIANTS',1,30,1)");
    // Some historical schemas retain a NULL reference after deleting a product.
    await db.query('ALTER TABLE order_items MODIFY product_id BIGINT NULL');
    await db.query(`INSERT INTO order_items(item_id,order_id,product_id,sku_id,quantity,price) VALUES
      (1,1,1,11,1,10),(2,1,1,12,2,10),(3,1,2,NULL,1,20),(4,1,NULL,NULL,1,10)`);
    await db.query('DELETE FROM products WHERE product_id=2');
    const products = await top();
    expect(revenues(products)).toEqual({ 1: 1500 });
    expect(Number(products[0].order_count)).toBe(1); expect(Number(products[0].total_sales)).toBe(3);
  });

  test('fully discounted and zero value orders report zero without division warnings', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Free',10),(2,'Zero',0)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'FULL-DISCOUNT',1,0,1),(2,'ZERO',1,0,1)");
    await db.query('INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(1,1,2,10),(2,1,1,0),(2,2,1,0)');
    expect(revenues(await top())).toEqual({ 1: 0, 2: 0 });
    const [warnings] = await db.query('SHOW WARNINGS'); expect(warnings).toEqual([]);
  });

  test('legacy zero value lines split a positive paid amount equally and conserve the last cent', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'First zero',0),(2,'Second zero',0)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'ZERO-LINES-PAID',1,0.03,1)");
    await db.query('INSERT INTO order_items(item_id,order_id,product_id,quantity,price) VALUES(2,1,1,5,0),(1,1,2,1,0)');
    const amounts = revenues(await top());
    expect(amounts).toEqual({ 1: 1, 2: 2 });
    expect(Object.values(amounts).reduce((sum, cents) => sum + cents, 0)).toBe(3);
  });

  test('exact cents survive DECIMAL maximum amounts and multiplication beyond safe integers', async () => {
    await db.query("INSERT INTO products(product_id,title,price) VALUES(1,'Large',99999999.99),(2,'Other',99999999.99)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'MAXIMUM',1,99999999.99,1)");
    await db.query(`INSERT INTO order_items(item_id,order_id,product_id,quantity,price) VALUES
      (1,1,1,2147483647,99999999.99),(2,1,2,2147483647,99999999.99)`);
    expect(revenues(await top())).toEqual({ 1: 5000000000, 2: 4999999999 });
  });

  test('a historical order without line items has no product attribution', async () => {
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'MISSING-LINES',1,42,1)");
    expect(await top()).toEqual([]);
    const stats = response(); await getDashboardStats({ query: {} } as any, stats as any);
    expect(stats.body.today_revenue).toBe(42);
  });
});
