import Joi from 'joi';

// Keep every search entry point within search_history.keyword VARCHAR(100).
export const SEARCH_KEYWORD_LIMIT = 100;
export const searchKeyword = Joi.string().trim().max(SEARCH_KEYWORD_LIMIT).prefs({ convert: true });
const queryInteger = (maximum: number) => Joi.string().pattern(/^[1-9]\d*$/).custom((value: string, helpers) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : helpers.error('any.invalid');
});
const limit = queryInteger(100);

export const searchRecordSchema = Joi.object({
  keyword: searchKeyword.min(1).required(),
  result_count: Joi.number().integer().min(0).max(2147483647).strict().default(0),
}).required().unknown(false);

export const searchHistorySchema = Joi.object({ limit: limit.default(10) })
  .required().unknown(false).prefs({ convert: false });
export const hotSearchSchema = Joi.object({ days: queryInteger(365).default(7), limit: limit.default(10) })
  .required().unknown(false).prefs({ convert: false });
export const searchSuggestionsSchema = Joi.object({ keyword: searchKeyword.allow('').default(''), limit: limit.default(5) })
  .required().unknown(false).prefs({ convert: false });
