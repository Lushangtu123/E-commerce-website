'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/AdminLayout';
import toast from 'react-hot-toast';

export default function AdminProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    keyword: '',
    status: ''
  });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
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

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, [page, filters]);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products/categories`);
      const data = await response.json();
      if (response.ok) {
        setCategories(data);
      }
    } catch (error) {
      console.error('获取分类失败:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('admin_token');
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(filters.keyword && { keyword: filters.keyword }),
        ...(filters.status !== '' && { status: filters.status })
      });

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/products?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const data = await response.json();
      
      if (response.ok) {
        setProducts(data.products);
        setTotal(data.pagination.total);
      } else {
        toast.error(data.error || '获取商品列表失败');
      }
    } catch (error) {
      console.error('获取商品列表失败:', error);
      toast.error('获取商品列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (productId: number, newStatus: number) => {
    try {
      const token = localStorage.getItem('admin_token');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/products/${productId}/status`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: newStatus })
        }
      );

      const data = await response.json();
      
      if (response.ok) {
        toast.success(newStatus === 1 ? '商品已上架' : '商品已下架');
        fetchProducts();
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch (error) {
      console.error('更新状态失败:', error);
      toast.error('更新状态失败');
    }
  };

  const handleBatchStatusChange = async (newStatus: number) => {
    if (selectedIds.length === 0) {
      toast.error('请先选择商品');
      return;
    }

    try {
      const token = localStorage.getItem('admin_token');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/products/batch/status`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            productIds: selectedIds,
            status: newStatus 
          })
        }
      );

      const data = await response.json();
      
      if (response.ok) {
        toast.success(`已${newStatus === 1 ? '上架' : '下架'}${selectedIds.length}个商品`);
        setSelectedIds([]);
        fetchProducts();
      } else {
        toast.error(data.error || '批量操作失败');
      }
    } catch (error) {
      console.error('批量操作失败:', error);
      toast.error('批量操作失败');
    }
  };

  const toggleSelect = (productId: number) => {
    setSelectedIds(prev => 
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === products.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(products.map(p => p.product_id));
    }
  };

  const handleAddProduct = async () => {
    // 验证表单
    if (!newProduct.title || !newProduct.price || !newProduct.category_id) {
      toast.error('请填写商品标题、价格和分类');
      return;
    }

    try {
      const token = localStorage.getItem('admin_token');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/products`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: newProduct.title,
            description: newProduct.description,
            price: parseFloat(newProduct.price),
            stock: parseInt(newProduct.stock) || 0,
            category_id: parseInt(newProduct.category_id),
            brand: newProduct.brand,
            image_url: newProduct.main_image,
            status: newProduct.status
          })
        }
      );

      const data = await response.json();
      
      if (response.ok) {
        toast.success('商品添加成功');
        setShowAddModal(false);
        setNewProduct({
          title: '',
          description: '',
          price: '',
          stock: '',
          category_id: '',
          brand: '',
          main_image: '',
          status: 1
        });
        fetchProducts();
      } else {
        toast.error(data.error || '添加失败');
      }
    } catch (error) {
      console.error('添加商品失败:', error);
      toast.error('添加商品失败');
    }
  };

  const openEditModal = (product: any) => {
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

  const handleEditProduct = async () => {
    // 验证表单
    if (!editProduct.title || !editProduct.price || !editProduct.category_id) {
      toast.error('请填写商品标题、价格和分类');
      return;
    }

    try {
      const token = localStorage.getItem('admin_token');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/products/${editProduct.product_id}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: editProduct.title,
            description: editProduct.description,
            price: parseFloat(editProduct.price),
            stock: parseInt(editProduct.stock) || 0,
            category_id: parseInt(editProduct.category_id),
            brand: editProduct.brand,
            image_url: editProduct.main_image,
            status: editProduct.status
          })
        }
      );

      const data = await response.json();
      
      if (response.ok) {
        toast.success('商品更新成功');
        setShowEditModal(false);
        setEditProduct(null);
        fetchProducts();
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch (error) {
      console.error('更新商品失败:', error);
      toast.error('更新商品失败');
    }
  };

  const getStatusBadge = (status: number) => {
    if (status === 1) {
      return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">已上架</span>;
    }
    return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">已下架</span>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* 页面标题和操作 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">商品管理</h1>
            <p className="text-gray-600 mt-1">管理商品的上下架和信息</p>
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加商品
            </span>
          </button>
        </div>

        {/* 搜索和筛选 */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              type="text"
              placeholder="搜索商品名称..."
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">全部状态</option>
              <option value="1">已上架</option>
              <option value="0">已下架</option>
            </select>
            <button
              onClick={fetchProducts}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              搜索
            </button>
            <button
              onClick={() => setFilters({ keyword: '', status: '' })}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              重置
            </button>
          </div>
        </div>

        {/* 批量操作 */}
        {selectedIds.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-blue-800">已选择 {selectedIds.length} 个商品</span>
              <div className="space-x-2">
                <button
                  onClick={() => handleBatchStatusChange(1)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  批量上架
                </button>
                <button
                  onClick={() => handleBatchStatusChange(0)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                >
                  批量下架
                </button>
                <button
                  onClick={() => setSelectedIds([])}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  取消选择
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 商品列表 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">加载中...</p>
              </div>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === products.length && products.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">价格</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">库存</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">销量</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
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
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <img
                            src={product.main_image || '/placeholder.png'}
                            alt={product.title}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
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
                            className="text-orange-600 hover:text-orange-900"
                          >
                            下架
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(product.product_id, 1)}
                            className="text-green-600 hover:text-green-900"
                          >
                            上架
                          </button>
                        )}
                        <button 
                          onClick={() => openEditModal(product)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 分页 */}
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  共 {total} 个商品
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    上一页
                  </button>
                  <span className="px-4 py-2 text-sm text-gray-700">
                    第 {page} 页
                  </span>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= Math.ceil(total / 20)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 添加商品模态框 */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">添加商品</h2>
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
                      商品标题 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newProduct.title}
                      onChange={(e) => setNewProduct({ ...newProduct, title: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请输入商品标题"
                    />
                  </div>

                  {/* 商品描述 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      商品描述
                    </label>
                    <textarea
                      value={newProduct.description}
                      onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请输入商品描述"
                    />
                  </div>

                  {/* 价格和库存 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        价格 (元) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newProduct.price}
                        onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        库存
                      </label>
                      <input
                        type="number"
                        value={newProduct.stock}
                        onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* 分类和品牌 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        分类 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={newProduct.category_id}
                        onChange={(e) => setNewProduct({ ...newProduct, category_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">请选择分类</option>
                        {categories.map((cat) => (
                          <option key={cat.category_id} value={cat.category_id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        品牌
                      </label>
                      <input
                        type="text"
                        value={newProduct.brand}
                        onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="请输入品牌"
                      />
                    </div>
                  </div>

                  {/* 图片URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      商品图片URL
                    </label>
                    <input
                      type="text"
                      value={newProduct.main_image}
                      onChange={(e) => setNewProduct({ ...newProduct, main_image: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://example.com/image.jpg"
                    />
                    {newProduct.main_image && (
                      <img
                        src={newProduct.main_image}
                        alt="预览"
                        className="mt-2 w-32 h-32 object-cover rounded-lg"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                  </div>

                  {/* 状态 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      状态
                    </label>
                    <select
                      value={newProduct.status}
                      onChange={(e) => setNewProduct({ ...newProduct, status: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value={1}>上架</option>
                      <option value={0}>下架</option>
                    </select>
                  </div>
                </div>

                {/* 按钮 */}
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddProduct}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    添加商品
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 编辑商品模态框 */}
        {showEditModal && editProduct && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">编辑商品</h2>
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
                      商品标题 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editProduct.title}
                      onChange={(e) => setEditProduct({ ...editProduct, title: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请输入商品标题"
                    />
                  </div>

                  {/* 商品描述 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      商品描述
                    </label>
                    <textarea
                      value={editProduct.description}
                      onChange={(e) => setEditProduct({ ...editProduct, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="请输入商品描述"
                    />
                  </div>

                  {/* 价格和库存 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        价格 (元) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={editProduct.price}
                        onChange={(e) => setEditProduct({ ...editProduct, price: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        库存
                      </label>
                      <input
                        type="number"
                        value={editProduct.stock}
                        onChange={(e) => setEditProduct({ ...editProduct, stock: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {/* 分类和品牌 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        分类 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={editProduct.category_id}
                        onChange={(e) => setEditProduct({ ...editProduct, category_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">请选择分类</option>
                        {categories.map((cat) => (
                          <option key={cat.category_id} value={cat.category_id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        品牌
                      </label>
                      <input
                        type="text"
                        value={editProduct.brand}
                        onChange={(e) => setEditProduct({ ...editProduct, brand: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="请输入品牌"
                      />
                    </div>
                  </div>

                  {/* 图片URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      商品图片URL
                    </label>
                    <input
                      type="text"
                      value={editProduct.main_image}
                      onChange={(e) => setEditProduct({ ...editProduct, main_image: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://example.com/image.jpg"
                    />
                    {editProduct.main_image && (
                      <img
                        src={editProduct.main_image}
                        alt="预览"
                        className="mt-2 w-32 h-32 object-cover rounded-lg"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                  </div>

                  {/* 状态 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      状态
                    </label>
                    <select
                      value={editProduct.status}
                      onChange={(e) => setEditProduct({ ...editProduct, status: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value={1}>上架</option>
                      <option value={0}>下架</option>
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
                    取消
                  </button>
                  <button
                    onClick={handleEditProduct}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    保存修改
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

