const search = jest.fn();
jest.mock('@elastic/elasticsearch', () => ({ Client: jest.fn(() => ({ search })) }));

process.env.ELASTICSEARCH_URL = 'http://es.test:9200';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { searchProductIds } = require('../../database/elasticsearch');

const base = { keyword: '', sort_by: 'sales', sort_order: 'desc', page: 1, page_size: 20 } as const;

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue({ hits: { total: { value: 0 }, hits: [] } });
});

async function sentQuery(params: object) {
  await searchProductIds({ ...base, ...params });
  return search.mock.calls[0][0].query.bool;
}

test('关键词的每个词都必须出现，而不是任意一个字命中即可', async () => {
  const { must } = await sentQuery({ keyword: '耳机' });
  const clauses = must[0].bool.should;
  expect(must[0].bool.minimum_should_match).toBe(1);
  for (const clause of clauses) expect(clause.multi_match.operator).toBe('and');
  expect(clauses.some((c: any) => c.multi_match.operator === 'or')).toBe(false);
});

test('词可以分布在不同字段（如品牌 + 标题），单字段匹配保留英文拼写容错', async () => {
  const { must } = await sentQuery({ keyword: 'Acme 耳机' });
  const types = must[0].bool.should.map((c: any) => c.multi_match.type);
  expect(types).toEqual(expect.arrayContaining(['cross_fields', 'best_fields']));
  const fuzzy = must[0].bool.should.find((c: any) => c.multi_match.type === 'best_fields');
  expect(fuzzy.multi_match.fuzziness).toBe('AUTO');
  // Elasticsearch rejects fuzziness on cross_fields queries.
  const cross = must[0].bool.should.find((c: any) => c.multi_match.type === 'cross_fields');
  expect(cross.multi_match.fuzziness).toBeUndefined();
});

test('没有关键词时只按筛选条件查询', async () => {
  const bool = await sentQuery({ brand: 'Acme' });
  expect(bool.must).toEqual([]);
  expect(bool.filter).toEqual(expect.arrayContaining([{ term: { status: 1 } }, { term: { 'brand.keyword': 'Acme' } }]));
});

test('英文关键词同时匹配英文标题和描述', async () => {
  const { must } = await sentQuery({ keyword: 'Cotton shirt' });
  for (const clause of must[0].bool.should) {
    expect(clause.multi_match.fields).toEqual(expect.arrayContaining(['title_en^3', 'description_en']));
  }
});
