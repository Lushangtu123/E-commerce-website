import { Client } from '@elastic/elasticsearch';
import logger from '../utils/logger';

let esClient: Client | null | undefined;

/**
 * Elasticsearch 是可选依赖：未配置 ELASTICSEARCH_URL 时返回 null，商品搜索使用 MySQL。
 * 超时较短，ES 故障时搜索能尽快回退，后台写入也不会长时间等待。
 */
export function getESClient(): Client | null {
  if (esClient === undefined) {
    esClient = process.env.ELASTICSEARCH_URL
      ? new Client({ node: process.env.ELASTICSEARCH_URL, requestTimeout: 3000, maxRetries: 1 })
      : null;
  }
  return esClient;
}

function requireESClient(): Client {
  const client = getESClient();
  if (!client) throw new Error('未配置 ELASTICSEARCH_URL');
  return client;
}

/** 写入索引的商品字段；price 和 stock 取自顾客视图（启用 SKU 的最低价和合计库存） */
function productDocument(product: any) {
  return {
    product_id: product.product_id,
    title: product.title,
    title_en: product.title_en,
    description: product.description,
    description_en: product.description_en,
    price: product.price,
    original_price: product.original_price,
    stock: product.stock,
    sales_count: product.sales_count,
    category_id: product.category_id,
    brand: product.brand,
    main_image: product.main_image,
    status: product.status,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

// 索引名称
export const PRODUCT_INDEX = 'products';
const englishContentMapping = {
  title_en: { type: 'text', analyzer: 'standard' },
  description_en: { type: 'text', analyzer: 'standard' },
} as const;

/**
 * 初始化产品索引
 */
export async function initProductIndex() {
  try {
    // 检查索引是否存在
    const indexExists = await requireESClient().indices.exists({
      index: PRODUCT_INDEX,
    });

    if (!indexExists) {
      // 创建索引及映射
      await requireESClient().indices.create({
        index: PRODUCT_INDEX,
        settings: {
          analysis: {
            analyzer: {
              standard_analyzer: {
                type: 'standard',
              },
            },
          },
        },
        mappings: {
          properties: {
            ...englishContentMapping,
            product_id: { type: 'integer' },
            title: {
              type: 'text',
              analyzer: 'standard',
              fields: {
                keyword: { type: 'keyword' },
              },
            },
            description: {
              type: 'text',
              analyzer: 'standard',
            },
            price: { type: 'float' },
            original_price: { type: 'float' },
            stock: { type: 'integer' },
            sales_count: { type: 'integer' },
            category_id: { type: 'integer' },
            brand: {
              type: 'text',
              analyzer: 'standard',
              fields: {
                keyword: { type: 'keyword' },
              },
            },
            main_image: { type: 'keyword' },
            status: { type: 'integer' },
            created_at: { type: 'date' },
            updated_at: { type: 'date' },
          },
        },
      });
      logger.info(`✅ Elasticsearch 索引 ${PRODUCT_INDEX} 创建成功`);
    } else {
      await requireESClient().indices.putMapping({ index: PRODUCT_INDEX, properties: englishContentMapping });
      logger.info(`✅ Elasticsearch 索引 ${PRODUCT_INDEX} 已存在`);
    }
  } catch (error) {
    logger.error({ err: error }, '❌ 初始化 Elasticsearch 索引失败');
    throw error;
  }
}

/**
 * 同步单个商品到 Elasticsearch
 */
export async function syncProductToES(product: any) {
  await requireESClient().index({
    index: PRODUCT_INDEX,
    id: product.product_id.toString(),
    document: productDocument(product),
  });
}

/**
 * 批量同步商品到 Elasticsearch
 */
export async function bulkSyncProductsToES(products: any[]) {
  try {
    const operations = products.flatMap((product) => [
      { index: { _index: PRODUCT_INDEX, _id: product.product_id.toString() } },
      productDocument(product),
    ]);

    const result = await requireESClient().bulk({ operations });
    
    if (result.errors) {
      logger.error('❌ 批量同步部分商品失败');
      result.items.forEach((item: any, index: number) => {
        if (item.index?.error) {
          logger.error({ err: item.index.error }, `商品 ${products[index].product_id} 同步失败`);
        }
      });
    } else {
      logger.info(`✅ 批量同步 ${products.length} 个商品到 ES 成功`);
    }

    return result;
  } catch (error) {
    logger.error({ err: error }, '❌ 批量同步商品到 ES 失败');
    throw error;
  }
}

/**
 * 从 Elasticsearch 删除商品（不存在视为成功）
 */
export async function deleteProductFromES(productId: number) {
  try {
    await requireESClient().delete({
      index: PRODUCT_INDEX,
      id: productId.toString(),
    });
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) throw error;
  }
}

export interface ESSearchParams {
  keyword: string;
  category_id?: number;
  min_price?: number;
  max_price?: number;
  brand?: string;
  sort_by: 'price' | 'sales' | 'created_at';
  sort_order: 'asc' | 'desc';
  page: number;
  page_size: number;
}

const SORT_FIELDS = { price: 'price', sales: 'sales_count', created_at: 'created_at' } as const;

/**
 * 在 Elasticsearch 中匹配上架商品，只返回按相关度/排序规则排好的商品 ID 和总数；
 * 价格、库存等展示字段由调用方从 MySQL 读取，避免使用过期的索引数据
 */
export async function searchProductIds(params: ESSearchParams): Promise<{ ids: number[]; total: number }> {
  const { keyword, category_id, min_price, max_price, brand, sort_by, sort_order, page, page_size } = params;
  const filter: any[] = [{ term: { status: 1 } }];
  if (category_id !== undefined) filter.push({ term: { category_id } });
  if (brand) filter.push({ term: { 'brand.keyword': brand } });
  if (min_price !== undefined || max_price !== undefined) {
    filter.push({ range: { price: { ...(min_price !== undefined && { gte: min_price }), ...(max_price !== undefined && { lte: max_price }) } } });
  }
  // The standard analyzer splits Chinese into single characters, so every term must match:
  // with `or`, 耳机 would also match 机械键盘 through the shared 机.
  // cross_fields lets terms span fields (brand + title); best_fields keeps typo tolerance
  // within one field, which cross_fields does not support.
  const fields = ['title^3', 'title_en^3', 'description', 'description_en', 'brand^2'];
  const must: any[] = keyword ? [{
    bool: {
      should: [
        { multi_match: { query: keyword, fields, type: 'cross_fields', operator: 'and' } },
        { multi_match: { query: keyword, fields, type: 'best_fields', operator: 'and', fuzziness: 'AUTO' } },
      ],
      minimum_should_match: 1,
    },
  }] : [];

  const result = await requireESClient().search({
    index: PRODUCT_INDEX,
    query: { bool: { must, filter } },
    sort: [{ [SORT_FIELDS[sort_by]]: sort_order }, { product_id: 'desc' }],
    from: (page - 1) * page_size,
    size: page_size,
    track_total_hits: true,
    _source: ['product_id'],
  });
  const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0;
  return { ids: result.hits.hits.map((hit: any) => Number(hit._source.product_id)), total };
}

/**
 * 检查 Elasticsearch 连接
 */
export async function checkESConnection() {
  try {
    const health = await requireESClient().cluster.health();
    logger.info({ health }, '✅ Elasticsearch 连接成功');
    return true;
  } catch (error) {
    logger.error({ err: error }, '❌ Elasticsearch 连接失败');
    return false;
  }
}

