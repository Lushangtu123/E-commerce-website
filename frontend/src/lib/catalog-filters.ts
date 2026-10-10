/** Shared by the server first page and the client query; invalid URLs never silently widen a search. */
export interface CatalogFilters {
  category_id?: number;
  brand?: string;
  min_price?: number;
  max_price?: number;
}

export interface CatalogFilterDraft {
  category_id: string;
  brand: string;
  min_price: string;
  max_price: string;
}

export const CATALOG_FILTER_KEYS = ['category_id', 'brand', 'min_price', 'max_price'] as const;
export const CATALOG_SORTS = ['created_at DESC', 'created_at ASC', 'price ASC', 'price DESC', 'sales_count DESC', 'sales_count ASC', 'rating DESC', 'price', 'sales'];

export function readCatalogDraft(params: { get(name: string): string | null }): CatalogFilterDraft {
  return Object.fromEntries(CATALOG_FILTER_KEYS.map(key => [key, params.get(key) ?? ''])) as unknown as CatalogFilterDraft;
}

export function parseCatalogFilters(draft: CatalogFilterDraft): { filters: CatalogFilters; error?: string } {
  const filters: CatalogFilters = {};
  if (draft.category_id !== '') {
    const id = Number(draft.category_id);
    if (!/^[1-9]\d*$/.test(draft.category_id) || !Number.isSafeInteger(id) || id > 2147483647) return { filters, error: '请选择有效的商品分类' };
    filters.category_id = id;
  }
  if (draft.brand.length > 100) return { filters, error: '品牌不能超过100个字符' };
  if (draft.brand !== '') filters.brand = draft.brand;
  for (const key of ['min_price', 'max_price'] as const) {
    if (draft[key] === '') continue;
    const amount = Number(draft[key]);
    if (!/^\d+(?:\.\d{1,2})?$/.test(draft[key]) || amount > 99999999.99) return { filters, error: '价格须为0至99999999.99，最多两位小数' };
    filters[key] = amount;
  }
  if (filters.max_price !== undefined && filters.max_price < (filters.min_price ?? 0)) return { filters, error: '最高价不能低于最低价' };
  return { filters };
}

export function catalogFilterParams(filters: CatalogFilters): Record<string, string> {
  return Object.fromEntries(CATALOG_FILTER_KEYS.filter(key => filters[key] !== undefined).map(key => [key, String(filters[key])]));
}
