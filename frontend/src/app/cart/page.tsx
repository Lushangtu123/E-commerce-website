'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { addressApi, cartApi, orderApi, type OrderPreview, type ShippingAddress } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, cartItemKey, type CartItem } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { FiTrash2, FiShoppingBag } from 'react-icons/fi';
import { logger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';

export default function CartPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { isAuthenticated, isHydrated, token, user } = useAuthStore();
  const { items, setItems, updateQuantity, removeItem } = useCartStore();
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCouponId, setSelectedCouponId] = useState<number | undefined>(undefined);
  const [quoteResult, setQuoteResult] = useState<{ key: string; data: OrderPreview } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteFailure, setQuoteFailure] = useState<{ key: string; message: string } | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const linkedCouponId = useRef<number | undefined>(undefined);
  const previousSession = useRef<string | null>(null);
  const submittingRequest = useRef(false);
  const mounted = useRef(true);
  const [addressResult, setAddressResult] = useState<{ key: string; addresses: ShippingAddress[]; error?: string } | null>(null);
  const [addressSelection, setAddressSelection] = useState<{ key: string; id: number } | null>(null);
  const [addressRevision, setAddressRevision] = useState(0);
  const sessionKey = JSON.stringify([token, user?.user_id]);
  const addresses = addressResult?.key === sessionKey ? addressResult.addresses : [];
  const addressLoading = addressResult?.key !== sessionKey;
  const addressError = addressResult?.key === sessionKey ? addressResult.error : null;
  const selectedAddress = addressSelection?.key === sessionKey ? addresses.find(address => address.address_id === addressSelection.id) : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('user_coupon_id');
    if (value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) {
      linkedCouponId.current = Number(value);
    }
  }, []);

  const isAvailable = (item: CartItem) => item.available !== false && item.available !== 0;
  const canReduce = (item: CartItem) => isAvailable(item) || (item.unavailable_reason === '库存不足' && item.stock > 0);
  const availableItems = items.filter(isAvailable);
  const orderItems = availableItems
    .filter(item => selectedItems.includes(cartItemKey(item)))
    .map(item => ({ product_id: item.product_id, quantity: item.quantity, ...(item.sku_id != null && { sku_id: item.sku_id }) }));
  const orderItemsKey = JSON.stringify(orderItems);
  const quoteKey = JSON.stringify([token, user?.user_id, orderItemsKey, selectedCouponId, quoteRevision]);
  const quote = quoteResult?.key === quoteKey ? quoteResult.data : null;
  const quoteError = quoteFailure?.key === quoteKey ? quoteFailure.message : null;
  const isCurrentSession = () => {
    const currentAuth = useAuthStore.getState();
    return mounted.current && currentAuth.isAuthenticated && currentAuth.token === token && currentAuth.user?.user_id === user?.user_id &&
      localStorage.getItem('token') === (token ?? null);
  };

  useEffect(() => {
    if (!isHydrated) return;
    const session = JSON.stringify([token, user?.user_id]);
    if (previousSession.current !== null && previousSession.current !== session) {
      linkedCouponId.current = undefined;
      setSelectedCouponId(undefined);
      setQuoteResult(null);
      setQuoteFailure(null);
      setSubmitting(false);
      submittingRequest.current = false;
    }
    previousSession.current = session;
  }, [isHydrated, token, user?.user_id]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadCart();
  }, [isHydrated, isAuthenticated, token, user?.user_id, router]);

  useEffect(() => {
    const previousSelection = addressSelection;
    setAddressResult(null);
    setAddressSelection(null);
    if (!isHydrated || !isAuthenticated || !isCurrentSession()) return;
    let active = true;
    addressApi.list().then(data => {
      if (!active || !isCurrentSession()) return;
      const ownedAddresses = data.addresses || [];
      setAddressResult({ key: sessionKey, addresses: ownedAddresses });
      const preferred = (previousSelection?.key === sessionKey && ownedAddresses.find(address => address.address_id === previousSelection.id)) ||
        ownedAddresses.find(address => address.is_default === true || address.is_default === 1) || ownedAddresses[0];
      if (preferred) setAddressSelection({ key: sessionKey, id: preferred.address_id });
    }).catch(error => {
      if (!active || !isCurrentSession()) return;
      setAddressResult({ key: sessionKey, addresses: [], error: error.response?.data?.error || '加载收货地址失败' });
    });
    return () => { active = false; };
  }, [isHydrated, isAuthenticated, token, user?.user_id, addressRevision]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || loading || orderItems.length === 0) return;
    let active = true;
    const isCurrentRequest = () => active && isCurrentSession();
    setQuoteResult(null);
    setQuoteFailure(null);
    setQuoteLoading(true);
    orderApi.preview({ items: orderItems, ...(selectedCouponId !== undefined && { user_coupon_id: selectedCouponId }) })
      .then((data) => {
        if (!isCurrentRequest()) return;
        setQuoteResult({ key: quoteKey, data });
        if (linkedCouponId.current !== undefined) {
          const carriedId = linkedCouponId.current;
          linkedCouponId.current = undefined;
          if (data.available_coupons.some(coupon => coupon.user_coupon_id === carriedId)) setSelectedCouponId(carriedId);
          else toast.error(t('所选优惠券当前不可用，请重新选择'));
        }
      })
      .catch((error) => {
        if (!isCurrentRequest()) return;
        const message = error.response?.data?.error || error.response?.data?.message || '计算订单金额失败';
        setQuoteFailure({ key: quoteKey, message });
        if (selectedCouponId !== undefined) {
          toast.error(t(message));
          setSelectedCouponId(undefined);
        }
      })
      .finally(() => { if (isCurrentRequest()) setQuoteLoading(false); });
    return () => { active = false; };
  }, [isHydrated, isAuthenticated, loading, token, user?.user_id, orderItemsKey, selectedCouponId, quoteRevision]);

  const loadCart = async () => {
    try {
      setLoading(true);
      const data: any = await cartApi.list();
      if (!isCurrentSession()) return;
      setItems(data.items || []);
      setSelectedItems((data.items || []).filter(isAvailable).map(cartItemKey));
    } catch (error) {
      if (!isCurrentSession()) return;
      setItems([]);
      setSelectedItems([]);
      logger.error('加载购物车失败:', error);
      toast.error(t('加载购物车失败'));
    } finally {
      if (isCurrentSession()) setLoading(false);
    }
  };

  const handleQuantityChange = async (item: CartItem, newQuantity: number) => {
    if (newQuantity < 1 || newQuantity > item.stock || !canReduce(item) || submittingRequest.current || !isCurrentSession()) return;

    try {
      await cartApi.updateQuantity({ product_id: item.product_id, quantity: newQuantity, ...(item.sku_id != null && { sku_id: item.sku_id }) });
      if (!isCurrentSession()) return;
      if (!isAvailable(item)) {
        const refreshed: any = await cartApi.list();
        if (!isCurrentSession()) return;
        setItems(refreshed.items || []);
      } else updateQuantity(item.product_id, newQuantity, item.sku_id);
    } catch {
      if (isCurrentSession()) toast.error(t('更新失败'));
    }
  };

  const handleRemove = async (item: CartItem) => {
    if (submittingRequest.current || !isCurrentSession()) return;
    try {
      await cartApi.remove(item.product_id, item.sku_id);
      if (!isCurrentSession()) return;
      removeItem(item.product_id, item.sku_id);
      setSelectedItems(selected => selected.filter(id => id !== cartItemKey(item)));
      toast.success(t('已删除'));
    } catch {
      if (isCurrentSession()) toast.error(t('删除失败'));
    }
  };

  const handleSelectAll = () => {
    if (orderItems.length === availableItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(availableItems.map(cartItemKey));
    }
  };

  const handleToggleSelect = (item: CartItem) => {
    if (!isAvailable(item) || submittingRequest.current) return;
    const key = cartItemKey(item);
    setSelectedItems(selected => selected.includes(key) ? selected.filter(id => id !== key) : [...selected, key]);
  };

  const handleCheckout = async () => {
    if (orderItems.length === 0) {
      toast.error(t('请选择要结算的商品'));
      return;
    }
    if (!quote || quoteLoading || quoteError || addressLoading || addressError || !selectedAddress || submittingRequest.current || !isCurrentSession()) return;

    submittingRequest.current = true;
    setSubmitting(true);
    try {
      const data: any = await orderApi.create({ items: orderItems, shipping_address_id: selectedAddress.address_id, ...(selectedCouponId !== undefined && { user_coupon_id: selectedCouponId }) });
      if (!isCurrentSession()) return;
      orderItems.forEach(item => removeItem(item.product_id, item.sku_id));
      setSelectedItems([]);
      toast.success(t('订单创建成功'));
      router.push(`/orders/${data.order_id}`);
    } catch (error: any) {
      if (!isCurrentSession()) return;
      toast.error(t(error.response?.data?.error || error.response?.data?.message || '创建订单失败'));
      setSelectedCouponId(undefined);
      setQuoteRevision(value => value + 1);
      setAddressRevision(value => value + 1);
    } finally {
      if (isCurrentSession()) {
        submittingRequest.current = false;
        setSubmitting(false);
      }
    }
  };

  if (!isHydrated || !isAuthenticated || loading) {
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
          <h3 className="text-2xl font-medium text-gray-900 mb-2">{t("购物车是空的")}</h3>
          <p className="text-gray-600 mb-6">{t("去逛逛，添加一些商品吧")}</p>
          <button onClick={() => router.push('/products')} className="btn btn-primary">
            {t("去购物")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="container-custom">
        <h1 className="text-3xl font-bold mb-8">{t("购物车")}</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 购物车列表 */}
          <div className="lg:col-span-2 space-y-4">
            {/* 全选 */}
            <div className="card p-4 flex items-center">
              <input
                type="checkbox"
                checked={availableItems.length > 0 && orderItems.length === availableItems.length}
                disabled={submitting || availableItems.length === 0}
                onChange={handleSelectAll}
                className="w-5 h-5 text-primary-600 rounded"
              />
              <span className="ml-3 font-medium">{t("全选")}</span>
            </div>

            {/* 商品列表 */}
            {items.map((item) => (
              <div key={cartItemKey(item)} className="card p-4">
                <div className="flex items-center space-x-4">
                  <input
                    type="checkbox"
                    checked={isAvailable(item) && selectedItems.includes(cartItemKey(item))}
                    disabled={submitting || !isAvailable(item)}
                    onChange={() => handleToggleSelect(item)}
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
                        {t("无图")}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">{item.title}</h3>
                    {item.sku_specs && <p className="text-sm text-gray-600 mt-1">{Object.entries(item.sku_specs).map(([name, value]) => `${name}: ${value}`).join(' / ')}</p>}
                    {item.sku_code && <p className="text-xs text-gray-500 mt-1">{t("规格编号：")}{item.sku_code}</p>}
                    {!isAvailable(item) && (
                      <div className="text-sm text-red-600 mt-1">
                        <p>{t(item.unavailable_reason || '商品当前不可用')}</p>
                        <button onClick={() => router.push(`/products/${item.product_id}`)} className="underline">{t("重新选规格")}</button>
                      </div>
                    )}
                    <p className="text-primary-600 font-medium mt-1">¥{item.price}</p>
                    {item.stock < 10 && (
                      <p className="text-orange-500 text-sm mt-1">{t('仅剩 {count} 件', { count: item.stock })}</p>
                    )}
                  </div>

                  <div className="flex items-center border border-gray-300 rounded">
                    <button
                      onClick={() => handleQuantityChange(item, Math.min(item.quantity - 1, item.stock))}
                      disabled={submitting || !canReduce(item) || item.quantity <= 1}
                      className="px-3 py-1 hover:bg-gray-100"
                    >
                      -
                    </button>
                    <span className="px-4 py-1 border-x border-gray-300 min-w-[3rem] text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleQuantityChange(item, item.quantity + 1)}
                      disabled={submitting || !isAvailable(item) || item.quantity >= item.stock}
                      className="px-3 py-1 hover:bg-gray-100 disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>

                  <div className="text-right">
                    <p className="font-bold text-lg">¥{(item.price * item.quantity).toFixed(2)}</p>
                  </div>

                  <button
                    onClick={() => handleRemove(item)}
                    disabled={submitting}
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
              <h3 className="font-bold text-lg mb-4">{t("订单摘要")}</h3>
              <div className="mb-6">
                <label htmlFor="shipping-address" className="block font-medium mb-2">{t("收货地址")}</label>
                {addressLoading ? <p className="text-sm text-gray-500">{t("收货地址加载中...")}</p> : addressError ? (
                  <div className="text-sm text-red-600" role="alert">
                    <p>{t(addressError)}</p>
                    <button onClick={() => setAddressRevision(value => value + 1)} className="underline mt-1">{t("重新加载地址")}</button>
                  </div>
                ) : addresses.length === 0 ? <p className="text-sm text-gray-600">{t("请先添加收货地址")}</p> : (
                  <select id="shipping-address" value={selectedAddress?.address_id ?? ''} disabled={submitting}
                    onChange={event => setAddressSelection({ key: sessionKey, id: Number(event.target.value) })}
                    className="w-full border border-gray-300 rounded px-3 py-2">
                    <option value="" disabled>{t("请选择收货地址")}</option>
                    {addresses.map(address => <option key={address.address_id} value={address.address_id}>
                      {address.receiver_name} {address.phone} · {address.province}{address.city}{address.district}{address.detail_address}
                    </option>)}
                  </select>
                )}
                <Link href="/profile/address" className="inline-block text-primary-600 text-sm underline mt-2">{t("管理收货地址")}</Link>
              </div>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-600">
                  <span>{t("商品数量")}</span>
                  <span>{t('{count} 件', { count: orderItems.length })}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>{t("商品总价")}</span>
                  <span>{quote ? `¥${quote.original_amount.toFixed(2)}` : t('计算中...')}</span>
                </div>
                <div>
                  <label htmlFor="checkout-coupon" className="block text-sm text-gray-600 mb-2">{t("优惠券")}</label>
                  <select
                    id="checkout-coupon"
                    value={selectedCouponId ?? ''}
                    disabled={submitting || quoteLoading || !quote}
                    onChange={(event) => setSelectedCouponId(event.target.value ? Number(event.target.value) : undefined)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                  >
                    <option value="">{t("不使用优惠券")}</option>
                    {quote?.available_coupons.map(coupon => (
                      <option key={coupon.user_coupon_id} value={coupon.user_coupon_id}>
                        {t('{name}（优惠¥{amount}）', { name: coupon.name, amount: coupon.discount_amount.toFixed(2) })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>{t("优惠券优惠")}</span>
                  <span>{quote ? `-¥${quote.discount_amount.toFixed(2)}` : t('计算中...')}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>{t("运费")}</span>
                  <span className="text-green-600">{t("免运费")}</span>
                </div>
                <div className="border-t pt-3 flex justify-between items-center">
                  <span className="font-medium">{t("应付金额")}</span>
                  <span className="text-2xl font-bold text-primary-600">
                    {quote ? `¥${quote.total_amount.toFixed(2)}` : t('计算中...')}
                  </span>
                </div>
                {quoteError && (
                  <div className="text-sm text-red-600" role="alert">
                    <p>{t(quoteError)}</p>
                    <button onClick={() => setQuoteRevision(value => value + 1)} className="mt-2 underline">{t("重新计算")}</button>
                  </div>
                )}
              </div>

              <button
                onClick={handleCheckout}
                disabled={orderItems.length === 0 || submitting || !quote || quoteLoading || !!quoteError || addressLoading || !!addressError || !selectedAddress}
                className="w-full btn btn-primary disabled:opacity-50"
              >
                <FiShoppingBag className="inline mr-2" />
                {submitting ? t('提交中...') : t('结算 ({count})', { count: orderItems.length })}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
