import Joi from 'joi';

export class ReviewError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export interface ReviewInput {
  product_id: number;
  order_id: number;
  rating: number;
  content?: string | null;
  images?: string[];
}

const id = Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER);
export const reviewCreateSchema = Joi.object({
  product_id: id.required(),
  order_id: id.required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  content: Joi.string().allow('', null).max(2000),
  images: Joi.array().max(9).items(Joi.string().max(2048).uri({ scheme: ['http', 'https'] })),
}).required().unknown(false).prefs({ convert: false });

const queryInteger = (maximum: number) => Joi.string().pattern(/^[1-9]\d*$/).custom((value: string, helpers) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : helpers.error('any.invalid');
});
export const reviewListSchema = Joi.object({
  page: queryInteger(2147483647).default(1),
  limit: queryInteger(100).default(10),
}).required().unknown(false).prefs({ convert: false });
const myReviewListSchema = reviewListSchema.keys({ order_id: queryInteger(Number.MAX_SAFE_INTEGER) });

export function parseReviewInput(body: unknown): ReviewInput {
  const { error, value } = reviewCreateSchema.validate(body);
  if (error) throw new ReviewError('评论参数或字段无效');
  return value;
}

export function assertReviewId(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new ReviewError('用户或商品或订单ID无效');
}

export function reviewProductPathId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new ReviewError('商品ID无效');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new ReviewError('商品ID无效');
  return number;
}

export function parseReviewPage(parameters: unknown): { page: number; limit: number } {
  const { error, value } = reviewListSchema.validate(parameters);
  if (error) throw new ReviewError('分页参数无效');
  return value;
}

export function parseMyReviewPage(parameters: unknown): { page: number; limit: number; order_id?: number } {
  const { error, value } = myReviewListSchema.validate(parameters);
  if (error) throw new ReviewError('分页参数无效');
  return value;
}

export function assertReviewPage(identity: unknown, page: unknown, limit: unknown): void {
  assertReviewId(identity);
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 2147483647 ||
      typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ReviewError('分页参数无效');
}
