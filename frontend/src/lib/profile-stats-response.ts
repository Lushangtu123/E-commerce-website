import type { UserStats } from '@/lib/api';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Publish only a complete snapshot of the API's five numeric counters. */
export function readProfileStatsResponse(value: unknown): { stats: UserStats } {
  if (!record(value) || value.success === false || value.error != null) throw new Error('Invalid account statistics');
  const stats = value.stats;
  if (!record(stats) || !['totalOrders', 'pendingOrders', 'totalCoupons', 'availableCoupons', 'favoriteCount'].every(field => count(stats[field]))) {
    throw new Error('Invalid account statistics');
  }
  return { stats: stats as unknown as UserStats };
}
