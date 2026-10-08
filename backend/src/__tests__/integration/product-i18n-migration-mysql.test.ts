import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实MySQL商品双语增量迁移', () => {
  const database = `product_i18n_migration_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00' };
  let server: Pool, db: Pool, created = false;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });

  test('旧商品/SKU/订单内容保持，新增列为SQL NULL且重复升级保留新翻译', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'product_skus', 'orders', 'order_items'].includes(match[2])) {
        await db.query(match[1].replace(/^\s*(title_en|description_en|specs_en|product_name_en|sku_specs_en)\b[^\n]*\n/gm, ''));
      }
    }
    await db.query("INSERT INTO products(product_id,title,description,price,stock,specs) VALUES(1,'历史衬衫','原描述',12.50,7,'{\"颜色\":\"红色\"}')");
    await db.query("INSERT INTO product_skus(sku_id,product_id,sku_code,specs,price,stock) VALUES(11,1,'OLD-RED','{\"尺寸\":42,\"防水\":false}',12.50,5)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status) VALUES(1,'OLD',1,25,0)");
    await db.query("INSERT INTO order_items(item_id,order_id,product_id,product_name,sku_id,sku_specs,price,quantity) VALUES(101,1,1,'下单时衬衫',11,'{\"尺寸\":42,\"防水\":false}',12.50,2)");
    const raw = async (table: string) => (await db.query<RowDataPacket[]>(`SELECT * FROM ${table}`))[0];
    const oldProducts = await raw('products'), oldSKUs = await raw('product_skus'), oldItems = await raw('order_items'), oldOrders = await raw('orders');
    const { migrateProductI18n } = require('../../database/migrate-product-i18n');
    await migrateProductI18n(db);
    expect(await raw('products')).toEqual(oldProducts.map(row => ({ ...row, title_en: null, description_en: null, specs_en: null })));
    expect(await raw('product_skus')).toEqual(oldSKUs.map(row => ({ ...row, specs_en: null })));
    expect(await raw('order_items')).toEqual(oldItems.map(row => ({ ...row, product_name_en: null, sku_specs_en: null })));
    expect(await raw('orders')).toEqual(oldOrders);
    const translation = JSON.stringify({ 颜色: { name: 'Color', value: 'Red' } });
    await db.query('UPDATE products SET title_en=?,description_en=?,specs_en=? WHERE product_id=1', ['Shirt', 'Cotton', translation]);
    await db.query('UPDATE product_skus SET specs_en=? WHERE sku_id=11', [translation]);
    await db.query('UPDATE order_items SET product_name_en=?,sku_specs_en=? WHERE item_id=101', ['Purchased shirt', translation]);
    const updated = await Promise.all(['products', 'product_skus', 'order_items'].map(raw));
    await migrateProductI18n(db); await migrateProductI18n(db);
    expect(await Promise.all(['products', 'product_skus', 'order_items'].map(raw))).toEqual(updated);
    const [columns] = await db.query<RowDataPacket[]>("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN ('title_en','description_en','specs_en','product_name_en','sku_specs_en')");
    expect(columns).toHaveLength(6);
    expect(columns.every(column => column.IS_NULLABLE === 'YES')).toBe(true);
  });
});
