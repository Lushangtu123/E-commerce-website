import { Client } from '@elastic/elasticsearch';

// 创建 Elasticsearch 客户端
const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200',
});

// 索引名称
export const PRODUCT_INDEX = 'products';

/**
 * 初始化产品索引
 */
export async function initProductIndex() {
  try {
    // 检查索引是否存在
    const indexExists = await esClient.indices.exists({
      index: PRODUCT_INDEX,
    });

    if (!indexExists) {
      // 创建索引及映射
      await esClient.indices.create({
        index: PRODUCT_INDEX,
        body: {
          settings: {
            analysis: {
              analyzer: {
                ik_max_word_analyzer: {
                  type: 'custom',
                  tokenizer: 'ik_max_word',
                },
                ik_smart_analyzer: {
                  type: 'custom',
                  tokenizer: 'ik_smart',
                },
              },
            },
          },
          mappings: {
            properties: {
              product_id: { type: 'integer' },
              title: {
                type: 'text',
                analyzer: 'ik_max_word_analyzer',
                search_analyzer: 'ik_smart_analyzer',
                fields: {
                  keyword: { type: 'keyword' },
                },
              },
              description: {
                type: 'text',
                analyzer: 'ik_max_word_analyzer',
                search_analyzer: 'ik_smart_analyzer',
              },
              price: { type: 'float' },
              original_price: { type: 'float' },
              stock: { type: 'integer' },
              sales_count: { type: 'integer' },
              category_id: { type: 'integer' },
              brand: {
                type: 'text',
                analyzer: 'ik_max_word_analyzer',
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
        },
      });
      console.log(`✅ Elasticsearch 索引 ${PRODUCT_INDEX} 创建成功`);
    } else {
      console.log(`✅ Elasticsearch 索引 ${PRODUCT_INDEX} 已存在`);
    }
  } catch (error) {
    console.error('❌ 初始化 Elasticsearch 索引失败:', error);
    throw error;
  }
}

/**
 * 同步单个商品到 Elasticsearch
 */
export async function syncProductToES(product: any) {
  try {
    await esClient.index({
      index: PRODUCT_INDEX,
      id: product.product_id.toString(),
      body: {
        product_id: product.product_id,
        title: product.title,
        description: product.description,
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
      },
    });
    console.log(`✅ 商品 ${product.product_id} 同步到 ES 成功`);
  } catch (error) {
    console.error(`❌ 商品 ${product.product_id} 同步到 ES 失败:`, error);
    throw error;
  }
}

/**
 * 批量同步商品到 Elasticsearch
 */
export async function bulkSyncProductsToES(products: any[]) {
  try {
    const body = products.flatMap((product) => [
      { index: { _index: PRODUCT_INDEX, _id: product.product_id.toString() } },
      {
        product_id: product.product_id,
        title: product.title,
        description: product.description,
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
      },
    ]);

    const result = await esClient.bulk({ body });
    
    if (result.errors) {
      console.error('❌ 批量同步部分商品失败');
      result.items.forEach((item: any, index: number) => {
        if (item.index?.error) {
          console.error(`商品 ${products[index].product_id} 同步失败:`, item.index.error);
        }
      });
    } else {
      console.log(`✅ 批量同步 ${products.length} 个商品到 ES 成功`);
    }

    return result;
  } catch (error) {
    console.error('❌ 批量同步商品到 ES 失败:', error);
    throw error;
  }
}

/**
 * 从 Elasticsearch 删除商品
 */
export async function deleteProductFromES(productId: number) {
  try {
    await esClient.delete({
      index: PRODUCT_INDEX,
      id: productId.toString(),
    });
    console.log(`✅ 商品 ${productId} 从 ES 删除成功`);
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      console.error(`❌ 商品 ${productId} 从 ES 删除失败:`, error);
      throw error;
    }
  }
}

/**
 * 搜索商品
 */
export async function searchProducts(params: {
  keyword?: string;
  category_id?: number;
  min_price?: number;
  max_price?: number;
  brand?: string;
  sort_by?: 'price' | 'sales' | 'created_at';
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}) {
  try {
    const {
      keyword = '',
      category_id,
      min_price,
      max_price,
      brand,
      sort_by = 'sales',
      sort_order = 'desc',
      page = 1,
      page_size = 20,
    } = params;

    // 构建查询条件
    const must: any[] = [
      { term: { status: 1 } }, // 只搜索上架商品
    ];

    // 关键词搜索
    if (keyword) {
      must.push({
        multi_match: {
          query: keyword,
          fields: ['title^3', 'description', 'brand^2'],
          type: 'best_fields',
          operator: 'or',
          fuzziness: 'AUTO',
        },
      });
    }

    // 分类筛选
    if (category_id) {
      must.push({ term: { category_id } });
    }

    // 品牌筛选
    if (brand) {
      must.push({ term: { 'brand.keyword': brand } });
    }

    // 价格范围筛选
    if (min_price || max_price) {
      const range: any = {};
      if (min_price) range.gte = min_price;
      if (max_price) range.lte = max_price;
      must.push({ range: { price: range } });
    }

    // 排序字段映射
    const sortFieldMap: any = {
      price: 'price',
      sales: 'sales_count',
      created_at: 'created_at',
    };

    const sortField = sortFieldMap[sort_by] || 'sales_count';

    // 执行搜索
    const result = await esClient.search({
      index: PRODUCT_INDEX,
      body: {
        query: {
          bool: { must },
        },
        sort: [{ [sortField]: sort_order }],
        from: (page - 1) * page_size,
        size: page_size,
        track_total_hits: true,
      },
    });

    // 提取结果
    const hits = result.hits.hits;
    const total = typeof result.hits.total === 'number' 
      ? result.hits.total 
      : result.hits.total?.value || 0;

    const products = hits.map((hit: any) => ({
      ...hit._source,
      _score: hit._score,
    }));

    return {
      products,
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  } catch (error) {
    console.error('❌ ES 搜索失败:', error);
    throw error;
  }
}

/**
 * 获取搜索建议（自动补全）
 */
export async function getSearchSuggestions(prefix: string, limit: number = 10) {
  try {
    const result = await esClient.search({
      index: PRODUCT_INDEX,
      body: {
        suggest: {
          title_suggest: {
            prefix,
            completion: {
              field: 'title.keyword',
              size: limit,
              skip_duplicates: true,
            },
          },
        },
      },
    });

    const options = result.suggest?.title_suggest?.[0]?.options;
    if (Array.isArray(options)) {
      return options.map((option: any) => option.text);
    }
    return [];
  } catch (error) {
    console.error('❌ 获取搜索建议失败:', error);
    return [];
  }
}

/**
 * 检查 Elasticsearch 连接
 */
export async function checkESConnection() {
  try {
    const health = await esClient.cluster.health();
    console.log('✅ Elasticsearch 连接成功:', health);
    return true;
  } catch (error) {
    console.error('❌ Elasticsearch 连接失败:', error);
    return false;
  }
}

export default esClient;

