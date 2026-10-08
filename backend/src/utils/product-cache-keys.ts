// Skip cached DTOs from before bilingual product content; invalidate older deployments' keys too.
export const PRODUCT_HOT_CACHE_KEY = 'products:hot:v3';
export const PRODUCT_HOT_CACHE_KEYS = ['products:hot', 'products:hot:v2', PRODUCT_HOT_CACHE_KEY];
export const productDetailCacheKey = (productId: number) => `product:v2:${productId}`;
export const productDetailCacheKeys = (productId: number) => [`product:${productId}`, productDetailCacheKey(productId)];
