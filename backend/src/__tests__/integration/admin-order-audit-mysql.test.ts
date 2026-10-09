import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { getPool } from '../../database/mysql';
import adminOrderRoutes from '../../routes/admin-order.routes';
import { transitionOrder } from '../../services/order.service';
import { OrderStatus } from '../../models/order.model';
import { migrateCouponTables } from '../../database/migrate-coupon';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ del: jest.fn().mockResolvedValue(1) }) }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('admin order status and audit atomicity in real MySQL', () => {
  const database = `admin_order_audit_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', connectionLimit: 8,
  };
  let server: Pool, db: Pool, created = false;
  const app = express(); app.use(express.json()); app.use('/api/admin/orders', adminOrderRoutes);
  const auth = (adminId = 2) => ({ Authorization: `Bearer ${jwt.sign({ type: 'admin', adminId, authVersion: 0 }, 'test-jwt-secret')}` });
  const shipment = { shipping_company: 'Fixture carrier', tracking_number: 'TRACK-10' };
  const update = (status: number, userAgent = 'Fixture browser') => request(app).put('/api/admin/orders/10/status')
    .set(auth()).set('User-Agent', userAgent).send({ status, ...(status === 2 ? shipment : {}) });

  beforeAll(async () => {
    server = mysql.createPool(options); await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database }); (getPool as jest.Mock).mockReturnValue(db);
    const needed = new Set(['users', 'products', 'product_skus', 'orders', 'order_items', 'roles', 'admins', 'permissions', 'role_permissions', 'admin_logs']);
    for (const file of ['migrate.ts', 'admin-migrate.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '../../database', file), 'utf8');
      for (const match of source.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
        if (needed.has(match[2])) await db.query(match[1]);
      }
    }
    await migrateCouponTables(db);
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(7,'buyer','buyer@example.test','fixture')");
    await db.query("INSERT INTO roles(role_id,role_name) VALUES(1,'order_operator'),(2,'order_reader')");
    await db.query("INSERT INTO admins(admin_id,username,password_hash,role_id) VALUES(2,'operator','fixture',1),(3,'reader','fixture',2)");
    await db.query("INSERT INTO permissions(permission_id,permission_name,permission_code) VALUES(1,'Edit orders','order:edit'),(2,'View orders','order:view')");
    await db.query('INSERT INTO role_permissions(role_id,permission_id) VALUES(1,1),(2,2)');
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    (getPool as jest.Mock).mockReturnValue(db);
    for (const table of ['admin_logs', 'coupon_usage_logs', 'user_coupons', 'coupons', 'order_items', 'orders', 'products']) await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO products(product_id,title,price,stock,sales_count) VALUES(1,'Fixture product',5,5,2)");
    await db.query("INSERT INTO orders(order_id,order_no,user_id,total_amount,status,payment_method) VALUES(10,'AUDIT-10',7,10,1,'demo')");
    await db.query("INSERT INTO order_items(order_id,product_id,product_name,quantity,price) VALUES(10,1,'Fixture product',2,5)");
  });
  async function order() { return (await db.query<RowDataPacket[]>('SELECT status,payment_method,shipping_company,tracking_number,paid_at,shipped_at,completed_at FROM orders WHERE order_id=10'))[0][0]; }
  async function audits() { return (await db.query<RowDataPacket[]>('SELECT admin_id,action,resource_type,resource_id,description,ip_address,user_agent FROM admin_logs ORDER BY log_id'))[0]; }
  async function product() { return (await db.query<RowDataPacket[]>('SELECT stock,sales_count FROM products WHERE product_id=1'))[0][0]; }
  async function reserveCoupon() {
    await db.query(`INSERT INTO coupons(coupon_id,code,name,type,discount_value,min_amount,total_quantity,remain_quantity,start_time,end_time)
      VALUES(1,'AUDIT-COUPON','Fixture coupon',1,1,0,10,9,DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 1 DAY))`);
    await db.query('INSERT INTO user_coupons(user_coupon_id,user_id,coupon_id,status,order_id,used_at,expired_at) VALUES(1,7,1,2,10,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))');
    await db.query('UPDATE orders SET user_coupon_id=1 WHERE order_id=10');
  }
  async function coupon() { return (await db.query<RowDataPacket[]>('SELECT status,order_id,used_at FROM user_coupons WHERE user_coupon_id=1'))[0][0]; }

  test.each([
    ['ordinary', 'Fixture browser'], ['501-character', 'x'.repeat(501)],
  ])('shipping retains an audit for a %s User-Agent', async (_label, userAgent) => {
    await update(2, userAgent).expect(200, { message: '更新成功', status: 2 });
    expect(await order()).toMatchObject({ status: 2, ...shipment, shipped_at: expect.any(Date) });
    expect(await audits()).toEqual([expect.objectContaining({ admin_id: 2, action: 'UPDATE_ORDER_STATUS', resource_type: 'order', resource_id: '10', user_agent: userAgent.slice(0, 500) })]);
  });

  test.each([
    [0, 1, '已支付', 'paid_at'], [1, 2, '已发货', 'shipped_at'],
    [2, 3, '已完成', 'completed_at'], [0, 4, '已取消', null],
  ] as const)('admin transition %i -> %i saves exactly one matching audit', async (from, to, name, timeField) => {
    await db.query('UPDATE orders SET status=? WHERE order_id=10', [from]);
    if (from === 0) await db.query('UPDATE orders SET payment_method=NULL WHERE order_id=10');
    await update(to).expect(200);
    const changed = await order(); expect(changed.status).toBe(to);
    if (timeField) expect(changed[timeField]).toBeInstanceOf(Date);
    if (to === 1) expect(changed.payment_method).toBe('demo');
    expect(await audits()).toEqual([expect.objectContaining({ description: `更新订单状态: AUDIT-10 -> ${name}` })]);
    if (to === 4) expect(await product()).toMatchObject({ stock: 7, sales_count: 2 });
  });

  test.each([[0, 1], [1, 2], [2, 3], [0, 4]] as const)('audit SQL failure rolls back admin transition %i -> %i and permits a safe retry', async (from, to) => {
    await db.query('UPDATE orders SET status=? WHERE order_id=10', [from]);
    if (from === 0) await db.query('UPDATE orders SET payment_method=NULL WHERE order_id=10');
    if (to === 4) await reserveCoupon();
    const beforeOrder = await order(), beforeProduct = await product(), beforeCoupon = to === 4 ? await coupon() : null;
    await db.query("CREATE TRIGGER fail_order_audit BEFORE INSERT ON admin_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected audit failure'");
    try {
      await update(to).expect(500, { error: '更新失败' });
      expect(await order()).toEqual(beforeOrder); expect(await product()).toEqual(beforeProduct);
      if (beforeCoupon) expect(await coupon()).toEqual(beforeCoupon);
      expect(await audits()).toHaveLength(0);
    } finally { await db.query('DROP TRIGGER fail_order_audit'); }
    await update(to).expect(200);
    expect((await order()).status).toBe(to); expect(await audits()).toHaveLength(1);
    if (to === 4) {
      expect(await product()).toMatchObject({ stock: 7, sales_count: 2 });
      expect(await coupon()).toMatchObject({ status: 1, order_id: null, used_at: null });
    }
  });

  test('anonymous and read-only admins cannot change status or write an audit', async () => {
    await request(app).put('/api/admin/orders/10/status').send({ status: 2, ...shipment }).expect(401);
    await request(app).put('/api/admin/orders/10/status').set(auth(3)).send({ status: 2, ...shipment }).expect(403);
    expect((await order()).status).toBe(1); expect(await audits()).toHaveLength(0);
  });
  test('a rejected transition and disabled collection do not write audits', async () => {
    await update(3).expect(400);
    await db.query('UPDATE orders SET status=0 WHERE order_id=10');
    const oldMode = process.env.PAYMENT_MODE; delete process.env.PAYMENT_MODE;
    try { await update(1).expect(503); } finally { process.env.PAYMENT_MODE = oldMode; }
    expect((await order()).status).toBe(0); expect(await audits()).toHaveLength(0);
  });
  test('concurrent shipping records only the winning tracking number and one audit', async () => {
    const attempts = await Promise.all(['TRACK-A', 'TRACK-B'].map(tracking_number => request(app).put('/api/admin/orders/10/status')
      .set(auth()).send({ status: 2, shipping_company: shipment.shipping_company, tracking_number })));
    expect(attempts.map(result => result.status).sort()).toEqual([200, 400]);
    expect(['TRACK-A', 'TRACK-B']).toContain((await order()).tracking_number); expect(await audits()).toHaveLength(1);
  });
  test.each([1, 4])('customer transition to %i keeps its existing path without admin audit', async status => {
    await db.query('UPDATE orders SET status=0 WHERE order_id=10');
    await transitionOrder(10, status, { userId: 7 });
    expect((await order()).status).toBe(status); expect(await audits()).toHaveLength(0);
  });
  test('timeout cancellation restores stock without attributing an admin audit', async () => {
    await db.query('UPDATE orders SET status=0,created_at=DATE_SUB(NOW(),INTERVAL 31 MINUTE) WHERE order_id=10');
    expect(await transitionOrder(10, OrderStatus.CANCELLED, { timeoutOnly: true })).toMatchObject({ changed: true });
    expect(await product()).toMatchObject({ stock: 7 }); expect(await audits()).toHaveLength(0);
  });
});
