'use client';

import { useI18n } from '@/lib/i18n';

import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { getAdminSessionToken } from '@/lib/admin-session';
import AdminLayout from '@/components/AdminLayout';
import ProductImage from '@/components/ProductImage';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

export default function AdminProductsPage() {
  const { t } = useI18n();
  const [result, setResult] = useState<{ key: string; revision: number; rows: any[]; total: number; error?: string } | null>(null);
  const [pageState, setPage] = useState(1);
  const [filtersState, setFilters] = useState({
    keyword: '',
    status: ''
  });
  const [selection, setSelection] = useState<{ key: string; ids: number[] } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formScope, setFormScope] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [newProduct, setNewProduct] = useState({
    title: '',
    description: '',
    price: '',
    stock: '',
    category_id: '',
    brand: '',
    main_image: '',
    status: 1
  });
  const [editProduct, setEditProduct] = useState<any>(null);

  const [, notifySessionChange] = useState(0);
  const [queryToken, setQueryToken] = useState(getAdminSessionToken);
  const token = getAdminSessionToken();
  const ownsQuery = queryToken === token;
  const page = ownsQuery ? pageState : 1;
  const filters = ownsQuery ? filtersState : { keyword: '', status: '' };
  const scopeKey = JSON.stringify([token, page, filters.keyword, filters.status]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef<object | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const latestRefresh = useRef<(() => Promise<void>) | null>(null);
  const isCurrentSession = () => mounted.current && !!token && getAdminSessionToken() === token;
  const isCurrentScope = () => isCurrentSession() && currentScope.current === scopeKey;
  const ownsResult = isCurrentScope() && result?.key === scopeKey;
  const products = ownsResult ? result.rows : [];
  const total = ownsResult ? result.total : 0;
  const loading = !ownsResult;
  const loadError = ownsResult ? result.error : undefined;
  const busy = !!token && pendingToken === token;
  const isDisplayedScope = () => isCurrentScope() && ownsResult && !loadError && result?.revision === request.current;

  const selectedIds = ownsResult && selection?.key === scopeKey ? selection.ids.filter(id => products.some(product => product.product_id === id)) : [];
  const allSelected = products.length > 0 && products.every(product => selectedIds.includes(product.product_id));
  const setSelectedIds = (next: number[] | ((ids: number[]) => number[])) => {
    if (!isCurrentScope()) return;
    setSelection(previous => ({ key: scopeKey, ids: typeof next === 'function' ? next(previous?.key === scopeKey ? previous.ids : []) : next }));
  };

  useEffect(() => {
    mounted.current = true;
    const onStorage = (event: StorageEvent) => {
      if ((event.storageArea === null || event.storageArea === localStorage) &&
        (event.key === null || event.key === 'admin_token' || event.key === 'admin_user')) notifySessionChange(value => value + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => { mounted.current = false; request.current++; window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    if (!ownsQuery) {
      setPage(1);
      setFilters({ keyword: '', status: '' });
      setQueryToken(token);
      mutation.current = null;
      setPendingToken(null);
      setShowAddModal(false);
      setShowEditModal(false);
      setEditProduct(null);
      setNewProduct({ title: '', description: '', price: '', stock: '', category_id: '', brand: '', main_image: '', status: 1 });
      setCategories([]);
    }
  }, [token]);

  const fetchProducts = async () => {
    if (!isCurrentScope()) return;
    const revision = ++request.current;
    setResult(null);
    try {
      const data: any = await api.get('/admin/products', { params: {
        page, limit: 20,
        ...(filters.keyword && { keyword: filters.keyword }),
        ...(filters.status !== '' && { status: filters.status }),
      } });
      if (!isCurrentScope() || revision !== request.current) return;
      const lastPage = Math.max(1, Number(data.pagination?.totalPages) || Math.ceil((Number(data.pagination?.total) || 0) / 20));
      if (page > lastPage) { setPage(lastPage); return; }
      setResult({ key: scopeKey, revision, rows: data.products || [], total: Number(data.pagination?.total) || 0 });
    } catch (error: any) {
      if (!isCurrentScope() || revision !== request.current) return;
      logger.error('获取商品列表失败:', error);
      setResult({ key: scopeKey, revision, rows: [], total: 0, error: error.response?.data?.error || '获取商品列表失败' });
    }
  };

  useEffect(() => {
    setSelection(null);
    fetchProducts();
    return () => { request.current++; };
  }, [scopeKey]);

  useEffect(() => {
    const capturedToken = token;
    let active = true;
    if (!isCurrentSession()) return;
    api.get('/products/categories').then((data: any) => {
      if (active && mounted.current && getAdminSessionToken() === capturedToken) setCategories(data);
    }).catch(error => { if (active && isCurrentSession()) logger.error('获取分类失败:', error); });
    return () => { active = false; };
  }, [token]);

  latestRefresh.current = fetchProducts;

  const runMutation = async (perform: () => Promise<unknown>, success: string, failure: string, afterSuccess?: () => void) => {
    if (!isDisplayedScope() || mutation.current) return;
    const operation = {};
    mutation.current = operation;
    setPendingToken(token);
    try {
      await perform();
      if (!isCurrentSession()) return;
      if (isDisplayedScope()) {
        afterSuccess?.();
        toast.success(t(success));
      }
      await latestRefresh.current?.();
    } catch (error: any) {
      if (isDisplayedScope()) toast.error(t(error.response?.data?.error || failure));
    } finally {
      if (isCurrentSession() && mutation.current === operation) {
        mutation.current = null;
        setPendingToken(null);
      }
    }
  };

  const changeFilters = (next: { keyword: string; status: string }) => {
    if (!isCurrentScope() || (page === 1 && next.keyword === filters.keyword && next.status === filters.status)) return;
    currentScope.current = JSON.stringify([token, 1, next.keyword, next.status]);
    request.current++;
    setResult(null);
    setPage(1);
    setFilters(next);
  };

  const changePage = (next: number) => {
    if (!isDisplayedScope()) return;
    const target = Math.max(1, Math.min(next, Math.max(1, Math.ceil(total / 20))));
    if (target === page) return;
    currentScope.current = JSON.stringify([token, target, filters.keyword, filters.status]);
    request.current++;
    setResult(null);
    setPage(target);
  };

  const handleStatusChange = (productId: number, newStatus: number) => {
    if (!isDisplayedScope() || !products.some(row => row.product_id === productId)) return;
    return runMutation(() => api.put(`/admin/products/${productId}/status`, { status: newStatus }),
      newStatus === 1 ? '商品已上架' : '商品已下架', '更新状态失败');
  };

  const handleBatchStatusChange = (newStatus: number) => {
    if (!isDisplayedScope() || mutation.current) return;
    const ids = [...selectedIds];
    if (ids.length === 0) { toast.error(t('请先选择商品')); return; }
    return runMutation(() => api.put('/admin/products/batch/status', { productIds: ids, status: newStatus }),
      t(newStatus === 1 ? '已上架{count}个商品' : '已下架{count}个商品', { count: ids.length }), '批量操作失败',
      () => setSelectedIds([]));
  };

  const toggleSelect = (productId: number) => {
    if (mutation.current || !isDisplayedScope() || !products.some(product => product.product_id === productId)) return;
    setSelectedIds(prev => 
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const toggleSelectAll = () => {
    if (mutation.current || !isDisplayedScope()) return;
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(products.map(p => p.product_id));
    }
  };

  const updateNewProduct = (next: typeof newProduct) => {
    if (formScope === scopeKey && isDisplayedScope() && !mutation.current) setNewProduct(next);
  };
  const updateEditProduct = (next: any) => {
    if (formScope === scopeKey && isDisplayedScope() && !mutation.current) setEditProduct(next);
  };

  const handleAddProduct = () => {
    if (formScope !== scopeKey || !isDisplayedScope() || mutation.current) return;
    if (!newProduct.title || !newProduct.price || !newProduct.category_id) {
      toast.error(t('请填写商品标题、价格和分类'));
      return;
    }
    const payload = {
      title: newProduct.title, description: newProduct.description,
      price: parseFloat(newProduct.price), stock: parseInt(newProduct.stock) || 0,
      category_id: parseInt(newProduct.category_id), brand: newProduct.brand,
      image_url: newProduct.main_image, status: newProduct.status,
    };
    return runMutation(() => api.post('/admin/products', payload), '商品添加成功', '添加商品失败', () => {
      setShowAddModal(false);
      setNewProduct({ title: '', description: '', price: '', stock: '', category_id: '', brand: '', main_image: '', status: 1 });
    });
  };

  const openEditModal = (product: any) => {
    if (!isDisplayedScope() || mutation.current || !products.some(row => row.product_id === product.product_id)) return;
    setFormScope(scopeKey);
    setEditProduct({
      product_id: product.product_id,
      title: product.title,
      description: product.description || '',
      price: product.price.toString(),
      stock: product.stock.toString(),
      category_id: product.category_id.toString(),
      brand: product.brand || '',
      main_image: product.main_image || '',
      status: product.status
    });
    setShowEditModal(true);
  };

  const handleEditProduct = () => {
    if (formScope !== scopeKey || !editProduct || !isDisplayedScope() || mutation.current ||
      !products.some(product => product.product_id === editProduct.product_id)) return;
    if (!editProduct.title || !editProduct.price || !editProduct.category_id) {
      toast.error(t('请填写商品标题、价格和分类'));
      return;
    }
    const payload = {
      title: editProduct.title, description: editProduct.description,
      price: parseFloat(editProduct.price), stock: parseInt(editProduct.stock) || 0,
      category_id: parseInt(editProduct.category_id), brand: editProduct.brand,
      image_url: editProduct.main_image, status: editProduct.status,
    };
    return runMutation(() => api.put(`/admin/products/${editProduct.product_id}`, payload), '商品更新成功', '更新商品失败', () => {
      setShowEditModal(false);
      setEditProduct(null);
    });
  };

  const getStatusBadge = (status: number) => {
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
            onClick={() => { if (isDisplayedScope() && !mutation.current) { setFormScope(scopeKey); setShowAddModal(true); } }}
            disabled={busy || loading || !!loadError}
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

        {/* 搜索和筛选 */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder={t("搜索商品名称...")}
              value={filters.keyword}
              onChange={(e) => changeFilters({ ...filters, keyword: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <select
              value={filters.status}
              onChange={(e) => changeFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">{t("全部状态")}</option>
              <option value="1">{t("已上架")}</option>
              <option value="0">{t("已下架")}</option>
            </select>
            <button
              onClick={fetchProducts}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              {t("搜索")}
            </button>
            <button
              onClick={() => changeFilters({ keyword: '', status: '' })}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {t("重置")}
            </button>
          </div>
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
              <button onClick={fetchProducts} className="mt-4 px-4 py-2 border rounded-lg">{t('重新加载')}</button>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        disabled={busy}
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
                          checked={selectedIds.includes(product.product_id)}
                          onChange={() => toggleSelect(product.product_id)}
                          disabled={busy}
                          className="rounded-sm border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <ProductImage src={product.main_image} alt={product.title} compact className="h-12 w-12 shrink-0 rounded-lg" />
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{product.title}</div>
                            <div className="text-sm text-gray-500">{product.category_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        ¥{product.price ? parseFloat(product.price).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {product.stock}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {product.sales_count || 0}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(product.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        {product.status === 1 ? (
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
                        <Link href={`/admin/products/${product.product_id}/skus`} className="text-primary-600 hover:text-primary-800" onClick={event => { if (!isDisplayedScope()) event.preventDefault(); }}>{t('管理规格')}</Link>
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

        {/* 添加商品模态框 */}
        {ownsQuery && formScope === scopeKey && showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">{t("添加商品")}</h2>
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* 商品标题 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("商品标题")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newProduct.title}
                      onChange={(e) => updateNewProduct({ ...newProduct, title: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={t("请输入商品标题")}
                    />
                  </div>

                  {/* 商品描述 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("商品描述")}
                    </label>
                    <textarea
                      value={newProduct.description}
                      onChange={(e) => updateNewProduct({ ...newProduct, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={t("请输入商品描述")}
                    />
                  </div>

                  {/* 价格和库存 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("价格 (元)")} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newProduct.price}
                        onChange={(e) => updateNewProduct({ ...newProduct, price: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("库存")}
                      </label>
                      <input
                        type="number"
                        value={newProduct.stock}
                        onChange={(e) => updateNewProduct({ ...newProduct, stock: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* 分类和品牌 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("分类")} <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={newProduct.category_id}
                        onChange={(e) => updateNewProduct({ ...newProduct, category_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        <option value="">{t("请选择分类")}</option>
                        {categories.map((cat) => (
                          <option key={cat.category_id} value={cat.category_id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("品牌")}
                      </label>
                      <input
                        type="text"
                        value={newProduct.brand}
                        onChange={(e) => updateNewProduct({ ...newProduct, brand: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder={t("请输入品牌")}
                      />
                    </div>
                  </div>

                  {/* 图片URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("商品图片URL")}
                    </label>
                    <input
                      type="text"
                      value={newProduct.main_image}
                      onChange={(e) => updateNewProduct({ ...newProduct, main_image: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="https://example.com/image.jpg"
                    />
                    {/* Shows the fallback for a broken URL, and recovers once the URL is corrected. */}
                    {newProduct.main_image && (
                      <ProductImage src={newProduct.main_image} alt={t("预览")} className="mt-2 h-32 w-32 rounded-lg" />
                    )}
                  </div>

                  {/* 状态 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("状态")}
                    </label>
                    <select
                      value={newProduct.status}
                      onChange={(e) => updateNewProduct({ ...newProduct, status: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value={1}>{t("上架")}</option>
                      <option value={0}>{t("下架")}</option>
                    </select>
                  </div>
                </div>

                {/* 按钮 */}
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t("取消")}
                  </button>
                  <button
                    onClick={handleAddProduct}
                    disabled={busy}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    {t("添加商品")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 编辑商品模态框 */}
        {ownsQuery && formScope === scopeKey && showEditModal && editProduct && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">{t("编辑商品")}</h2>
                  <button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditProduct(null);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* 商品标题 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("商品标题")} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editProduct.title}
                      onChange={(e) => updateEditProduct({ ...editProduct, title: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={t("请输入商品标题")}
                    />
                  </div>

                  {/* 商品描述 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("商品描述")}
                    </label>
                    <textarea
                      value={editProduct.description}
                      onChange={(e) => updateEditProduct({ ...editProduct, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={t("请输入商品描述")}
                    />
                  </div>

                  {/* 价格和库存 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("价格 (元)")} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editProduct.price}
                        onChange={(e) => updateEditProduct({ ...editProduct, price: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("库存")}
                      </label>
                      <input
                        type="number"
                        value={editProduct.stock}
                        onChange={(e) => updateEditProduct({ ...editProduct, stock: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* 分类和品牌 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("分类")} <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={editProduct.category_id}
                        onChange={(e) => updateEditProduct({ ...editProduct, category_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        <option value="">{t("请选择分类")}</option>
                        {categories.map((cat) => (
                          <option key={cat.category_id} value={cat.category_id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("品牌")}
                      </label>
                      <input
                        type="text"
                        value={editProduct.brand}
                        onChange={(e) => updateEditProduct({ ...editProduct, brand: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder={t("请输入品牌")}
                      />
                    </div>
                  </div>

                  {/* 图片URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("商品图片URL")}
                    </label>
                    <input
                      type="text"
                      value={editProduct.main_image}
                      onChange={(e) => updateEditProduct({ ...editProduct, main_image: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="https://example.com/image.jpg"
                    />
                    {/* Shows the fallback for a broken URL, and recovers once the URL is corrected. */}
                    {editProduct.main_image && (
                      <ProductImage src={editProduct.main_image} alt={t("预览")} className="mt-2 h-32 w-32 rounded-lg" />
                    )}
                  </div>

                  {/* 状态 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("状态")}
                    </label>
                    <select
                      value={editProduct.status}
                      onChange={(e) => updateEditProduct({ ...editProduct, status: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value={1}>{t("上架")}</option>
                      <option value={0}>{t("下架")}</option>
                    </select>
                  </div>
                </div>

                {/* 按钮 */}
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditProduct(null);
                    }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {t("取消")}
                  </button>
                  <button
                    onClick={handleEditProduct}
                    disabled={busy}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    {t("保存修改")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
