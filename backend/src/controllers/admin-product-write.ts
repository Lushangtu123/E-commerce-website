import logger from '../utils/logger';
import { getRedisClient } from '../database/redis';
import { syncProductsToSearchIndex } from '../services/product-search.service';
import { PRODUCT_HOT_CACHE_KEYS, productDetailCacheKeys } from '../utils/product-cache-keys';

/** After commit, refresh derived data. Audit is already part of the write transaction. */
export async function afterProductWrite(productIds: number[]) {
  try {
    await getRedisClient().del(...productIds.flatMap(productDetailCacheKeys), ...PRODUCT_HOT_CACHE_KEYS);
  } catch (error) {
    logger.warn({ err: error }, '商品已写入，缓存清理失败');
  }
  try {
    await syncProductsToSearchIndex(productIds);
  } catch (error) {
    logger.warn({ err: error }, '商品已写入，搜索索引刷新失败');
  }
}
