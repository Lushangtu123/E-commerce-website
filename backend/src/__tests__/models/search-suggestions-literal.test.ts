jest.mock('../../database/mysql', () => ({ query: jest.fn() }));

import { query } from '../../database/mysql';
import { SearchHistoryModel } from '../../models/search-history.model';

beforeEach(() => {
  jest.clearAllMocks();
  (query as jest.Mock).mockResolvedValue([]);
});

test.each([
  ['%', '%!%%'],
  ['_', '%!_%'],
  ['!', '%!!%'],
  [String.raw`path\charger`, String.raw`%path\charger%`],
  [String.raw`50%_!\'`, String.raw`%50!%!_!!\'%`],
])('搜索建议将 %s 作为绑定的字面文字而非 LIKE 通配符', async (keyword, pattern) => {
  await SearchHistoryModel.getSuggestions(keyword, 7);
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, params] = (query as jest.Mock).mock.calls[0];
  expect(sql).toContain("WHERE keyword LIKE ? ESCAPE '!'");
  expect(params).toEqual([pattern, 7]);
});

test('普通建议继续包含匹配并按出现频率排序，保留绑定数量和返回值', async () => {
  (query as jest.Mock).mockResolvedValue([{ keyword: 'Fast USB charger' }, { keyword: 'USB cable' }]);
  await expect(SearchHistoryModel.getSuggestions('USB', 2)).resolves.toEqual(['Fast USB charger', 'USB cable']);
  const [sql, params] = (query as jest.Mock).mock.calls[0];
  expect(sql).toContain('ORDER BY count DESC');
  expect(sql).toContain('LIMIT ?');
  expect(params).toEqual(['%USB%', 2]);
});
