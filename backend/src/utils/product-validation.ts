import Joi from 'joi';
import { searchKeyword } from './search-validation';

export const PRODUCT_SORTS: Record<string, string> = Object.freeze({
  'created_at DESC': 'created_at DESC',
  'created_at ASC': 'created_at ASC',
  'price ASC': 'price ASC',
  'price DESC': 'price DESC',
  'sales_count DESC': 'sales_count DESC',
  'sales_count ASC': 'sales_count ASC',
  'rating DESC': 'rating DESC',
  price: 'price ASC',
  sales: 'sales_count DESC',
});

const integer = Joi.number().integer().min(1).max(2147483647);
const money = Joi.number().min(0).max(99999999.99).precision(2);
export const productQuerySchema = Joi.object({
  category_id: integer,
  keyword: searchKeyword.allow(''),
  brand: Joi.string().max(100),
  min_price: money,
  max_price: money.min(Joi.ref('min_price', { adjust: value => value ?? 0 })),
  sort: Joi.string().valid(...Object.keys(PRODUCT_SORTS)).default('created_at DESC'),
  page: integer.default(1),
  limit: integer.max(100).default(20),
}).unknown(false);

const productFields = {
  title: Joi.string().trim().min(1).max(200),
  description: Joi.string().allow('', null),
  category_id: integer.allow(null),
  brand: Joi.string().max(100).allow('', null),
  price: money,
  original_price: money.allow(null),
  stock: Joi.number().integer().min(0).max(2147483647),
  main_image: Joi.string().max(255).allow('', null),
  images: Joi.array().items(Joi.string().max(500)).allow(null),
  specs: Joi.object().unknown(true).allow(null),
  status: Joi.number().valid(0, 1),
};

// Body values are strict: numeric strings, arbitrary SQL columns and server-owned fields are rejected.
export const productCreateSchema = Joi.object(productFields).keys({
  title: productFields.title.required(),
  price: productFields.price.required(),
  stock: productFields.stock.default(0),
  status: productFields.status.default(1),
}).unknown(false).prefs({ convert: false });

export const productUpdateSchema = Joi.object(productFields).min(1).unknown(false).prefs({ convert: false });

export function positiveId(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : undefined;
}
