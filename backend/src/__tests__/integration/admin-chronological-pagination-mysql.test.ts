import fs from 'node:fs';
import path from 'node:path';
import mysql, { Pool } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { getAdminProducts } from '../../controllers/admin-product.controller';
import { getAdminOrders } from '../../controllers/admin-order.controller';
import { getAdminUsers, getAdminUserDetail, getUserOrders } from '../../controllers/admin-user.controller';
import { getAdminLogs } from '../../controllers/admin-log.controller';
import { getRecentOrders } from '../../controllers/admin-dashboard.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));

// Only use an explicitly opted-in test server, with an isolated database of our own.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('admin chronological lists with tied timestamps', () => {
  const database = `admin_chronological_pagination_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 3,
  };
  const timestamp = '2026-10-01 12:00:00';
  const descendingIds = Array.from({ length: 50 }, (_, index) => 50 - index);
  let server: Pool, db: Pool, created = false;

  async function createTables(file: string, names: string[]) {
    const source = fs.readFileSync(path.join(__dirname, '../../database', file), 'utf8');
    const found = new Set<string>();
    for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (names.includes(match[2])) {
        await db.query(match[1]);
        found.add(match[2]);
      }
    }
    expect([...found].sort()).toEqual([...names].sort());
  }

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    await createTables('migrate.ts', ['users', 'categories', 'products', 'orders', 'order_items', 'shipping_addresses']);
    await createTables('admin-migrate.ts', ['roles', 'admins', 'admin_logs']);
    await db.query("INSERT INTO categories(category_id,name) VALUES(1,'Fixture category'),(2,'Excluded category')");
    await db.query("INSERT INTO admins(admin_id,username,password_hash,real_name) VALUES(1,'fixture','test','Fixture admin'),(2,'excluded','test','Excluded admin')");
    for (let id = 1; id <= 50; id++) {
      await db.query('INSERT INTO users(user_id,username,email,password_hash,status,created_at) VALUES(?,?,?,\'test\',1,?)',
        [id, `Fixture user ${id}`, `fixture-${id}@example.test`, timestamp]);
      await db.query('INSERT INTO products(product_id,title,category_id,price,stock,status,created_at) VALUES(?,?,1,10,5,1,?)',
        [id, `Fixture product ${id}`, timestamp]);
      await db.query('INSERT INTO orders(order_id,order_no,user_id,total_amount,status,created_at) VALUES(?,?,1,10,1,?)',
        [id, `FIXTURE-${id}`, timestamp]);
      await db.query('INSERT INTO admin_logs(log_id,admin_id,action,description,created_at) VALUES(?,1,\'FIXTURE\',\'Fixture log\',?)',
        [id, timestamp]);
      await db.query('INSERT INTO shipping_addresses(address_id,user_id,receiver_name,phone,is_default,created_at) VALUES(?,1,\'Fixture receiver\',\'123456789\',?,?)',
        [id, id === 1 ? 1 : 0, timestamp]);
    }
    // Matching timestamps must not weaken the existing filters or total counts.
    await db.query('INSERT INTO users(user_id,username,email,password_hash,status,created_at) VALUES(51,\'Excluded\',\'excluded@example.test\',\'test\',0,?)', [timestamp]);
    await db.query('INSERT INTO products(product_id,title,category_id,price,status,created_at) VALUES(51,\'Excluded\',2,10,-1,?)', [timestamp]);
    await db.query('INSERT INTO orders(order_id,order_no,user_id,total_amount,status,created_at) VALUES(51,\'EXCLUDED\',2,10,4,?)', [timestamp]);
    await db.query('INSERT INTO admin_logs(log_id,admin_id,action,created_at) VALUES(51,2,\'EXCLUDED\',?)', [timestamp]);
    await db.query('INSERT INTO shipping_addresses(address_id,user_id,receiver_name,phone,is_default,created_at) VALUES(51,2,\'Excluded\',\'123456789\',1,?)', [timestamp]);
    await db.query(`INSERT INTO order_items(order_id,product_id,product_name,price,quantity) VALUES
      (1,1,'Multiple products A',10,2),(1,2,'Multiple products B',10,3),
      (2,1,'One product, many units',10,7),
      (3,1,'Same product, first line',10,1),(3,1,'Same product, second line',10,4),
      (51,1,'Other account',10,9)`);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (created) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  type Controller = (req: any, res: any) => Promise<any>;
  async function invoke(controller: Controller, query: Record<string, string>, params: Record<string, string> = {}) {
    const res = {
      body: undefined as any,
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.body = body; return this; },
    };
    await controller({ query, params }, res);
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  const pagedLists: [string, Controller, string, string, Record<string, string>, Record<string, string>][] = [
    ['products', getAdminProducts, 'products', 'product_id', { keyword: 'Fixture', categoryId: '1', status: '1' }, {}],
    ['orders', getAdminOrders, 'orders', 'order_id', { orderNo: 'FIXTURE-', userId: '1', status: '1', startDate: '2026-10-01', endDate: '2026-10-01' }, {}],
    ['users', getAdminUsers, 'users', 'user_id', { keyword: 'Fixture', status: '1' }, {}],
    ['logs', getAdminLogs, 'logs', 'log_id', { action: 'FIXTURE', adminId: '1', startDate: '2026-10-01', endDate: '2026-10-01' }, {}],
    ['user orders', getUserOrders, 'orders', 'order_id', {}, { userId: '1' }],
  ];

  test.each(pagedLists)('%s returns every same-second row exactly once over three 20-row pages', async (_name, controller, field, idField, filters, params) => {
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const body = await invoke(controller, { ...filters, page: String(page), limit: '20' }, params);
      expect(body.pagination).toEqual({ page, limit: 20, total: 50, totalPages: 3 });
      expect(body[field]).toHaveLength(page === 3 ? 10 : 20);
      ids.push(...body[field].map((row: any) => Number(row[idField])));
    }
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort((a, b) => a - b)).toEqual([...descendingIds].reverse());
    expect(ids).toEqual(descendingIds);
  });

  test('dashboard recent orders consistently selects the highest IDs within a same-second limit', async () => {
    const expected = [51, ...descendingIds].slice(0, 20);
    for (let attempt = 0; attempt < 2; attempt++) {
      const orders = await invoke(getRecentOrders, { limit: '20' });
      expect(orders.map((row: any) => Number(row.order_id))).toEqual(expected);
      expect(orders[1]).toMatchObject({ order_no: 'FIXTURE-50', user_id: 1, username: 'Fixture user 1', status: 1 });
    }
  });

  test.each([
    ['order management', getAdminOrders, { userId: '1' }, {}],
    ['user order details', getUserOrders, {}, { userId: '1' }],
  ] as [string, Controller, Record<string, string>, Record<string, string>][])(
    '%s counts purchased units, including repeated product lines and historical empty orders',
    async (_name, controller, filters, params) => {
      const body = await invoke(controller, { ...filters, limit: '100' }, params);
      const counts = new Map<number, unknown>(body.orders.map((order: any) => [Number(order.order_id), order.item_count]));
      expect(counts.get(1)).toBe(5);
      expect(counts.get(2)).toBe(7);
      expect(counts.get(3)).toBe(5);
      expect(counts.get(4)).toBe(0);
      expect(counts.size).toBe(50);
      expect(counts.has(51)).toBe(false);
      expect(body.pagination.total).toBe(50);
    },
  );

  test('user detail orders use the same tie order and addresses retain default-first priority', async () => {
    const body = await invoke(getAdminUserDetail, {}, { userId: '1' });
    expect(body.recent_orders.map((row: any) => Number(row.order_id))).toEqual(descendingIds.slice(0, 10));
    expect(body.addresses.map((row: any) => Number(row.address_id))).toEqual([1, ...descendingIds.filter(id => id !== 1)]);
    expect(body.addresses[0]).toMatchObject({ is_default: 1, receiver_name: 'Fixture receiver' });
  });

  test('chronology still outranks IDs when creation times differ', async () => {
    try {
      await db.query("UPDATE products SET created_at = '2026-10-02 12:00:00' WHERE product_id = 1");
      await db.query("UPDATE products SET created_at = '2026-09-30 12:00:00' WHERE product_id = 50");
      const ids: number[] = [];
      for (let page = 1; page <= 3; page++) {
        const body = await invoke(getAdminProducts, { page: String(page), limit: '20' });
        ids.push(...body.products.map((row: any) => Number(row.product_id)));
      }
      expect(ids).toEqual([1, ...descendingIds.filter(id => id !== 1 && id !== 50), 50]);
    } finally {
      await db.query('UPDATE products SET created_at = ? WHERE product_id IN (1,50)', [timestamp]);
    }
  });
});
