import api from './client';
import type { AdminSKU } from './admin';
import type { SpecTranslations } from '@/lib/product-content';

// 商品相关API
/** MySQL DECIMAL columns arrive as strings, so prices may be either. */
export type Money = number | string;

export interface Product {
  product_id: number;
  title: string;
  title_en?: string | null;
  description?: string | null;
  description_en?: string | null;
  specs?: Record<string, unknown> | null;
  specs_en?: SpecTranslations | null;
  category_id?: number | null;
  category_name?: string | null;
  brand?: string | null;
  price: Money;
  original_price?: Money | null;
  stock: number;
  sales_count: number;
  rating: number | string;
  /** Actual published review count; zero means the product has not been rated. */
  review_count?: number;
  main_image?: string | null;
  images?: string[] | null;
  status?: number;
  has_sku?: boolean | number;
  /** Active variants, present on the detail response when the product has SKUs. */
  skus?: AdminSKU[];
  created_at?: string;
}

export interface ProductList {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const productApi = {
  list: (params?: object) => api.get<unknown, ProductList>('/products', { params }),
  getDetail: (id: number) => api.get<unknown, { product: Product }>(`/products/${id}`),
  getHotProducts: (limit?: number) => api.get<unknown, { products: Product[] }>('/products/hot', { params: { limit } }),
};

// 评论相关API
export interface PurchaseReview {
  review_id: number;
  product_id: number;
  order_id: number;
  user_id: number;
  rating: number;
  content?: string | null;
  created_at?: string;
}

export interface ProductReview {
  review_id: number;
  rating: number;
  content?: string | null;
  username?: string | null;
  created_at?: string;
}

export const reviewApi = {
  create: (data: { product_id: number; order_id: number; rating: number; content?: string; images?: string[] }) =>
    api.post<unknown, { review_id: number; message: string }>('/reviews', data),
  listByProduct: (productId: number, params?: object) =>
    api.get<unknown, { reviews: ProductReview[]; total: number; totalPages: number }>(`/reviews/product/${productId}`, { params }),
  listByUser: (params?: { page?: number; limit?: number; order_id?: number }) =>
    api.get<unknown, { reviews: PurchaseReview[]; totalPages: number }>('/reviews/my', { params }),
};

// 收藏相关API
/** Paginated customer activity; the row type is the page's own view of a product. */
export interface ActivityPage<T> {
  favorites?: T[];
  history?: T[];
  pagination?: { page?: number; limit?: number; total?: number; total_pages?: number };
}

export const favoriteApi = {
  add: (productId: number) => api.post<unknown, { message: string; favorite_id?: number; already_favorited?: boolean }>('/favorites', { product_id: productId }),
  remove: (productId: number) => api.delete<unknown, { message: string }>(`/favorites/${productId}`),
  toggle: (productId: number) => api.post<unknown, { message: string; is_favorited: boolean; favorite_id?: number }>('/favorites/toggle', { product_id: productId }),
  check: (productId: number) => api.get<unknown, { is_favorited: boolean }>(`/favorites/check/${productId}`),
  checkMultiple: (productIds: number[]) => api.post('/favorites/check-multiple', { product_ids: productIds }),
  list: <T,>(params?: object) => api.get<unknown, ActivityPage<T>>('/favorites/my', { params }),
  getCount: () => api.get('/favorites/count'),
};

// 搜索相关API
export interface SearchKeyword {
  keyword: string;
  created_at?: string;
}

export interface HotKeyword {
  keyword: string;
  search_count: number;
  total_results?: number | string | null;
}

export const searchApi = {
  record: (keyword: string, resultCount?: number) => api.post('/search/record', { keyword, result_count: resultCount }),
  getHistory: (limit?: number) => api.get<unknown, { history: SearchKeyword[] }>('/search/history', { params: { limit } }),
  getHot: (days?: number, limit?: number) => api.get<unknown, { keywords: HotKeyword[] }>('/search/hot', { params: { days, limit } }),
  getSuggestions: (keyword: string, limit?: number) => api.get('/search/suggestions', { params: { keyword, limit } }),
  clearHistory: () => api.delete('/search/history'),
  deleteKeyword: (keyword: string) => api.delete(`/search/history/${encodeURIComponent(keyword)}`),
};

// 浏览历史相关API
export const browseApi = {
  record: (productId: number) => api.post('/browse/record', { product_id: productId }),
  getHistory: <T,>(params?: object) => api.get<unknown, ActivityPage<T>>('/browse/history', { params }),
  clearHistory: () => api.delete('/browse/history'),
  deleteRecord: (productId: number) => api.delete(`/browse/history/${productId}`),
};

// 推荐相关API
export const recommendationApi = {
  // 个性化推荐（需要登录）
  getPersonalized: (limit?: number) =>
    api.get<unknown, { recommendations: Product[] }>('/recommendations/personalized', { params: { limit } }),
  
  // 相关商品推荐
  getRelated: (productId: number, limit?: number) =>
    api.get<unknown, { related_products: Product[] }>(`/recommendations/related/${productId}`, { params: { limit } }),
  
  // 猜你喜欢（可选登录）
  getGuessYouLike: (limit?: number) =>
    api.get<unknown, { recommendations: Product[] }>('/recommendations/guess-you-like', { params: { limit } }),
};
