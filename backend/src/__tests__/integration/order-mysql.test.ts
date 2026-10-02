import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { createOrder, transitionOrder } from '../../services/order.service';
import { cancelTimeoutOrder } from '../../services/order-timeout.service';
import { OrderStatus } from '../../models/order.model';
import { getAdminOrderDetail } from '../../controllers/admin-order.controller';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ del: jest.fn().mockResolvedValue(1) }) }));

// Opt-in only. Each run creates and drops its own database, never the application's DB_NAME.
const enabled = Boolean(process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST);
const integration = enabled ? describe : describe.skip;
integration('真实 MySQL 订单事务及并发', () => {
  const database = `ecommerce_order_test_${process.pid}`;
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const connectionOptions = {
    ...(process.env.MYSQL_TEST_SOCKET
      ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root',
    password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00',
    connectionLimit: 8,
  };

  beforeAll(async () => {
    server = mysql.createPool(connectionOptions);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    databaseCreated = true;
    db = mysql.createPool({ ...connectionOptions, database });
    (getPool as jest.Mock).mockReturnValue(db);
    // Use the project's actual base schema, so stale SQL column names fail here.
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const tables = new Set(['users', 'products', 'orders', 'order_items', 'cart', 'shipping_addresses']);
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (tables.has(match[2])) await db.query(match[1]);
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
    for (const table of ['order_items', 'orders', 'cart', 'shipping_addresses', 'products', 'users']) {
      await db.query(`DELETE FROM ${table}`);
    }
    await db.query("INSERT INTO products (product_id,title,price,stock) VALUES (1,'商品一',10.10,10),(2,'商品二',5,1)");
  });

  async function product() {
    const [rows] = await db.query<RowDataPacket[]>('SELECT stock, sales_count FROM products WHERE product_id = 1');
    return rows[0];
  }
  async function state(orderId: number) {
    const [rows] = await db.query<RowDataPacket[]>('SELECT status FROM orders WHERE order_id = ?', [orderId]);
    return rows[0].status;
  }
  async function expiredOrder() {
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 2 }]);
    await db.query('UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 31 MINUTE) WHERE order_id = ?', [orderId]);
    return orderId;
  }

  test('重复商品合并并按数据库价格结算、清理购物车', async () => {
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,4),(1,2,1)');
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 2, price: 0 }, { product_id: 1, quantity: 2 }]);
    const [items] = await db.query<RowDataPacket[]>('SELECT quantity,price FROM order_items WHERE order_id = ?', [orderId]);
    const [orders] = await db.query<RowDataPacket[]>('SELECT total_amount FROM orders WHERE order_id = ?', [orderId]);
    const [cart] = await db.query<RowDataPacket[]>('SELECT product_id FROM cart WHERE user_id = 1');
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4);
    expect(orders[0].total_amount).toBe('40.40');
    expect(await product()).toMatchObject({ stock: 6 });
    expect(cart.map(item => item.product_id)).toEqual([2]);
  });

  test('多个用户争抢库存只有一个订单成功', async () => {
    await db.query('UPDATE products SET stock = 5 WHERE product_id = 1');
    const results = await Promise.allSettled([
      createOrder(1, [{ product_id: 1, quantity: 4 }]),
      createOrder(2, [{ product_id: 1, quantity: 4 }]),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await product()).toMatchObject({ stock: 1 });
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    expect(orders[0].count).toBe(1);
  });

  test('明细写入失败回滚已写订单、扣减库存及购物车', async () => {
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,2)');
    await db.query("CREATE TRIGGER test_item_failure BEFORE INSERT ON order_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected item failure'");
    try {
      await expect(createOrder(1, [{ product_id: 1, quantity: 2 }])).rejects.toThrow('injected item failure');
      expect(await product()).toMatchObject({ stock: 10 });
      const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
      const [cart] = await db.query<RowDataPacket[]>('SELECT quantity FROM cart WHERE user_id = 1');
      expect(orders[0].count).toBe(0);
      expect(cart[0].quantity).toBe(2);
    } finally { await db.query('DROP TRIGGER test_item_failure'); }
  });

  test('手动取消与超时消息并发只恢复一次库存', async () => {
    const orderId = await expiredOrder();
    await Promise.allSettled([
      transitionOrder(orderId, OrderStatus.CANCELLED, { userId: 1 }),
      cancelTimeoutOrder(orderId), cancelTimeoutOrder(orderId),
    ]);
    expect(await state(orderId)).toBe(OrderStatus.CANCELLED);
    expect(await product()).toMatchObject({ stock: 10, sales_count: 0 });
    expect(await cancelTimeoutOrder(orderId)).toBe(false);
  });

  test('支付与超时取消并发保持订单、库存和销量一致', async () => {
    const orderId = await expiredOrder();
    await Promise.allSettled([
      transitionOrder(orderId, OrderStatus.PAID, { userId: 1 }),
      cancelTimeoutOrder(orderId),
    ]);
    const status = await state(orderId);
    expect([OrderStatus.PAID, OrderStatus.CANCELLED]).toContain(status);
    expect(await product()).toMatchObject(status === OrderStatus.PAID
      ? { stock: 8, sales_count: 2 } : { stock: 10, sales_count: 0 });
  });

  test('重复支付不重复计销量，已支付订单不再允许取消', async () => {
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 2 }]);
    const results = await Promise.allSettled([
      transitionOrder(orderId, OrderStatus.PAID, { userId: 1 }),
      transitionOrder(orderId, OrderStatus.PAID, { userId: 1 }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(transitionOrder(orderId, OrderStatus.CANCELLED, { userId: 1 })).rejects.toThrow();
    expect(await product()).toMatchObject({ stock: 8, sales_count: 2 });
  });

  test('未到期订单不会被提前超时取消', async () => {
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 2 }]);
    expect(await cancelTimeoutOrder(orderId)).toBe(false);
    expect(await state(orderId)).toBe(OrderStatus.PENDING);
    expect(await product()).toMatchObject({ stock: 8 });
  });

  test('不能使用其他用户的收货地址', async () => {
    await db.query("INSERT INTO shipping_addresses (address_id,user_id,receiver_name,phone) VALUES (1,2,'收件人','12345678901')");
    await expect(createOrder(1, [{ product_id: 1, quantity: 1 }], 1)).rejects.toThrow('收货地址');
    expect(await product()).toMatchObject({ stock: 10 });
  });

  test('支付、发货、完成写入基线时间字段并禁止回退', async () => {
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 1 }]);
    await transitionOrder(orderId, OrderStatus.PAID, { userId: 1 });
    await transitionOrder(orderId, OrderStatus.SHIPPED);
    await transitionOrder(orderId, OrderStatus.COMPLETED, { userId: 1 });
    await expect(transitionOrder(orderId, OrderStatus.PENDING)).rejects.toThrow();
    const [orders] = await db.query<RowDataPacket[]>('SELECT status,paid_at,shipped_at,completed_at FROM orders WHERE order_id = ?', [orderId]);
    expect(orders[0].status).toBe(OrderStatus.COMPLETED);
    for (const key of ['paid_at', 'shipped_at', 'completed_at']) expect(orders[0][key]).toBeInstanceOf(Date);
    expect(await product()).toMatchObject({ stock: 9, sales_count: 1 });
  });

  test('后台订单详情可读取基线收货地址字段', async () => {
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'customer','customer@example.test','test')");
    await db.query("INSERT INTO shipping_addresses (address_id,user_id,receiver_name,phone,detail_address) VALUES (1,1,'收件人','12345678901','测试地址')");
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 1 }], 1);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getAdminOrderDetail({ params: { orderId: String(orderId) } } as any, res as any);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.objectContaining({ receiver_name: '收件人', detail_address: '测试地址' }),
      items: expect.arrayContaining([expect.objectContaining({ product_id: 1, quantity: 1 })]),
    }));
  });
});
