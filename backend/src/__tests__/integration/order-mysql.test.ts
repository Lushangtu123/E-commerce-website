import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool } from '../../database/mysql';
import { createOrder, previewOrder, transitionOrder } from '../../services/order.service';
import { CouponModel, CouponType } from '../../models/coupon.model';
import { cancelTimeoutOrder } from '../../services/order-timeout.service';
import { OrderStatus } from '../../models/order.model';
import { getAdminOrderDetail } from '../../controllers/admin-order.controller';
import { OrderController } from '../../controllers/order.controller';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import orderRoutes from '../../routes/order.routes';
import { migrateCouponTables } from '../../database/migrate-coupon';

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
    await migrateCouponTables(db);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    for (const table of ['coupon_usage_logs', 'user_coupons', 'coupons', 'order_items', 'orders', 'cart', 'shipping_addresses', 'products', 'users']) {
      await db.query(`DELETE FROM ${table}`);
    }
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'customer','customer@example.test','test')");
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
  async function receivedCoupon() {
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,min_amount,total_quantity,remain_quantity,start_time,end_time)
      VALUES (1,'SAVE20','八折优惠',2,20,0,10,9,DATE_SUB(NOW(), INTERVAL 1 DAY),DATE_ADD(NOW(), INTERVAL 1 DAY))`);
    await db.query('INSERT INTO user_coupons (user_coupon_id,user_id,coupon_id,expired_at) VALUES (1,1,1,DATE_ADD(NOW(), INTERVAL 1 DAY))');
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

  test('下单按服务器金额优惠并占用用户领取的券，金额与券绑定一起提交', async () => {
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,min_amount,total_quantity,remain_quantity,start_time,end_time)
      VALUES (1,'SAVE20','八折优惠',2,20,0,10,9,DATE_SUB(NOW(), INTERVAL 1 DAY),DATE_ADD(NOW(), INTERVAL 1 DAY))`);
    await db.query('INSERT INTO user_coupons (user_coupon_id,user_id,coupon_id,expired_at) VALUES (1,1,1,DATE_ADD(NOW(), INTERVAL 1 DAY))');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await OrderController.create({ userId: 1, body: {
      items: [{ product_id: 1, quantity: 2 }], user_coupon_id: 1, discount_amount: 10000, total_amount: 0,
    } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    const orderId = res.json.mock.calls[0][0].order_id;
    const [orders] = await db.query<RowDataPacket[]>('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    expect(orders[0].total_amount).toBe('16.16');
    expect(orders[0].original_amount).toBe('20.20');
    expect(orders[0].discount_amount).toBe('4.04');
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons WHERE user_coupon_id = 1');
    expect(coupons[0]).toMatchObject({ status: 2, order_id: orderId });
  });

  test('订单预览使用服务器商品价和有效券，不占库存、购物车或券', async () => {
    await db.query(`INSERT INTO coupons (coupon_id,code,name,type,discount_value,min_amount,total_quantity,remain_quantity,start_time,end_time)
      VALUES (1,'SAVE20','八折优惠',2,20,0,10,9,DATE_SUB(NOW(), INTERVAL 1 DAY),DATE_ADD(NOW(), INTERVAL 1 DAY))`);
    await db.query('INSERT INTO user_coupons (user_coupon_id,user_id,coupon_id,expired_at) VALUES (1,1,1,DATE_ADD(NOW(), INTERVAL 1 DAY))');
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,2)');
    const app = express();
    app.use(express.json());
    app.use('/orders', orderRoutes);
    const token = jwt.sign({ userId: 1 }, 'test-jwt-secret');
    const res = await request(app).post('/orders/preview').set('Authorization', `Bearer ${token}`).send({
      items: [{ product_id: 1, quantity: 2, price: 0 }], user_coupon_id: 1, discount_amount: 10000,
    }).expect(200);
    expect(res.body).toMatchObject({ original_amount: 20.20, discount_amount: 4.04, total_amount: 16.16, coupon: { user_coupon_id: 1, name: '八折优惠' } });
    expect(res.body.available_coupons).toHaveLength(1);
    expect(await product()).toMatchObject({ stock: 10 });
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons WHERE user_coupon_id = 1');
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    const [cart] = await db.query<RowDataPacket[]>('SELECT quantity FROM cart WHERE user_id = 1');
    expect(coupons[0]).toMatchObject({ status: 1, order_id: null });
    expect(orders[0].count).toBe(0);
    expect(cart[0].quantity).toBe(2);
  });

  test('同券并发购买不同商品只成功一次，失败订单不动库存或购物车', async () => {
    await receivedCoupon();
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,1),(1,2,1)');
    const results = await Promise.allSettled([
      createOrder(1, [{ product_id: 1, quantity: 1 }], undefined, undefined, 1),
      createOrder(1, [{ product_id: 2, quantity: 1 }], undefined, undefined, 1),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [orders] = await db.query<RowDataPacket[]>('SELECT order_id FROM orders');
    const [items] = await db.query<RowDataPacket[]>('SELECT product_id FROM order_items');
    const [stock] = await db.query<RowDataPacket[]>('SELECT product_id,stock FROM products ORDER BY product_id');
    const [cart] = await db.query<RowDataPacket[]>('SELECT product_id FROM cart');
    const [logs] = await db.query<RowDataPacket[]>('SELECT order_id FROM coupon_usage_logs');
    expect(orders).toHaveLength(1);
    expect(items).toHaveLength(1);
    expect(logs).toEqual([expect.objectContaining({ order_id: orders[0].order_id })]);
    expect(stock.map(row => row.stock)).toEqual(items[0].product_id === 1 ? [9, 1] : [10, 0]);
    expect(cart.map(row => row.product_id)).toEqual([items[0].product_id === 1 ? 2 : 1]);
  });

  test('用券订单明细失败完整回滚金额、券绑定、日志、库存与购物车', async () => {
    await receivedCoupon();
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,2)');
    await db.query("CREATE TRIGGER test_coupon_failure BEFORE INSERT ON order_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected coupon failure'");
    try {
      await expect(createOrder(1, [{ product_id: 1, quantity: 2 }], undefined, undefined, 1)).rejects.toThrow('injected coupon failure');
      const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id,used_at FROM user_coupons');
      const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
      const [logs] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coupon_usage_logs');
      const [cart] = await db.query<RowDataPacket[]>('SELECT quantity FROM cart');
      expect(coupons[0]).toMatchObject({ status: 1, order_id: null, used_at: null });
      expect(orders[0].count).toBe(0);
      expect(logs[0].count).toBe(0);
      expect(await product()).toMatchObject({ stock: 10 });
      expect(cart[0].quantity).toBe(2);
    } finally { await db.query('DROP TRIGGER test_coupon_failure'); }
  });

  test('取消与超时仅返券一次，复用后旧订单取消不影响新绑定及金额快照', async () => {
    await receivedCoupon();
    const first = await createOrder(1, [{ product_id: 1, quantity: 2 }], undefined, undefined, 1);
    await db.query('UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 31 MINUTE) WHERE order_id = ?', [first.orderId]);
    await Promise.allSettled([
      transitionOrder(first.orderId, OrderStatus.CANCELLED, { userId: 1 }),
      cancelTimeoutOrder(first.orderId), cancelTimeoutOrder(first.orderId),
    ]);
    expect(await product()).toMatchObject({ stock: 10 });
    const [returned] = await db.query<RowDataPacket[]>('SELECT status,order_id,used_at FROM user_coupons');
    expect(returned[0]).toMatchObject({ status: 1, order_id: null, used_at: null });
    await db.query("UPDATE coupons SET name = '新的券名' WHERE coupon_id = 1");
    const second = await createOrder(1, [{ product_id: 1, quantity: 1 }], undefined, undefined, 1);
    expect(await cancelTimeoutOrder(first.orderId)).toBe(false);
    await expect(transitionOrder(first.orderId, OrderStatus.CANCELLED, { userId: 1 })).rejects.toThrow();
    const [bound] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons');
    const [logs] = await db.query<RowDataPacket[]>('SELECT order_id FROM coupon_usage_logs ORDER BY log_id');
    const [orders] = await db.query<RowDataPacket[]>('SELECT original_amount,discount_amount,total_amount,coupon_name FROM orders WHERE order_id = ?', [first.orderId]);
    const [definitions] = await db.query<RowDataPacket[]>('SELECT remain_quantity FROM coupons');
    expect(bound[0]).toMatchObject({ status: 2, order_id: second.orderId });
    expect(logs.map(row => row.order_id)).toEqual([first.orderId, second.orderId]);
    expect(orders[0]).toMatchObject({ original_amount: '20.20', discount_amount: '4.04', total_amount: '16.16', coupon_name: '八折优惠' });
    expect(definitions[0].remain_quantity).toBe(9);
  });

  test.each([
    ['用户券过期', 'UPDATE user_coupons SET expired_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)'],
    ['券定义过期', 'UPDATE coupons SET end_time = DATE_SUB(NOW(), INTERVAL 1 SECOND)'],
  ])('取消时%s返为过期券', async (_label, sql) => {
    await receivedCoupon();
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 1 }], undefined, undefined, 1);
    await db.query(sql);
    await transitionOrder(orderId, OrderStatus.CANCELLED, { userId: 1 });
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id,used_at FROM user_coupons');
    expect(coupons[0]).toMatchObject({ status: 3, order_id: null, used_at: null });
  });

  test('支付与超时取消竞争时券状态与订单同步', async () => {
    await receivedCoupon();
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 1 }], undefined, undefined, 1);
    await db.query('UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 31 MINUTE) WHERE order_id = ?', [orderId]);
    await Promise.allSettled([transitionOrder(orderId, OrderStatus.PAID, { userId: 1 }), cancelTimeoutOrder(orderId)]);
    const status = await state(orderId);
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons');
    expect(coupons[0]).toMatchObject(status === OrderStatus.PAID ? { status: 2, order_id: orderId } : { status: 1, order_id: null });
    expect(await product()).toMatchObject(status === OrderStatus.PAID ? { stock: 9, sales_count: 1 } : { stock: 10, sales_count: 0 });
  });

  test.each([
    ['已禁用', 'UPDATE coupons SET status = 0', ''],
    ['未生效', 'UPDATE coupons SET start_time = DATE_ADD(NOW(), INTERVAL 1 HOUR)', ''],
    ['已过期', 'UPDATE coupons SET end_time = DATE_SUB(NOW(), INTERVAL 1 SECOND)', ''],
    ['用户券过期', 'UPDATE user_coupons SET expired_at = DATE_SUB(NOW(), INTERVAL 1 SECOND)', ''],
    ['非本人券', "INSERT INTO users (user_id,username,email,password_hash) VALUES (2,'other','other@example.test','test')", 'UPDATE user_coupons SET user_id = 2'],
    ['已占用', 'UPDATE user_coupons SET status = 2, order_id = 999', ''],
    ['未满门槛', 'UPDATE coupons SET min_amount = 99', ''],
  ])('预览与下单均拒绝%s，失败没有副作用', async (_label, sql, extra) => {
    await receivedCoupon();
    await db.query(sql);
    if (extra) await db.query(extra);
    await expect(previewOrder(1, [{ product_id: 1, quantity: 1 }], 1)).rejects.toThrow();
    await expect(createOrder(1, [{ product_id: 1, quantity: 1 }], undefined, undefined, 1)).rejects.toThrow();
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    expect(orders[0].count).toBe(0);
    expect(await product()).toMatchObject({ stock: 10 });
  });

  test('预览后价格改变按下单时服务器价格重算，已禁用券不会静默原价下单', async () => {
    await receivedCoupon();
    expect(await previewOrder(1, [{ product_id: 1, quantity: 1 }], 1)).toMatchObject({ total_amount: 8.08 });
    await db.query('UPDATE products SET price = 20 WHERE product_id = 1');
    expect(await createOrder(1, [{ product_id: 1, quantity: 1 }], undefined, undefined, 1)).toMatchObject({ original_amount: 20, discount_amount: 4, total_amount: 16 });
    const [before] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    await db.query('UPDATE coupons SET status = 0');
    await expect(createOrder(1, [{ product_id: 2, quantity: 1 }], undefined, undefined, 1)).rejects.toThrow();
    const [after] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    expect(after[0].count).toBe(before[0].count);
  });

  test('真实驱动创建省略可选字段的券并分页查询', async () => {
    const couponId = await CouponModel.create({ code: 'MINIMAL', name: '测试券', type: CouponType.NO_THRESHOLD,
      discount_value: 1, total_quantity: 10, start_time: new Date(Date.now() - 60000), end_time: new Date(Date.now() + 60000) });
    const list = await CouponModel.getList({ page: 1, page_size: 1, available_only: true });
    expect(list.total).toBe(1);
    expect(list.coupons[0]).toMatchObject({ coupon_id: couponId, min_amount: '0.00', max_discount: null, per_user_limit: 1, status: 1 });
  });

  test('同用户并发领取不超限且发行余量只扣一次', async () => {
    await receivedCoupon();
    await db.query('DELETE FROM user_coupons');
    const results = await Promise.allSettled([CouponModel.receiveCoupon(1, 1), CouponModel.receiveCoupon(1, 1)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [definitions] = await db.query<RowDataPacket[]>('SELECT remain_quantity FROM coupons');
    const [received] = await db.query<RowDataPacket[]>('SELECT user_coupon_id FROM user_coupons');
    expect(definitions[0].remain_quantity).toBe(8);
    expect(received).toHaveLength(1);
  });
});
