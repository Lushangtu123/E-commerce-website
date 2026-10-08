import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import Redis from 'ioredis';
import { getPool, query } from '../../database/mysql';
import { getRedisClient } from '../../database/redis';
import { getESClient, searchProductIds } from '../../database/elasticsearch';
import { ProductModel } from '../../models/product.model';
import { BrowseHistoryModel } from '../../models/browse-history.model';
import { ProductController } from '../../controllers/product.controller';
import { afterProductWrite } from '../../controllers/admin-product-write';
import { invalidateOrderProductCache } from '../../services/order.service';
import { searchProducts } from '../../services/product-search.service';
import { getNewUserRecommendations, getRelatedProducts, getRecommendationsByBrowseHistory } from '../../services/recommendation.service';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/redis', () => ({ getRedisClient: jest.fn() }));
jest.mock('../../database/elasticsearch', () => ({ getESClient: jest.fn(), searchProductIds: jest.fn() }));
jest.mock('../../models/browse-history.model', () => ({ BrowseHistoryModel: { getRecentProductIds: jest.fn() } }));
jest.mock('../../controllers/admin-log.controller', () => ({ logAdminAction: jest.fn() }));

const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 商品售价与原价来自同一规格', () => {
  const database = `catalog_prices_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool, db: Pool, redis: Redis | undefined, created = false;
  const search = { keyword: '', sort_by: 'price' as const, sort_order: 'asc' as const, page: 1, page_size: 20 };
  const expected = [[1, 99, 100, 5], [2, 99, null, 2], [3, 0, 0, 1], [4, 99, 120, 3],
    [5, 77, null, 0], [6, 20, 30, 3], [7, 10, 15, 2], [8, 99, 120, 2]];
  const prices = (rows: any[]) => rows.map(p => [p.product_id, Number(p.price),
    p.original_price === null ? null : Number(p.original_price), Number(p.stock)]).sort((a, b) => Number(a[0]) - Number(b[0]));

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); created = true;
    db = mysql.createPool({ ...options, database });
    (getPool as jest.Mock).mockReturnValue(db);
    (query as jest.Mock).mockImplementation(async (sql, values) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'product_skus'].includes(match[2])) await db.query(match[1]);
    }
    await db.query(`INSERT INTO products(product_id,title,category_id,price,original_price,stock,sales_count) VALUES
      (1,'最低价',1,199,250,99,8),(2,'无原价',1,199,200,99,7),(3,'零价',1,199,200,99,6),
      (4,'同价',1,199,250,99,5),(5,'全停用',1,77,100,99,4),(6,'无规格',1,20,30,3,3),
      (7,'最低规格无库存',1,199,250,99,2),(8,'停用低价',1,199,250,99,1)`);
    await db.query(`INSERT INTO product_skus(sku_id,product_id,sku_code,price,original_price,stock,status) VALUES
      (11,1,'A',99,100,2,1),(12,1,'B',150,200,3,1),(21,2,'C',99,NULL,2,1),(31,3,'D',0,0,1,1),
      (42,4,'E',99,200,2,1),(41,4,'F',99,120,1,1),(51,5,'G',10,15,3,0),
      (71,7,'H',10,15,0,1),(72,7,'I',20,25,2,1),(81,8,'J',1,2,3,0),(82,8,'K',99,120,2,1)`);
    if (process.env.REDIS_TEST_URL) {
      redis = new Redis(process.env.REDIS_TEST_URL, { protocol: 2, keyPrefix: `catalog-prices:${process.pid}:` });
      (getRedisClient as jest.Mock).mockReturnValue(redis);
    }
  });
  afterAll(async () => {
    if (redis) { await redis.del('product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3'); await redis.quit(); }
    if (db) await db.end();
    if (server) { try { if (created) await server.query(`DROP DATABASE ${database}`); } finally { await server.end(); } }
  });
  beforeEach(() => {
    (getESClient as jest.Mock).mockReturnValue(null);
    (BrowseHistoryModel.getRecentProductIds as jest.Mock).mockResolvedValue([]);
  });

  test('列表和热门结果不重复商品，保留库存汇总、简单商品、零价及停用规则', async () => {
    const list = await ProductModel.list({ sort: 'price ASC' });
    expect(list.total).toBe(8);
    expect(prices(list.products)).toEqual(expected);
    expect(prices(await ProductModel.getHotProducts(20))).toEqual(expected);
    const page = await ProductModel.list({ min_price: 99, max_price: 99, sort: 'price ASC', page: 2, limit: 2 });
    expect(page.total).toBe(4);
    expect(page.products).toHaveLength(2);
    expect(new Set(page.products.map(p => p.product_id)).size).toBe(2);
  });
  test('MySQL 和 ES 搜索读取同一实时规格价格', async () => {
    expect(prices((await searchProducts(search)).products)).toEqual(expected);
    (getESClient as jest.Mock).mockReturnValue({});
    (searchProductIds as jest.Mock).mockResolvedValue({ ids: [4, 2, 1], total: 3 });
    const result = await searchProducts(search);
    expect(result.products.map(p => p.product_id)).toEqual([4, 2, 1]);
    expect(prices(result.products)).toEqual(expected.filter(p => [1, 2, 4].includes(Number(p[0]))));
  });
  test('新用户、浏览和相关推荐共用价格来源，排除无库存商品', async () => {
    const available = expected.filter(p => p[0] !== 5);
    expect(prices(await getNewUserRecommendations(20))).toEqual(available);
    expect(prices(await getRecommendationsByBrowseHistory(1, 20))).toEqual(available);
    (BrowseHistoryModel.getRecentProductIds as jest.Mock).mockResolvedValue([6]);
    expect(prices(await getRecommendationsByBrowseHistory(1, 20))).toEqual(available.filter(p => p[0] !== 6));
    expect(prices(await getRelatedProducts(6, 20))).toEqual(available.filter(p => p[0] !== 6));
  });

  (process.env.REDIS_TEST_URL ? test : test.skip)('旧热门缓存被跳过，缓存命中保留新价格，商品和订单写入清理所有版本', async () => {
    const hot = async () => {
      const res: any = { json(value: any) { this.body = value; return this; }, status() { return this; } };
      await ProductController.getHotProducts({ query: {} } as any, res);
      return res.body;
    };
    await redis!.setex('products:hot', 600, JSON.stringify([{ product_id: 1, price: 99, original_price: 250 }]));
    await redis!.setex('products:hot:v2', 600, JSON.stringify([{ product_id: 1, price: 99, original_price: 250 }]));
    await redis!.del('products:hot:v3');
    expect(prices((await hot()).products)).toEqual(expected);
    expect((await hot()).fromCache).toBe(true);
    expect(await redis!.ttl('products:hot:v3')).toBeGreaterThan(0);
    const req = { admin: { adminId: 1 }, get: () => 'fixture', ip: '127.0.0.1' } as any;
    const writers = [
      () => afterProductWrite(req, [1], 'UPDATE', 'product', '1', 'fixture'),
      () => invalidateOrderProductCache([1]),
      () => ProductController.update({ params: { id: '1' }, body: { price: 200 } } as any, { status() { return this; }, json() {} } as any),
    ];
    for (const write of writers) {
      for (const key of ['product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3']) await redis!.set(key, 'stale');
      await write();
      expect(await redis!.mget('product:1', 'product:v2:1', 'products:hot', 'products:hot:v2', 'products:hot:v3')).toEqual([null, null, null, null, null]);
    }
  });
});
