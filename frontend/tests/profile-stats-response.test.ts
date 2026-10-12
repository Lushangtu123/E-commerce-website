import { describe, expect, it } from 'vitest';
import { readProfileStatsResponse } from '@/lib/profile-stats-response';
import type { UserStats } from '@/lib/api';

const stats: UserStats = { totalOrders: 17, pendingOrders: 3, totalCoupons: 11, availableCoupons: 4, favoriteCount: 8 };
const fields = Object.keys(stats) as (keyof UserStats)[];

describe('profile stats response', () => {
  it.each([
    null, undefined, false, 1, 'stats', [], {}, { stats: null }, { stats: [] }, { stats: {} },
    { stats, success: false }, { stats, error: '获取个人统计失败' },
  ].map(response => ({ response })))('rejects a malformed envelope $response', ({ response }) => {
    expect(() => readProfileStatsResponse(response)).toThrow('Invalid account statistics');
  });

  describe.each(fields)('%s count', field => {
    it.each([undefined, null, '4', '', false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity])('rejects %s', value => {
      expect(() => readProfileStatsResponse({ stats: { ...stats, [field]: value } })).toThrow('Invalid account statistics');
    });
    it('requires the count to be present', () => {
      const missing: Partial<UserStats> = { ...stats };
      delete missing[field];
      expect(() => readProfileStatsResponse({ stats: missing })).toThrow('Invalid account statistics');
    });
  });

  it('preserves ordinary numeric counts', () => {
    expect(readProfileStatsResponse({ stats })).toEqual({ stats });
  });

  it.each([0, Number.MAX_SAFE_INTEGER])('accepts safe counts at the boundary %s', count => {
    const boundary: UserStats = { totalOrders: count, pendingOrders: count, totalCoupons: count, availableCoupons: count, favoriteCount: count };
    expect(readProfileStatsResponse({ stats: boundary })).toEqual({ stats: boundary });
  });
});
