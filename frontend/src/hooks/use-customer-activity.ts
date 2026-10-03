'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

interface ActivityResult<T> {
  key: string;
  revision: number;
  rows: T[];
  total: number;
  totalPages: number;
  error?: string;
}

interface MutationOptions<T> {
  productId?: number;
  confirm?: () => boolean;
  onSuccess: (value: T) => void;
  onError: (error: any) => void;
  refresh?: boolean;
}

export function canBuyActivityProduct(product: { status: number | null; stock: number | string | null }) {
  const stock = Number(product.stock);
  return product.status === 1 && Number.isFinite(stock) && stock > 0;
}

/** Keeps each account's paginated collection and request results in their own scope. */
export function useCustomerActivity<T extends { product_id: number }>(
  collection: 'favorites' | 'history',
  load: (params: { page: number; limit: number }) => Promise<any>,
  errorMessage: string,
) {
  const router = useRouter();
  const { user, token, isAuthenticated, isHydrated } = useAuthStore();
  const [pageState, setPage] = useState(1);
  const [querySession, setQuerySession] = useState<string | null>(null);
  const [result, setResult] = useState<ActivityResult<T> | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef<object | null>(null);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const latestRefresh = useRef<(() => Promise<void>) | null>(null);
  const sessionKey = JSON.stringify([token, user?.user_id]);
  const page = querySession === null || querySession === sessionKey ? pageState : 1;
  const limit = 20;
  const scopeKey = JSON.stringify([sessionKey, page]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const isCurrentSession = () => {
    const state = useAuthStore.getState();
    return mounted.current && state.isHydrated && state.isAuthenticated &&
      state.token === token && state.user?.user_id === user?.user_id &&
      localStorage.getItem('token') === (token ?? null);
  };
  const isCurrentQuery = () => isCurrentSession() && currentScope.current === scopeKey;
  const ownsResult = isCurrentQuery() && result?.key === scopeKey;
  const rows = ownsResult ? result.rows : [];
  const total = ownsResult ? result.total : 0;
  const totalPages = ownsResult ? result.totalPages : 0;
  const error = ownsResult ? result.error : undefined;
  const loading = !ownsResult;
  const isCurrentScope = () => isCurrentQuery() && result?.key === scopeKey &&
    result.revision === request.current && !result.error;
  const hasDisplayedRow = (productId: number) => isCurrentScope() && rows.some(row => row.product_id === productId);
  const busy = pendingSession === sessionKey;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (querySession !== null && querySession !== sessionKey) {
      setPage(1);
      mutation.current = null;
      setPendingSession(null);
    }
    setQuerySession(sessionKey);
  }, [isHydrated, sessionKey]);

  const reload = async () => {
    if (!isCurrentQuery()) return;
    const revision = ++request.current;
    setResult(null);
    try {
      const data = await load({ page, limit });
      if (!isCurrentQuery() || revision !== request.current) return;
      const count = Number(data.pagination?.total) || 0;
      const pages = Number(data.pagination?.total_pages) || Math.ceil(count / limit);
      if (page > Math.max(1, pages)) { setPage(Math.max(1, pages)); return; }
      setResult({ key: scopeKey, revision, rows: data[collection] || [], total: count, totalPages: pages });
    } catch (cause: any) {
      if (!isCurrentQuery() || revision !== request.current) return;
      setResult({ key: scopeKey, revision, rows: [], total: 0, totalPages: 0,
        error: cause.response?.data?.message || cause.response?.data?.error || errorMessage });
    }
  };
  latestRefresh.current = reload;

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
      // A deletion may finish after pagination changes; reload the page currently displayed.
      if (options.refresh) await latestRefresh.current?.();
    } catch (cause: any) {
      if (isCurrentScope()) options.onError(cause);
    } finally {
      if (isCurrentSession() && mutation.current === operation) {
        mutation.current = null;
        setPendingSession(null);
      }
    }
  };

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated || !user) { router.push('/login'); return; }
    reload();
    return () => { request.current++; };
  }, [isHydrated, isAuthenticated, scopeKey, router]);

  return { user, isHydrated, rows, total, totalPages, page, limit, loading, error, reload,
    isCurrentSession, isCurrentScope, hasDisplayedRow, busy, runMutation,
    goToPage: (next: number) => { if (isCurrentScope()) setPage(Math.max(1, Math.min(next, Math.max(1, totalPages)))); },
  };
}
