import Joi from 'joi';

/** Translations use the original specification keys; missing parts fall back to their original content. */
export type SpecsTranslation = Record<string, { name?: string; value?: string }>;

export const specsTranslationSchema = Joi.object().pattern(
  Joi.string().trim().min(1).max(50),
  Joi.object({
    name: Joi.string().trim().min(1).max(50),
    value: Joi.string().trim().min(1).max(100),
  }).min(1).unknown(false)
).max(20).allow(null);
