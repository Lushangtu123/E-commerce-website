'use client';

import '@/lib/admin-i18n';
import { translate, useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { AdminPage, AdminProductRow, Category } from '@/lib/api';
import { useAdminQuery, useAdminSessionId } from '@/hooks/use-admin-query';
import AdminLayout from '@/components/AdminLayout';
import ProductImage from '@/components/ProductImage';
import AdminProductForm, { EMPTY_PRODUCT_FORM, isProductFormComplete, toProductPayload, toProductChanges, type ProductFormValues } from '@/components/AdminProductForm';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { requestFailure } from '@/lib/api-error';
import { localizedText } from '@/lib/product-content';
import { clearPendingProductCreation, readPendingProductCreation, storePendingProductCreation, type PendingProductCreation } from '@/lib/pending-product-creation';
import { inventoryUpdateAcknowledged, unknownInventoryWrite, validProductSnapshot } from '@/lib/admin-inventory-write';

type EditProductForm = ProductFormValues & { product_id: number; has_sku: boolean; previous: ProductFormValues };
type Recovery = { sessionId: string | null; checking: boolean };

export default function AdminProductsPage() {
  const { t, locale } = useI18n();
  const sessionId = useAdminSessionId();
  const queryClient = useQueryClient();
  // The page and filters belong to the administrator who chose them; another one starts unfiltered on page one.
  const [view, setView] = useState({ sessionId, page: 1, filters: { keyword: '', status: '' } });
  const ownsView = view.sessionId === sessionId;
  const page = ownsView ? view.page : 1;
  const filters = ownsView ? view.filters : { keyword: '', status: '' };
  const [draft, setDraft] = useState({ sessionId, keyword: '' });
  const keywordDraft = draft.sessionId === sessionId ? draft.keyword : '';
  const [selection, setSelection] = useState<{ key: string; ids: number[] } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formScope, setFormScope] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newProduct, setNewProduct] = useState(EMPTY_PRODUCT_FORM);
  const [editProduct, setEditProduct] = useState<EditProductForm | null>(null);
  const pendingCreation = useRef<{ sessionId: string; attempt: PendingProductCreation } | null>(null);
  const [creation, setCreation] = useState<{ sessionId: string; attempt: PendingProductCreation } | null>(null);
  const creationUnavailable = useRef<string | null>(null);
  const [creationStorageError, setCreationStorageError] = useState<string | null>(null);
  const pending = creation?.sessionId === sessionId ? creation.attempt : null;

  const scopeKey = JSON.stringify([sessionId, page, filters.keyword, filters.status]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mutation = useRef<object | null>(null);
  const recovery = useRef<Recovery | null>(null);
  const [recovering, setRecovering] = useState<Recovery | null>(null);
  const latestRead = useRef<(() => Promise<boolean>) | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const query = useAdminQuery({
    name: 'products',
    params: [page, filters.keyword, filters.status],
    load: () => api.get<unknown, AdminPage & { products?: AdminProductRow[] }>('/admin/products', { params: {
      page, limit: 20,
      ...(filters.keyword && { keyword: filters.keyword }),
      ...(filters.status !== '' && { status: filters.status }),
    } }),
  });
  const categoriesQuery = useAdminQuery({ name: 'categories', params: [], load: () => api.get<unknown, Category[]>('/products/categories') });
  const categories = categoriesQuery.data ?? [];
  const categoriesReady = categoriesQuery.data !== undefined && !categoriesQuery.error;
  const categoriesLoading = !categoriesReady && !categoriesQuery.error;
  const lastPage = Math.max(1, Number(query.data?.pagination?.totalPages) || Math.ceil((Number(query.data?.pagination?.total) || 0) / 20));
  const beyondLastPage = query.data !== undefined && page > lastPage;
  const shown = beyondLastPage ? undefined : query.data;
  // Handlers act only on the rows they were rendered with, not on rows a refresh has since replaced.
  const displayed = useRef(shown);
  displayed.current = shown;
  const products = shown?.products || [];
  const total = Number(shown?.pagination?.total) || 0;
  const loadError = query.error ? requestFailure(query.error).response?.data?.error || '获取商品列表失败' : undefined;
  const loading = !shown && !loadError;
  const unresolved = recovering?.sessionId === sessionId && query.isCurrentSession() ? recovering : null;
  const busy = !!sessionId && (pendingSessionId === sessionId || !!unresolved);
  const writeLocked = () => !!mutation.current || recovery.current?.sessionId === sessionId;
  const isCurrentScope = () => query.isCurrentSession() && currentScope.current === scopeKey;
  const isDisplayedScope = () => isCurrentScope() && shown !== undefined && displayed.current === shown;
  const reload = () => { if (isCurrentScope()) void query.refetch(); };
  const reloadCategories = () => {
    if (formScope === scopeKey && isCurrentScope() && categoriesQuery.isCurrentSession()) void categoriesQuery.refetch();
  };
  const restoreCreation = () => {
    if (!sessionId || !query.isCurrentSession() || writeLocked()) return;
    try {
      const attempt = readPendingProductCreation(sessionId);
      pendingCreation.current = attempt ? { sessionId, attempt } : null;
      setCreation(pendingCreation.current);
      creationUnavailable.current = null; setCreationStorageError(null);
    } catch {
      pendingCreation.current = null; setCreation(null);
      creationUnavailable.current = sessionId; setCreationStorageError(sessionId);
    }
  };

  // Cancel earlier list reads before replacing the cache with this recovery snapshot.
  // A filter change during the read is checked again through the latest render's loader.
  latestRead.current = async () => {
    if (!isCurrentScope()) return false;
    await queryClient.cancelQueries({ queryKey: ['admin', 'products', sessionId] });
    if (!isCurrentScope()) return false;
    const actual = await api.get<unknown, unknown>('/admin/products', { params: {
      page, limit: 20, ...(filters.keyword && { keyword: filters.keyword }), ...(filters.status !== '' && { status: filters.status }),
    } });
    if (!isCurrentScope()) return false;
    if (!validProductSnapshot(actual)) throw new Error('Invalid product snapshot');
    queryClient.setQueryData(['admin', 'products', sessionId, page, filters.keyword, filters.status], actual);
    return true;
  };

  const selectableProducts = products.filter(product => product.status === 0 || product.status === 1);
  const selectedIds = shown && selection?.key === scopeKey ? selection.ids.filter(id => selectableProducts.some(product => product.product_id === id)) : [];
  const allSelected = selectableProducts.length > 0 && selectableProducts.every(product => selectedIds.includes(product.product_id));
  const setSelectedIds = (next: number[] | ((ids: number[]) => number[])) => {
    if (!isCurrentScope()) return;
    setSelection(previous => ({ key: scopeKey, ids: typeof next === 'function' ? next(previous?.key === scopeKey ? previous.ids : []) : next }));
  };

  // Open forms and a pending action belong to the administrator who started them.
  useEffect(() => {
    mutation.current = null;
    recovery.current = null;
    setRecovering(null);
    setPendingSessionId(null);
    setShowAddModal(false);
    setShowEditModal(false);
    setEditProduct(null);
    setNewProduct(EMPTY_PRODUCT_FORM);
    pendingCreation.current = null; setCreation(null);
    creationUnavailable.current = null; setCreationStorageError(null);
    restoreCreation();
  }, [sessionId]);

  // A selection belongs to the page and filters it was made on, even when they are visited again.
  useEffect(() => {
    setSelection(null);
  }, [scopeKey]);

  // Taking the only product on the final filtered page off sale leaves that page empty; show the new last page.
  useEffect(() => {
    if (beyondLastPage) setView({ sessionId, page: lastPage, filters });
  }, [beyondLastPage]);

  useEffect(() => {
    if (query.error) logger.error('获取商品列表失败:', query.error);
  }, [query.error]);

  useEffect(() => {
    if (categoriesQuery.error) logger.error('获取分类失败:', categoriesQuery.error);
  }, [categoriesQuery.error]);

  const checkProducts = async (record: Recovery) => {
    if (!query.isCurrentSession() || recovery.current !== record || record.checking) return;
    const checking = { ...record, checking: true }; recovery.current = checking; setRecovering(checking);
    try {
      const refreshed = await latestRead.current?.();
      if (!query.isCurrentSession() || recovery.current !== checking) return;
      if (!refreshed) {
        const failed = { ...checking, checking: false }; recovery.current = failed; setRecovering(failed);
        return;
      }
      // Inventory can change through sales during recovery; never infer the write result or replay its draft.
      setShowEditModal(false); setEditProduct(null); setSelection(null);
      recovery.current = null; setRecovering(null);
      toast.error(translate('已重新加载当前商品数据，请核对后重新编辑；此前提交结果仍无法确认'));
    } catch {
      if (query.isCurrentSession() && recovery.current === checking) {
        const failed = { ...checking, checking: false }; recovery.current = failed; setRecovering(failed);
      }
    }
  };
  const startRecovery = async () => {
    if (!query.isCurrentSession()) return;
    const record = { sessionId, checking: false }; recovery.current = record; setRecovering(record);
    // Retire the modal immediately so its blocking dialog cannot hide the read-only recovery control.
    setShowEditModal(false); setEditProduct(null); setSelection(null);
    await checkProducts(record);
  };
  const runMutation = async (perform: () => Promise<unknown>, success: string, failure: string, afterSuccess?: () => void,
    acknowledged?: (value: unknown) => boolean) => {
    if (!isDisplayedScope() || writeLocked()) return;
    const operation = {};
    mutation.current = operation;
    setPendingSessionId(sessionId);
    try {
      const response = await perform();
      if (!query.isCurrentSession() || mutation.current !== operation) return;
      if (acknowledged && !acknowledged(response)) { await startRecovery(); return; }
      if (isDisplayedScope()) {
        afterSuccess?.();
        toast.success(translate(success));
      }
      // The page or filters may have changed meanwhile; this reloads whichever rows are displayed now.
      // After a session change it sends nothing: the old administrator's queries are gone or fail their session check.
      await query.invalidate();
    } catch (error) {
      if (!query.isCurrentSession() || mutation.current !== operation) return;
      if (acknowledged && unknownInventoryWrite(error)) await startRecovery();
      else if (isDisplayedScope()) toast.error(translate(requestFailure(error).response?.data?.error || failure));
    } finally {
      if (mutation.current === operation) {
        mutation.current = null;
        setPendingSessionId(null);
      }
    }
  };

  const changeFilters = (next: { keyword: string; status: string }) => {
    if (!isCurrentScope() || (page === 1 && next.keyword === filters.keyword && next.status === filters.status)) return;
    // Retire this scope's handlers now, before React commits the new query.
    currentScope.current = JSON.stringify([sessionId, 1, next.keyword, next.status]);
    setView({ sessionId, page: 1, filters: next });
  };

  const changePage = (next: number) => {
    if (!isDisplayedScope()) return;
    const target = Math.max(1, Math.min(next, Math.max(1, Math.ceil(total / 20))));
    if (target === page) return;
    currentScope.current = JSON.stringify([sessionId, target, filters.keyword, filters.status]);
    setView({ sessionId, page: target, filters });
  };

  const submitSearch = () => {
    if (!isCurrentScope()) return;
    if (page === 1 && keywordDraft === filters.keyword) reload();
    else changeFilters({ ...filters, keyword: keywordDraft });
  };

  const resetSearch = () => {
    if (!isCurrentScope()) return;
    setDraft({ sessionId, keyword: '' });
    changeFilters({ keyword: '', status: '' });
  };

  const handleStatusChange = (productId: number, newStatus: number) => {
    if (!selectableProducts.some(row => row.product_id === productId)) return;
    return runMutation(() => api.put(`/admin/products/${productId}/status`, { status: newStatus }),
      newStatus === 1 ? '商品已上架' : '商品已下架', '更新状态失败', undefined,
      value => inventoryUpdateAcknowledged(value) && 'status' in value && value.status === newStatus);
  };

  const handleBatchStatusChange = (newStatus: number) => {
    if (!isDisplayedScope() || writeLocked()) return;
    const ids = [...selectedIds];
    if (ids.length === 0) { toast.error(translate('请先选择商品')); return; }
    return runMutation(() => api.put('/admin/products/batch/status', { productIds: ids, status: newStatus }),
      t(newStatus === 1 ? '已上架{count}个商品' : '已下架{count}个商品', { count: ids.length }), '批量操作失败',
      () => setSelectedIds([]), value => !!value && typeof value === 'object' && 'message' in value && value.message === '批量更新成功' && 'count' in value && value.count === ids.length);
  };

  const toggleSelect = (productId: number) => {
    if (writeLocked() || !isDisplayedScope() || !selectableProducts.some(product => product.product_id === productId)) return;
    setSelectedIds(prev => 
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const toggleSelectAll = () => {
    if (writeLocked() || !isDisplayedScope()) return;
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableProducts.map(p => p.product_id));
    }
  };

  const updateNewProduct = (next: ProductFormValues) => {
    if (formScope === scopeKey && isDisplayedScope() && !writeLocked() && pendingCreation.current?.sessionId !== sessionId) setNewProduct(next);
  };
  const updateEditProduct = (next: EditProductForm) => {
    if (formScope === scopeKey && isDisplayedScope() && !writeLocked()) setEditProduct(next);
  };

  const submitCreation = async (attempt: PendingProductCreation) => {
    if (!sessionId || !query.isCurrentSession() || writeLocked() || creationUnavailable.current === sessionId) return;
    const recovering = pendingCreation.current?.sessionId === sessionId;
    if (!storePendingProductCreation(sessionId, attempt)) {
      toast.error(translate('无法保存商品新增请求，请允许浏览器存储后重试')); return;
    }
    const operation = {}; mutation.current = operation; setPendingSessionId(sessionId);
    pendingCreation.current = { sessionId, attempt }; setCreation(pendingCreation.current);
    const active = () => query.isCurrentSession() && mutation.current === operation;
    try {
      const data = await api.post<unknown, { product_id: number }>('/admin/products', { ...attempt.input, create_key: attempt.key });
      if (!active()) return;
      if (!data || !Number.isSafeInteger(data.product_id) || data.product_id <= 0) throw new Error('Invalid product creation response');
      if (clearPendingProductCreation(sessionId, attempt.key)) {
        pendingCreation.current = null; setCreation(null);
        setNewProduct(EMPTY_PRODUCT_FORM); toast.success(translate('商品添加成功'));
      } else toast.error(translate('商品已保存，但未能清除本地确认记录，请重试确认'));
      setShowAddModal(false);
      void query.invalidate();
    } catch (error) {
      if (!active()) return;
      const failure = requestFailure(error), status = failure.response?.status;
      // A rejection on a recovery retry cannot prove that an earlier lost reply did not commit.
      const definitive = !recovering && status !== undefined && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
      if (definitive && clearPendingProductCreation(sessionId, attempt.key)) {
        pendingCreation.current = null; setCreation(null);
      } else setShowAddModal(false);
      toast.error(translate(failure.response?.data?.error || (definitive ? '添加商品失败' : '新增商品结果尚未确认，请先重试确认')));
    } finally {
      if (mutation.current === operation) { mutation.current = null; setPendingSessionId(null); }
    }
  };

  const handleAddProduct = () => {
    if (formScope !== scopeKey || !isDisplayedScope() || !categoriesReady || writeLocked() || pendingCreation.current?.sessionId === sessionId || creationUnavailable.current === sessionId || !sessionId) return;
    if (!isProductFormComplete(newProduct)) {
      toast.error(translate('请填写商品标题、价格和分类'));
      return;
    }
    let payload;
    try { payload = toProductPayload(newProduct); }
    catch (error) { toast.error(translate((error as Error).message)); return; }
    let key: string;
    try { key = crypto.randomUUID(); }
    catch { toast.error(translate('无法保存商品新增请求，请允许浏览器存储后重试')); return; }
    return submitCreation({ key, input: payload });
  };

  const openEditModal = (product: AdminProductRow) => {
    if (!isDisplayedScope() || writeLocked() || !selectableProducts.some(row => row.product_id === product.product_id)) return;
    setFormScope(scopeKey);
    const values: ProductFormValues = {
      title: product.title,
      title_en: product.title_en || '',
      description: product.description || '',
      description_en: product.description_en || '',
      specs: product.specs,
      specs_en: product.specs_en,
      price: product.price.toString(),
      stock: product.stock.toString(),
      category_id: product.category_id == null ? '' : String(product.category_id),
      brand: product.brand || '',
      main_image: product.main_image || '',
      status: product.status
    };
    setEditProduct({ ...values, product_id: product.product_id, has_sku: product.has_sku === 1 || product.has_sku === true, previous: values });
    setShowEditModal(true);
  };

  const handleEditProduct = () => {
    if (formScope !== scopeKey || !editProduct || !isDisplayedScope() || !categoriesReady || writeLocked() ||
      !selectableProducts.some(product => product.product_id === editProduct.product_id)) return;
    if (!isProductFormComplete(editProduct)) {
      toast.error(translate('请填写商品标题、价格和分类'));
      return;
    }
    let payload;
    try { payload = toProductChanges(editProduct, editProduct.previous); }
    catch (error) { toast.error(translate((error as Error).message)); return; }
    if (!Object.keys(payload).length) { toast.success(translate('没有需要保存的修改')); return; }
    return runMutation(() => api.put(`/admin/products/${editProduct.product_id}`, payload), '商品更新成功', '更新商品失败', () => {
      setShowEditModal(false);
      setEditProduct(null);
    }, inventoryUpdateAcknowledged);
  };

  const getStatusBadge = (status: number) => {
    if (status === -1) return <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">{t('已删除')}</span>;
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">{t("已上架")}</span>;
    }
    return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">{t("已下架")}</span>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* 页面标题和操作 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("商品管理")}</h1>
            <p className="text-gray-600 mt-1">{t("管理商品的上下架和信息")}</p>
          </div>
          <button 
            onClick={() => { if (isDisplayedScope() && !writeLocked() && pendingCreation.current?.sessionId !== sessionId && creationUnavailable.current !== sessionId) { setFormScope(scopeKey); setShowAddModal(true); } }}
            disabled={busy || !!pending || creationStorageError === sessionId || loading || !!loadError}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <span className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t("添加商品")}
            </span>
          </button>
        </div>

        {pending && <div className="card p-4 space-y-3" role="alert">
          <p>{t('新增商品结果尚未确认，请先重试确认')}</p>
          <p className="font-medium">{localizedText(String(pending.input.title), typeof pending.input.title_en === 'string' ? pending.input.title_en : undefined, locale)}</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => {
            const current = pendingCreation.current;
            if (current?.sessionId === sessionId) void submitCreation(current.attempt);
          }}>{t('重试确认商品')}</button>
        </div>}
        {creationStorageError === sessionId && <div className="card p-4 space-y-3" role="alert">
          <p>{t('无法读取商品新增记录，请检查浏览器存储后重试')}</p>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={restoreCreation}>{t('重新读取新增记录')}</button>
        </div>}

        {unresolved && <div role="alert" className="bg-white rounded-lg shadow-sm p-4 space-y-3">
          <p>{t(unresolved.checking ? '商品更新结果未知，正在重新加载当前数据...' : '商品更新结果尚未确认，请重新加载核对；确认前不会再次提交')}</p>
          <button type="button" className="btn btn-outline" disabled={unresolved.checking || pendingSessionId === sessionId}
            onClick={() => void checkProducts(unresolved)}>{t('重新核对商品')}</button>
        </div>}

        {/* 搜索和筛选 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <form role="search" onSubmit={event => { event.preventDefault(); submitSearch(); }} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder={t("搜索商品名称...")}
              aria-label={t("搜索商品")}
              value={keywordDraft}
              onChange={(e) => { if (isCurrentScope()) setDraft({ sessionId, keyword: e.target.value }); }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <select
              aria-label={t("商品状态")}
              value={filters.status}
              onChange={(e) => changeFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">{t("全部状态")}</option>
              <option value="1">{t("已上架")}</option>
              <option value="0">{t("已下架")}</option>
              <option value="-1">{t("已删除")}</option>
            </select>
            <button
              type="submit"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              {t("搜索")}
            </button>
            <button
              type="button"
              onClick={resetSearch}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {t("重置")}
            </button>
          </form>
        </div>

        {/* 批量操作 */}
        {selectedIds.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">{t("已选择 {count} 个商品", { count: selectedIds.length })}</span>
              <div className="space-x-2">
                <button
                  onClick={() => handleBatchStatusChange(1)}
                  disabled={busy}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  {t("批量上架")}
                </button>
                <button
                  onClick={() => handleBatchStatusChange(0)}
                  disabled={busy}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                >
                  {t("批量下架")}
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  {t("取消选择")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 商品列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">{t("加载中...")}</p>
              </div>
            </div>
          ) : loadError ? (
            <div role="alert" className="p-8 text-center">
              <p className="text-red-600">{t(loadError)}</p>
              <button onClick={reload} className="mt-4 px-4 py-2 border rounded-lg">{t('重新加载')}</button>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        aria-label={t("全选")}
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        disabled={busy || selectableProducts.length === 0}
                        className="rounded-sm border-gray-300"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("商品")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("价格")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("库存")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("销量")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("状态")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t("操作")}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {products.map((product) => (
                    <tr key={product.product_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          aria-label={t("选择 {title}", { title: localizedText(product.title, product.title_en, locale) })}
                          checked={selectedIds.includes(product.product_id)}
                          onChange={() => toggleSelect(product.product_id)}
                          disabled={busy || product.status === -1}
                          className="rounded-sm border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <ProductImage src={product.main_image} alt={localizedText(product.title, product.title_en, locale)} compact className="h-12 w-12 shrink-0 rounded-lg" />
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{localizedText(product.title, product.title_en, locale)}</div>
                            <div className="text-sm text-gray-500">{product.category_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {product.has_sku === 1 || product.has_sku === true ? <>
                          <div>{product.sku_min_price == null ? t('无启用规格') : t('规格起价 ¥{price}', { price: Number(product.sku_min_price).toFixed(2) })}</div>
                          <div className="text-xs font-normal text-gray-500 mt-1">{t('基础价格 ¥{price}', { price: Number(product.price).toFixed(2) })}</div>
                        </> : <>¥{product.price ? Number(product.price).toFixed(2) : '0.00'}</>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {product.has_sku === 1 || product.has_sku === true ? <>
                          <div>{t('可售库存 {stock}', { stock: product.sellable_stock ?? 0 })}</div>
                          <div className="text-xs text-gray-500 mt-1">{t('基础库存 {stock}', { stock: product.stock })}</div>
                        </> : product.stock}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {product.sales_count || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(product.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        {product.status !== -1 && <>{product.status === 1 ? (
                          <button
                            onClick={() => handleStatusChange(product.product_id, 0)}
                            disabled={busy}
                            className="text-orange-600 hover:text-orange-900"
                          >
                            {t("下架")}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(product.product_id, 1)}
                            disabled={busy}
                            className="text-green-600 hover:text-green-900"
                          >
                            {t("上架")}
                          </button>
                        )}
                        <button 
                          onClick={() => openEditModal(product)}
                          disabled={busy}
                          className="text-primary-600 hover:text-primary-800"
                        >
                          {t("编辑")}
                        </button>
                        <Link href={`/admin/products/${product.product_id}/skus`} className="text-primary-600 hover:text-primary-800" onClick={event => { if (!isDisplayedScope()) event.preventDefault(); }}>{t('管理规格')}</Link></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 分页 */}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  {t("共 {count} 个商品", { count: total })}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => changePage(page - 1)}
                    disabled={page === 1}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    {t("上一页")}
                  </button>
                  <span className="px-4 py-2 text-sm text-gray-700">
                    {t("第 {page} 页", { page })}
                  </span>
                  <button
                    onClick={() => changePage(page + 1)}
                    disabled={page >= Math.ceil(total / 20)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    {t("下一页")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {formScope === scopeKey && showAddModal && (
          <AdminProductForm idPrefix="newProduct" heading={t('添加商品')} submitLabel={t('添加商品')}
            values={newProduct} categories={categories} busy={busy} onChange={updateNewProduct}
            categoriesLoading={categoriesLoading} categoriesFailed={!!categoriesQuery.error} onRetryCategories={reloadCategories}
            onClose={() => setShowAddModal(false)} onSubmit={handleAddProduct} />
        )}

        {formScope === scopeKey && showEditModal && editProduct && (
          <AdminProductForm idPrefix="editProduct" heading={t('编辑商品')} submitLabel={t('保存修改')}
            values={editProduct} categories={categories} busy={busy}
            variantProductId={editProduct.has_sku ? editProduct.product_id : undefined}
            categoriesLoading={categoriesLoading} categoriesFailed={!!categoriesQuery.error} onRetryCategories={reloadCategories}
            onChange={values => updateEditProduct({ ...values, product_id: editProduct.product_id, has_sku: editProduct.has_sku, previous: editProduct.previous })}
            onClose={() => { setShowEditModal(false); setEditProduct(null); }} onSubmit={handleEditProduct} />
        )}
      </div>
    </AdminLayout>
  );
}
