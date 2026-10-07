import { RowDataPacket } from 'mysql2';
import { query } from '../database/mysql';
import { customerProducts, Product, ProductModel } from '../models/product.model';
import { deleteProductFromES, ESSearchParams, getESClient, searchProductIds, syncProductToES } from '../database/elasticsearch';
import logger from '../utils/logger';

export type ProductSearchParams = ESSearchParams;

export interface ProductSearchResult {
  products: Product[];
  total: number;
  engine: 'elasticsearch' | 'mysql';
}

const SORT_COLUMNS = { price: 'price', sales: 'sales_count', created_at: 'created_at' } as const;

/** 顾客视图下的商品（SKU 商品取启用规格的最低价和合计库存） */
async function loadCustomerProducts(productIds: number[], onSaleOnly: boolean): Promise<Product[]> {
  if (!productIds.length) return [];
  return query<(Product & RowDataPacket)[]>(
    `SELECT * FROM (${customerProducts}) AS products
     WHERE product_id IN (${productIds.map(() => '?').join(',')})${onSaleOnly ? ' AND status = 1' : ''}`,
    productIds
  );
}

/**
 * 商品或 SKU 写入后同步搜索索引：存在的商品重新索引，已删除的从索引移除。
 * 搜索索引只是副本，同步失败只记录日志，不影响已提交的写入。
 */
export async function syncProductsToSearchIndex(productIds: number[]): Promise<void> {
  if (!getESClient() || !productIds.length) return;
  const ids = [...new Set(productIds)];
  try {
    const found = new Map((await loadCustomerProducts(ids, false)).map(product => [Number(product.product_id), product]));
    await Promise.all(ids.map(async id => {
      try {
        const product = found.get(id);
        await (product ? syncProductToES(product) : deleteProductFromES(id));
      } catch (error) {
        logger.warn({ err: error }, `商品 ${id} 搜索索引同步失败，可运行 sync-es 重建索引`);
      }
    }));
  } catch (error) {
    logger.warn({ err: error }, '读取商品失败，搜索索引未同步');
  }
}

async function searchWithMySQL(params: ProductSearchParams): Promise<ProductSearchResult> {
  const { keyword, category_id, min_price, max_price, brand, sort_by, sort_order, page, page_size } = params;
  const { products, total } = await ProductModel.list({
    keyword, category_id, min_price, max_price, brand,
    sort: `${SORT_COLUMNS[sort_by]} ${sort_order.toUpperCase()}`,
    page, limit: page_size,
  });
  return { products, total, engine: 'mysql' };
}

/**
 * 商品搜索：已配置 Elasticsearch 时用它做全文匹配和排序，再从 MySQL 读取当前价格、库存和上架状态；
 * 未配置或 ES 出错时回退到 MySQL 搜索，保证搜索始终可用
 */
export async function searchProducts(params: ProductSearchParams): Promise<ProductSearchResult> {
  if (getESClient()) {
    try {
      const { ids, total } = await searchProductIds(params);
      const byId = new Map((await loadCustomerProducts(ids, true)).map(product => [Number(product.product_id), product]));
      return { products: ids.flatMap(id => byId.get(id) ?? []), total, engine: 'elasticsearch' };
    } catch (error) {
      logger.warn({ err: error }, 'Elasticsearch 搜索失败，回退到 MySQL');
    }
  }
  return searchWithMySQL(params);
}
