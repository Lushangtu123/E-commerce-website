import Joi from 'joi';
import { positiveId } from './product-validation';

export class RecommendationError extends Error {
  readonly statusCode = 400;
}
const schema = Joi.object({
  limit: Joi.string().pattern(/^[1-9]\d*$/).custom((value: string, helpers) => {
    const limit = Number(value);
    return Number.isSafeInteger(limit) && limit <= 50 ? limit : helpers.error('any.invalid');
  }).default(10),
}).required().unknown(false).prefs({ convert: false });

export function recommendationLimit(query: unknown): number {
  const { error, value } = schema.validate(query);
  if (error) throw new RecommendationError('推荐查询参数无效');
  return value.limit;
}
export function recommendationProductId(value: unknown): number {
  const id = positiveId(value);
  if (!id) throw new RecommendationError('商品ID无效');
  return id;
}
