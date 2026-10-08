// Skip DTOs with legacy synthetic ratings; invalidate older deployments' keys too.
export const PRODUCT_HOT_CACHE_KEY = 'products:hot:v4';
export const PRODUCT_HOT_CACHE_KEYS = ['products:hot', 'products:hot:v2', 'products:hot:v3', PRODUCT_HOT_CACHE_KEY];
export const productDetailCacheKey = (productId: number) => `product:v3:${productId}`;
export const productDetailCacheKeys = (productId: number) => [`product:${productId}`, `product:v2:${productId}`, productDetailCacheKey(productId)];
