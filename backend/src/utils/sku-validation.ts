import Joi from 'joi';

const money = Joi.number().min(0).max(99999999.99).precision(2);
const skuFields = {
  sku_code: Joi.string().pattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/),
  specs: Joi.object().pattern(
    Joi.string().min(1).max(50),
    Joi.alternatives().try(Joi.string().min(1).max(100), Joi.number(), Joi.boolean())
  ).min(1).max(20),
  price: money,
  original_price: money.allow(null),
  stock: Joi.number().integer().min(0).max(2147483647),
  image: Joi.string().max(255).allow('', null),
  status: Joi.number().valid(0, 1),
};

export const skuCreateSchema = Joi.object(skuFields).keys({
  sku_code: skuFields.sku_code.required(),
  specs: skuFields.specs.required(),
  price: skuFields.price.required(),
  stock: skuFields.stock.default(0),
  status: skuFields.status.default(1),
}).unknown(false).prefs({ convert: false });

export const skuUpdateSchema = Joi.object(skuFields).min(1).unknown(false).prefs({ convert: false });
export const skuBatchSchema = Joi.object({
  skus: Joi.array().items(skuCreateSchema).min(1).max(100).required(),
}).unknown(false).prefs({ convert: false });

export function validSKUId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}
