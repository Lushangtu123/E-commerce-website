import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import { getPool, query } from '../../database/mysql';
import { ProductModel } from '../../models/product.model';
import { createProduct } from '../../controllers/admin-product.controller';
import { afterProductWrite } from '../../controllers/admin-product-write';
import { migrateProductCreations } from '../../database/migrate-product-creations';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../controllers/admin-product-write', () => ({ afterProductWrite: jest.fn().mockResolvedValue(undefined) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
const key = '00000000-0000-4000-8000-000000000001';
const nextKey = '00000000-0000-4000-8000-000000000002';
const input = { title: 'Retry product', price: 12, stock: 5, category_id: 1, specs: { color: 'red', size: 42 } };
type Receipt = { productId: number; replayed: boolean };
// Keep the behavioral red check executable against the original model API.
const create = (data = input, createKey = key, adminId = 1): Promise<Receipt> => {
  const method = (ProductModel as unknown as { createForAdmin?: (data: typeof input, admin: number, key: string) => Promise<Receipt> }).createForAdmin;
  return method ? method.call(ProductModel, data, adminId, createKey) : ProductModel.create(data).then(productId => ({ productId, replayed: false }));
};

integration('real MySQL product creation retry identity', () => {
  const database = `product_create_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 6 };
  let server: Pool, db: Pool, created = false;
  const app = express(); app.use(express.json());
  app.post('/products', (req, _res, next) => { (req as unknown as { admin: { adminId: number } }).admin = { adminId: 1 }; next(); }, createProduct);
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    await db.query(source.match(/`(CREATE TABLE IF NOT EXISTS products[\s\S]*?)`/)![1]);
    await db.query('CREATE TABLE admins(admin_id BIGINT PRIMARY KEY, status TINYINT DEFAULT 1)');
    await db.query('INSERT INTO admins(admin_id) VALUES(1),(2)');
    const adminSource = fs.readFileSync(path.join(__dirname, '../../database/admin-migrate.ts'), 'utf8');
    await db.query(adminSource.match(/`(\s*CREATE TABLE IF NOT EXISTS admin_logs[\s\S]*?)`/)![1]);
    await migrateProductCreations(db);
  });
  afterAll(async () => { if (db) await db.end(); if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } } });
  beforeEach(async () => { await db.query('DELETE FROM admin_logs'); await db.query('DELETE FROM products'); jest.clearAllMocks(); });
  const rows = async () => (await db.query<RowDataPacket[]>('SELECT product_id,title,stock,create_key FROM products ORDER BY product_id'))[0];
  test('same key concurrent requests and lost-response retries create one product', async () => {
    const receipts = await Promise.all([create(), create(), create()]);
    expect(new Set(receipts.map(value => value.productId)).size).toBe(1);
    expect(receipts.filter(value => !value.replayed)).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
    expect(await create()).toEqual({ productId: receipts[0].productId, replayed: true });
  });
  test('a changed payload conflicts without overwriting stock or creating a product', async () => {
    await create(); await expect(create({ ...input, stock: 6 })).rejects.toMatchObject({ statusCode: 409 });
    expect(await rows()).toEqual([expect.objectContaining({ stock: 5 })]);
  });
  test('different administrators and new keys represent independent creations', async () => {
    await create(); await create(input, nextKey); await create(input, key, 2); expect(await rows()).toHaveLength(3);
  });
  test('object key order and product edits do not prevent replay of the original request', async () => {
    const first = await create(); await db.query('UPDATE products SET stock=1,status=-1,title=? WHERE product_id=?', ['Changed', first.productId]);
    expect(await create({ ...input, specs: { size: 42, color: 'red' } })).toEqual({ ...first, replayed: true });
    expect(await rows()).toEqual([expect.objectContaining({ title: 'Changed', stock: 1 })]);
  });
  test('controller returns the original product ID and records the creation action once', async () => {
    const first = await request(app).post('/products').send({ ...input, create_key: key }).expect(201);
    const retry = await request(app).post('/products').send({ ...input, create_key: key }).expect(201);
    expect(first.body.product_id).toBe(retry.body.product_id); expect(retry.body.replayed).toBe(true);
    expect(await rows()).toHaveLength(1); expect(afterProductWrite).toHaveBeenCalledTimes(1);
    const [logs] = await db.query<RowDataPacket[]>('SELECT action,resource_id FROM admin_logs');
    expect(logs).toEqual([{ action: 'CREATE_PRODUCT', resource_id: String(first.body.product_id) }]);
  });
  test('rejects invalid request IDs, retains legacy API compatibility', async () => {
    for (const create_key of ['', 'invalid', null, 1]) await request(app).post('/products').send({ ...input, create_key }).expect(400);
    await request(app).post('/products').send(input).expect(201);
    expect(await rows()).toHaveLength(1);
  });
  test('a disabled or missing administrator cannot create a product', async () => {
    await expect(create(input, key, 999)).rejects.toMatchObject({ statusCode: 403 });
    await db.query('UPDATE admins SET status=0 WHERE admin_id=2');
    try { await expect(create(input, key, 2)).rejects.toMatchObject({ statusCode: 403 }); expect(await rows()).toEqual([]); }
    finally { await db.query('UPDATE admins SET status=1 WHERE admin_id=2'); }
  });
  test('a failed insert rolls back its receipt and releases the connection for a valid retry', async () => {
    await db.query("CREATE TRIGGER reject_audit_creation BEFORE INSERT ON products FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture failure'");
    try { await expect(create()).rejects.toThrow('fixture failure'); expect(await rows()).toEqual([]); }
    finally { await db.query('DROP TRIGGER reject_audit_creation'); }
    expect((await create()).replayed).toBe(false); expect(await rows()).toHaveLength(1);
  });
  test('repeatable migration preserves historical products and checks without changing data', async () => {
    await db.query('ALTER TABLE products DROP INDEX unique_admin_create_key, DROP COLUMN created_by_admin_id, DROP COLUMN create_key, DROP COLUMN create_fingerprint');
    await ProductModel.create(input); await ProductModel.create(input);
    const [before] = await db.query<RowDataPacket[]>('SELECT * FROM products ORDER BY product_id');
    await expect(migrateProductCreations(db, true)).rejects.toThrow('字段尚未迁移');
    await migrateProductCreations(db); await migrateProductCreations(db);
    const [after] = await db.query<RowDataPacket[]>('SELECT * FROM products ORDER BY product_id');
    expect(after).toEqual(before.map(row => ({ ...row, created_by_admin_id: null, create_key: null, create_fingerprint: null })));
    await expect(migrateProductCreations(db, true)).resolves.toBeUndefined();
  });
  test('incompatible existing columns are rejected before adding any other columns', async () => {
    await db.query('ALTER TABLE products DROP INDEX unique_admin_create_key, DROP COLUMN created_by_admin_id, DROP COLUMN create_fingerprint, MODIFY create_key VARCHAR(36)');
    try {
      await expect(migrateProductCreations(db)).rejects.toThrow('字段结构不兼容');
      const [columns] = await db.query<RowDataPacket[]>("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='created_by_admin_id'");
      expect(columns).toEqual([]);
    } finally { await db.query('ALTER TABLE products DROP COLUMN create_key'); await migrateProductCreations(db); }
  });
});
