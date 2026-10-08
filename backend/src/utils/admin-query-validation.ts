import Joi from 'joi';

export class AdminQueryError extends Error {
  constructor() { super('后台查询参数无效'); }
}

// Query values are strings. Reject parseInt suffixes, coercion and unsafe offsets.
const decimal = (maximum: number, numeric = true) => Joi.string().pattern(/^[1-9]\d*$/).custom((value: string, helpers) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) return helpers.error('any.invalid');
  return numeric ? number : value;
});
const id = decimal(Number.MAX_SAFE_INTEGER, false);
const text = (maximum: number) => Joi.string().trim().max(maximum).allow('').prefs({convert: true});
const status = (...values: string[]) => Joi.string().custom((value: string, helpers) => values.includes(value) ? Number(value) : helpers.error('any.invalid'));
const date = Joi.string().pattern(/^[1-9]\d{3}-\d{2}-\d{2}$/).custom((value: string, helpers) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : helpers.error('any.invalid');
});
const dates = {startDate: date, endDate: date};
const pagination = (defaultLimit = 20) => ({page: decimal(10000).default(1), limit: decimal(100).default(defaultLimit)});
const object = <T>(fields: Joi.SchemaMap<T>) => Joi.object<T>(fields).required().unknown(false).prefs({convert: false});
const orderedDates = <T extends {startDate?: string; endDate?: string}>(schema: Joi.ObjectSchema<T>) => schema.custom((value: T, helpers) => {
  return value.startDate && value.endDate && value.startDate > value.endDate ? helpers.error('any.invalid') : value;
});

interface PageQuery {page: number; limit: number}
interface DateQuery {startDate?: string; endDate?: string}
export const adminProductsQuerySchema = object<PageQuery & {keyword?: string; categoryId?: string; status?: number}>({
  ...pagination(), keyword: text(100), categoryId: decimal(2147483647, false), status: status('-1', '0', '1'),
});
export const adminUsersQuerySchema = object<PageQuery & {keyword?: string; status?: number}>({
  ...pagination(), keyword: text(100), status: status('0', '1'),
});
export const adminOrdersQuerySchema = orderedDates(object<PageQuery & DateQuery & {orderNo?: string; userId?: string; status?: number}>({
  ...pagination(), ...dates, orderNo: text(32), userId: id, status: status('0', '1', '2', '3', '4'),
}));
export const adminLogsQuerySchema = orderedDates(object<PageQuery & DateQuery & {action?: string; adminId?: string}>({
  ...pagination(), ...dates, action: text(50), adminId: id,
}));
export const adminUserOrdersQuerySchema = object<PageQuery>(pagination(10));
export const adminDatesQuerySchema = orderedDates(object<DateQuery>(dates));
export const adminEmptyQuerySchema = object<Record<string, never>>({});
export const adminRecentOrdersQuerySchema = object<{limit: number}>({limit: decimal(100).default(10)});
export const adminTopProductsQuerySchema = object<{days: number; limit: number}>({days: decimal(365).default(7), limit: decimal(100).default(10)});
export const adminSalesTrendQuerySchema = object<{days: number}>({days: decimal(365).default(7)});

export function parseAdminQuery<T>(input: unknown, schema: Joi.ObjectSchema<T>): T {
  const {error, value} = schema.validate(input);
  if (error) throw new AdminQueryError();
  return value;
}

/** BIGINT IDs stay canonical strings so mysql2 never coerces a malformed path. */
export function adminUserPathId(input: unknown): string | undefined {
  const {error, value} = id.required().strict().validate(input);
  return error ? undefined : value;
}
