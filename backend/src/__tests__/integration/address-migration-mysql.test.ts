import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { migrateAddressTables } from '../../database/migrate-address';

const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;

integration('真实 MySQL 收货地址快照旧库升级', () => {
  const database = `ecom_address_migration_test_${process.pid}`;
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
  const legacyAddress = {
    receiver_name: '历史收件人', phone: '13800138000', province: '广东省',
    city: '深圳市', district: '南山区', detail_address: '历史地址 8 号',
  };

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      schemas.set(match[2], match[1]);
    }
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    await db.query('DROP TABLE IF EXISTS orders');
    await db.query('DROP TABLE IF EXISTS shipping_addresses');
    await db.query(schemas.get('shipping_addresses')!);
    await db.query(schemas.get('orders')!.replace(/^\s*shipping_address_snapshot\b[^\n]*\n/gm, ''));
    await db.query(`INSERT INTO shipping_addresses
      (address_id,user_id,receiver_name,phone,province,city,district,detail_address,is_default)
      VALUES (2147483650,1,?,?,?,?,?,?,1),
             (20,2,'其他用户姓名','13900139000','私密省','私密市','私密区','其他用户私密地址',0),
             (30,1,'不完整旧地址','13700137000',NULL,NULL,NULL,NULL,0)`,
      Object.values(legacyAddress));
    await db.query(`INSERT INTO orders
      (order_id,order_no,user_id,total_amount,shipping_address_id,status,remark,created_at)
      VALUES (2147483650,'OWNED_BIGINT',1,42.50,2147483650,1,'历史备注','2025-01-02 03:04:05'),
             (2,'FOREIGN_ADDRESS',1,15,20,0,NULL,'2025-02-03 04:05:06'),
             (3,'MISSING_ADDRESS',1,16,999,0,NULL,'2025-03-04 05:06:07'),
             (4,'NO_ADDRESS',1,17,NULL,4,NULL,'2025-04-05 06:07:08'),
             (5,'INCOMPLETE_OWNED',1,18,30,3,NULL,'2025-05-06 07:08:09')`);
  });

  async function orders() {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM orders ORDER BY order_id');
    return rows;
  }

  test('只为本用户地址回填 canonical JSON，旧 BIGINT 和订单字段保持不变', async () => {
    const before = await orders();

    await migrateAddressTables(db);

    const after = await orders();
    const snapshots = new Map(after.map(row => [row.order_id, row.shipping_address_snapshot]));
    expect(snapshots.get(2147483650)).toEqual(legacyAddress);
    expect(snapshots.get(5)).toEqual({
      receiver_name: '不完整旧地址', phone: '13700137000',
      province: null, city: null, district: null, detail_address: null,
    });
    for (const orderId of [2, 3, 4]) expect(snapshots.get(orderId)).toBeNull();
    // Compare every historical field, including timestamps, amount, status and both BIGINT IDs.
    expect(after.map(({ shipping_address_snapshot, ...row }) => row)).toEqual(before);
    const [column] = await db.query<RowDataPacket[]>(
      `SELECT DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'shipping_address_snapshot'`
    );
    expect(column).toEqual([expect.objectContaining({ DATA_TYPE: 'json', IS_NULLABLE: 'YES' })]);
  });

  test('重复升级不受地址编辑、删除或已有快照影响，也不暴露异主地址', async () => {
    await migrateAddressTables(db);
    const manualSnapshot = {
      receiver_name: '原下单快照姓名', phone: '13600136000', province: '快照省',
      city: '快照市', district: '快照区', detail_address: '原下单快照地址',
    };
    await db.query(`INSERT INTO orders (order_id,order_no,user_id,total_amount,shipping_address_id,shipping_address_snapshot)
      VALUES (6,'EXISTING_SNAPSHOT',1,20,2147483650,?)`, [JSON.stringify(manualSnapshot)]);
    const before = await orders();
    await db.query(`UPDATE shipping_addresses SET receiver_name = '修改后的姓名', phone = '13500135000',
      province = '修改后的省', city = '修改后的市', district = '修改后的区', detail_address = '修改后的地址'
      WHERE address_id = 2147483650`);
    await db.query('DELETE FROM shipping_addresses WHERE address_id = 30');

    await migrateAddressTables(db);

    const after = await orders();
    expect(after).toEqual(before);
    expect(after.find(row => row.order_id === 2147483650)?.shipping_address_snapshot).toEqual(legacyAddress);
    expect(after.find(row => row.order_id === 6)?.shipping_address_snapshot).toEqual(manualSnapshot);
    for (const orderId of [2, 3, 4]) expect(after.find(row => row.order_id === orderId)?.shipping_address_snapshot).toBeNull();
  });

  test('新建 orders 已含 nullable JSON 快照时迁移兼容且可重跑', async () => {
    await db.query('DROP TABLE orders');
    await db.query(schemas.get('orders')!);
    const [column] = await db.query<RowDataPacket[]>(
      `SELECT DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'shipping_address_snapshot'`
    );
    expect(column).toEqual([expect.objectContaining({ DATA_TYPE: 'json', IS_NULLABLE: 'YES' })]);
    await db.query(`INSERT INTO orders (order_id,order_no,user_id,total_amount,shipping_address_id,shipping_address_snapshot)
      VALUES (1,'FRESH_OWNED',1,10,2147483650,NULL),(2,'FRESH_SNAPSHOT',1,20,2147483650,?)`,
      [JSON.stringify({ ...legacyAddress, receiver_name: '已经保存的姓名' })]);

    await migrateAddressTables(db);
    const first = await orders();
    await migrateAddressTables(db);

    expect(await orders()).toEqual(first);
    expect(first[0].shipping_address_snapshot).toEqual(legacyAddress);
    expect(first[1].shipping_address_snapshot).toEqual({ ...legacyAddress, receiver_name: '已经保存的姓名' });
  });
});
