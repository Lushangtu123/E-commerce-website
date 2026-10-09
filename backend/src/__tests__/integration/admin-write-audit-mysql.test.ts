import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import products from '../../routes/admin-product.routes';
import legacyProducts from '../../routes/product.routes';
import coupons from '../../routes/admin-coupon.routes';
import users from '../../routes/admin-user.routes';
import { migrateProductCreations } from '../../database/migrate-product-creations';
import { getRedisClient } from '../../database/redis';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ del: invalidate }) }));
jest.mock('../../services/product-search.service', () => ({ syncProductsToSearchIndex: jest.fn().mockResolvedValue(undefined) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
const invalidate = jest.fn().mockResolvedValue(1);
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
const product = { title: 'Created product', price: 12, stock: 5, category_id: 1 };
const sku = { sku_code: 'NEW-SKU', specs: { Color: 'Blue' }, price: 12, stock: 5 };
const coupon = { code: 'CREATED', name: 'Created coupon', type: 1, discount_value: 1, total_quantity: 10,
  start_time: '2026-01-01', end_time: '2027-01-01' };
const createKey = '00000000-0000-4000-8000-000000000001';
type Write = readonly [name: string, method: 'post' | 'put' | 'delete', url: string, body: object, status: number, action: string];
const writes: readonly Write[] = [
  ['product create', 'post', '/api/admin/products', product, 201, 'CREATE_PRODUCT'],
  ['keyed product create', 'post', '/api/admin/products', { ...product, create_key: createKey }, 201, 'CREATE_PRODUCT'],
  ['legacy product create', 'post', '/api/products', product, 201, 'CREATE_PRODUCT'],
  ['product edit', 'put', '/api/admin/products/1', { title: 'Edited product', stock: 6 }, 200, 'UPDATE_PRODUCT'],
  ['legacy product edit', 'put', '/api/products/1', { title: 'Edited product', stock: 6 }, 200, 'UPDATE_PRODUCT'],
  ['product delete', 'delete', '/api/admin/products/1', {}, 200, 'DELETE_PRODUCT'],
  ['product status', 'put', '/api/admin/products/1/status', { status: 0 }, 200, 'UPDATE_PRODUCT_STATUS'],
  ['batch product status', 'put', '/api/admin/products/batch/status', { productIds: [2, 1], status: 0 }, 200, 'BATCH_UPDATE_PRODUCT_STATUS'],
  ['SKU create', 'post', '/api/admin/products/1/skus', sku, 201, 'CREATE_SKU'],
  ['batch SKU create', 'post', '/api/admin/products/1/skus/batch', { skus: [sku, { ...sku, sku_code: 'SECOND-SKU' }] }, 201, 'BATCH_CREATE_SKU'],
  ['nested SKU edit', 'put', '/api/admin/products/1/skus/11', { stock: 6 }, 200, 'UPDATE_SKU'],
  ['global SKU edit', 'put', '/api/admin/products/skus/11', { stock: 6 }, 200, 'UPDATE_SKU'],
  ['SKU delete', 'delete', '/api/admin/products/skus/11', {}, 200, 'DELETE_SKU'],
  ['coupon create', 'post', '/api/admin/coupons', coupon, 200, 'CREATE_COUPON'],
  ['coupon status', 'put', '/api/admin/coupons/1/status', { status: 0 }, 200, 'UPDATE_COUPON_STATUS'],
  ['user status', 'put', '/api/admin/users/7/status', { status: 0 }, 200, 'UPDATE_USER_STATUS'],
] as const;

integration('non-order admin writes and audit atomicity in real MySQL', () => {
  const database = `admin_write_audit_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8 };
  let server: Pool, db: Pool, created = false;
  const app = express(); app.use(express.json());
  app.use('/api/admin/products', products); app.use('/api/products', legacyProducts);
  app.use('/api/admin/coupons', coupons); app.use('/api/admin/users', users);
  const auth = (adminId = 2) => `Bearer ${jwt.sign({ type: 'admin', adminId, authVersion: 0 }, 'test-jwt-secret')}`;
  const send = (write: typeof writes[number], adminId = 2, agent = 'Fixture browser') =>
    request(app)[write[1]](write[2]).set('Authorization', auth(adminId)).set('User-Agent', agent).send(write[3]);
  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const needed = new Set(['users', 'categories', 'products', 'product_skus', 'orders', 'order_items', 'reviews', 'roles', 'admins', 'permissions', 'role_permissions', 'admin_logs', 'coupons']);
    for (const file of ['migrate.ts', 'admin-migrate.ts', 'migrate-coupon.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '../../database', file), 'utf8');
      for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) if (needed.has(match[2])) await db.query(match[1]);
    }
    await migrateProductCreations(db);
    await db.query("INSERT INTO categories(category_id,name) VALUES(1,'Fixture category')");
    await db.query("INSERT INTO roles(role_id,role_name) VALUES(1,'super_admin'),(2,'reader')");
    await db.query("INSERT INTO admins(admin_id,username,password_hash,role_id) VALUES(2,'operator','fixture',1),(3,'reader','fixture',2)");
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(7,'buyer','buyer@example.test','fixture')");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    invalidate.mockClear(); (getPool as jest.Mock).mockReturnValue(db);
    for (const table of ['admin_logs', 'product_skus', 'products', 'coupons']) await db.query(`DELETE FROM ${table}`);
    await db.query('UPDATE users SET status=1,auth_version=0 WHERE user_id=7');
    await db.query("INSERT INTO products(product_id,title,price,stock,status) VALUES(1,'Fixture product',5,5,1),(2,'Second product',5,5,1)");
    await db.query("INSERT INTO product_skus(sku_id,product_id,sku_code,specs,price,stock,status) VALUES(11,1,'ORIGINAL-SKU','{}',5,5,1)");
    await db.query("INSERT INTO coupons(coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,start_time,end_time) VALUES(1,'ORIGINAL','Fixture coupon',1,1,10,10,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))");
  });
  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const [table, columns, order] of [
      ['products', 'product_id,title,price,stock,status,created_by_admin_id,create_key,create_fingerprint', 'product_id'],
      ['product_skus', 'sku_id,sku_code,price,stock,status', 'sku_id'],
      ['coupons', 'coupon_id,code,status,remain_quantity,total_quantity', 'coupon_id'],
      ['users', 'user_id,status,auth_version', 'user_id'],
    ]) result[table] = (await db.query(`SELECT ${columns} FROM ${table} ORDER BY ${order}`))[0];
    return result;
  }
  const audits = async () => (await db.query<RowDataPacket[]>('SELECT * FROM admin_logs ORDER BY log_id'))[0];
  test.each(writes)('%s rolls back on audit failure and allows a safe retry', async (...write) => {
    const before = await snapshot();
    await db.query("CREATE TRIGGER fail_admin_audit BEFORE INSERT ON admin_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected audit failure'");
    try {
      const response = await send(write);
      expect(await snapshot()).toEqual(before); expect(response.status).toBe(500);
      expect(await audits()).toHaveLength(0); expect(invalidate).not.toHaveBeenCalled();
    } finally { await db.query('DROP TRIGGER fail_admin_audit'); }
    await send(write).expect(write[4]);
    expect(await snapshot()).not.toEqual(before);
    expect(await audits()).toEqual([expect.objectContaining({ admin_id: 2, action: write[5], user_agent: 'Fixture browser' })]);
  });
  test.each(writes)('%s rejects an admin without mutation permission', async (...write) => {
    const before = await snapshot(); await send(write, 3).expect(403);
    expect(await snapshot()).toEqual(before); expect(await audits()).toHaveLength(0);
  });
  test('concurrent keyed creates and lost-response retries retain one product and one audit', async () => {
    const write = writes[1];
    const responses = await Promise.all([send(write), send(write), send(write)]);
    expect(responses.map(value => value.status)).toEqual([201, 201, 201]);
    expect(new Set(responses.map(value => value.body.product_id)).size).toBe(1);
    expect(responses.filter(value => !value.body.replayed)).toHaveLength(1);
    const retry = await send(write).expect(201); expect(retry.body.replayed).toBe(true);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM products WHERE create_key=?', [createKey]);
    expect(rows).toHaveLength(1); expect(await audits()).toHaveLength(1);
  });
  test('concurrent unique SKU and coupon creators audit only the winning insertion', async () => {
    for (const write of [writes[8], writes[13]]) {
      const results = await Promise.all([send(write), send(write)]);
      expect(results.map(value => value.status).sort()).toEqual([write[4], 409].sort());
    }
    expect((await audits()).map(value => value.action)).toEqual(['CREATE_SKU', 'CREATE_COUPON']);
  });
  test('long audit metadata is bounded and cache failure cannot undo a committed inventory write', async () => {
    (getRedisClient().del as jest.Mock).mockRejectedValueOnce(new Error('fixture cache failure'));
    const agent = 'x'.repeat(501); await send(writes[10], 2, agent).expect(200);
    expect((await audits())[0].user_agent).toBe(agent.slice(0, 500));
    expect((await snapshot()).product_skus).toEqual([expect.objectContaining({ stock: 6 })]);
  });
  test('a maximum-size product status batch retains every target in its audit', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => 1000000000 + index);
    await db.query('INSERT INTO products(product_id,title,price,stock) VALUES ?', [ids.map(id => [id, 'Batch product', 5, 5])]);
    await request(app).put('/api/admin/products/batch/status').set('Authorization', auth()).send({ productIds: ids, status: 0 }).expect(200);
    const [rows] = await db.query<RowDataPacket[]>('SELECT product_id FROM products WHERE status=0 ORDER BY product_id');
    expect(rows.map(row => row.product_id)).toEqual(ids);
    const [audit] = await audits(); expect(audit.action).toBe('BATCH_UPDATE_PRODUCT_STATUS');
    for (const id of ids) expect(`${audit.resource_id ?? ''} ${audit.description}`).toContain(String(id));
  });
});
