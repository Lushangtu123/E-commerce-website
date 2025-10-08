'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cartApi, orderApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { FiTrash2, FiShoppingBag } from 'react-icons/fi';

export default function CartPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { items, setItems, updateQuantity, removeItem, clearCart, getTotalPrice } = useCartStore();
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadCart();
  }, [isAuthenticated]);

  const loadCart = async () => {
    try {
      setLoading(true);
      const data: any = await cartApi.list();
      setItems(data.items || []);
      setSelectedItems((data.items || []).map((item: any) => item.product_id));
    } catch (error: any) {
      console.error('加载购物车失败:', error);
      toast.error('加载购物车失败');
    } finally {
      setLoading(false);
    }
  };

  const handleQuantityChange = async (productId: number, newQuantity: number) => {
    if (newQuantity < 1) return;

    try {
      await cartApi.updateQuantity({ product_id: productId, quantity: newQuantity });
      updateQuantity(productId, newQuantity);
    } catch (error: any) {
      toast.error('更新失败');
    }
  };

  const handleRemove = async (productId: number) => {
    try {
      await cartApi.remove(productId);
      removeItem(productId);
      setSelectedItems(selectedItems.filter(id => id !== productId));
      toast.success('已删除');
    } catch (error: any) {
      toast.error('删除失败');
    }
  };

  const handleSelectAll = () => {
    if (selectedItems.length === items.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(items.map(item => item.product_id));
    }
  };

  const handleToggleSelect = (productId: number) => {
    if (selectedItems.includes(productId)) {
      setSelectedItems(selectedItems.filter(id => id !== productId));
    } else {
      setSelectedItems([...selectedItems, productId]);
    }
  };

  const getSelectedTotal = () => {
    return items
      .filter(item => selectedItems.includes(item.product_id))
      .reduce((total, item) => total + item.price * item.quantity, 0);
  };

  const handleCheckout = async () => {
    if (selectedItems.length === 0) {
      toast.error('请选择要结算的商品');
      return;
    }

    const orderItems = items
      .filter(item => selectedItems.includes(item.product_id))
      .map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
      }));

    setSubmitting(true);
    try {
      const data: any = await orderApi.create({ items: orderItems });
      toast.success('订单创建成功');
      router.push(`/orders/${data.order_id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || '创建订单失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-8">
        <div className="container-custom">
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4 h-24 bg-gray-200"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-20">
        <div className="container-custom text-center">
          <div className="text-6xl mb-4">🛒</div>
          <h3 className="text-2xl font-medium text-gray-900 mb-2">购物车是空的</h3>
          <p className="text-gray-600 mb-6">去逛逛，添加一些商品吧</p>
          <button onClick={() => router.push('/products')} className="btn btn-primary">
            去购物
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="container-custom">
        <h1 className="text-3xl font-bold mb-8">购物车</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 购物车列表 */}
          <div className="lg:col-span-2 space-y-4">
            {/* 全选 */}
            <div className="card p-4 flex items-center">
              <input
                type="checkbox"
                checked={selectedItems.length === items.length}
                onChange={handleSelectAll}
                className="w-5 h-5 text-primary-600 rounded"
              />
              <span className="ml-3 font-medium">全选</span>
            </div>

            {/* 商品列表 */}
            {items.map((item) => (
              <div key={item.cart_id} className="card p-4">
                <div className="flex items-center space-x-4">
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(item.product_id)}
                    onChange={() => handleToggleSelect(item.product_id)}
                    className="w-5 h-5 text-primary-600 rounded"
                  />

                  <div className="w-24 h-24 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                    {item.main_image ? (
                      <img
                        src={item.main_image}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        无图
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
                    <p className="text-primary-600 font-medium mt-1">¥{item.price}</p>
                    {item.stock < 10 && (
                      <p className="text-orange-500 text-sm mt-1">仅剩 {item.stock} 件</p>
                    )}
                  </div>

                  <div className="flex items-center border border-gray-300 rounded">
                    <button
                      onClick={() => handleQuantityChange(item.product_id, item.quantity - 1)}
                      className="px-3 py-1 hover:bg-gray-100"
                    >
                      -
                    </button>
                    <span className="px-4 py-1 border-x border-gray-300 min-w-[3rem] text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleQuantityChange(item.product_id, item.quantity + 1)}
                      disabled={item.quantity >= item.stock}
                      className="px-3 py-1 hover:bg-gray-100 disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>

                  <div className="text-right">
                    <p className="font-bold text-lg">¥{(item.price * item.quantity).toFixed(2)}</p>
                  </div>

                  <button
                    onClick={() => handleRemove(item.product_id)}
                    className="text-gray-400 hover:text-red-500 p-2"
                  >
                    <FiTrash2 size={20} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 结算信息 */}
          <div className="lg:col-span-1">
            <div className="card p-6 sticky top-24">
              <h3 className="font-bold text-lg mb-4">订单摘要</h3>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-600">
                  <span>商品数量</span>
                  <span>{selectedItems.length} 件</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>商品总价</span>
                  <span>¥{getSelectedTotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>运费</span>
                  <span className="text-green-600">免运费</span>
                </div>
                <div className="border-t pt-3 flex justify-between items-center">
                  <span className="font-medium">合计</span>
                  <span className="text-2xl font-bold text-primary-600">
                    ¥{getSelectedTotal().toFixed(2)}
                  </span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                disabled={selectedItems.length === 0 || submitting}
                className="w-full btn btn-primary disabled:opacity-50"
              >
                <FiShoppingBag className="inline mr-2" />
                {submitting ? '提交中...' : `结算 (${selectedItems.length})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

