'use client';

import '@/lib/admin-i18n';
import type { Category } from '@/lib/api';
import type { SpecTranslations } from '@/lib/product-content';
import { useI18n } from '@/lib/i18n';
import ProductImage from '@/components/ProductImage';

/** The product form keeps numbers as strings while the administrator types. */
export interface ProductFormValues {
  title: string;
  title_en: string;
  description: string;
  description_en: string;
  /** Chinese attributes are reference data; editing their English text never rewrites this JSON. */
  specs?: unknown;
  specs_en?: SpecTranslations | null;
  price: string;
  stock: string;
  category_id: string;
  brand: string;
  main_image: string;
  status: number;
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  title: '', title_en: '', description: '', description_en: '', price: '', stock: '', category_id: '', brand: '', main_image: '', status: 1,
};

/** Whether the fields the API requires are filled in. */
export const isProductFormComplete = (values: ProductFormValues) => !!(values.title && values.price && values.category_id);

/** The create and update request body for a filled-in form. */
const specEntries = (specs: unknown): [string, unknown][] => specs && typeof specs === 'object' && !Array.isArray(specs) ? Object.entries(specs) : [];

function translatedSpecs(values: ProductFormValues, allowTypedValues = false) {
  const englishEntries: [string, SpecTranslations[string]][] = [];
  for (const [key, originalValue] of specEntries(values.specs)) {
    const translation = values.specs_en && Object.hasOwn(values.specs_en, key) ? values.specs_en[key] : undefined;
    const name = translation?.name?.trim() ?? '';
    const value = allowTypedValues || typeof originalValue === 'string' ? translation?.value?.trim() ?? '' : '';
    if (name.length > 50 || value.length > 100) throw new Error('英文规格名称最多50个字符，英文规格值最多100个字符');
    if (name || value) englishEntries.push([key, { ...(name && { name }), ...(value && { value }) }]);
  }
  return englishEntries.length ? Object.fromEntries(englishEntries) : null;
}

function productStock(value: string) {
  // Stock is optional for a new product, which starts with no inventory.
  if (value === '') return 0;
  const stock = Number(value);
  if (/[^0-9]/.test(value) || !Number.isInteger(stock) || stock > 2147483647) {
    throw new Error('库存须为0至2147483647的整数');
  }
  return stock;
}

export function toProductPayload(values: ProductFormValues, includeEmptyEnglish = false) {
  const titleEn = values.title_en.trim(), descriptionEn = values.description_en.trim();
  if (titleEn.length > 200) throw new Error('英文商品标题最多200个字符');
  const specsEn = translatedSpecs(values);
  return {
    title: values.title, description: values.description,
    ...((titleEn || includeEmptyEnglish) && { title_en: titleEn || null }),
    ...((descriptionEn || includeEmptyEnglish) && { description_en: descriptionEn || null }),
    ...((specsEn || includeEmptyEnglish) && { specs_en: specsEn }),
    price: parseFloat(values.price), stock: productStock(values.stock),
    category_id: parseInt(values.category_id), brand: values.brand,
    image_url: values.main_image, status: values.status,
  };
}

/** Updates only what the administrator changed, so an English edit cannot reset live inventory. */
export function toProductChanges(values: ProductFormValues, previous: ProductFormValues) {
  // Clearing existing stock must not silently reset live inventory to zero.
  if (values.stock === '') throw new Error('库存须为0至2147483647的整数');
  const payload = toProductPayload(values, true), original = { ...toProductPayload(previous, true), specs_en: translatedSpecs(previous, true) };
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(original[key as keyof typeof original]))) as Partial<typeof payload>;
}

