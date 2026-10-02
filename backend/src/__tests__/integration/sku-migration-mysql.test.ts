import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { migrateSkuTables } from '../../database/migrate-sku';

const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;

integration('真实 MySQL SKU 旧库升级', () => {
  const database = `ecommerce_sku_migration_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET
      ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root',
    password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00',
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const schemas = new Map<string, string>();

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      schemas.set(match[2], match[1]);
    }
    await db.query(schemas.get('orders')!);
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status) VALUES (1,'LEGACY',1,85,0),(2,'VARIANT',1,24.50,0)");
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    for (const table of ['order_items', 'cart']) {
      await db.query(`DROP TABLE IF EXISTS ${table}`);
      // Recreate the previous release's schema without SKU columns or identity.
      const legacy = schemas.get(table)!
        .replace(/^\s*(sku_id|sku_key|sku_code|sku_specs)\b[^\n]*\n/gm, '')
        .replace(/UNIQUE KEY uk_user_product_sku\s*\([^)]*\)/, 'UNIQUE KEY uk_user_product (user_id, product_id)');
      await db.query(legacy);
    }
    await db.query(`INSERT INTO cart (cart_id,user_id,product_id,quantity,created_at,updated_at)
      VALUES (10,1,11,3,'2025-01-02 03:04:05','2025-02-03 04:05:06'),(11,2,11,5,'2025-03-04 05:06:07','2025-04-05 06:07:08')`);
    await db.query(`INSERT INTO order_items (item_id,order_id,product_id,product_name,product_image,quantity,price)
      VALUES (101,1,11,'历史商品名','/legacy-image.png',2,42.50)`);
  });

  async function cartIndexes() {
    const [indexes] = await db.query<RowDataPacket[]>(
      `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cart'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`
    );
    return indexes;
  }

  test('升级和重复执行保留旧购物车数量、商品快照及新规格快照', async () => {
    const [oldCart] = await db.query<RowDataPacket[]>('SELECT * FROM cart ORDER BY cart_id');
    const [oldItems] = await db.query<RowDataPacket[]>('SELECT * FROM order_items ORDER BY item_id');

    await migrateSkuTables(db);

    const [cart] = await db.query<RowDataPacket[]>('SELECT * FROM cart ORDER BY cart_id');
    const [items] = await db.query<RowDataPacket[]>('SELECT * FROM order_items ORDER BY item_id');
    expect(cart).toEqual(oldCart.map(row => ({ ...row, sku_id: null, sku_key: 0 })));
    expect(items).toEqual(oldItems.map(row => ({ ...row, sku_id: null, sku_code: null, sku_specs: null })));

    await db.query('INSERT INTO cart (cart_id,user_id,product_id,sku_id,quantity) VALUES (12,1,11,2147483650,2)');
    await db.query(`INSERT INTO order_items (item_id,order_id,product_id,product_name,product_image,sku_id,sku_code,sku_specs,quantity,price)
      VALUES (102,2,11,'下单时商品名','/snapshot-image.png',2147483650,'RED-M',?,1,24.50)`,
      [JSON.stringify({ 颜色: '红色', 尺寸: 'M' })]);
    const [beforeCart] = await db.query<RowDataPacket[]>('SELECT * FROM cart ORDER BY cart_id');
    const [beforeItems] = await db.query<RowDataPacket[]>('SELECT * FROM order_items ORDER BY item_id');

    await migrateSkuTables(db);

    const [afterCart] = await db.query<RowDataPacket[]>('SELECT * FROM cart ORDER BY cart_id');
    const [afterItems] = await db.query<RowDataPacket[]>('SELECT * FROM order_items ORDER BY item_id');
    expect(afterCart).toEqual(beforeCart);
    expect(afterItems).toEqual(beforeItems);
    expect(afterItems[1]).toMatchObject({ sku_id: 2147483650, sku_code: 'RED-M', price: '24.50' });
  });

  test('同商品 base 和不同 SKU 共存，各自保持用户范围内唯一', async () => {
    await migrateSkuTables(db);
    await db.query(`INSERT INTO cart (user_id,product_id,sku_id,quantity)
      VALUES (1,11,2147483650,2),(1,11,2147483651,4),(2,11,2147483650,1),(1,12,2147483650,1)`);

    for (const skuId of [null, 2147483650, 2147483651]) {
      await expect(db.query('INSERT INTO cart (user_id,product_id,sku_id,quantity) VALUES (1,11,?,1)', [skuId]))
        .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    }
    await expect(db.query('UPDATE cart SET sku_id = NULL WHERE user_id = 1 AND product_id = 11 AND sku_id = 2147483650'))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT sku_id,sku_key,quantity FROM cart WHERE user_id = 1 AND product_id = 11 ORDER BY sku_key'
    );
    expect(rows).toEqual([
      expect.objectContaining({ sku_id: null, sku_key: 0, quantity: 3 }),
      expect.objectContaining({ sku_id: 2147483650, sku_key: 2147483650, quantity: 2 }),
      expect.objectContaining({ sku_id: 2147483651, sku_key: 2147483651, quantity: 4 }),
    ]);
    const indexes = await cartIndexes();
    expect(indexes.some(index => index.INDEX_NAME === 'uk_user_product')).toBe(false);
    expect(indexes.filter(index => index.INDEX_NAME === 'uk_user_product_sku').map(index => [index.NON_UNIQUE, index.COLUMN_NAME]))
      .toEqual([[0, 'user_id'], [0, 'product_id'], [0, 'sku_key']]);
  });

  test('删除旧唯一索引前中断仍保留新约束，重跑可安全完成', async () => {
    const interruption = new Error('模拟删除旧索引前迁移中断');
    const interrupted = new Proxy(db, {
      get(target, property) {
        if (property !== 'query') return Reflect.get(target, property);
        return async (sql: string, params?: any[]) => {
          if (/ALTER TABLE cart DROP INDEX uk_user_product\b/i.test(sql)) throw interruption;
          return target.query(sql, params);
        };
      },
    });

    await expect(migrateSkuTables(interrupted)).rejects.toBe(interruption);

    const before = await cartIndexes();
    expect(before.some(index => index.INDEX_NAME === 'uk_user_product' && index.NON_UNIQUE === 0)).toBe(true);
    expect(before.filter(index => index.INDEX_NAME === 'uk_user_product_sku').map(index => [index.NON_UNIQUE, index.COLUMN_NAME]))
      .toEqual([[0, 'user_id'], [0, 'product_id'], [0, 'sku_key']]);
    await expect(db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,11,1)'))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

    await migrateSkuTables(db);

    const after = await cartIndexes();
    expect(after.some(index => index.INDEX_NAME === 'uk_user_product')).toBe(false);
    await db.query('INSERT INTO cart (user_id,product_id,sku_id,quantity) VALUES (1,11,2147483650,2)');
    await expect(db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,11,1)'))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    const [base] = await db.query<RowDataPacket[]>('SELECT quantity,sku_id,sku_key FROM cart WHERE cart_id = 10');
    expect(base[0]).toMatchObject({ quantity: 3, sku_id: null, sku_key: 0 });
  });
});
