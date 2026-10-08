import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { getRedisClient } from '../../database/redis';
import { getESClient, syncProductToES } from '../../database/elasticsearch';
import productRoutes from '../../routes/product.routes';
import { PRODUCT_HOT_CACHE_KEYS, productDetailCacheKeys } from '../../utils/product-cache-keys';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../database/elasticsearch', () => ({
  getESClient: jest.fn(), syncProductToES: jest.fn(), deleteProductFromES: jest.fn(),
}));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('legacy product routes use current product write postprocessing', () => {
  const database = `legacy_product_writes_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00',
  };
  let server: Pool, db: Pool, created = false;
  let cache: Map<string, string>;
  let redis: { del: jest.Mock };
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  const adminToken = jwt.sign({ adminId: 1, type: 'admin', authVersion: 0 }, 'test-jwt-secret');

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    for (const [file, tables] of [
      ['migrate.ts', ['products', 'product_skus', 'reviews']],
      ['admin-migrate.ts', ['roles', 'admins', 'permissions', 'role_permissions', 'admin_logs']],
    ] as const) {
      const source = fs.readFileSync(path.join(__dirname, '../../database', file), 'utf8');
      for (const match of source.matchAll(/`\s*(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
        if ((tables as readonly string[]).includes(match[2])) await db.query(match[1]);
      }
    }
    await db.query("INSERT INTO roles(role_id,role_name) VALUES(2,'product_editor')");
    await db.query("INSERT INTO admins(admin_id,username,password_hash,role_id,status) VALUES(1,'editor','unused',2,1)");
    await db.query("INSERT INTO permissions(permission_id,permission_name,permission_code) VALUES(1,'Create','product:create'),(2,'Edit','product:edit')");
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    (getPool as jest.Mock).mockReturnValue(db);
    (getESClient as jest.Mock).mockReturnValue({});
    (syncProductToES as jest.Mock).mockResolvedValue(undefined);
    cache = new Map();
    redis = { del: jest.fn(async (...keys: string[]) => keys.reduce((count, key) => count + Number(cache.delete(key)), 0)) };
    (getRedisClient as jest.Mock).mockReturnValue(redis);
    await db.query('DELETE FROM admin_logs');
    await db.query('DELETE FROM products');
    await db.query('DELETE FROM role_permissions');
    await db.query('INSERT INTO role_permissions(role_id,permission_id) VALUES(2,1),(2,2)');
    await db.query("INSERT INTO products(product_id,title,title_en,price,stock,status) VALUES(1,'原商品','Original',20,4,1),(2,'已删除','Deleted',20,4,-1)");
    for (const key of [...productDetailCacheKeys(1), ...PRODUCT_HOT_CACHE_KEYS]) cache.set(key, 'stale');
  });

  async function logs() { return (await db.query<RowDataPacket[]>('SELECT * FROM admin_logs ORDER BY log_id'))[0]; }

  test('creation clears hot rankings, indexes persisted customer fields and records the authenticated admin', async () => {
    const result = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`)
      .set('User-Agent', 'legacy-create-test').send({ title: '新商品', title_en: 'New product', price: 75, stock: 3 }).expect(201);
    const id = result.body.product_id;
    expect(PRODUCT_HOT_CACHE_KEYS.filter(key => cache.has(key))).toEqual([]);
    expect(syncProductToES).toHaveBeenCalledWith(expect.objectContaining({ product_id: id, title_en: 'New product', price: '75.00', stock: '3', status: 1 }));
    expect(await logs()).toEqual([expect.objectContaining({ admin_id: 1, action: 'CREATE_PRODUCT', resource_type: 'product', resource_id: String(id), description: '创建商品: 新商品', user_agent: 'legacy-create-test' })]);
  });

  test('updates clear detail/ranking caches, refresh the index price and append an audit entry', async () => {
    await request(app).put('/api/products/1').set('Authorization', `Bearer ${adminToken}`)
      .set('User-Agent', 'legacy-update-test').send({ price: 75, title_en: 'Changed' }).expect(200);
    expect(cache.size).toBe(0);
    expect(syncProductToES).toHaveBeenCalledWith(expect.objectContaining({ product_id: 1, price: '75.00', title_en: 'Changed' }));
    expect(await logs()).toEqual([expect.objectContaining({ admin_id: 1, action: 'UPDATE_PRODUCT', resource_id: '1', user_agent: 'legacy-update-test' })]);
    const [rows] = await db.query<RowDataPacket[]>('SELECT price,title_en FROM products WHERE product_id=1');
    expect(rows[0]).toMatchObject({ price: '75.00', title_en: 'Changed' });
  });

  test('cache and index failures keep a committed update successful and still record its audit entry', async () => {
    redis.del.mockRejectedValue(new Error('Redis unavailable'));
    (syncProductToES as jest.Mock).mockRejectedValue(new Error('Index unavailable'));
    await request(app).put('/api/products/1').set('Authorization', `Bearer ${adminToken}`).send({ price: 75 }).expect(200);
    const [rows] = await db.query<RowDataPacket[]>('SELECT price FROM products WHERE product_id=1');
    expect(rows[0].price).toBe('75.00');
    expect(syncProductToES).toHaveBeenCalledTimes(1);
    expect(await logs()).toEqual([expect.objectContaining({ action: 'UPDATE_PRODUCT', resource_id: '1' })]);
  });

  test('an unconfigured search service still clears caches and writes an audit entry', async () => {
    (getESClient as jest.Mock).mockReturnValue(null);
    await request(app).put('/api/products/1').set('Authorization', `Bearer ${adminToken}`).send({ stock: 6 }).expect(200);
    expect(cache.size).toBe(0);
    expect(syncProductToES).not.toHaveBeenCalled();
    expect(await logs()).toEqual([expect.objectContaining({ action: 'UPDATE_PRODUCT' })]);
  });

  test('permission denial prevents a legacy write and all postprocessing', async () => {
    await db.query('DELETE FROM role_permissions');
    await request(app).put('/api/products/1').set('Authorization', `Bearer ${adminToken}`).send({ price: 75 }).expect(403);
    const [rows] = await db.query<RowDataPacket[]>('SELECT price FROM products WHERE product_id=1');
    expect(rows[0].price).toBe('20.00');
    expect(redis.del).not.toHaveBeenCalled();
    expect(syncProductToES).not.toHaveBeenCalled();
    expect(await logs()).toEqual([]);
  });

  test('deleted products retain their tombstone and trigger no successful-write postprocessing', async () => {
    await request(app).put('/api/products/2').set('Authorization', `Bearer ${adminToken}`).send({ status: 1 }).expect(400);
    const [rows] = await db.query<RowDataPacket[]>('SELECT status FROM products WHERE product_id=2');
    expect(rows[0].status).toBe(-1);
    expect(redis.del).not.toHaveBeenCalled();
    expect(syncProductToES).not.toHaveBeenCalled();
    expect(await logs()).toEqual([]);
  });
});
