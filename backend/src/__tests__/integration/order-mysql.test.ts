import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { createOrder as createOrderService, previewOrder, transitionOrder } from '../../services/order.service';
import { ProductModel } from '../../models/product.model';
import { FavoriteModel } from '../../models/favorite.model';
import { BrowseHistoryModel } from '../../models/browse-history.model';
import { SKUModel } from '../../models/sku.model';
import { CouponModel, CouponType } from '../../models/coupon.model';
import { cancelTimeoutOrder } from '../../services/order-timeout.service';
import { OrderStatus } from '../../models/order.model';
import { getAdminOrderDetail } from '../../controllers/admin-order.controller';
import { OrderController } from '../../controllers/order.controller';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import orderRoutes from '../../routes/order.routes';
import cartRoutes from '../../routes/cart.routes';
import { migrateSkuTables } from '../../database/migrate-sku';
import { migrateCouponTables } from '../../database/migrate-coupon';
import { migrateAddressTables } from '../../database/migrate-address';
import addressRoutes from '../../routes/address.routes';
import { AddressModel } from '../../models/address.model';

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
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    // Use the project's actual base schema, so stale SQL column names fail here.
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const tables = new Set(['users', 'products', 'product_skus', 'orders', 'order_items', 'cart', 'favorites', 'browse_history', 'shipping_addresses']);
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (tables.has(match[2])) await db.query(match[1]);
    }
    await migrateCouponTables(db);
    await migrateSkuTables(db);
    await migrateAddressTables(db);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(async () => {
    for (const table of ['coupon_usage_logs', 'user_coupons', 'coupons', 'order_items', 'orders', 'cart', 'favorites', 'browse_history', 'shipping_addresses', 'product_skus', 'products', 'users']) {
      await db.query(`DELETE FROM ${table}`);
    }
    await db.query("INSERT INTO users (user_id,username,email,password_hash) VALUES (1,'customer','customer@example.test','test'),(2,'other','other@example.test','test')");
    await db.query(`INSERT INTO shipping_addresses (address_id,user_id,receiver_name,phone,province,city,district,detail_address,is_default)
      VALUES (101,1,'收件人','13800138000','浙江省','杭州市','西湖区','测试路1号',1),
             (102,2,'其他收件人','13800138001','浙江省','杭州市','滨江区','测试路2号',1)`);
    await db.query("INSERT INTO products (product_id,title,price,stock) VALUES (1,'商品一',10.10,10),(2,'商品二',5,1)");
  });

  // Existing inventory/coupon tests use valid persisted addresses; no order behavior is mocked.
  const createOrder = (userId: number, items: unknown, addressId = 100 + userId, remark?: string, couponId?: number) =>
    createOrderService(userId, items, addressId, remark, couponId);
  const ADDRESS = { receiver_name: '收件人', phone: '13800138000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '测试路1号' };

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

  test('无地址、他人地址及过期选择拒绝下单，券库存购物车完全保留', async () => {
    await receivedCoupon();
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,2)');
    const app = express();
    app.use(express.json());
    app.use('/orders', orderRoutes);
    const token = jwt.sign({ userId: 1 }, 'test-jwt-secret');
    for (const addressId of [undefined, null, '101', 0, -1, 102, 999]) {
      await request(app).post('/orders').set('Authorization', `Bearer ${token}`).send({
        items: [{ product_id: 1, quantity: 2 }], shipping_address_id: addressId, user_coupon_id: 1,
      }).expect(400);
    }
    expect(await product()).toMatchObject({ stock: 10, sales_count: 0 });
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    const [cart] = await db.query<RowDataPacket[]>('SELECT quantity FROM cart WHERE user_id = 1');
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons WHERE user_coupon_id = 1');
    expect(orders[0].count).toBe(0);
    expect(cart[0].quantity).toBe(2);
    expect(coupons[0]).toMatchObject({ status: 1, order_id: null });
  });

  test('新订单保存本人地址快照，修改和删除地址不改变客户和后台订单详情', async () => {
    const app = express();
    app.use(express.json());
    app.use('/orders', orderRoutes);
    app.use('/addresses', addressRoutes);
    const auth = { Authorization: `Bearer ${jwt.sign({ userId: 1 }, 'test-jwt-secret')}` };
    const created = await request(app).post('/orders').set(auth).send({
      items: [{ product_id: 1, quantity: 1 }], shipping_address_id: 101,
      shipping_address_snapshot: { ...ADDRESS, receiver_name: '客户端伪造的收件人' },
    }).expect(201);
    const orderId = created.body.order_id;
    await request(app).put('/addresses/101').set(auth).send({
      ...ADDRESS, receiver_name: '改后收件人', phone: '13800138099', detail_address: '改后的路99号',
    }).expect(200);
    await request(app).delete('/addresses/101').set(auth).expect(200);
    const detail = await request(app).get(`/orders/${orderId}`).set(auth).expect(200);
    expect(detail.body.order.shipping_address_snapshot).toEqual(ADDRESS);
    expect(detail.body.order.shipping_address_id).toBe(101);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getAdminOrderDetail({ params: { orderId: String(orderId) } } as any, res as any);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order: expect.objectContaining({
      shipping_address_snapshot: ADDRESS, receiver_name: ADDRESS.receiver_name, recipient_phone: ADDRESS.phone, detail_address: ADDRESS.detail_address,
    }) }));
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM shipping_addresses WHERE address_id = 101');
    expect(rows).toHaveLength(0);
  });

  test('旧订单缺失快照不回读他人的当前地址，仍可取消', async () => {
    const { orderId } = await createOrder(1, [{ product_id: 1, quantity: 1 }]);
    await db.query('UPDATE orders SET shipping_address_snapshot = NULL, shipping_address_id = 102 WHERE order_id = ?', [orderId]);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await getAdminOrderDetail({ params: { orderId: String(orderId) } } as any, res as any);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order: expect.objectContaining({
      shipping_address_snapshot: null, receiver_name: null, recipient_phone: null, detail_address: null,
    }) }));
    await transitionOrder(orderId, OrderStatus.CANCELLED, { userId: 1 });
    expect(await product()).toMatchObject({ stock: 10 });
  });

  test('已有不完整地址需编辑后才能下新订单，预览仍只读', async () => {
    await db.query('UPDATE shipping_addresses SET district = NULL WHERE address_id = 101');
    expect(await previewOrder(1, [{ product_id: 1, quantity: 1 }])).toMatchObject({ total_amount: 10.1 });
    await expect(createOrderService(1, [{ product_id: 1, quantity: 1 }], 101)).rejects.toThrow('地址信息');
    expect(await product()).toMatchObject({ stock: 10 });
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    expect(orders[0].count).toBe(0);
  });

  test('同用户下单、编辑地址和再次领券同时进行均可完成，不形成外键锁死锁', async () => {
    await receivedCoupon();
    await db.query('UPDATE coupons SET per_user_limit = 2 WHERE coupon_id = 1');
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      return { promise, resolve };
    };
    const requested = Array.from({ length: 3 }, deferred);
    const acquired = Array.from({ length: 3 }, deferred);
    const release = deferred();
    const firstResources: string[] = [];
    let connections = 0;
    (getPool as jest.Mock).mockReturnValue({ getConnection: async () => {
      const role = connections++;
      const connection = await db.getConnection();
      let firstLock = true;
      return new Proxy(connection, { get(target, property) {
        if (property === 'execute') return async (sql: string, params: any[]) => {
          const initial = firstLock && sql.includes('FOR UPDATE');
          if (initial) {
            firstLock = false;
            firstResources[role] = `${/FROM\s+(\w+)/i.exec(sql)?.[1]}:${params[0]}`;
            requested[role].resolve();
          }
          const result = await target.execute(sql, params);
          if (initial) { acquired[role].resolve(); await release.promise; }
          return result;
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    } });
    let outcomes: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const order = createOrder(1, [{ product_id: 1, quantity: 1 }], 101, undefined, 1);
      await acquired[0].promise;
      const edit = AddressModel.update(1, 101, { ...ADDRESS, detail_address: '编辑后的地址' });
      await requested[1].promise;
      const claim = CouponModel.receiveCoupon(1, 1);
      outcomes = Promise.allSettled([order, edit, claim]);
      await requested[2].promise;
      // Distinct initial locks can all be held before continuing; shared initial locks serialize.
      // This schedules the former address -> coupon -> user cycle without timing sleeps.
      if (new Set(firstResources).size === 3) await Promise.all(acquired.map(event => event.promise));
      release.resolve();
      const results = await outcomes;
      expect(results.map(result => result.status === 'rejected' ? `rejected:${result.reason.code}` : result.status))
        .toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
      (getPool as jest.Mock).mockReturnValue(db);
      const [orders] = await db.query<RowDataPacket[]>('SELECT shipping_address_snapshot,total_amount FROM orders');
      const [coupons] = await db.query<RowDataPacket[]>('SELECT status FROM user_coupons ORDER BY user_coupon_id');
      const addresses = await AddressModel.list(1);
      expect(orders).toEqual([expect.objectContaining({ shipping_address_snapshot: ADDRESS, total_amount: '8.08' })]);
      expect(coupons.map(coupon => coupon.status)).toEqual([2, 1]);
      expect(addresses[0]).toMatchObject({ detail_address: '编辑后的地址', is_default: true });
      expect(await product()).toMatchObject({ stock: 9 });
    } finally {
      release.resolve();
      if (outcomes) await outcomes;
      (getPool as jest.Mock).mockReturnValue(db);
    }
  });

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
    await db.query("INSERT INTO shipping_addresses (address_id,user_id,receiver_name,phone,province,city,district,detail_address) VALUES (1,1,'收件人','12345678901','浙江省','杭州市','西湖区','测试地址')");
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
      items: [{ product_id: 1, quantity: 2 }], shipping_address_id: 101, user_coupon_id: 1, discount_amount: 10000, total_amount: 0,
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
    ['非本人券', 'UPDATE user_coupons SET user_id = 2', ''],
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

  test('SKU下单采用所选规格的服务器价格与库存，保留规格快照', async () => {
    await db.query(`INSERT INTO product_skus (sku_id,product_id,sku_code,specs,price,stock)
      VALUES (1,1,'RED-M','{"颜色":"红色","尺寸":"M"}',15,3)`);
    const result = await createOrder(1, [{ product_id: 1, sku_id: 1, quantity: 2, price: 0 }]);
    expect(result).toMatchObject({ original_amount: 30, discount_amount: 0, total_amount: 30 });
    const [stock] = await db.query<RowDataPacket[]>('SELECT stock FROM product_skus WHERE sku_id = 1');
    const [items] = await db.query<RowDataPacket[]>('SELECT sku_id,sku_code,sku_specs,price,quantity FROM order_items WHERE order_id = ?', [result.orderId]);
    expect(stock[0].stock).toBe(1);
    expect(await product()).toMatchObject({ stock: 10 });
    expect(items[0]).toMatchObject({ sku_id: 1, sku_code: 'RED-M', sku_specs: { 颜色: '红色', 尺寸: 'M' }, price: '15.00', quantity: 2 });
  });

  async function variants() {
    await db.query(`INSERT INTO product_skus (sku_id,product_id,sku_code,specs,price,stock,image)
      VALUES (1,1,'RED-M','{"颜色":"红色","尺寸":"M"}',15,3,'red.jpg'),
             (2,1,'BLUE-L','{"颜色":"蓝色","尺寸":"L"}',25,2,'blue.jpg')`);
  }

  function cartApp() {
    const app = express(); app.use(express.json()); app.use('/cart', cartRoutes);
    return app;
  }
  const cartAuth = () => ({ Authorization: `Bearer ${jwt.sign({ userId: 1 }, 'test-jwt-secret')}` });

  test('SKU购物车新增、更新、删除按规格隔离，累计数量不能超过库存', async () => {
    await variants();
    await db.query('UPDATE products SET stock = 0 WHERE product_id = 1');
    const app = cartApp(); const auth = cartAuth();
    await request(app).post('/cart').set(auth).send({ product_id: 1, sku_id: 1, quantity: 1 }).expect(200);
    await request(app).post('/cart').set(auth).send({ product_id: 1, sku_id: 2, quantity: 1 }).expect(200);
    const listed = await request(app).get('/cart').set(auth).expect(200);
    expect(listed.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku_id: 1, price: '15.00', stock: 3, available: true, main_image: 'red.jpg', sku_specs: { 颜色: '红色', 尺寸: 'M' } }),
      expect.objectContaining({ sku_id: 2, price: '25.00', stock: 2, available: true }),
    ]));
    await request(app).put('/cart').set(auth).send({ product_id: 1, sku_id: 1, quantity: 2 }).expect(200);
    await request(app).post('/cart').set(auth).send({ product_id: 1, sku_id: 1, quantity: 2 }).expect(400);
    await db.query('INSERT INTO cart (user_id,product_id,quantity) VALUES (1,1,7)');
    await request(app).delete('/cart/1').set(auth).expect(200);
    const [rows] = await db.query<RowDataPacket[]>('SELECT sku_id,quantity FROM cart ORDER BY sku_id');
    expect(rows.map(row => [row.sku_id,row.quantity])).toEqual([[1,2],[2,1]]);
    await request(app).delete('/cart/1?sku_id=1').set(auth).expect(200);
    const [remaining] = await db.query<RowDataPacket[]>('SELECT sku_id FROM cart');
    expect(remaining.map(row => row.sku_id)).toEqual([2]);
  });

  test('同SKU合并、不同SKU保持两明细，预览和用券按规格总价结算', async () => {
    await variants(); await receivedCoupon();
    await db.query('UPDATE products SET stock = 0 WHERE product_id = 1');
    const items = [{ product_id: 1, sku_id: 2, quantity: 1 }, { product_id: 1, sku_id: 1, quantity: 1 }, { product_id: 1, sku_id: 1, quantity: 1 }];
    expect(await previewOrder(1, items, 1)).toMatchObject({ original_amount: 55, discount_amount: 11, total_amount: 44 });
    const result = await createOrder(1, items, undefined, undefined, 1);
    expect(result).toMatchObject({ original_amount: 55, discount_amount: 11, total_amount: 44, productIds: [1] });
    const [lines] = await db.query<RowDataPacket[]>('SELECT sku_id,quantity FROM order_items WHERE order_id = ? ORDER BY sku_id', [result.orderId]);
    expect(lines.map(row => [row.sku_id,row.quantity])).toEqual([[1,2],[2,1]]);
    expect(await product()).toMatchObject({ stock: 0 });
  });

  test('SKU下单只清所选规格，保留其他规格、旧base和其他用户购物车', async () => {
    await variants();
    await db.query('INSERT INTO cart (user_id,product_id,sku_id,quantity) VALUES (1,1,1,1),(1,1,2,1),(1,1,NULL,1),(2,1,1,1)');
    await createOrder(1, [{ product_id: 1, sku_id: 1, quantity: 1 }]);
    const [cart] = await db.query<RowDataPacket[]>('SELECT user_id,sku_id FROM cart ORDER BY user_id,sku_key');
    expect(cart.map(row => [row.user_id,row.sku_id])).toEqual([[1,null],[1,2],[2,1]]);
  });

  test('SKU最后一件并发只成交一次，失败方不多占券且保留购物车', async () => {
    await variants(); await receivedCoupon();
    await db.query('UPDATE product_skus SET stock = 1 WHERE sku_id = 1');
    await db.query('INSERT INTO cart (user_id,product_id,sku_id,quantity) VALUES (1,1,1,1),(2,1,1,1)');
    const results = await Promise.allSettled([
      createOrder(1, [{ product_id: 1, sku_id: 1, quantity: 1 }], undefined, undefined, 1),
      createOrder(2, [{ product_id: 1, sku_id: 1, quantity: 1 }]),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [orders] = await db.query<RowDataPacket[]>('SELECT user_id,order_id FROM orders');
    const [stock] = await db.query<RowDataPacket[]>('SELECT stock FROM product_skus WHERE sku_id = 1');
    const [cart] = await db.query<RowDataPacket[]>('SELECT user_id FROM cart');
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons');
    const [logs] = await db.query<RowDataPacket[]>('SELECT order_id FROM coupon_usage_logs');
    expect(stock[0].stock).toBe(0);
    expect(cart.map(row => row.user_id)).toEqual([orders[0].user_id === 1 ? 2 : 1]);
    expect(coupons[0]).toMatchObject(orders[0].user_id === 1 ? { status: 2, order_id: orders[0].order_id } : { status: 1, order_id: null });
    expect(logs).toHaveLength(orders[0].user_id === 1 ? 1 : 0);
    expect(await product()).toMatchObject({ stock: 10 });
  });

  test('软删除规格订单取消只回原SKU一次并返券，历史base单仍回父库存', async () => {
    const legacy = await createOrder(1, [{ product_id: 1, quantity: 2 }]);
    await variants(); await receivedCoupon();
    const variant = await createOrder(1, [{ product_id: 1, sku_id: 1, quantity: 2 }], undefined, undefined, 1);
    await db.query('UPDATE product_skus SET status = 0, specs = JSON_OBJECT("颜色","已改名"), price = 99 WHERE sku_id = 1');
    await db.query('UPDATE products SET status = -1 WHERE product_id = 1');
    await db.query('UPDATE orders SET created_at = DATE_SUB(NOW(),INTERVAL 31 MINUTE) WHERE order_id = ?', [variant.orderId]);
    await Promise.allSettled([transitionOrder(variant.orderId, OrderStatus.CANCELLED, { userId: 1 }), cancelTimeoutOrder(variant.orderId)]);
    await transitionOrder(legacy.orderId, OrderStatus.CANCELLED, { userId: 1 });
    const [skus] = await db.query<RowDataPacket[]>('SELECT stock FROM product_skus ORDER BY sku_id');
    const [lines] = await db.query<RowDataPacket[]>('SELECT sku_specs,price FROM order_items WHERE order_id = ?', [variant.orderId]);
    const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons');
    expect(skus.map(row => row.stock)).toEqual([3,2]);
    expect(await product()).toMatchObject({ stock: 10 });
    expect(lines[0]).toMatchObject({ sku_specs: { 颜色: '红色', 尺寸: 'M' }, price: '15.00' });
    expect(coupons[0]).toMatchObject({ status: 1, order_id: null });
  });

  test('SKU支付只累加一次商品销量，不再次扣规格库存', async () => {
    await variants();
    const { orderId } = await createOrder(1, [{ product_id: 1, sku_id: 1, quantity: 2 }, { product_id: 1, sku_id: 2, quantity: 1 }]);
    const results = await Promise.allSettled([transitionOrder(orderId, OrderStatus.PAID, { userId: 1 }), transitionOrder(orderId, OrderStatus.PAID, { userId: 1 })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [skus] = await db.query<RowDataPacket[]>('SELECT stock FROM product_skus ORDER BY sku_id');
    expect(skus.map(row => row.stock)).toEqual([1,1]);
    expect(await product()).toMatchObject({ stock: 10, sales_count: 3 });
  });

  test.each([undefined, 0, -1, 1.5, '1', 999, 3])('SKU商品拒绝未选、非法或错属规格 %p', async sku_id => {
    await variants();
    await db.query(`INSERT INTO product_skus (sku_id,product_id,sku_code,specs,price,stock) VALUES (3,2,'OTHER','{"尺寸":"M"}',1,10)`);
    const items = [{ product_id: 1, sku_id, quantity: 1 }];
    await expect(previewOrder(1, items)).rejects.toThrow();
    await expect(createOrder(1, items)).rejects.toThrow();
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    expect(orders[0].count).toBe(0);
    expect(await product()).toMatchObject({ stock: 10 });
  });

  test('停用SKU和旧base行仍显示不可用且可移除，不回退父库存', async () => {
    await variants();
    await db.query('INSERT INTO cart (user_id,product_id,sku_id,quantity) VALUES (1,1,1,1),(1,1,NULL,1)');
    await db.query('UPDATE product_skus SET status = 0');
    const app = cartApp(); const auth = cartAuth();
    const listed = await request(app).get('/cart').set(auth).expect(200);
    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.items.every((item: any) => item.available === false)).toBe(true);
    await request(app).post('/cart').set(auth).send({ product_id: 1, quantity: 1 }).expect(400);
    await request(app).put('/cart').set(auth).send({ product_id: 1, sku_id: 1, quantity: 2 }).expect(400);
    await request(app).put('/cart').set(auth).send({ product_id: 1, sku_id: 1, quantity: 0 }).expect(200);
    await request(app).delete('/cart/1').set(auth).expect(200);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM cart'); expect(rows).toHaveLength(0);
  });
  test('客户商品列表、热门、收藏和历史展示SKU价格与库存，筛选按规格价执行', async () => {
    await variants();
    await db.query('UPDATE products SET stock = 0,price = 100 WHERE product_id = 1');
    await db.query('INSERT INTO favorites (user_id,product_id) VALUES (1,1)');
    await db.query('INSERT INTO browse_history (user_id,product_id) VALUES (1,1)');
    const lists = [
      (await ProductModel.list({ min_price: 14, max_price: 16 })).products,
      await ProductModel.getHotProducts(),
      (await FavoriteModel.getUserFavorites(1)).favorites,
      (await BrowseHistoryModel.getUserHistory(1)).history,
    ];
    for (const list of lists) expect(list.find(item => item.product_id === 1)).toMatchObject({ price: '15.00', stock: '5', has_sku: 1 });
    expect((await ProductModel.list({ min_price: 90 })).products).toHaveLength(0);
    await db.query('UPDATE product_skus SET status = 0');
    const inactive = (await ProductModel.list({})).products.find(item => item.product_id === 1);
    expect(inactive).toMatchObject({ stock: '0', has_sku: 1 });
    expect(await product()).toMatchObject({ stock: 0 });
  });

  test('用券SKU订单明细失败完整回滚规格库存、券与购物车', async () => {
    await variants(); await receivedCoupon();
    await db.query('INSERT INTO cart (user_id,product_id,sku_id,quantity) VALUES (1,1,1,2)');
    await db.query("CREATE TRIGGER test_sku_failure BEFORE INSERT ON order_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sku failure'");
    try {
      await expect(createOrder(1, [{ product_id: 1, sku_id: 1, quantity: 2 }], undefined, undefined, 1)).rejects.toThrow('sku failure');
      const [skus] = await db.query<RowDataPacket[]>('SELECT stock FROM product_skus ORDER BY sku_id');
      const [coupons] = await db.query<RowDataPacket[]>('SELECT status,order_id FROM user_coupons');
      const [logs] = await db.query<RowDataPacket[]>('SELECT * FROM coupon_usage_logs');
      const [orders] = await db.query<RowDataPacket[]>('SELECT * FROM orders');
      const [cart] = await db.query<RowDataPacket[]>('SELECT sku_id,quantity FROM cart');
      expect(skus.map(row => row.stock)).toEqual([3,2]);
      expect(coupons[0]).toMatchObject({ status: 1, order_id: null });
      expect(logs).toHaveLength(0); expect(orders).toHaveLength(0);
      expect(cart[0]).toMatchObject({ sku_id: 1, quantity: 2 });
    } finally { await db.query('DROP TRIGGER test_sku_failure'); }
  });

  test('SKU管理软删和重启保留可回补库存，批量重复编码回滚全部写入', async () => {
    const skuId = await SKUModel.create({ product_id: 1, sku_code: 'ZERO', specs: { size: 'M' }, price: 0, stock: 1 });
    const order = await createOrder(1, [{ product_id: 1, sku_id: skuId, quantity: 1 }]);
    expect(order.total_amount).toBe(0);
    await SKUModel.delete(skuId);
    await transitionOrder(order.orderId, OrderStatus.CANCELLED, { userId: 1 });
    const listed = await SKUModel.findByProductId(1, true);
    expect(listed[0]).toMatchObject({ sku_id: skuId, stock: 1, status: 0 });
    await SKUModel.update(skuId, { status: 1, price: 2 });
    expect((await SKUModel.findByProductId(1))[0]).toMatchObject({ status: 1, price: '2.00' });
    await expect(SKUModel.createBatch([
      { product_id: 1, sku_code: 'TEMP', specs: { size: 'L' }, price: 1, stock: 1 },
      { product_id: 1, sku_code: 'ZERO', specs: { size: 'XL' }, price: 1, stock: 1 },
    ])).rejects.toMatchObject({ statusCode: 409 });
    expect(await SKUModel.findByProductId(1, true)).toHaveLength(1);
  });

  test.each(['SKU先创建', '基础订单先创建'])('首个SKU与基础订单并发按父锁顺序处理：%s', async scenario => {
    let notifyLocked!: () => void;
    let releaseParent!: () => void;
    const parentLocked = new Promise<void>(resolve => { notifyLocked = resolve; });
    const continueFirst = new Promise<void>(resolve => { releaseParent = resolve; });
    let paused = false;
    (getPool as jest.Mock).mockReturnValue({
      getConnection: async () => {
        const connection = await db.getConnection();
        return new Proxy(connection, {
          get(target, property) {
            if (property === 'execute') return async (sql: string, params: any[]) => {
              const result = await target.execute(sql, params);
              if (!paused && sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
                paused = true; notifyLocked(); await continueFirst;
              }
              return result;
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    });
    const createSKU = () => SKUModel.create({ product_id: 1, sku_code: 'FIRST', specs: { size: 'M' }, price: 15, stock: 3 });
    const createBase = () => createOrder(1, [{ product_id: 1, quantity: 2 }]);
    try {
      const first = scenario === 'SKU先创建' ? createSKU() : createBase();
      await parentLocked;
      const second = scenario === 'SKU先创建' ? createBase() : createSKU();
      const resultsPromise = Promise.allSettled([first, second]);
      releaseParent();
      const results = await resultsPromise;
      expect(results[0].status).toBe('fulfilled');
      if (scenario === 'SKU先创建') {
        expect(results[1]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('请选择') } });
        expect(await product()).toMatchObject({ stock: 10 });
      } else {
        expect(results[1].status).toBe('fulfilled');
        expect(await product()).toMatchObject({ stock: 8 });
        const [orders] = await db.query<RowDataPacket[]>('SELECT order_id FROM orders');
        (getPool as jest.Mock).mockReturnValue(db);
        await transitionOrder(orders[0].order_id, OrderStatus.CANCELLED, { userId: 1 });
        expect(await product()).toMatchObject({ stock: 10 });
      }
      const [skus] = await db.query<RowDataPacket[]>('SELECT stock FROM product_skus');
      expect(skus[0].stock).toBe(3);
    } finally {
      releaseParent(); (getPool as jest.Mock).mockReturnValue(db);
    }
  });

});