interface Props {
  /** Prefixes the field ids, so each form's labels stay tied to its own inputs. */
  idPrefix: string;
  /** Already translated, like `submitLabel`. */
  heading: string;
  submitLabel: string;
  values: ProductFormValues;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesFailed: boolean;
  onRetryCategories: () => void;
  busy: boolean;
  onChange: (values: ProductFormValues) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const inputClass = 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

/** The modal used to add a product and to edit one. */
export default function AdminProductForm({ idPrefix, heading, submitLabel, values, categories, categoriesLoading, categoriesFailed, onRetryCategories, busy, onChange, onClose, onSubmit }: Props) {
  const { t } = useI18n();
  const id = (field: string) => `${idPrefix}-${field}`;
  const set = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => onChange({ ...values, [field]: value });
  const setSpec = (key: string, field: 'name' | 'value', value: string) => set('specs_en', {
    ...values.specs_en, [key]: { ...(values.specs_en && Object.hasOwn(values.specs_en, key) ? values.specs_en[key] : {}), [field]: value },
  });
  const required = <span className="text-red-500">*</span>;
  const categoriesUnavailable = categoriesLoading || categoriesFailed;
  const missingSelectedCategory = values.category_id !== '' && !categories.some(category => String(category.category_id) === values.category_id);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">{heading}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor={id('title')} className={labelClass}>{t('商品标题')} {required}</label>
              <input id={id('title')} type="text" value={values.title} onChange={e => set('title', e.target.value)}
                className={inputClass} placeholder={t('请输入商品标题')} />
            </div>

            <div>
              <label htmlFor={id('title-en')} className={labelClass}>{t('英文商品标题（可选）')}</label>
              <input id={id('title-en')} type="text" value={values.title_en} maxLength={200} onChange={e => set('title_en', e.target.value)}
                className={inputClass} placeholder={t('请输入英文商品标题')} />
            </div>

            <div>
              <label htmlFor={id('description')} className={labelClass}>{t('商品描述')}</label>
              <textarea id={id('description')} value={values.description} onChange={e => set('description', e.target.value)}
                rows={3} className={inputClass} placeholder={t('请输入商品描述')} />
            </div>

            <div>
              <label htmlFor={id('description-en')} className={labelClass}>{t('英文商品描述（可选）')}</label>
              <textarea id={id('description-en')} value={values.description_en} onChange={e => set('description_en', e.target.value)}
                rows={3} className={inputClass} placeholder={t('请输入英文商品描述')} />
            </div>

            {specEntries(values.specs).length > 0 && <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-gray-700">{t('商品属性英文翻译')}</legend>
              {specEntries(values.specs).map(([key, value], index) => {
                const translation = values.specs_en && Object.hasOwn(values.specs_en, key) ? values.specs_en[key] : undefined;
                return <div key={key} className="rounded-lg border border-gray-200 p-3 space-y-3">
                  <p className="text-sm text-gray-600 wrap-break-word">{key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label htmlFor={id(`spec-name-en-${index}`)} className={labelClass}>{t('英文规格名称 {index}（可选）', { index: index + 1 })}</label>
                      <input id={id(`spec-name-en-${index}`)} type="text" value={translation?.name ?? ''} maxLength={50} className={inputClass} onChange={e => setSpec(key, 'name', e.target.value)} /></div>
                    <div><label htmlFor={id(`spec-value-en-${index}`)} className={labelClass}>{t('英文规格值 {index}（可选）', { index: index + 1 })}</label>
                      <input id={id(`spec-value-en-${index}`)} type="text" value={typeof value === 'string' ? translation?.value ?? '' : ''} maxLength={100} disabled={typeof value !== 'string'} className={inputClass} onChange={e => setSpec(key, 'value', e.target.value)} />
                      {typeof value !== 'string' && <p className="mt-1 text-xs text-gray-500">{t('数字和布尔值保持原值')}</p>}</div>
                  </div>
                </div>;
              })}
            </fieldset>}
            <p className="text-sm text-gray-500">{t('英文内容可选，留空显示中文；清空已有英文可删除翻译')}</p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={id('price')} className={labelClass}>{t('价格 (元)')} {required}</label>
                <input id={id('price')} type="number" step="0.01" value={values.price} onChange={e => set('price', e.target.value)}
                  className={inputClass} placeholder="0.00" />
              </div>
              <div>
                <label htmlFor={id('stock')} className={labelClass}>{t('库存')}</label>
                <input id={id('stock')} type="text" inputMode="numeric" value={values.stock} onChange={e => set('stock', e.target.value)}
                  className={inputClass} placeholder="0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={id('category-id')} className={labelClass}>{t('分类')} {required}</label>
                <select id={id('category-id')} value={values.category_id} disabled={busy || categoriesUnavailable}
                  onChange={e => { if (!busy && !categoriesUnavailable) set('category_id', e.target.value); }} className={inputClass}>
                  <option value="">{t('请选择分类')}</option>
                  {missingSelectedCategory && <option value={values.category_id}>{t('当前分类（ID：{id}）', { id: values.category_id })}</option>}
                  {categories.map(category => (
                    <option key={category.category_id} value={category.category_id}>{category.name}</option>
                  ))}
                </select>
                {categoriesLoading && <p role="status" className="mt-2 text-sm text-gray-600">{t('正在加载分类...')}</p>}
                {categoriesFailed && <div role="alert" className="mt-2 text-sm text-red-700">
                  <p>{t('获取分类失败，请重新加载')}</p>
                  <button type="button" onClick={onRetryCategories} disabled={busy} className="mt-2 underline disabled:opacity-50">
                    {t('重新加载分类')}
                  </button>
                </div>}
              </div>
              <div>
                <label htmlFor={id('brand')} className={labelClass}>{t('品牌')}</label>
                <input id={id('brand')} type="text" value={values.brand} onChange={e => set('brand', e.target.value)}
                  className={inputClass} placeholder={t('请输入品牌')} />
              </div>
            </div>

            <div>
              <label htmlFor={id('main-image')} className={labelClass}>{t('商品图片URL')}</label>
              <input id={id('main-image')} type="text" value={values.main_image} onChange={e => set('main_image', e.target.value)}
                className={inputClass} placeholder="https://example.com/image.jpg" />
              {/* Shows the fallback for a broken URL, and recovers once the URL is corrected. */}
              {values.main_image && <ProductImage src={values.main_image} alt={t('预览')} className="mt-2 h-32 w-32 rounded-lg" />}
            </div>

            <div>
              <label htmlFor={id('status')} className={labelClass}>{t('状态')}</label>
              <select id={id('status')} value={values.status} onChange={e => set('status', parseInt(e.target.value))} className={inputClass}>
                <option value={1}>{t('上架')}</option>
                <option value={0}>{t('下架')}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              {t('取消')}
            </button>
            <button onClick={onSubmit} disabled={busy || categoriesUnavailable} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
