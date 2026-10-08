import fs from 'fs';
import path from 'path';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { getPool, query } from '../../database/mysql';
import { ProductModel } from '../../models/product.model';
import { SKUModel } from '../../models/sku.model';
import { CartModel } from '../../models/cart.model';
import { FavoriteModel } from '../../models/favorite.model';
import { BrowseHistoryModel } from '../../models/browse-history.model';
import { ReviewModel } from '../../models/review.model';
import { OrderModel } from '../../models/order.model';
import { ProductController } from '../../controllers/product.controller';
import { OrderController } from '../../controllers/order.controller';
import { getAdminProducts } from '../../controllers/admin-product.controller';
import { getProductSKUs } from '../../controllers/admin-sku.controller';
import { getAdminOrderDetail } from '../../controllers/admin-order.controller';
import { getTopProducts } from '../../controllers/admin-dashboard.controller';
import { getNewUserRecommendations } from '../../services/recommendation.service';
import { searchProducts } from '../../services/product-search.service';
import { createOrder } from '../../services/order.service';
import { migrateCouponTables } from '../../database/migrate-coupon';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: () => ({ get: async () => null, setex: async () => 'OK', del: async () => 1 }) }));
jest.mock('../../database/elasticsearch', () => ({ getESClient: () => null }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实MySQL商品双语展示搜索与下单快照', () => {
  const database = `product_i18n_test_${process.pid}`;
  const options = { ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
    : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '', timezone: '+00:00', connectionLimit: 4 };
  let server: Pool, db: Pool, created = false;
  const translation = { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' } };
  const specs = { 颜色: '红色', 尺寸: 42, 防水: false };
  const response = () => ({ body: undefined as any, statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } });
  const request = (params = {}, keyword?: string) => ({ userId: 1, params, query: keyword ? { keyword } : {} }) as any;

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    const tables = new Set(['users', 'products', 'product_skus', 'orders', 'order_items', 'cart', 'shipping_addresses', 'favorites', 'browse_history', 'reviews']);
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) if (tables.has(match[2])) await db.query(match[1]);
    await db.query('CREATE TABLE categories (category_id INT PRIMARY KEY, name VARCHAR(100))');
    await db.query("INSERT INTO categories VALUES(1,'服装')");
    await migrateCouponTables(db);
    await db.query("INSERT INTO users(user_id,username,email,password_hash) VALUES(1,'buyer','buyer@example.test','fixture')");
    await db.query("INSERT INTO shipping_addresses(address_id,user_id,receiver_name,phone,province,city,district,detail_address) VALUES(101,1,'测试收件人','13800138000','浙江省','杭州市','西湖区','测试路')");
  });
  afterAll(async () => {
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(async () => {
    for (const table of ['reviews', 'favorites', 'browse_history', 'coupon_usage_logs', 'user_coupons', 'order_items', 'orders', 'cart', 'product_skus', 'products']) await db.query(`DELETE FROM ${table}`);
  });

  async function bilingualProduct() {
    const productId = await ProductModel.create({ title: '衬衫', title_en: 'Red shirt', description: '棉质', description_en: 'Cotton garment', category_id: 1, price: 99, stock: 10, specs, specs_en: translation } as any);
    const skuId = await SKUModel.create({ product_id: productId, sku_code: 'RED', specs, specs_en: translation, price: 12.50, stock: 5 } as any);
    return { productId, skuId };
  }

  test('详情、catalog、推荐、管理SKU及用户活动投影都返回英文并保留原规格类型', async () => {
    const { productId, skuId } = await bilingualProduct();
    const detail = response(); await ProductController.getDetail(request({ id: String(productId) }), detail as any);
    expect(detail.body.product).toMatchObject({ title_en: 'Red shirt', description_en: 'Cotton garment', specs_en: translation });
    expect(detail.body.product.skus[0]).toMatchObject({ specs, specs_en: translation });
    expect((await ProductModel.list({})).products[0]).toMatchObject({ title_en: 'Red shirt', specs_en: translation });
    expect((await ProductModel.getHotProducts())[0]).toHaveProperty('title_en', 'Red shirt');
    expect((await getNewUserRecommendations())[0]).toHaveProperty('title_en', 'Red shirt');
    await CartModel.add(1, productId, 1, skuId);
    expect((await CartModel.list(1))[0]).toMatchObject({ title_en: 'Red shirt', sku_specs: specs, sku_specs_en: translation });
    await FavoriteModel.add(1, productId); await BrowseHistoryModel.add(1, productId);
    expect((await FavoriteModel.getUserFavorites(1)).favorites[0]).toHaveProperty('title_en', 'Red shirt');
    expect((await BrowseHistoryModel.getUserHistory(1)).history[0]).toHaveProperty('title_en', 'Red shirt');
    const adminSKUs = response(); await getProductSKUs(request({ productId: String(productId) }), adminSKUs as any);
    expect(adminSKUs.body.product.title_en).toBe('Red shirt');
    expect(adminSKUs.body.skus[0].specs_en).toEqual(translation);
    const purchase = await createOrder(1, [{ product_id: productId, sku_id: skuId, quantity: 1 }], 101);
    await db.query('UPDATE orders SET status=3 WHERE order_id=?', [purchase.orderId]);
    await db.query("INSERT INTO reviews(product_id,user_id,order_id,rating,content) VALUES(?,1,?,5,'用户原文')", [productId, purchase.orderId]);
    expect((await ReviewModel.listByUser(1)).reviews[0]).toHaveProperty('product_title_en', 'Red shirt');
    const dashboard = response(); await getTopProducts(request(), dashboard as any);
    expect(dashboard.body[0]).toHaveProperty('title_en', 'Red shirt');
  });

  test('MySQL和管理搜索匹配英文标题/描述，旧商品和NULL翻译仍可中文搜索', async () => {
    const { productId } = await bilingualProduct();
    const legacyId = await ProductModel.create({ title: '旧夹克', description: '原始中文描述', price: 20, stock: 3 });
    const base = { sort_by: 'sales' as const, sort_order: 'desc' as const, page: 1, page_size: 20 };
    for (const keyword of ['shirt', 'Cotton', '衬衫']) {
      const result = await searchProducts({ ...base, keyword });
      expect(result.products.map(product => product.product_id)).toEqual([productId]);
      expect(result.products[0]).toHaveProperty('title_en', 'Red shirt');
      const admin = response(); await getAdminProducts(request({}, keyword), admin as any);
      expect(admin.body.products.map((product: any) => product.product_id)).toEqual([productId]);
    }
    expect((await searchProducts({ ...base, keyword: '夹克' })).products[0]).toMatchObject({ product_id: legacyId, title_en: null });
  });

  test('订单双语快照来自服务器，商品及SKU改名或软删除后客户和管理详情保持下单内容', async () => {
    const { productId, skuId } = await bilingualProduct();
    const purchase = await createOrder(1, [{ product_id: productId, sku_id: skuId, quantity: 1, title_en: 'Forged', specs_en: {} }], 101);
    const before = await OrderModel.getOrderItems(purchase.orderId);
    expect(before[0]).toMatchObject({ product_name: '衬衫', product_name_en: 'Red shirt', sku_specs: specs, sku_specs_en: translation });
    await ProductModel.update(productId, { title: '改名商品', title_en: 'Renamed', status: 0 } as any);
    await SKUModel.update(skuId, { specs: { 颜色: '蓝色' }, specs_en: { 颜色: { name: 'Colour', value: 'Blue' } }, status: 0 } as any, productId);
    expect(await OrderModel.getOrderItems(purchase.orderId)).toEqual(before);
    const customer = response(); await OrderController.getDetail(request({ id: String(purchase.orderId) }), customer as any);
    expect(customer.body.items).toEqual(before);
    const admin = response(); await getAdminOrderDetail(request({ orderId: String(purchase.orderId) }), admin as any);
    expect(admin.body.items[0]).toMatchObject({ product_name: '衬衫', product_name_en: 'Red shirt', sku_specs_en: translation, title: '衬衫', title_en: 'Red shirt' });
    expect(admin.body.items[0].title_en).not.toBe('Renamed');
  });

  test('未翻译商品订单保存SQL NULL英文快照并保留原始中文', async () => {
    const productId = await ProductModel.create({ title: '旧商品', price: 20, stock: 3 });
    const purchase = await createOrder(1, [{ product_id: productId, quantity: 1 }], 101);
    const [items] = await db.query<RowDataPacket[]>('SELECT product_name,product_name_en,sku_specs_en FROM order_items WHERE order_id=?', [purchase.orderId]);
    expect(items).toEqual([{ product_name: '旧商品', product_name_en: null, sku_specs_en: null }]);
  });
});
