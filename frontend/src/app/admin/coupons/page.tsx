'use client';

import '@/lib/admin-i18n';
import { translate, useI18n } from '@/lib/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { adminCouponApi } from '@/lib/api';
import { useAdminSession } from '@/hooks/use-admin-session';
import { useScopedQuery } from '@/hooks/use-scoped-query';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';
import AdminCouponForm, { EMPTY_COUPON_FORM, type CouponFormValues } from '@/components/AdminCouponForm';
import AdminCouponTable, { type AdminCoupon } from '@/components/AdminCouponTable';

const PAGE_SIZE = 50;

export default function AdminCouponsPage() {
  const { t } = useI18n();
  const session = useAdminSession();
  const { sessionId } = session;
  const [view, setView] = useState({ sessionId, page: 1, status: '' });
  const page = view.sessionId === sessionId ? view.page : 1;
  const status = view.sessionId === sessionId ? view.status : '';
  const [draft, setDraft] = useState({ sessionId, open: false, values: EMPTY_COUPON_FORM });
  const ownsDraft = draft.sessionId === sessionId;
  const scopeKey = JSON.stringify([sessionId, page, status]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const displayedDraft = useRef(ownsDraft ? draft : undefined);
  displayedDraft.current = ownsDraft ? draft : undefined;
  const mutation = useRef<object | null>(null);
  const retry = useRef<object | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const query = useScopedQuery({
    scope: ['admin', 'coupons', sessionId],
    params: [page, status],
    load: () => status === '' ? adminCouponApi.getList(page, PAGE_SIZE) : adminCouponApi.getList(page, PAGE_SIZE, Number(status)),
    enabled: !!sessionId,
    sessionIsCurrent: session.active,
  });
  const pageSize = Number(query.data?.pagination?.page_size) || PAGE_SIZE;
  const lastPage = Math.max(1, Number(query.data?.pagination?.total_pages) || Math.ceil((Number(query.data?.pagination?.total) || 0) / pageSize));
  const beyondLastPage = query.data !== undefined && page > lastPage;
  const shown = beyondLastPage ? undefined : query.data;
  // Retire actions captured from rows a refresh has replaced, even within the same page and filter.
  const displayed = useRef(shown);
  displayed.current = shown;
  const coupons = shown?.data || [];
  const total = Number(shown?.pagination?.total) || coupons.length;
  const loadError = query.error ? requestFailure(query.error).response?.data?.error || requestFailure(query.error).response?.data?.message || '获取优惠券列表失败' : undefined;
  const loading = !shown && !loadError;
  const busy = !!sessionId && pendingSessionId === sessionId;
  const isCurrentScope = () => query.isCurrentSession() && currentScope.current === scopeKey;
  const isDisplayedScope = () => isCurrentScope() && shown !== undefined && displayed.current === shown;
  const isCurrentDraft = () => query.isCurrentSession() && ownsDraft && draft.open && displayedDraft.current === draft;

  // A replacement administrator can act immediately; old completions cannot unlock their new requests.
  useEffect(() => {
    mutation.current = null;
    retry.current = null;
    setPendingSessionId(null);
    setDraft({ sessionId, open: false, values: EMPTY_COUPON_FORM });
  }, [sessionId]);

  useEffect(() => {
    if (beyondLastPage) setView({ sessionId, page: lastPage, status });
  }, [beyondLastPage, lastPage, sessionId, status]);

  useEffect(() => {
    if (query.error) logger.error('获取优惠券列表失败:', query.error);
  }, [query.error]);

  const reload = async () => {
    if (!isCurrentScope() || retry.current) return;
    const operation = {};
    retry.current = operation;
    try { await query.refetch(); }
    finally { if (retry.current === operation) retry.current = null; }
  };

  const changeStatus = (next: string) => {
    if (!isCurrentScope() || !['', '0', '1'].includes(next) || (page === 1 && status === next)) return;
    // Reject clicks on this render's rows before React commits the replacement query.
    currentScope.current = JSON.stringify([sessionId, 1, next]);
    setView({ sessionId, page: 1, status: next });
  };

  const changePage = (next: number) => {
    if (!isDisplayedScope()) return;
    const target = Math.max(1, Math.min(next, lastPage));
    if (target === page) return;
    currentScope.current = JSON.stringify([sessionId, target, status]);
    setView({ sessionId, page: target, status });
  };

  const openForm = () => {
    if (!isCurrentScope() || mutation.current) return;
    setDraft({ sessionId, open: true, values: ownsDraft ? draft.values : EMPTY_COUPON_FORM });
  };
  const closeForm = () => {
    if (isCurrentDraft() && !mutation.current) setDraft({ ...draft, open: false });
  };
  const updateDraft = (values: CouponFormValues) => {
    if (isCurrentDraft() && !mutation.current) setDraft({ ...draft, values });
  };

  const runMutation = async (perform: () => Promise<unknown>, isCurrent: () => boolean, success: string, failure: string, afterSuccess?: () => void) => {
    if (!isCurrentScope() || !isCurrent() || mutation.current) return;
    const operation = {};
    mutation.current = operation;
    setPendingSessionId(sessionId);
    try {
      await perform();
      if (isCurrent()) {
        afterSuccess?.();
        toast.success(translate(success));
      }
      // Refresh whichever filter this administrator now displays, retaining the lock through that read.
      if (query.isCurrentSession()) await query.invalidate();
    } catch (error) {
      if (isCurrent()) {
        logger.error(failure, error);
        toast.error(translate(requestFailure(error).response?.data?.error || requestFailure(error).response?.data?.message || failure));
      }
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        setPendingSessionId(null);
      }
    }
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    return runMutation(() => adminCouponApi.create({
      ...draft.values,
      start_time: new Date(draft.values.start_time).toISOString(),
      end_time: new Date(draft.values.end_time).toISOString(),
    }), isCurrentDraft, '创建成功！', '创建失败', () => {
      setDraft({ sessionId, open: false, values: EMPTY_COUPON_FORM });
    });
  };

  const handleUpdateStatus = (coupon: AdminCoupon) => {
    if (!coupons.includes(coupon)) return;
    return runMutation(() => adminCouponApi.updateStatus(coupon.coupon_id, coupon.status === 1 ? 0 : 1),
      isDisplayedScope, '状态更新成功！', '更新失败');
  };

  return (
    <AdminLayout>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{t('优惠券管理')}</h1>
              <p className="mt-2 text-gray-600">{t('创建和管理优惠券')}</p>
            </div>
            <button onClick={openForm} disabled={!sessionId || busy}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              {t('+ 创建优惠券')}
            </button>
          </div>

          <div className="mb-6 bg-white rounded-lg shadow-sm p-4">
            <label htmlFor="coupon-status" className="text-sm font-medium text-gray-700 mr-3">{t('优惠券状态')}</label>
            <select id="coupon-status" aria-label={t('优惠券状态')} value={status} onChange={event => changeStatus(event.target.value)} disabled={!sessionId}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
              <option value="">{t('全部状态')}</option>
              <option value="1">{t('启用')}</option>
              <option value="0">{t('禁用')}</option>
            </select>
          </div>

          {ownsDraft && draft.open && (
            <AdminCouponForm values={draft.values} busy={busy} onChange={updateDraft} onSubmit={handleCreate} onClose={closeForm} />
          )}

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
              <p className="mt-4 text-gray-600">{t('加载中...')}</p>
            </div>
          ) : loadError ? (
            <div role="alert" className="bg-white rounded-lg shadow-sm p-8 text-center">
              <p className="text-red-600">{t(loadError)}</p>
              <button onClick={reload} className="mt-4 px-4 py-2 border rounded-lg">{t('重新加载')}</button>
            </div>
          ) : (
            <>
              <AdminCouponTable coupons={coupons} busy={busy} onCreate={openForm} onToggleStatus={handleUpdateStatus} />
              <div className="bg-white px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-700">{t('共 {count} 张优惠券', { count: total })}</p>
                <div className="flex gap-2">
                  <button onClick={() => changePage(page - 1)} disabled={page === 1}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">{t('上一页')}</button>
                  <span className="px-4 py-2 text-sm text-gray-700">{t('第 {page} 页', { page })}</span>
                  <button onClick={() => changePage(page + 1)} disabled={page >= lastPage}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed">{t('下一页')}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
