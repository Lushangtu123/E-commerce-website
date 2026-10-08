jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

import { getPool, query } from '../../database/mysql';
import { ProductModel } from '../../models/product.model';
import { SKUModel } from '../../models/sku.model';
import { productCreateSchema, productUpdateSchema } from '../../utils/product-validation';
import { skuCreateSchema, skuUpdateSchema } from '../../utils/sku-validation';

const translation = { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' } };
const product = { title: '衬衫', title_en: 'Shirt', description_en: 'Cotton shirt', specs_en: translation, price: 12, stock: 3 };
const sku = { product_id: 1, sku_code: 'RED', specs: { 颜色: '红色', 尺寸: 42, 防水: false }, specs_en: translation, price: 12, stock: 3 };
let connection: any;

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue({ insertId: 1, affectedRows: 1 });
  connection = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql: string) => sql.includes('FROM products') ? [[{ product_id: 1, status: 1 }], []]
      : sql.includes('FROM product_skus') ? [[{ ...sku, sku_id: 1, status: 1 }], []]
      : [{ insertId: 1, affectedRows: 1 }, []]),
  };
  (getPool as jest.Mock).mockReturnValue({ getConnection: async () => connection });
});

test('商品和SKU接受按原始key的部分翻译，null可清除且原数字和布尔规格保持', () => {
  expect(productCreateSchema.validate(product).error).toBeUndefined();
  const { product_id, ...fields } = sku;
  expect(skuCreateSchema.validate(fields).value.specs).toEqual(sku.specs);
  expect(skuCreateSchema.validate(fields).error).toBeUndefined();
  expect(productUpdateSchema.validate({ title_en: null, description_en: null, specs_en: null }).error).toBeUndefined();
  expect(skuUpdateSchema.validate({ specs_en: null }).error).toBeUndefined();
});

test.each([
  { 颜色: {} }, { 颜色: { name: '' } }, { 颜色: { value: '   ' } }, { 颜色: { name: ' Color ' } },
  { 颜色: { name: 'x'.repeat(51) } }, { 颜色: { value: 'x'.repeat(101) } },
  { 颜色: { name: 'Color', extra: 'x' } }, { 颜色: 'Color' }, { 颜色: { value: 3 } },
  { ['x'.repeat(51)]: { name: 'Long key' } },
  Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, { name: 'Key' }])),
  [],
])('商品及SKU拒绝无效翻译映射 %j', specs_en => {
  expect(productUpdateSchema.validate({ specs_en }).error).toBeDefined();
  expect(skuUpdateSchema.validate({ specs_en }).error).toBeDefined();
});

test('创建和更新商品持久化英文JSON，清除时写SQL NULL', async () => {
  await ProductModel.create(product as any);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('title_en'), expect.arrayContaining(['Shirt', 'Cotton shirt', JSON.stringify(translation)]));
  (query as jest.Mock).mockClear();
  await ProductModel.update(1, { specs_en: translation, title_en: 'New shirt' } as any);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('specs_en = ?'), [JSON.stringify(translation), 'New shirt', 1]);
  await ProductModel.update(1, { specs_en: null } as any);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('specs_en = ?'), [null, 1]);
});

test('创建及批量创建SKU保存英文映射，更新null不保存JSON字符串null', async () => {
  await SKUModel.create(sku as any);
  let insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO product_skus'));
  expect(insert[0]).toContain('specs_en');
  expect(insert[1]).toContain(JSON.stringify(translation));
  connection.execute.mockClear();
  await SKUModel.createBatch([sku]);
  insert = connection.execute.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO product_skus'));
  expect(insert[1]).toContain(JSON.stringify(translation));
  await SKUModel.update(1, { specs_en: null } as any, 1);
  const update = connection.execute.mock.calls.find(([sql]: [string]) => sql.startsWith('UPDATE product_skus'));
  expect(update[1]).toEqual([null, 1, 1]);
});

test('所有SKU读取入口解析英文映射JSON并保留null', async () => {
  (query as jest.Mock).mockImplementation(async () => [{ ...sku, sku_id: 1, specs_en: JSON.stringify(translation) }]);
  expect((await SKUModel.findById(1) as any).specs_en).toEqual(translation);
  expect((await SKUModel.findBySKUCode('RED') as any).specs_en).toEqual(translation);
  expect((await SKUModel.findByProductId(1))[0]).toHaveProperty('specs_en', translation);
  expect((await SKUModel.getLowestPriceSKU(1) as any).specs_en).toEqual(translation);
  (query as jest.Mock).mockResolvedValue([{ ...sku, sku_id: 1, specs_en: null }]);
  expect((await SKUModel.findById(1) as any).specs_en).toBeNull();
});

test('MySQL英文搜索查询两种语言并返回英文商品投影', async () => {
  (query as jest.Mock).mockImplementation(async (sql: string) => sql.includes('SELECT COUNT') ? [{ total: 1 }] : [product]);
  const result = await ProductModel.list({ keyword: 'Shirt' });
  const [sql, params] = (query as jest.Mock).mock.calls[1];
  expect(sql).toContain('title_en LIKE ?');
  expect(sql).toContain('description_en LIKE ?');
  expect(sql).toContain('p.specs_en');
  expect(params.slice(0, 4)).toEqual(['%Shirt%', '%Shirt%', '%Shirt%', '%Shirt%']);
  expect(result.products[0]).toHaveProperty('title_en', 'Shirt');
});
