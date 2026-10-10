import { Suspense } from 'react';
import ProductListView, { type ProductListSeed } from '@/components/ProductList';
import { ProductCardSkeleton } from '@/components/ProductCard';
import type { ProductList } from '@/lib/api';
import { fetchApiResult } from '@/lib/site';
import { CATALOG_SORTS, catalogFilterParams, parseCatalogFilters, parseCatalogPage, readCatalogDraft } from '@/lib/catalog-filters';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

/** The URL's requested page, or null when the API cannot answer so the client can retry. */
async function loadSeed(params: SearchParams): Promise<ProductListSeed | null> {
  const keyword = first(params.keyword);
  const sort = first(params.sort) || 'created_at DESC';
  const { filters, error } = parseCatalogFilters(readCatalogDraft({ get: key => first(params[key]) }));
  if (error || !CATALOG_SORTS.includes(sort)) return null;
  const search = new URLSearchParams({ ...(keyword && { keyword }), sort, ...catalogFilterParams(filters), page: String(parseCatalogPage(params.page)), limit: '20' });
  const result = await fetchApiResult<ProductList>(`/products?${search}`, { revalidate: 60 });
  return result.kind === 'ok' && Array.isArray(result.data.products) ? { keyword, sort, filters, list: result.data } : null;
}

// Server-rendered so shared links already carry their requested page of products.
export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const initialSearch = new URLSearchParams(Object.entries(params).flatMap(([key, value]) =>
    value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(item => [key, item]))).toString();
  const seed = await loadSeed(params);
  return (
    <Suspense fallback={
      <div className="py-10">
        <div className="container-custom">
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {[...Array(12)].map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        </div>
      </div>
    }>
      <ProductListView seed={seed} initialSearch={initialSearch} />
    </Suspense>
  );
}
