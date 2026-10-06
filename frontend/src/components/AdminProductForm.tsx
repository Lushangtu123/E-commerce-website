'use client';

import type { Category } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import ProductImage from '@/components/ProductImage';

/** The product form keeps numbers as strings while the administrator types. */
export interface ProductFormValues {
  title: string;
  description: string;
  price: string;
  stock: string;
  category_id: string;
  brand: string;
  main_image: string;
  status: number;
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  title: '', description: '', price: '', stock: '', category_id: '', brand: '', main_image: '', status: 1,
};

/** Whether the fields the API requires are filled in. */
export const isProductFormComplete = (values: ProductFormValues) => !!(values.title && values.price && values.category_id);

/** The create and update request body for a filled-in form. */
export function toProductPayload(values: ProductFormValues) {
  return {
    title: values.title, description: values.description,
    price: parseFloat(values.price), stock: parseInt(values.stock) || 0,
    category_id: parseInt(values.category_id), brand: values.brand,
    image_url: values.main_image, status: values.status,
  };
}

interface Props {
  /** Prefixes the field ids, so each form's labels stay tied to its own inputs. */
  idPrefix: string;
  /** Already translated, like `submitLabel`. */
  heading: string;
  submitLabel: string;
  values: ProductFormValues;
  categories: Category[];
  busy: boolean;
  onChange: (values: ProductFormValues) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const inputClass = 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

/** The modal used to add a product and to edit one. */
export default function AdminProductForm({ idPrefix, heading, submitLabel, values, categories, busy, onChange, onClose, onSubmit }: Props) {
  const { t } = useI18n();
  const id = (field: string) => `${idPrefix}-${field}`;
  const set = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => onChange({ ...values, [field]: value });
  const required = <span className="text-red-500">*</span>;

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
              <label htmlFor={id('description')} className={labelClass}>{t('商品描述')}</label>
              <textarea id={id('description')} value={values.description} onChange={e => set('description', e.target.value)}
                rows={3} className={inputClass} placeholder={t('请输入商品描述')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={id('price')} className={labelClass}>{t('价格 (元)')} {required}</label>
                <input id={id('price')} type="number" step="0.01" value={values.price} onChange={e => set('price', e.target.value)}
                  className={inputClass} placeholder="0.00" />
              </div>
              <div>
                <label htmlFor={id('stock')} className={labelClass}>{t('库存')}</label>
                <input id={id('stock')} type="number" value={values.stock} onChange={e => set('stock', e.target.value)}
                  className={inputClass} placeholder="0" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor={id('category-id')} className={labelClass}>{t('分类')} {required}</label>
                <select id={id('category-id')} value={values.category_id} onChange={e => set('category_id', e.target.value)} className={inputClass}>
                  <option value="">{t('请选择分类')}</option>
                  {categories.map(category => (
                    <option key={category.category_id} value={category.category_id}>{category.name}</option>
                  ))}
                </select>
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
            <button onClick={onSubmit} disabled={busy} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
