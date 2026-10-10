'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productApi } from '@/lib/api';
import { CATALOG_FILTER_KEYS, parseCatalogFilters, type CatalogFilterDraft, type CatalogFilters as Filters } from '@/lib/catalog-filters';
import { useI18n } from '@/lib/i18n';

export default function CatalogFilters({ initial, scope, onApply }: { initial: CatalogFilterDraft; scope: string; onApply: (filters: Filters) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState({ scope, draft: initial, error: '' });
  // Navigation restores the URL's applied filters; a draft stays local until Apply is pressed.
  if (state.scope !== scope) setState({ scope, draft: initial, error: '' });
  const draft = state.scope === scope ? state.draft : initial;
  const categoriesQuery = useQuery({ queryKey: ['catalog-categories'], queryFn: () => productApi.getCategories(), staleTime: 60_000 });
  const categories = categoriesQuery.data ?? [];
  const missingCategory = draft.category_id !== '' && !categories.some(category => String(category.category_id) === draft.category_id);
  const change = (key: keyof CatalogFilterDraft, value: string) => setState({ scope, draft: { ...draft, [key]: value }, error: '' });

  return (
    <form aria-label={t('商品筛选')} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" noValidate onSubmit={event => {
      event.preventDefault();
      const parsed = parseCatalogFilters(draft);
      if (parsed.error) { setState({ scope, draft, error: parsed.error }); return; }
      onApply(parsed.filters);
    }}>
      <div>
        <label htmlFor="catalog-category" className="mb-1 block text-sm text-gray-600">{t('商品分类')}</label>
        <select id="catalog-category" className="input" value={draft.category_id} onChange={event => change('category_id', event.target.value)}>
          <option value="">{t('全部分类')}</option>
          {missingCategory && <option value={draft.category_id}>{t('分类编号：{id}', { id: draft.category_id })}</option>}
          {categories.map(category => <option key={category.category_id} value={category.category_id}>{t(category.name)}</option>)}
        </select>
        {categoriesQuery.isError && <div className="mt-1 text-sm" role="status">
          <span>{t('分类暂时无法加载')}</span>{' '}
          <button type="button" className="text-gray-900 underline" onClick={() => void categoriesQuery.refetch()}>{t('重试')}</button>
        </div>}
      </div>
      <div>
        <label htmlFor="catalog-brand" className="mb-1 block text-sm text-gray-600">{t('商品品牌')}</label>
        <input id="catalog-brand" className="input" maxLength={100} value={draft.brand} onChange={event => change('brand', event.target.value)} />
      </div>
      {(['min_price', 'max_price'] as const).map(key => <div key={key}>
        <label htmlFor={`catalog-${key}`} className="mb-1 block text-sm text-gray-600">{t(key === 'min_price' ? '最低价（元）' : '最高价（元）')}</label>
        <input id={`catalog-${key}`} className="input" inputMode="decimal" value={draft[key]} onChange={event => change(key, event.target.value)} />
      </div>)}
      {state.scope === scope && state.error && <p role="alert" className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{t(state.error)}</p>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className="btn btn-primary">{t('应用筛选')}</button>
        <button type="button" className="btn btn-secondary" onClick={() => {
          setState({ scope, draft: Object.fromEntries(CATALOG_FILTER_KEYS.map(key => [key, ''])) as unknown as CatalogFilterDraft, error: '' });
          onApply({});
        }}>{t('重置筛选')}</button>
      </div>
    </form>
  );
}
