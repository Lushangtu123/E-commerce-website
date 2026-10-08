'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { couponApi, type Coupon } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { translate, useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';
import { useSessionQuery } from '@/hooks/use-session-query';
import { clearPendingCouponClaim, listPendingCouponClaims, prepareCouponClaim, readPendingCouponClaim } from '@/lib/pending-coupon-claim';

const pageSize = 50;

export default function CouponsPage() {
  const router = useRouter();
  const { t, locale, formatDate } = useI18n();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
  const sessionKey = JSON.stringify([sessionId, user?.user_id]);
  const [pageState, setPageState] = useState({ session: sessionKey, page: 1 });
  const page = pageState.session === sessionKey ? pageState.page : 1;
  const scopeKey = JSON.stringify([sessionKey, page]);
  const currentScope = useRef(scopeKey);
  useLayoutEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const claims = useRef(new Map<number, object>());
  const [pending, setPending] = useState<{ session: string; ids: Set<number> }>({ session: sessionKey, ids: new Set() });
  const receivingIds = pending.session === sessionKey ? pending.ids : new Set<number>();
  const query = useSessionQuery({
    name: 'customer-coupon-center', params: [page, pageSize],
    load: async () => {
      const response = await couponApi.getAvailable(page, pageSize);
      const total = Number(response.pagination?.total ?? response.data?.length ?? 0);
      return { coupons: response.data || [], total, totalPages: Number(response.pagination?.total_pages ?? Math.ceil(total / pageSize)) };
    },
  });
  const { isCurrentSession } = query;
  const lastPage = Math.max(1, query.data?.totalPages ?? 0);
  const beyondLastPage = query.data !== undefined && page > lastPage;
  const shown = beyondLastPage ? undefined : query.data;
  const coupons = shown?.coupons || [];
  const orphanClaims = listPendingCouponClaims(sessionKey).filter(claim => !coupons.some(coupon => coupon.coupon_id === claim.couponId));
  const error = query.error ? requestFailure(query.error).response?.data?.message || requestFailure(query.error).response?.data?.error || '加载优惠券失败，请重试' : undefined;
  const loading = !shown && !error;
  const isCurrentScope = () => isCurrentSession() && currentScope.current === scopeKey && shown !== undefined;
  const goToPage = (next: number) => {
    if (isCurrentScope()) setPageState({ session: sessionKey, page: Math.max(1, Math.min(next, lastPage)) });
  };

  useEffect(() => {
    claims.current = new Map();
  }, [sessionKey]);

  // Adjust before showing an empty page after the available list shrinks.
  if (beyondLastPage) setPageState({ session: sessionKey, page: lastPage });

  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      toast.error(translate('请先登录'));
      router.push('/login');
    }
  }, [isHydrated, isAuthenticated, router]);

  const handleReceive = async (coupon: Pick<Coupon, 'coupon_id' | 'remain_quantity'>, recovery = false) => {
    if (!isCurrentSession() || claims.current.has(coupon.coupon_id)) return;
    if (!recovery && (!isCurrentScope() || coupon.remain_quantity <= 0 || !coupons.some(row => row.coupon_id === coupon.coupon_id))) return;
    const claimKey = recovery ? readPendingCouponClaim(sessionKey, coupon.coupon_id) : prepareCouponClaim(sessionKey, coupon.coupon_id);
    if (!claimKey) { toast.error(translate('无法保存领取请求，请检查浏览器存储后重试')); return; }
    const operation = {};
    claims.current.set(coupon.coupon_id, operation);
    setPending(prev => ({ session: sessionKey, ids: new Set(prev.session === sessionKey ? prev.ids : []).add(coupon.coupon_id) }));

    try {
      await couponApi.receive(coupon.coupon_id, claimKey);
      if (!isCurrentSession()) return;
      clearPendingCouponClaim(sessionKey, coupon.coupon_id, claimKey);
      toast.success(translate('领取成功！'));
      
      // Exhausted coupons disappear from the available list; refresh its total and current page together.
      await query.invalidate();
    } catch (error) {
      if (!isCurrentSession()) return;
      logger.error('领取失败:', error);
      const failure = requestFailure(error);
      const status = failure.response?.status;
      // Preserve the original identity after a timeout, lost response or server failure.
      // A deliberate retry can then recover the original receipt without claiming another coupon.
      const uncertain = !status || status === 408 || status === 429 || status >= 500;
      if (!uncertain && status !== 409) clearPendingCouponClaim(sessionKey, coupon.coupon_id, claimKey);
      const message = uncertain ? '领取结果尚未确认，重试不会重复领取' : failure.response?.data?.message || '领取失败';
      toast.error(translate(message));
    } finally {
      if (claims.current.get(coupon.coupon_id) === operation) {
        claims.current.delete(coupon.coupon_id);
        if (isCurrentSession()) setPending(prev => {
          const ids = new Set(prev.session === sessionKey ? prev.ids : []);
          ids.delete(coupon.coupon_id);
          return { session: sessionKey, ids };
        });
      }
    }
  };

  const getCouponTypeText = (type: number) => {
    switch (type) {
      case 1:
        return '满减券';
      case 2:
        return '折扣券';
      case 3:
        return '无门槛券';
      default:
        return '优惠券';
    }
  };

  const getCouponDescription = (coupon: Coupon) => {
    switch (coupon.type) {
      case 1:
        return t('满{minimum}元减{discount}元', { minimum: coupon.min_amount, discount: coupon.discount_value });
      case 2:
        const discount = 100 - Number(coupon.discount_value);
        const maxText = Number(coupon.max_discount) > 0
          ? t('，最高优惠{maximum}元', { maximum: coupon.max_discount ?? 0 })
          : '';
        return (locale === 'en' ? t('{percentage}%优惠', { percentage: Number(coupon.discount_value) }) : t('{discount}折优惠', { discount: discount / 10 })) + maxText;
      case 3:
        return t('直接抵扣{discount}元', { discount: coupon.discount_value });
      default:
        return coupon.description || '';
    }
  };

  const getCouponColor = (type: number) => {
    switch (type) {
      case 1:
      case 2:
      case 3:
        return 'from-primary-500 to-primary-700';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  if (!isHydrated || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">{t("加载中...")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("优惠券中心")}</h1>
          <p className="mt-2 text-gray-600">{t("领取优惠券，享受更多优惠")}</p>
          <p className="mt-2 text-sm text-gray-600">{t('共 {count} 张优惠券', { count: shown?.total ?? '—' })}</p>
          
          <div className="mt-4 flex gap-4">
            <button
              onClick={() => router.push('/my/coupons')}
              className="px-4 py-2 border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
            >
              {t("我的优惠券")}
            </button>
          </div>
        </div>

        {orphanClaims.length > 0 && <section className="card p-6 mb-6 space-y-3" aria-label={t('待确认的优惠券领取')}>
          <h2 className="font-semibold">{t('待确认的优惠券领取')}</h2>
          <p className="text-sm text-gray-600">{t('领取结果尚未确认，重试不会重复领取')}</p>
          {orphanClaims.map(claim => <div className="flex items-center justify-between gap-3" key={claim.couponId}>
            <span>{t('优惠券编号 {id}', { id: claim.couponId })}</span>
            <button type="button" className="btn btn-secondary" disabled={receivingIds.has(claim.couponId)} onClick={() => handleReceive({ coupon_id: claim.couponId, remain_quantity: 0 }, true)}>{t(receivingIds.has(claim.couponId) ? '领取中...' : '重试领取')}</button>
          </div>)}
        </section>}

        {/* Coupons Grid */}
        {loading ? <div className="text-center py-12" role="status">{t('加载中...')}</div> : error ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm" role="alert">
            <p className="text-red-600">{t(error)}</p>
            <button onClick={query.refetch} className="btn btn-secondary mt-4">{t('重新加载优惠券')}</button>
          </div>
        ) : coupons.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="mt-4 text-gray-500">{t("暂无可领取的优惠券")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coupons.map((coupon) => (
              <div
                key={coupon.coupon_id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Coupon Header */}
                <div className={`bg-linear-to-r/srgb ${getCouponColor(coupon.type)} p-6 text-white`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm opacity-90">{t(getCouponTypeText(coupon.type))}</div>
                      <div className="text-3xl font-bold mt-1">
                        {coupon.type === 2 ? (locale === 'en' ? t('{percentage}%优惠', { percentage: Number(coupon.discount_value) }) : t('{discount}折', { discount: (100 - Number(coupon.discount_value)) / 10 })) : `¥${coupon.discount_value}`}
                      </div>
                      <div className="text-sm opacity-90 mt-1">
                        {coupon.type === 1 && t('满{minimum}元可用', { minimum: coupon.min_amount })}
                        {coupon.type === 2 && Number(coupon.min_amount) > 0 && t('满{minimum}元可用', { minimum: coupon.min_amount })}
                        {coupon.type === 3 && t('无门槛')}
                      </div>
                    </div>
                    <div className="text-right text-sm opacity-90">
                      <div>{t("剩余")}</div>
                      <div className="text-xl font-semibold">{coupon.remain_quantity}</div>
                    </div>
                  </div>
                </div>

                {/* Coupon Body */}
                <div className="p-6">
                  <h3 className="font-semibold text-gray-900 mb-2">{coupon.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{getCouponDescription(coupon)}</p>
                  
                  {coupon.description && (
                    <p className="text-xs text-gray-500 mb-4">{coupon.description}</p>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
                    <span>{t('有效期至 {date}', { date: formatDate(coupon.end_time, true) })}</span>
                    <span>{t('限领 {count} 张', { count: coupon.per_user_limit })}</span>
                  </div>

                  <button
                    onClick={() => handleReceive(coupon)}
                    disabled={receivingIds.has(coupon.coupon_id) || coupon.remain_quantity <= 0}
                    className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                      coupon.remain_quantity === 0
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : receivingIds.has(coupon.coupon_id)
                        ? 'bg-gray-400 text-white cursor-wait'
                        : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    {receivingIds.has(coupon.coupon_id)
                      ? t('领取中...')
                      : coupon.remain_quantity === 0
                      ? t('已领完')
                      : readPendingCouponClaim(sessionKey, coupon.coupon_id)
                      ? t('重试领取')
                      : t('立即领取')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {shown && shown.totalPages > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-4" aria-label={t('优惠券分页')}>
            <button disabled={page <= 1} onClick={() => goToPage(page - 1)} className="btn btn-secondary disabled:opacity-50">{t('上一页')}</button>
            <span>{t('第 {page} / {pages} 页', { page, pages: shown.totalPages })}</span>
            <button disabled={page >= shown.totalPages} onClick={() => goToPage(page + 1)} className="btn btn-secondary disabled:opacity-50">{t('下一页')}</button>
          </nav>
        )}
      </div>
    </div>
  );
}
