import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool, query } from '../../database/mysql';
import adminProducts from '../../routes/admin-product.routes';
import { ProductController } from '../../controllers/product.controller';
import { createOrder, previewOrder } from '../../services/order.service';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { getRedisClient } from '../../database/redis';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => {
  const cache = new Map<string, string>();
  const client = { get: jest.fn(async (key: string) => cache.get(key) ?? null),
    setex: jest.fn(async (key: string, _ttl: number, value: string) => { cache.set(key, value); }),
    del: jest.fn(async (...keys: string[]) => { keys.forEach(key => cache.delete(key)); }) };
  return { getRedisClient: () => client };
});

const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
(enabled ? describe : describe.skip)('真实 MySQL 管理员SKU界面契约', () => {
  const database = `ecom_admin_sku_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET } : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }), user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00', connectionLimit: 6 };
  let server: Pool, db: Pool, created = false;
  const app = express(); app.use(express.json()); app.use('/api/admin/products', adminProducts); app.get('/api/products/:id', ProductController.getDetail);
  const admin = (id = 1) => `Bearer ${jwt.sign({ type: 'admin', adminId: id }, process.env.JWT_SECRET!)}`;
  const body = { sku_code: 'BLUE-M', specs: { Color: 'Blue', Size: 42, Waterproof: false }, price: 12.50, original_price: null, stock: 3, image: null, status: 1 };

  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    const needed = new Set(['users', 'products', 'product_skus', 'orders', 'order_items', 'cart', 'shipping_addresses', 'roles', 'admins', 'permissions', 'role_permissions', 'admin_logs']);
    for (const filename of ['migrate.ts', 'admin-migrate.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '../../database', filename), 'utf8');
      for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) if (needed.has(match[2])) await db.query(match[1]);
    }
    await migrateCouponTables(db);
    await db.query("INSERT INTO roles(role_id,role_name) VALUES(1,'super_admin'),(2,'viewer')");
    await db.query("INSERT INTO admins(admin_id,username,password_hash,role_id) VALUES(1,'owner','fixture',1),(2,'viewer','fixture',2)");
    await db.query("INSERT INTO permissions(permission_id,permission_name,permission_code) VALUES(1,'view','product:view')");
    await db.query('INSERT INTO role_permissions(role_id,permission_id) VALUES(2,1)');
  });
  afterAll(async () => { if (db) await db.end(); if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } } });
  beforeEach(async () => {
    await getRedisClient().del('product:1', 'product:v2:1', 'product:2', 'product:v2:2', 'products:hot', 'products:hot:v2', 'products:hot:v3');
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    for (const table of ['admin_logs', 'coupon_usage_logs', 'user_coupons', 'order_items', 'orders', 'cart', 'shipping_addresses', 'product_skus', 'products', 'users']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'buyer','buyer@example.test','fixture')");
    await db.query("INSERT INTO products(product_id,title,price,stock) VALUES(1,'原始商品',100,99),(2,'普通商品',5,10)");
    await db.query("INSERT INTO shipping_addresses(address_id,user_id,receiver_name,phone,province,city,district,detail_address) VALUES(101,1,'测试收件人','13800138000','浙江省','杭州市','西湖区','测试路')");
    await db.query('INSERT INTO product_skus(sku_id,product_id,sku_code,specs,price,stock,status) VALUES(11,1,?,?,12.50,3,1)', [body.sku_code, JSON.stringify(body.specs)]);
  });

  test('嵌套编辑绑定商品与规格，并保留属性类型和审计记录', async () => {
    const response = await request(app).put('/api/admin/products/1/skus/11').set('Authorization', admin()).send({ ...body, price: 15.25, stock: 4 });
    expect(response.status).toBe(200);
    const list = await request(app).get('/api/admin/products/1/skus').set('Authorization', admin());
    expect(list.body.product).toEqual({ product_id: 1, title: '原始商品', title_en: null, status: 1 });
    expect(list.body.skus[0]).toMatchObject({ sku_id: 11, price: '15.25', stock: 4, specs: body.specs, image: null, original_price: null });
    const [logs] = await db.query<RowDataPacket[]>('SELECT action,resource_type,resource_id FROM admin_logs');
    expect(logs).toEqual([expect.objectContaining({ action: 'UPDATE_SKU', resource_type: 'sku', resource_id: '11' })]);
  });

  test('读取、创建和编辑遵守管理员认证及权限，错误商品不能编辑此规格', async () => {
    expect((await request(app).get('/api/admin/products/1/skus')).status).toBe(401);
    expect((await request(app).put('/api/admin/products/1/skus/11').set('Authorization', `Bearer ${jwt.sign({ userId: 1 }, process.env.JWT_SECRET!)}`).send({ stock: 0 })).status).toBe(403);
    expect((await request(app).get('/api/admin/products/1/skus').set('Authorization', admin(2))).status).toBe(200);
    expect((await request(app).post('/api/admin/products/1/skus').set('Authorization', admin(2)).send({ ...body, sku_code: 'GREEN-M' })).status).toBe(403);
    expect((await request(app).put('/api/admin/products/1/skus/11').set('Authorization', admin(2)).send({ stock: 0 })).status).toBe(403);
    expect((await request(app).put('/api/admin/products/2/skus/11').set('Authorization', admin()).send({ stock: 0 })).status).toBe(404);
    expect((await db.query<RowDataPacket[]>('SELECT stock FROM product_skus WHERE sku_id=11'))[0][0].stock).toBe(3);
    expect((await db.query<RowDataPacket[]>('SELECT * FROM admin_logs'))[0]).toHaveLength(0);
  });

  test('新增、改价和停用立即影响前台与订单价格库存，全部停用不回退基础库存', async () => {
    const before = await request(app).get('/api/products/1');
    expect(before.body.product).toMatchObject({ price: 12.5, stock: 3 });
    expect(await getRedisClient().get('product:v2:1')).not.toBeNull();
    const added = await request(app).post('/api/admin/products/1/skus').set('Authorization', admin()).send({ ...body, sku_code: 'GREEN-M', price: 8.75, stock: 2 });
    expect(added.status).toBe(201); const id = added.body.sku_id;
    expect((await request(app).post('/api/admin/products/1/skus').set('Authorization', admin()).send({ ...body, sku_code: 'GREEN-M' })).status).toBe(409);
    let detail = await request(app).get('/api/products/1');
    expect(detail.body.product).toMatchObject({ has_sku: true, price: 8.75, stock: 5 });
    expect((await previewOrder(1, [{ product_id: 1, sku_id: id, quantity: 1 }])).total_amount).toBe(8.75);
    const purchase = await createOrder(1, [{ product_id: 1, sku_id: id, quantity: 1 }], 101);
    expect(purchase.total_amount).toBe(8.75);
    expect((await request(app).put(`/api/admin/products/1/skus/${id}`).set('Authorization', admin()).send({ price: 9.25 })).status).toBe(200);
    expect((await db.query<RowDataPacket[]>('SELECT price,stock FROM product_skus WHERE sku_id=?', [id]))[0][0]).toMatchObject({ price: '9.25', stock: 1 });
    expect((await previewOrder(1, [{ product_id: 1, sku_id: id, quantity: 1 }])).total_amount).toBe(9.25);
    await request(app).put(`/api/admin/products/1/skus/${id}`).set('Authorization', admin()).send({ status: 0 });
    await expect(previewOrder(1, [{ product_id: 1, sku_id: id, quantity: 1 }])).rejects.toMatchObject({ statusCode: 400 });
    detail = await request(app).get('/api/products/1'); expect(detail.body.product).toMatchObject({ price: 12.5, stock: 3 });
    await request(app).put('/api/admin/products/1/skus/11').set('Authorization', admin()).send({ status: 0 });
    detail = await request(app).get('/api/products/1'); expect(detail.body.product).toMatchObject({ has_sku: true, stock: 0, skus: [] });
    await expect(previewOrder(1, [{ product_id: 1, quantity: 1 }])).rejects.toThrow();
    await expect(createOrder(1, [{ product_id: 2, quantity: 1 }], 101)).resolves.toMatchObject({ total_amount: 5 });
    await request(app).put(`/api/admin/products/1/skus/${id}`).set('Authorization', admin()).send({ status: 1 });
    detail = await request(app).get('/api/products/1'); expect(detail.body.product).toMatchObject({ price: 9.25, stock: 1 });
    expect((await db.query<RowDataPacket[]>('SELECT stock FROM products WHERE product_id=1'))[0][0].stock).toBe(99);
  });
});
