import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { CartModel } from '../../models/cart.model';
import { migrateCartAdds } from '../../database/migrate-cart-adds';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
const key = '00000000-0000-4000-8000-000000000001';
integration('real MySQL durable cart add receipts', () => {
  const database = `cart_add_receipts_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } :
    { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8 };
  let server: Pool, db: Pool, created = false;
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database}`); created = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['users', 'products', 'product_skus', 'cart'].includes(match[2])) await db.query(match[1]);
    }
    await migrateCartAdds(db);
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'A','a@test','test'),(2,'B','b@test','test')");
    await db.query("INSERT INTO products(product_id,title,price,stock,status) VALUES(1,'A',10,20,1),(2,'B',10,20,1)");
    await db.query("INSERT INTO product_skus(sku_id,product_id,sku_code,specs,price,stock,status) VALUES(21,2,'A','{}',10,20,1),(22,2,'B','{}',10,20,1)");
  });
  beforeEach(async () => {
    await db.query('DELETE FROM cart'); await db.query('DELETE FROM cart_add_receipts');
    await db.query('UPDATE products SET stock=20,status=1'); await db.query('UPDATE product_skus SET stock=20,status=1');
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  const cart = async () => (await db.query<RowDataPacket[]>('SELECT user_id,product_id,sku_id,quantity FROM cart ORDER BY user_id,product_id,sku_id'))[0];
  const receipts = async () => (await db.query<RowDataPacket[]>('SELECT * FROM cart_add_receipts ORDER BY user_id,add_key'))[0];
  const add = (user = 1, product = 1, quantity = 2, sku?: number, addKey = key) => CartModel.add(user, product, quantity, sku, addKey);
  test('concurrent same-key adds commit one increment and one durable receipt', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => add()));
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(await cart()).toEqual([{ user_id: 1, product_id: 1, sku_id: null, quantity: 2 }]);
    expect(await receipts()).toHaveLength(1);
    await expect(add()).resolves.toEqual({ add_key: key, replayed: true });
  });
  test.each(['remove', 'clear', 'change', 'checkout'] as const)('lost-response retry survives %s and changed catalog without restoring a row', async action => {
    await add();
    if (action === 'remove') await CartModel.remove(1, 1);
    if (action === 'clear') await CartModel.clear(1);
    if (action === 'change') await CartModel.updateQuantity(1, 1, 7);
    if (action === 'checkout') await db.query('DELETE FROM cart WHERE user_id=1');
    const before = await cart(); await db.query('UPDATE products SET stock=0,status=0');
    await expect(add()).resolves.toEqual({ add_key: key, replayed: true });
    expect(await cart()).toEqual(before); expect(await receipts()).toHaveLength(1);
  });
  test('changed normalized payload returns 409; same UUID is independently scoped to a customer', async () => {
    await add(1, 2, 2, 21);
    for (const [product, quantity, sku] of [[1, 2, undefined], [2, 3, 21], [2, 2, 22]] as const) {
      await expect(add(1, product, quantity, sku)).rejects.toMatchObject({ statusCode: 409 });
    }
    await add(2, 2, 2, 21); expect(await receipts()).toHaveLength(2);
    expect((await cart()).map(row => row.quantity)).toEqual([2, 2]);
  });
  test('a receipt insertion failure rolls back the additive write and permits a valid retry', async () => {
    await db.query("CREATE TRIGGER cart_receipt_fail BEFORE INSERT ON cart_add_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='receipt fail'");
    try { await expect(add()).rejects.toThrow('receipt fail'); }
    finally { await db.query('DROP TRIGGER cart_receipt_fail'); }
    expect(await cart()).toEqual([]); expect(await receipts()).toEqual([]);
    await add(); expect((await cart())[0].quantity).toBe(2); expect(await receipts()).toHaveLength(1);
  });
  test('concurrent independent intents preserve additive semantics and live stock limits', async () => {
    await Promise.all(Array.from({ length: 6 }, (_, i) => add(1, 1, 2, undefined, `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)));
    expect((await cart())[0].quantity).toBe(12);
    await expect(add(1, 1, 9, undefined, '00000000-0000-4000-8000-000000000099')).rejects.toMatchObject({ statusCode: 400 });
    expect(await receipts()).toHaveLength(6);
    expect(await CartModel.add(1, 1, 1)).toBe(true); expect((await cart())[0].quantity).toBe(13);
  });
  test('migration/check are idempotent, preserve receipts, require explicit primary key and reject incompatible schema', async () => {
    await add(); const before = await receipts(); await migrateCartAdds(db); await migrateCartAdds(db, true);
    expect(await receipts()).toEqual(before);
    await db.query('ALTER TABLE cart_add_receipts MODIFY add_key VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL');
    await expect(migrateCartAdds(db)).rejects.toThrow('字段结构不兼容');
    expect((await receipts())[0].payload_fingerprint).toBe(before[0].payload_fingerprint);
    await db.query('ALTER TABLE cart_add_receipts MODIFY add_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL');
    await db.query('ALTER TABLE cart_add_receipts DROP PRIMARY KEY');
    await expect(migrateCartAdds(db)).rejects.toThrow('主键结构不兼容');
    await db.query('ALTER TABLE cart_add_receipts ADD PRIMARY KEY(user_id,add_key)');
    await migrateCartAdds(db, true);
  });
});
