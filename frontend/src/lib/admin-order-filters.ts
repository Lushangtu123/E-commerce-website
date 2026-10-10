export const orderFilterKeys = ['orderNo', 'status', 'userId', 'startDate', 'endDate'] as const;
export type OrderFilters = Record<typeof orderFilterKeys[number], string>;
export const emptyOrderFilters: OrderFilters = { orderNo: '', status: '', userId: '', startDate: '', endDate: '' };
export const orderFilterError = '订单筛选条件无效，请检查后重试';

const positive = (value: string, maximum: number) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= maximum;
const validDate = (value: string) => {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Match the existing API's canonical IDs and calendar dates before issuing a read. */
export function normalizeOrderFilters(draft: OrderFilters) {
  const filters = Object.fromEntries(orderFilterKeys.map(key => [key, draft[key].trim()])) as OrderFilters;
  const invalid = filters.orderNo.length > 32 || !['', '0', '1', '2', '3', '4'].includes(filters.status) ||
    (!!filters.userId && !positive(filters.userId, Number.MAX_SAFE_INTEGER)) ||
    (!!filters.startDate && !validDate(filters.startDate)) || (!!filters.endDate && !validDate(filters.endDate)) ||
    (!!filters.startDate && !!filters.endDate && filters.startDate > filters.endDate);
  return { filters, error: invalid ? orderFilterError : undefined };
}

export function readOrderFilters(search: string) {
  const params = new URLSearchParams(search);
  const draft = Object.fromEntries(orderFilterKeys.map(key => [key, params.get(key) ?? ''])) as OrderFilters;
  const normalized = normalizeOrderFilters(draft);
  const page = params.get('page');
  const invalid = [...orderFilterKeys, 'page'].some(key => params.getAll(key).length > 1) ||
    (page !== null && !positive(page, 10000));
  return { ...normalized, page: page !== null && !invalid ? Number(page) : 1, error: invalid ? orderFilterError : normalized.error };
}

/** Only replace this view's keys; unrelated URL parameters survive navigation. */
export function orderFiltersUrl(search: string, filters: OrderFilters, page = 1) {
  const params = new URLSearchParams(search);
  for (const key of orderFilterKeys) {
    params.delete(key);
    if (filters[key]) params.set(key, filters[key]);
  }
  params.delete('page');
  if (page > 1) params.set('page', String(page));
  const next = params.toString();
  return `/admin/orders${next ? `?${next}` : ''}`;
}
