jest.mock('../../database/mysql', () => ({ getPool: jest.fn(), query: jest.fn() }));

import { query } from '../../database/mysql';
import { ProductModel } from '../../models/product.model';

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockImplementation(async (sql: string) => sql.startsWith('SELECT COUNT') ? [{ total: 0 }] : []);
});

test('商品查询按空白拆词并去重，每个词查询全部五个字段，计数与分页条件一致', async () => {
  await ProductModel.list({ keyword: '  Acme\t耳机\nAcme  ', category_id: 2, brand: 'Acme', min_price: 10, max_price: 50, sort: 'price ASC', page: 2, limit: 3 });
  const [[countSql, countParams], [listSql, listParams]] = (query as jest.Mock).mock.calls;
  const termClause = "(title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!' OR title_en LIKE ? ESCAPE '!' OR description_en LIKE ? ESCAPE '!' OR brand LIKE ? ESCAPE '!')";
  const where = `WHERE status = 1 AND category_id = ? AND ${termClause} AND ${termClause} AND brand = ? AND price >= ? AND price <= ?`;
  expect(countSql).toContain(where);
  expect(listSql).toContain(where + ' ORDER BY price ASC, product_id DESC LIMIT ? OFFSET ?');
  expect(countParams).toEqual([2, ...Array(5).fill('%Acme%'), ...Array(5).fill('%耳机%'), 'Acme', 10, 50]);
  expect(listParams).toEqual([...countParams, 3, 3]);
});

test('通配符与转义字符仅存在于绑定的字面搜索值', async () => {
  await ProductModel.list({ keyword: "50%_!\\'" });
  for (const [sql, params] of (query as jest.Mock).mock.calls) {
    expect(sql).not.toContain("50%_!\\'");
    expect(params.slice(0, 5)).toEqual(Array(5).fill("%50!%!_!!\\'%"));
  }
});

test('空白关键词保持无关键词的目录查询', async () => {
  await ProductModel.list({ keyword: ' \t\n ' });
  const [[countSql, countParams], [listSql, listParams]] = (query as jest.Mock).mock.calls;
  expect(countSql).not.toContain('LIKE');
  expect(listSql).not.toContain('LIKE');
  expect(countParams).toEqual([]);
  expect(listParams).toEqual([20, 0]);
});

test('拆词前继续遵守100字符关键词上限', async () => {
  await ProductModel.list({ keyword: 'x'.repeat(100) });
  expect((query as jest.Mock).mock.calls[0][1]).toEqual(Array(5).fill(`%${'x'.repeat(100)}%`));
  jest.clearAllMocks();
  await expect(ProductModel.list({ keyword: 'x'.repeat(101) })).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
