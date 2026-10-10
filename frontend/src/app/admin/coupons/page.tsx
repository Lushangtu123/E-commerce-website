'use client';

import '@/lib/admin-i18n';
import { translate, useI18n } from '@/lib/i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AdminLayout from '@/components/AdminLayout';
import { adminCouponApi } from '@/lib/api';
import { useAdminSession } from '@/hooks/use-admin-session';
import { useScopedQuery } from '@/hooks/use-scoped-query';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';
import AdminCouponForm, { EMPTY_COUPON_FORM, type CouponFormValues } from '@/components/AdminCouponForm';
import AdminCouponTable, { type AdminCoupon } from '@/components/AdminCouponTable';
import { clearCouponWrite, couponCreationDraft, matchesCouponCreation, readCouponWrite, storeCouponWrite,
  unknownCouponWrite, validCouponPage, validCouponSnapshot, type CouponWriteIntent } from '@/lib/admin-coupon-write';
import { newSessionId } from '@/lib/session-id';

const PAGE_SIZE = 50;
type Recovery = { sessionId: string; intent: CouponWriteIntent; checking: boolean; absent?: boolean };

export default function AdminCouponsPage() {
  const { t } = useI18n();
  const session = useAdminSession();
  const { sessionId } = session;
  const queryClient = useQueryClient();
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
  const recovery = useRef<Recovery | null>(null);
  const [recovering, setRecovering] = useState<Recovery | null>(null);
  const [restoredSessionId, setRestoredSessionId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const latestRead = useRef<(() => Promise<boolean>) | null>(null);
  const query = useScopedQuery({
    scope: ['admin', 'coupons', sessionId],
    params: [page, status],
    load: () => status === '' ? adminCouponApi.getList(page, PAGE_SIZE) : adminCouponApi.getList(page, PAGE_SIZE, Number(status)),
    enabled: !!sessionId && session.ready,
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
  const unresolved = recovering?.sessionId === sessionId ? recovering : null;
  const busy = !!sessionId && (pendingSessionId === sessionId || !!unresolved || storageError === sessionId || restoredSessionId !== sessionId);
  const writeLocked = () => !!mutation.current || recovery.current?.sessionId === sessionId || storageError === sessionId || restoredSessionId !== sessionId;
  const isCurrentScope = () => query.isCurrentSession() && currentScope.current === scopeKey;
  const isDisplayedScope = () => isCurrentScope() && shown !== undefined && displayed.current === shown;
  const isCurrentDraft = () => query.isCurrentSession() && ownsDraft && draft.open && displayedDraft.current === draft;

  const restorePending = () => {
    if (!sessionId || !query.isCurrentSession() || mutation.current) return;
    try {
      const intent = readCouponWrite(sessionId);
      const record = intent ? { sessionId, intent, checking: false } : null;
      recovery.current = record; setRecovering(record); setStorageError(null);
    } catch { setStorageError(sessionId); }
    setRestoredSessionId(sessionId);
  };

  // A replacement administrator owns a separate receipt; old completions cannot unlock their requests.
  useEffect(() => {
    mutation.current = null;
    retry.current = null;
    recovery.current = null; setRecovering(null); setStorageError(null);
    setPendingSessionId(null);
    setDraft({ sessionId, open: false, values: EMPTY_COUPON_FORM });
    if (sessionId) {
      try {
        const intent = readCouponWrite(sessionId);
        const record = intent ? { sessionId, intent, checking: false } : null;
        recovery.current = record; setRecovering(record);
      } catch { setStorageError(sessionId); }
      setRestoredSessionId(sessionId);
    }
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

  // Install only a valid snapshot for the currently displayed page. Cancel older list requests
  // before this read, so they cannot put stale actionable rows back after reconciliation.
  latestRead.current = async () => {
    if (!isCurrentScope()) return false;
    await queryClient.cancelQueries({ queryKey: ['admin', 'coupons', sessionId] });
    if (!isCurrentScope()) return false;
    const actual = status === '' ? await adminCouponApi.getList(page, PAGE_SIZE) : await adminCouponApi.getList(page, PAGE_SIZE, Number(status));
    if (!isCurrentScope()) return false;
    if (!validCouponPage(actual) || actual.pagination?.page !== page || actual.pagination.page_size !== PAGE_SIZE ||
      (status !== '' && actual.data.some(coupon => coupon.status !== Number(status)))) throw new Error('Invalid coupon list snapshot');
    queryClient.setQueryData(['admin', 'coupons', sessionId, page, status], actual);
    return true;
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
    if (!isCurrentScope() || writeLocked()) return;
    setDraft({ sessionId, open: true, values: ownsDraft ? draft.values : EMPTY_COUPON_FORM });
  };
  const closeForm = () => {
    if (isCurrentDraft() && !writeLocked()) setDraft({ ...draft, open: false });
  };
  const updateDraft = (values: CouponFormValues) => {
    if (isCurrentDraft() && !writeLocked()) setDraft({ ...draft, values });
  };

  const checkResult = async (record: Recovery) => {
    if (!query.isCurrentSession() || recovery.current !== record || record.checking) return;
    const checking = { ...record, checking: true, absent: false };
    recovery.current = checking; setRecovering(checking);
    try {
      const intent = checking.intent;
      const response: unknown = intent.kind === 'create' ? await adminCouponApi.getByCode(intent.input.code) : await adminCouponApi.getDetail(intent.id);
      if (!query.isCurrentSession() || recovery.current !== checking) return;
      if (!response || typeof response !== 'object' || !('success' in response) || response.success !== true || !('data' in response)) {
        throw new Error('Invalid coupon detail response');
      }
      // Absence is evidence from the unique-code endpoint, never from a filtered/paginated list.
      if (intent.kind === 'create' && response.data === null) {
        const absent = { ...checking, checking: false, absent: true };
        recovery.current = absent; setRecovering(absent); return;
      }
      const canonical = response.data;
      if (!validCouponSnapshot(canonical) || (intent.kind === 'status' ? canonical.coupon_id !== intent.id :
        canonical.code.toUpperCase() !== intent.input.code.toUpperCase())) throw new Error('Invalid coupon identity');
      if (!await latestRead.current?.()) throw new Error('Coupon view changed');
      if (!query.isCurrentSession() || recovery.current !== checking || !clearCouponWrite(checking.sessionId, intent.key)) return;
      recovery.current = null; setRecovering(null);
      if (intent.kind === 'create') {
        const matches = matchesCouponCreation(canonical, intent.input);
        setDraft({ sessionId, open: !matches, values: matches ? EMPTY_COUPON_FORM : couponCreationDraft(intent.input) });
        toast.error(translate(matches ? '已确认原优惠券创建结果，请核对当前列表' : '该代码对应的优惠券与原创建内容不一致，请核对后修改草稿'));
      } else toast.error(translate('已重新加载优惠券当前状态，请核对后再操作'));
    } catch {
      // A failed, malformed or outdated read keeps the original intent and every write locked.
    } finally {
      if (query.isCurrentSession() && recovery.current === checking) {
        const failed = { ...checking, checking: false };
        recovery.current = failed; setRecovering(failed);
      }
    }
  };

  const startRecovery = async (intent: CouponWriteIntent) => {
    if (!sessionId || !query.isCurrentSession()) return;
    const record = { sessionId, intent, checking: false };
    recovery.current = record; setRecovering(record);
    // Close the blocking dialog so the read-only recovery controls are accessible.
    setDraft(current => current.sessionId === sessionId ? { ...current, open: false } : current);
    await checkResult(record);
  };

  const runMutation = async (intent: CouponWriteIntent, isCurrent: () => boolean, success: string, failure: string, original?: Recovery) => {
    if (!sessionId || !isCurrentScope() || !isCurrent() || mutation.current ||
      (original ? recovery.current !== original || !original.absent : writeLocked())) return;
    if (!storeCouponWrite(sessionId, intent)) {
      toast.error(translate('无法保存优惠券请求，请允许浏览器存储后重试'));
      return;
    }
    const operation = {};
    mutation.current = operation;
    setPendingSessionId(sessionId);
    try {
      if (intent.kind === 'create') await adminCouponApi.create(intent.input);
      else await adminCouponApi.updateStatus(intent.id, intent.status);
      if (!query.isCurrentSession() || mutation.current !== operation) return;
      if (!clearCouponWrite(sessionId, intent.key)) { await startRecovery(intent); return; }
      recovery.current = null; setRecovering(null);
      if (isCurrent()) {
        if (intent.kind === 'create') setDraft({ sessionId, open: false, values: EMPTY_COUPON_FORM });
        toast.success(translate(success));
      }
      // Refresh whichever filter this administrator now displays, retaining the lock through that read.
      if (query.isCurrentSession()) await query.invalidate();
    } catch (error) {
      if (!query.isCurrentSession() || mutation.current !== operation) return;
      // A replay still belongs to the original uncertain intent, including a duplicate-code 4xx.
      if (original || unknownCouponWrite(error)) { await startRecovery(intent); return; }
      if (!clearCouponWrite(sessionId, intent.key)) { await startRecovery(intent); return; }
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
    if (!isCurrentScope() || !isCurrentDraft() || writeLocked()) return;
    return runMutation({ key: newSessionId(), kind: 'create', input: {
      ...draft.values, code: draft.values.code.trim(), name: draft.values.name.trim(),
      start_time: new Date(draft.values.start_time).toISOString(), end_time: new Date(draft.values.end_time).toISOString(),
    } }, isCurrentDraft, '创建成功！', '创建失败');
  };

  const handleUpdateStatus = (coupon: AdminCoupon) => {
    if (!coupons.includes(coupon)) return;
    return runMutation({ key: newSessionId(), kind: 'status', id: coupon.coupon_id, status: coupon.status === 1 ? 0 : 1 },
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

          {storageError === sessionId && sessionId && (
            <div role="alert" className="mb-6 bg-white rounded-lg p-4">
              <p>{t('无法读取优惠券待确认请求，请检查浏览器存储后重试')}</p>
              <button onClick={restorePending} className="mt-3 px-4 py-2 border rounded-lg">{t('重新读取待确认请求')}</button>
            </div>
          )}
          {unresolved && (
            <div role="alert" className="mb-6 bg-white rounded-lg p-4">
              <p>{t(unresolved.absent ? '暂未找到原代码的优惠券，可重试原创建请求；重试保留原代码和全部内容' :
                '优惠券提交结果尚未确认，请先重新确认；确认期间不能创建或修改优惠券')}</p>
              <button onClick={() => checkResult(unresolved)} disabled={unresolved.checking || pendingSessionId === sessionId}
                className="mt-3 px-4 py-2 border rounded-lg disabled:opacity-50">{t(unresolved.checking ? '确认中...' : '重新确认优惠券结果')}</button>
              {unresolved.absent && unresolved.intent.kind === 'create' && (
                <button onClick={() => runMutation(unresolved.intent, isCurrentScope, '创建成功！', '创建失败', unresolved)}
                  disabled={pendingSessionId === sessionId} className="mt-3 ml-3 px-4 py-2 border rounded-lg disabled:opacity-50">{t('重试原创建请求')}</button>
              )}
            </div>
          )}

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
