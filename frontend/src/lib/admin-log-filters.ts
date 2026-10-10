export const logFilterKeys = ['action', 'adminId', 'startDate', 'endDate'] as const;
export type LogFilters = Record<typeof logFilterKeys[number], string>;
export const emptyLogFilters: LogFilters = { action: '', adminId: '', startDate: '', endDate: '' };
export const logFilterError = '日志筛选条件无效，请检查后重试';

export const logActionLabels: Record<string, string> = {
  LOGIN: '登录', CREATE_PRODUCT: '创建商品', UPDATE_PRODUCT: '更新商品', DELETE_PRODUCT: '删除商品',
  UPDATE_PRODUCT_STATUS: '更新商品状态', BATCH_UPDATE_PRODUCT_STATUS: '批量更新商品状态',
  UPDATE_ORDER_STATUS: '更新订单状态', UPDATE_USER_STATUS: '更新用户状态',
  CREATE_COUPON: '创建优惠券', UPDATE_COUPON: '更新优惠券', UPDATE_COUPON_STATUS: '更新优惠券状态',
  CREATE_SKU: '创建SKU', BATCH_CREATE_SKU: '批量创建SKU', UPDATE_SKU: '更新SKU', DELETE_SKU: '删除SKU',
  REVIEW_AFTER_SALES: '审核售后申请', COMPLETE_AFTER_SALES: '售后结案',
};

const positive = (value: string, maximum: number) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= maximum;
const validDate = (value: string) => {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Match the existing API's canonical IDs and calendar dates before issuing a read. */
export function normalizeLogFilters(draft: LogFilters) {
  const filters = Object.fromEntries(logFilterKeys.map(key => [key, draft[key].trim()])) as LogFilters;
  const invalid = filters.action.length > 50 ||
    (!!filters.adminId && !positive(filters.adminId, Number.MAX_SAFE_INTEGER)) ||
    (!!filters.startDate && !validDate(filters.startDate)) || (!!filters.endDate && !validDate(filters.endDate)) ||
    (!!filters.startDate && !!filters.endDate && filters.startDate > filters.endDate);
  return { filters, error: invalid ? logFilterError : undefined };
}

export function readLogFilters(search: string) {
  const params = new URLSearchParams(search);
  const draft = Object.fromEntries(logFilterKeys.map(key => [key, params.get(key) ?? ''])) as LogFilters;
  const normalized = normalizeLogFilters(draft);
  const page = params.get('page');
  const invalid = [...logFilterKeys, 'page'].some(key => params.getAll(key).length > 1) ||
    (page !== null && !positive(page, 10000));
  return { ...normalized, page: page !== null && !invalid ? Number(page) : 1, error: invalid ? logFilterError : normalized.error };
}

/** Only replace this view's keys; unrelated URL parameters survive navigation. */
export function logFiltersUrl(search: string, filters: LogFilters, page = 1) {
  const params = new URLSearchParams(search);
  for (const key of logFilterKeys) {
    params.delete(key);
    if (filters[key]) params.set(key, filters[key]);
  }
  params.delete('page');
  if (page > 1) params.set('page', String(page));
  const next = params.toString();
  return `/admin/logs${next ? `?${next}` : ''}`;
}
