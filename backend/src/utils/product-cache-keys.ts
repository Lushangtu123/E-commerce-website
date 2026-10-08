// Skip pre-SKU-price hot DTOs on rollout; keep their key in write invalidation for older deployments.
export const PRODUCT_HOT_CACHE_KEY = 'products:hot:v2';
export const PRODUCT_HOT_CACHE_KEYS = ['products:hot', PRODUCT_HOT_CACHE_KEY];
