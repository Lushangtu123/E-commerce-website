'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/useAuthStore';
import { requestFailure } from '@/lib/api-error';
import { useSessionQuery } from '@/hooks/use-session-query';
import type { ActivityPage } from '@/lib/api';

interface MutationOptions<T> {
  productId?: number;
  /** Asked after the action is locked; the action is dropped unless it resolves to true. */
  confirm?: () => Promise<boolean>;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  refresh?: boolean;
  /** Only removals need to reconcile an uncertain reply; quick cart has its own recovery. */
  deletion?: 'remove' | 'clear';
}

const limit = 20;
type DeletionRecovery = { session: string; checking: boolean };

export function canBuyActivityProduct(product: { status: number | null; stock: number | string | null }) {
  const stock = Number(product.stock);
  return product.status === 1 && Number.isFinite(stock) && stock > 0;
}

/**
 * Keeps each account's paginated collection in its own scope. The query key carries the
 * session and page, so a response only ever fills the scope that requested it.
 */
export function useCustomerActivity<T extends { product_id: number }>(
  collection: 'favorites' | 'history',
  load: (params: { page: number; limit: number }) => Promise<ActivityPage<T>>,
  errorMessage: string,
) {
  const router = useRouter();
  const { user, sessionId, isAuthenticated, isHydrated } = useAuthStore();
  const sessionKey = JSON.stringify([sessionId, user?.user_id]);
  // A page belongs to the session that chose it; another session starts on page one.
  const [pageState, setPageState] = useState({ session: sessionKey, page: 1 });
  const page = pageState.session === sessionKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ session: sessionKey, page: next });
  const scopeKey = JSON.stringify([sessionKey, page]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mutation = useRef<object | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const deletion = useRef<DeletionRecovery | null>(null);
  const [deletionView, setDeletionView] = useState<DeletionRecovery | null>(null);
  const queryClient = useQueryClient();
  const queryPrefix = [collection, sessionId, user?.user_id];
  const query = useSessionQuery({
    name: collection,
    params: [page],
    load: async () => {
      const data = await load({ page, limit });
      // A checking read must prove it returned a collection, rather than turn an invalid reply into empty data.
      if (deletion.current?.session === sessionKey && (!Array.isArray(data[collection]) ||
        !Number.isSafeInteger(Number(data.pagination?.total)) || Number(data.pagination?.total) < 0 ||
        !Number.isSafeInteger(Number(data.pagination?.total_pages)) || Number(data.pagination?.total_pages) < 0)) {
        throw new Error('Invalid activity list');
      }
      const total = Number(data.pagination?.total) || 0;
      return { rows: data[collection] || [], total, totalPages: Number(data.pagination?.total_pages) || Math.ceil(total / limit) };
    },
  });

  const { isCurrentSession } = query;
  const isCurrentQuery = () => isCurrentSession() && currentScope.current === scopeKey;
  const lastPage = Math.max(1, query.data?.totalPages ?? 0);
  const beyondLastPage = query.data !== undefined && page > lastPage;
  const shown = beyondLastPage ? undefined : query.data;
  const deletionRecovery = deletionView?.session === sessionKey && isCurrentSession() ? deletionView : null;
  const error = deletionRecovery ? (deletionRecovery.checking ? undefined : '删除结果尚未确认，请重新核对列表后再操作') : query.error
    ? requestFailure(query.error).response?.data?.message || requestFailure(query.error).response?.data?.error || errorMessage
    : undefined;
  const rows = shown?.rows ?? [];
  const total = shown?.total ?? 0;
  const totalPages = shown?.totalPages ?? 0;
  const loading = !shown && !error;
  const isCurrentScope = () => isCurrentQuery() && shown !== undefined;
  const hasDisplayedRow = (productId: number) => isCurrentScope() && rows.some(row => row.product_id === productId);
  const busy = pendingSession === sessionKey || !!deletionRecovery;

  // A pending action belongs to the session that started it; the next session may act at once.
  useEffect(() => {
    mutation.current = null;
    setPendingSession(null);
    deletion.current = null;
    setDeletionView(null);
  }, [sessionKey]);

  // Deleting the only row on the final page leaves that page empty; show the new last page.
  useEffect(() => {
    if (beyondLastPage) setPage(lastPage);
  }, [beyondLastPage]);

  useEffect(() => {
    if (isHydrated && (!isAuthenticated || !user)) router.push('/login');
  }, [isHydrated, isAuthenticated, user, router]);

  const checkDeletion = async (record: DeletionRecovery) => {
    if (!isCurrentSession() || deletion.current !== record || record.checking) return;
    record.checking = true;
    setDeletionView({ ...record });
    try {
      // Retire reads that may have started before the delete, then check the page displayed now.
      await queryClient.cancelQueries({ queryKey: queryPrefix });
      if (!isCurrentSession() || deletion.current !== record) return;
      await queryClient.invalidateQueries({ queryKey: queryPrefix }, { throwOnError: true });
      if (!isCurrentSession() || deletion.current !== record) return;
      deletion.current = null;
      setDeletionView(null);
    } catch {
      if (isCurrentSession() && deletion.current === record) {
        record.checking = false;
        setDeletionView({ ...record });
      }
    }
  };

  const reload = async () => {
    if (!isCurrentQuery()) return;
    const record = deletion.current;
    if (record?.session === sessionKey) await checkDeletion(record);
    else await query.refetch();
  };

  const runMutation = async <R,>(perform: () => Promise<R>, options: MutationOptions<R>) => {
    if (!isCurrentScope() || mutation.current || deletion.current?.session === sessionKey ||
      (options.productId !== undefined && !hasDisplayedRow(options.productId))) return;
    const operation = {};
    mutation.current = operation;
    setPendingSession(sessionKey);
    try {
      if (options.confirm && !(await options.confirm())) return;
      if (!isCurrentScope()) return;
      const value = await perform();
      if (!isCurrentSession()) return;
      if (isCurrentScope()) options.onSuccess(value);
      // A deletion may finish after pagination changes; this reloads whichever page is displayed now.
      if (options.refresh) await query.invalidate();
    } catch (cause) {
      if (!isCurrentSession()) return;
      const status = requestFailure(cause).response?.status;
      if (options.deletion && (status === undefined || status === 408 || status === 429 || status >= 500 ||
        (options.deletion === 'remove' && status === 404))) {
        const record = { session: sessionKey, checking: false };
        deletion.current = record;
        await checkDeletion(record);
      } else if (isCurrentScope()) options.onError(cause);
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        setPendingSession(null);
      }
    }
  };

  return { user, isHydrated, rows, total, totalPages, page, limit, loading, error, reload,
    isCurrentSession, isCurrentScope, hasDisplayedRow, busy, runMutation, deletionRecovery,
    goToPage: (next: number) => { if (isCurrentScope()) setPage(Math.max(1, Math.min(next, Math.max(1, totalPages)))); },
  };
}
