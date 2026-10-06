import { Suspense } from 'react';
import ProductListView, { type ProductListSeed } from '@/components/ProductList';
import { ProductCardSkeleton } from '@/components/ProductCard';
import type { ProductList } from '@/lib/api';
import { fetchApiResult } from '@/lib/site';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

/** Page one of the URL's search, or null when the API cannot answer, so the client loads it as before. */
async function loadSeed(params: SearchParams): Promise<ProductListSeed | null> {
  const keyword = first(params.keyword);
  const sort = first(params.sort) || 'created_at DESC';
  const search = new URLSearchParams({ ...(keyword && { keyword }), sort, page: '1', limit: '20' });
  const result = await fetchApiResult<ProductList>(`/products?${search}`, { revalidate: 60 });
  return result.kind === 'ok' && Array.isArray(result.data.products) ? { keyword, sort, list: result.data } : null;
}

// Server-rendered so the HTML already carries the first page of products.
export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const seed = await loadSeed(await searchParams);
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
      <ProductListView seed={seed} />
    </Suspense>
  );
}
