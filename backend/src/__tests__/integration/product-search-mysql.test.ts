import fs from 'fs';
import path from 'path';
import mysql, { Pool } from 'mysql2/promise';
import { query } from '../../database/mysql';
import { getESClient, searchProductIds, syncProductToES, deleteProductFromES } from '../../database/elasticsearch';
import { searchProducts, syncProductsToSearchIndex } from '../../services/product-search.service';
import { ProductModel } from '../../models/product.model';

jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('../../database/elasticsearch', () => ({
  getESClient: jest.fn(), searchProductIds: jest.fn(), syncProductToES: jest.fn(), deleteProductFromES: jest.fn(),
}));

// Own only product_search_test_${pid}; never run against the application's DB_NAME.
const integration = process.env.MYSQL_TEST_SOCKET || process.env.MYSQL_TEST_HOST ? describe : describe.skip;
integration('真实 MySQL 商品搜索回退与索引同步', () => {
  const database = `product_search_test_${process.pid}`;
  const options = {
    ...(process.env.MYSQL_TEST_SOCKET ? { socketPath: process.env.MYSQL_TEST_SOCKET }
      : { host: process.env.MYSQL_TEST_HOST, port: Number(process.env.MYSQL_TEST_PORT || 3306) }),
    user: process.env.MYSQL_TEST_USER || 'root', password: process.env.MYSQL_TEST_PASSWORD || '',
    timezone: '+00:00', connectionLimit: 4,
  };
  let server: Pool;
  let db: Pool;
  let databaseCreated = false;
  const base = { keyword: '', sort_by: 'sales' as const, sort_order: 'desc' as const, page: 1, page_size: 20 };

  beforeAll(async () => {
    server = mysql.createPool(options);
    await server.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`); databaseCreated = true;
    db = mysql.createPool({ ...options, database });
    (query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => (await db.query(sql, values))[0]);
    const source = fs.readFileSync(path.join(__dirname, '../../database/migrate.ts'), 'utf8');
    for (const match of source.matchAll(/`(CREATE TABLE IF NOT EXISTS (\w+)[\s\S]*?)`/g)) {
      if (['products', 'product_skus', 'reviews'].includes(match[2])) await db.query(match[1]);
    }
    await db.query(`INSERT INTO products (product_id,title,title_en,description,description_en,category_id,brand,price,stock,sales_count,status) VALUES
      (1,'蓝牙耳机','Wireless headphones','主动降噪','Comfortable audio',1,'Acme',99.00,5,10,1),
      (2,'有线耳机','Wired headphones','录音室音频','Studio audio',1,'Other',29.00,5,50,1),
      (3,'下架耳机','Wireless headphones','主动降噪','Comfortable audio',1,'Acme',9.00,5,99,0),
      (4,'规格耳机','Travel headphones','便携音频','Comfortable audio',1,'Acme',199.00,0,1,1),
      (5,'Acme speaker','Compact speaker',NULL,NULL,2,'Other',179.00,5,2,1)`);
    await db.query('INSERT INTO products (product_id,title,title_en,brand,price,stock,status) VALUES ?', [[
      [6, '100% cotton model_one!', 'C:\\audio', 'Fabric', 19, 5, 1],
      [7, '100X cotton modelXone', 'C:/audio', 'Fabric', 19, 5, 1],
    ]]);
    // SKU 商品对顾客显示启用规格的最低价
    await db.query(`INSERT INTO product_skus (product_id,sku_code,specs,price,stock,status) VALUES
      (4,'S-1','{"颜色":"黑"}',149.00,3,1),(4,'S-2','{"颜色":"白"}',59.00,2,0)`);
  });

  afterAll(async () => {
    if (db) await db.end();
    if (server) {
      try { if (databaseCreated) await server.query(`DROP DATABASE ${database}`); }
      finally { await server.end(); }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (getESClient as jest.Mock).mockReturnValue(null);
  });

  test('MySQL 搜索按关键词、品牌和顾客价格排序，排除下架商品', async () => {
    const result = await searchProducts({ ...base, keyword: '耳机', brand: 'Acme', sort_by: 'price', sort_order: 'asc' });
    expect(result.engine).toBe('mysql');
    expect(result.total).toBe(2);
    expect(result.products.map(p => [p.product_id, Number(p.price)])).toEqual([[1, 99], [4, 149]]);
  });

  test('MySQL 搜索支持按销量升序和价格区间', async () => {
    const result = await searchProducts({ ...base, keyword: '耳机', sort_order: 'asc', min_price: 50 });
    expect(result.products.map(p => p.product_id)).toEqual([4, 1]);
  });

  test.each([
    ['Acme', [1, 4, 5]],
    ['  Acme\t耳机\nAcme  ', [1, 4]],
    ['Wireless 降噪', [1]],
    ['Comfortable headphones', [1, 4]],
    ['audio Acme', [1, 4]],
    ['Acme speaker', [5]],
    ['Acme missing', []],
    ['Acme 下架', []],
  ])('MySQL 每个词可匹配品牌或任一语言字段：%s', async (keyword, ids) => {
    const result = await searchProducts({ ...base, keyword });
    expect(result.engine).toBe('mysql');
    expect(result.total).toBe(ids.length);
    expect(result.products.map(p => p.product_id).sort((a, b) => a - b)).toEqual(ids);
  });

  test('ES 失败后同样支持品牌与英文标题跨字段搜索', async () => {
    (getESClient as jest.Mock).mockReturnValue({});
    (searchProductIds as jest.Mock).mockRejectedValue(new Error('isolated fallback exercise'));
    const result = await searchProducts({ ...base, keyword: 'Acme headphones' });
    expect(result.engine).toBe('mysql');
    expect(result.total).toBe(2);
    expect(result.products.map(p => p.product_id)).toEqual([1, 4]);
  });

  test.each(['%', '_', '!', '\\'])('MySQL 将 %s 作为字面文本而非通配符', async keyword => {
    const result = await ProductModel.list({ keyword });
    expect(result.total).toBe(1);
    expect(result.products.map(p => p.product_id)).toEqual([6]);
  });

  test.each([[1, 1, 99, 5], [2, 4, 149, 3]])('跨字段搜索保留分类、品牌、顾客价格筛选和分页：第 %i 页', async (page, id, price, stock) => {
    const result = await searchProducts({
      ...base, keyword: 'Acme 耳机', category_id: 1, brand: 'Acme', min_price: 90, max_price: 150,
      sort_by: 'price', sort_order: 'asc', page, page_size: 1,
    });
    expect(result.total).toBe(2);
    expect(result.products.map(p => [p.product_id, Number(p.price), Number(p.stock)])).toEqual([[id, price, stock]]);
  });

  test('ES 结果按其顺序从 MySQL 读取当前数据，并跳过已下架商品', async () => {
    (getESClient as jest.Mock).mockReturnValue({});
    (searchProductIds as jest.Mock).mockResolvedValue({ ids: [4, 3, 2], total: 3 });
    const result = await searchProducts({ ...base, keyword: '耳机' });
    expect(result.engine).toBe('elasticsearch');
    expect(result.products.map(p => [p.product_id, Number(p.price)])).toEqual([[4, 149], [2, 29]]);
  });

  test('索引同步写入顾客视图（含下架商品），删除不存在的商品', async () => {
    (getESClient as jest.Mock).mockReturnValue({});
    await syncProductsToSearchIndex([3, 4, 404]);
    const indexed = new Map((syncProductToES as jest.Mock).mock.calls.map(([p]) => [p.product_id, p]));
    expect([...indexed.keys()].sort()).toEqual([3, 4]);
    expect(Number(indexed.get(4).price)).toBe(149);
    expect(indexed.get(3).status).toBe(0);
    expect(deleteProductFromES).toHaveBeenCalledWith(404);
  });
});
