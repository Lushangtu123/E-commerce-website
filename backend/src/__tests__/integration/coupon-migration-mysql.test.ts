import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { migrateCouponTables } from '../../database/migrate-coupon';

const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;

integration('真实 MySQL 优惠券旧库升级', () => {
  const database = `ecommerce_coupon_migration_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET
      ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00',
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    // Deliberately recreate the previous release's orders and INT coupon bindings.
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (match[2] === 'users' || match[2] === 'orders') {
        const schema = match[1].replace(/^\s*(original_amount|discount_amount|user_coupon_id|coupon_name|coupon_code)[^\n]*\n/gm, '');
        await db.query(schema);
      }
    }
    const couponSource = fs.readFileSync(path.join(__dirname, '../../database/migrate-coupon.ts'), 'utf8');
    for (const match of couponSource.matchAll(/`(\s*CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      await db.query(match[1].replace(/order_id BIGINT/g, 'order_id INT'));
    }
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'legacy','legacy@example.test','test')");
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,status) VALUES (1,'LEGACY',1,42.50,1)");
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,total_quantity,remain_quantity,start_time,end_time)
      VALUES (1,'LEGACY','历史券',1,5,10,9,DATE_SUB(NOW(), INTERVAL 1 DAY),DATE_ADD(NOW(), INTERVAL 1 DAY))`);
    await db.query('INSERT INTO user_coupons (user_coupon_id,user_id,coupon_id,status,used_at,order_id,expired_at) VALUES (1,1,1,2,NOW(),1,DATE_ADD(NOW(), INTERVAL 1 DAY))');
    await db.query('INSERT INTO coupon_usage_logs (user_id,coupon_id,user_coupon_id,order_id,discount_amount,order_amount) VALUES (1,1,1,1,5,47.50)');
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  test('增量升级与重复执行保留旧订单、已用券及日志，并兼容 BIGINT 订单ID', async () => {
    await migrateCouponTables(db);
    const [orders] = await db.query<RowDataPacket[]>('SELECT * FROM orders WHERE order_id = 1');
    expect(orders[0]).toMatchObject({ order_no: 'LEGACY', total_amount: '42.50', original_amount: '42.50', discount_amount: '0.00', user_coupon_id: null, status: 1 });
    const [used] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons');
    const [logs] = await db.query<RowDataPacket[]>('SELECT * FROM coupon_usage_logs');
    const [definitions] = await db.query<RowDataPacket[]>('SELECT * FROM coupons');
    // Re-running must not rewrite a new order's recorded discount or consume another coupon.
    await db.query("INSERT INTO orders (order_id,order_no,user_id,total_amount,original_amount,discount_amount,user_coupon_id,coupon_name,coupon_code) VALUES (2147483650,'NEW',1,8,10,2,1,'快照券','SNAPSHOT')");
    await db.query('UPDATE user_coupons SET order_id = 2147483650');
    await db.query('UPDATE coupon_usage_logs SET order_id = 2147483650');
    await migrateCouponTables(db);
    const [second] = await db.query<RowDataPacket[]>('SELECT original_amount,discount_amount,total_amount,coupon_name FROM orders WHERE order_id = 2147483650');
    const [usedAgain] = await db.query<RowDataPacket[]>('SELECT * FROM user_coupons');
    const [logsAgain] = await db.query<RowDataPacket[]>('SELECT * FROM coupon_usage_logs');
    const [definitionsAgain] = await db.query<RowDataPacket[]>('SELECT * FROM coupons');
    expect(second[0]).toMatchObject({ original_amount: '10.00', discount_amount: '2.00', total_amount: '8.00', coupon_name: '快照券' });
    expect(usedAgain).toEqual(used.map(row => ({ ...row, order_id: 2147483650 })));
    expect(logsAgain).toEqual(logs.map(row => ({ ...row, order_id: 2147483650 })));
    expect(definitionsAgain).toEqual(definitions);
  });
});
