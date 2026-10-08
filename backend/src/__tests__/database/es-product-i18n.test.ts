const indices = { exists: jest.fn(), create: jest.fn(), putMapping: jest.fn() };
const index = jest.fn();
const bulk = jest.fn();
jest.mock('@elastic/elasticsearch', () => ({ Client: jest.fn(() => ({ indices, index, bulk })) }));

process.env.ELASTICSEARCH_URL = 'http://es.test:9200';
const { initProductIndex, syncProductToES, bulkSyncProductsToES } = require('../../database/elasticsearch');

beforeEach(() => {
  jest.clearAllMocks();
  indices.exists.mockResolvedValue(false);
  bulk.mockResolvedValue({ errors: false });
});

test('新索引声明英文标题及描述的text mapping', async () => {
  await initProductIndex();
  expect(indices.create.mock.calls[0][0].mappings.properties).toMatchObject({
    title_en: { type: 'text', analyzer: 'standard' }, description_en: { type: 'text', analyzer: 'standard' },
  });
});

test('已有索引升级英文mapping且不重建或删除索引', async () => {
  indices.exists.mockResolvedValue(true);
  await initProductIndex();
  expect(indices.create).not.toHaveBeenCalled();
  expect(indices.putMapping).toHaveBeenCalledWith(expect.objectContaining({ index: 'products', properties: expect.objectContaining({
    title_en: { type: 'text', analyzer: 'standard' }, description_en: { type: 'text', analyzer: 'standard' },
  }) }));
});

test('单个和全量同步都包含英文商品搜索内容', async () => {
  const product = { product_id: 1, title: '衬衫', title_en: 'Shirt', description_en: 'Cotton shirt', status: 1 };
  await syncProductToES(product);
  await bulkSyncProductsToES([product]);
  expect(index.mock.calls[0][0].document).toMatchObject(product);
  expect(bulk.mock.calls[0][0].operations[1]).toMatchObject(product);
});
