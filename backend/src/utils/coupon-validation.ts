import Joi from 'joi';

const positiveId = Joi.number().integer().min(1).max(2147483647);
const money = Joi.number().min(0).max(99999999.99).precision(2);
const pagination = {
  page: positiveId.default(1),
  page_size: Joi.number().integer().min(1).max(100).default(20),
};

export const couponCreateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().max(1000).allow('', null).default(null),
  type: Joi.number().valid(1, 2, 3).required(),
  discount_value: money.greater(0).when('type', { is: 2, then: money.greater(0).max(100) }).required(),
  min_amount: money.when('type', { is: 3, then: Joi.number().valid(0) }).default(0),
  // null, omitted and zero all retain the existing "no cap" convention.
  max_discount: money.allow(null).default(null),
  total_quantity: positiveId.required(),
  per_user_limit: positiveId.default(1),
  start_time: Joi.date().iso().prefs({ convert: true }).required(),
  end_time: Joi.date().iso().greater(Joi.ref('start_time')).prefs({ convert: true }).required(),
  status: Joi.number().valid(0, 1).default(1),
}).unknown(false).prefs({ convert: false });

export const couponIdSchema = Joi.object({ id: positiveId.required() }).unknown(false);
export const couponListSchema = Joi.object(pagination).unknown(false);
export const adminCouponListSchema = Joi.object({ ...pagination, status: Joi.number().valid(0, 1) }).unknown(false);
export const userCouponListSchema = Joi.object({ status: Joi.number().valid(1, 2, 3) }).unknown(false);
export const couponStatusSchema = Joi.object({ status: Joi.number().valid(0, 1).required() })
  .unknown(false).prefs({ convert: false });

export const couponReceiveSchema = Joi.object({
  coupon_id: positiveId,
  code: Joi.string().trim().min(1).max(50),
}).xor('coupon_id', 'code').unknown(false).prefs({ convert: false });

// Query strings must be complete decimal amounts; parseFloat-style prefixes are rejected.
export const couponAmountQuerySchema = Joi.object({
  amount: Joi.alternatives().try(
    money.greater(0).strict(),
    Joi.string().pattern(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/).custom((value, helpers) => {
      const amount = Number(value);
      return amount > 0 && amount <= 99999999.99 ? amount : helpers.error('any.invalid');
    })
  ).required(),
}).unknown(false);

export const couponCalculateSchema = Joi.object({
  user_coupon_id: positiveId.required(),
  order_amount: money.greater(0).required(),
}).unknown(false).prefs({ convert: false });
