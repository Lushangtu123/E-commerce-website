import fs from 'fs';
import path from 'path';
import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { SKUModel } from '../../models/sku.model';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 首次创建 SKU 并发', () => {
  const database = `sku_creation_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 6,
  };
  let server: Pool, db: Pool, created = false;
  const sku = (productId: number, code: string) => ({ product_id: productId, sku_code: code, specs: { Size: 'M' }, price: 12.5, stock: 2 });

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'product_skus'].includes(match[2])) await db.query(match[1]);
    }
    await db.query("INSERT INTO products(product_id,title,price,stock) VALUES(1,'First',1,99),(2,'Second',1,99)");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue(db);
    // A new empty index avoids dependence on deleted-row purge timing.
    await db.query('TRUNCATE TABLE product_skus');
  });

  // Both real transactions finish their reads before either inserts. Statements
  // and their results are unchanged; this reliably exercises the shared empty gap.
  function overlapFirstInserts() {
    let arrivals = 0, timedOut = false;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const timer = setTimeout(() => { timedOut = true; release(); }, 3000);
    (getPool as jest.Mock).mockReturnValue({
      getConnection: async () => {
        const connection = await db.getConnection();
        let paused = false;
        return new Proxy(connection, {
          get(target, property) {
            if (property === 'execute') return async (sql: string, params?: Parameters<PoolConnection['execute']>[1]) => {
              if (!paused && /^\s*INSERT INTO product_skus\b/i.test(sql)) {
                paused = true;
                if (++arrivals === 2) { clearTimeout(timer); release(); }
                await ready;
              }
              return connection.execute(sql, params);
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as PoolConnection;
      },
    });
    return {
      assertBothArrived: () => { expect(timedOut).toBe(false); expect(arrivals).toBe(2); },
      restore: () => { clearTimeout(timer); release(); (getPool as jest.Mock).mockReturnValue(db); },
    };
  }

  test.each(['single', 'batch', 'mixed'])('不同商品同时首次创建均成功（%s）', async mode => {
    const barrier = overlapFirstInserts();
    try {
      const first = sku(1, 'FIRST-ONE'), second = sku(2, 'FIRST-TWO');
      const results = await Promise.allSettled([
        mode === 'batch' ? SKUModel.createBatch([first]) : SKUModel.create(first),
        mode === 'single' ? SKUModel.create(second) : SKUModel.createBatch([second]),
      ]);
      barrier.assertBothArrived();
      expect(results).toEqual([expect.objectContaining({ status: 'fulfilled' }), expect.objectContaining({ status: 'fulfilled' })]);
    } finally { barrier.restore(); }
    const [rows] = await db.query<RowDataPacket[]>('SELECT product_id,sku_code,stock,price FROM product_skus ORDER BY product_id');
    expect(rows).toEqual([
      expect.objectContaining({ product_id: 1, sku_code: 'FIRST-ONE', stock: 2, price: '12.50' }),
      expect.objectContaining({ product_id: 2, sku_code: 'FIRST-TWO', stock: 2, price: '12.50' }),
    ]);
    expect((await db.query<RowDataPacket[]>('SELECT stock FROM products ORDER BY product_id'))[0].map(row => row.stock)).toEqual([99, 99]);
  });

  test('相同商品的单个与批量创建仍串行提交并保留所有规格', async () => {
    await Promise.all([
      SKUModel.create(sku(1, 'SAME-ONE')),
      SKUModel.createBatch([sku(1, 'SAME-TWO'), sku(1, 'SAME-THREE')]),
    ]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT product_id,sku_code,stock FROM product_skus ORDER BY sku_code');
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.product_id === 1 && row.stock === 2)).toBe(true);
    expect(rows.map(row => row.sku_code)).toEqual(['SAME-ONE', 'SAME-THREE', 'SAME-TWO']);
  });

  test('批量创建锁定不存在的父商品时不插入任何规格', async () => {
    await expect(SKUModel.createBatch([sku(1, 'VALID'), sku(3, 'MISSING')])).rejects.toMatchObject({ statusCode: 404 });
    expect((await db.query<RowDataPacket[]>('SELECT * FROM product_skus'))[0]).toHaveLength(0);
  });
});
