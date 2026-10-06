'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/useAuthStore';
import { requestFailure } from '@/lib/api-error';
import { StaleSessionError } from '@/lib/query-client';
import type { ActivityPage } from '@/lib/api';

interface MutationOptions<T> {
  productId?: number;
  confirm?: () => boolean;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  refresh?: boolean;
}

const limit = 20;

export function canBuyActivityProduct(product: { status: number | null; stock: number | string | null }) {
  const stock = Number(product.stock);
  return product.status === 1 && Number.isFinite(stock) && stock > 0;
}

/** True while the store and browser storage still hold the session a request was made for. */
function sessionIsCurrent(token: string | null, userId: number | undefined) {
  const state = useAuthStore.getState();
  return state.isHydrated && state.isAuthenticated && state.token === token && state.user?.user_id === userId &&
    localStorage.getItem('token') === (token ?? null);
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
  const queryClient = useQueryClient();
  const { user, token, isAuthenticated, isHydrated } = useAuthStore();
  const sessionKey = JSON.stringify([token, user?.user_id]);
  // A page belongs to the session that chose it; another session starts on page one.
  const [pageState, setPageState] = useState({ session: sessionKey, page: 1 });
  const page = pageState.session === sessionKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ session: sessionKey, page: next });
  const scopeKey = JSON.stringify([sessionKey, page]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mounted = useRef(true);
  const mutation = useRef<object | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const sessionQueryKey = ['customer-activity', collection, token, user?.user_id] as const;

  const query = useQuery({
    queryKey: [...sessionQueryKey, page],
    enabled: isHydrated && isAuthenticated && !!user,
    // Another account must not find this one's rows in memory once the page stops using them.
    gcTime: 0,
    queryFn: async () => {
      if (!sessionIsCurrent(token, user?.user_id)) throw new StaleSessionError();
      const data = await load({ page, limit });
      if (!sessionIsCurrent(token, user?.user_id)) throw new StaleSessionError();
      const total = Number(data.pagination?.total) || 0;
      return { rows: data[collection] || [], total, totalPages: Number(data.pagination?.total_pages) || Math.ceil(total / limit) };
    },
  });

  const isCurrentSession = () => mounted.current && sessionIsCurrent(token, user?.user_id);
  const isCurrentQuery = () => isCurrentSession() && currentScope.current === scopeKey;
  const live = isCurrentSession();
  const beyondLastPage = query.data !== undefined && page > Math.max(1, query.data.totalPages);
  const shown = live && query.isSuccess && !beyondLastPage ? query.data : undefined;
  const error = live && query.isError && !(query.error instanceof StaleSessionError)
    ? requestFailure(query.error).response?.data?.message || requestFailure(query.error).response?.data?.error || errorMessage
    : undefined;
  const rows = shown?.rows ?? [];
  const total = shown?.total ?? 0;
  const totalPages = shown?.totalPages ?? 0;
  const loading = !shown && !error;
  const isCurrentScope = () => isCurrentQuery() && shown !== undefined;
  const hasDisplayedRow = (productId: number) => isCurrentScope() && rows.some(row => row.product_id === productId);
  const busy = pendingSession === sessionKey;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A pending action belongs to the session that started it; the next session may act at once.
  useEffect(() => {
    mutation.current = null;
    setPendingSession(null);
  }, [sessionKey]);

  // Deleting the only row on the final page leaves that page empty; show the new last page.
  useEffect(() => {
    if (beyondLastPage) setPage(Math.max(1, query.data.totalPages));
  }, [beyondLastPage]);

  useEffect(() => {
    if (isHydrated && (!isAuthenticated || !user)) router.push('/login');
  }, [isHydrated, isAuthenticated, user, router]);

  const reload = async () => {
    if (isCurrentQuery()) await query.refetch();
  };

  const runMutation = async <R,>(perform: () => Promise<R>, options: MutationOptions<R>) => {
    if (!isCurrentScope() || mutation.current ||
      (options.productId !== undefined && !hasDisplayedRow(options.productId))) return;
    const operation = {};
    mutation.current = operation;
    setPendingSession(sessionKey);
    try {
      if (options.confirm && !options.confirm()) return;
      if (!isCurrentScope()) return;
      const value = await perform();
      if (!isCurrentSession()) return;
      if (isCurrentScope()) options.onSuccess(value);
      // A deletion may finish after pagination changes; this reloads whichever page is displayed now.
      if (options.refresh) await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    } catch (cause) {
      if (isCurrentScope()) options.onError(cause);
    } finally {
      if (isCurrentSession() && mutation.current === operation) {
        mutation.current = null;
        setPendingSession(null);
      }
    }
  };

  return { user, isHydrated, rows, total, totalPages, page, limit, loading, error, reload,
    isCurrentSession, isCurrentScope, hasDisplayedRow, busy, runMutation,
    goToPage: (next: number) => { if (isCurrentScope()) setPage(Math.max(1, Math.min(next, Math.max(1, totalPages)))); },
  };
}
