import Joi from 'joi';

export class CustomerActivityError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

const productId = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER);
const queryInteger = (maximum: number) => Joi.string().pattern(/^[1-9]\d*$/).custom((value: string, helpers) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : helpers.error('any.invalid');
});

export const activityListSchema = Joi.object({
  page: queryInteger(2147483647).default(1),
  limit: queryInteger(100).default(20),
}).required().unknown(false).prefs({ convert: false });

export const activityProductSchema = Joi.object({ product_id: productId.required() })
  .required().unknown(false).prefs({ convert: false });
export const activityBatchSchema = Joi.object({ product_ids: Joi.array().items(productId).min(1).max(100).required() })
  .required().unknown(false).prefs({ convert: false });

export function assertActivityId(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new CustomerActivityError('用户或商品ID无效');
}

export function activityPathId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new CustomerActivityError('商品ID无效');
  const id = Number(value); assertActivityId(id); return id;
}

export function assertActivityPage(userId: unknown, page: unknown, limit: unknown): void {
  assertActivityId(userId);
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 2147483647 ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new CustomerActivityError('分页参数无效');
  }
}

export function assertActivityBatch(ids: unknown): asserts ids is number[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) throw new CustomerActivityError('商品ID列表无效');
  for (const id of ids) assertActivityId(id);
}

/** Preserve activity identity and counts for orphan rows while exposing no purchasable product. */
export function activityProductDTO<T extends Record<string, any>>(row: T) {
  const { existing_product_id, ...item } = row;
  return existing_product_id == null
    ? { ...item, title: '商品已不存在', price: 0, stock: 0, status: -1, has_sku: 0 }
    : item;
}
