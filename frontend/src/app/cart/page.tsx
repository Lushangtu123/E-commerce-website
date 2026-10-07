'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addressApi, cartApi, orderApi, type OrderPreview, type ShippingAddress } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { useCartStore, cartItemKey, type CartItem } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { FiShoppingCart } from 'react-icons/fi';
import CartItemRow, { canReduceCartItem as canReduce, isCartItemAvailable as isAvailable } from '@/components/CartItemRow';
import CheckoutSummary from '@/components/CheckoutSummary';
import { logger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';
import { requestFailure } from '@/lib/api-error';

export default function CartPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { isAuthenticated, isHydrated, sessionId, user } = useAuthStore();
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
  // Lock writes synchronously, including clicks received before the disabled controls render.
  const cartMutation = useRef<object | null>(null);
  const [updatingSession, setUpdatingSession] = useState<string | null>(null);
  const mounted = useRef(true);
  const [addressResult, setAddressResult] = useState<{ key: string; addresses: ShippingAddress[]; error?: string } | null>(null);
  const [addressSelection, setAddressSelection] = useState<{ key: string; id: number } | null>(null);
  const [addressRevision, setAddressRevision] = useState(0);
  const sessionKey = JSON.stringify([sessionId, user?.user_id]);
  const cartUpdating = updatingSession === sessionKey;
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

  const availableItems = items.filter(isAvailable);
  const orderItems = availableItems
    .filter(item => selectedItems.includes(cartItemKey(item)))
    .map(item => ({ product_id: item.product_id, quantity: item.quantity, ...(item.sku_id != null && { sku_id: item.sku_id }) }));
  const orderItemsKey = JSON.stringify(orderItems);
  const quoteKey = JSON.stringify([sessionId, user?.user_id, orderItemsKey, selectedCouponId, quoteRevision]);
  const quote = quoteResult?.key === quoteKey ? quoteResult.data : null;
  const quoteError = quoteFailure?.key === quoteKey ? quoteFailure.message : null;
  const isCurrentSession = () => {
    const currentAuth = useAuthStore.getState();
    return mounted.current && currentAuth.isAuthenticated && currentAuth.sessionId === sessionId && currentAuth.user?.user_id === user?.user_id &&
      storedSessionId() === (sessionId ?? null);
  };

  useEffect(() => {
    if (!isHydrated) return;
    const session = JSON.stringify([sessionId, user?.user_id]);
    if (previousSession.current !== null && previousSession.current !== session) {
      linkedCouponId.current = undefined;
      setSelectedCouponId(undefined);
      setQuoteResult(null);
      setQuoteFailure(null);
      setSubmitting(false);
      submittingRequest.current = false;
      cartMutation.current = null;
      setUpdatingSession(null);
    }
    previousSession.current = session;
  }, [isHydrated, sessionId, user?.user_id]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadCart();
  }, [isHydrated, isAuthenticated, sessionId, user?.user_id, router]);

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
  }, [isHydrated, isAuthenticated, sessionId, user?.user_id, addressRevision]);

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
  }, [isHydrated, isAuthenticated, loading, sessionId, user?.user_id, orderItemsKey, selectedCouponId, quoteRevision]);

  const loadCart = async () => {
    try {
      setLoading(true);
      const data = await cartApi.list();
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
    if (newQuantity < 1 || newQuantity > item.stock || !canReduce(item) || submittingRequest.current || cartMutation.current || !isCurrentSession()) return;

    const operation = {};
    cartMutation.current = operation;
    setUpdatingSession(sessionKey);
    try {
      await cartApi.updateQuantity({ product_id: item.product_id, quantity: newQuantity, ...(item.sku_id != null && { sku_id: item.sku_id }) });
      if (!isCurrentSession()) return;
      if (!isAvailable(item)) {
        const refreshed = await cartApi.list();
        if (!isCurrentSession()) return;
        setItems(refreshed.items || []);
      } else updateQuantity(item.product_id, newQuantity, item.sku_id);
    } catch {
      if (isCurrentSession()) toast.error(t('更新失败'));
    } finally {
      if (cartMutation.current === operation) {
        cartMutation.current = null;
        if (isCurrentSession()) setUpdatingSession(null);
      }
    }
  };

  const handleRemove = async (item: CartItem) => {
    if (submittingRequest.current || cartMutation.current || !isCurrentSession()) return;
    const operation = {};
    cartMutation.current = operation;
    setUpdatingSession(sessionKey);
    try {
      await cartApi.remove(item.product_id, item.sku_id);
      if (!isCurrentSession()) return;
      removeItem(item.product_id, item.sku_id);
      setSelectedItems(selected => selected.filter(id => id !== cartItemKey(item)));
      toast.success(t('已删除'));
    } catch {
      if (isCurrentSession()) toast.error(t('删除失败'));
    } finally {
      if (cartMutation.current === operation) {
        cartMutation.current = null;
        if (isCurrentSession()) setUpdatingSession(null);
      }
    }
  };

  const handleSelectAll = () => {
    if (submittingRequest.current || cartMutation.current || !isCurrentSession()) return;
    if (orderItems.length === availableItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(availableItems.map(cartItemKey));
    }
  };

  const handleToggleSelect = (item: CartItem) => {
    if (!isAvailable(item) || submittingRequest.current || cartMutation.current || !isCurrentSession()) return;
    const key = cartItemKey(item);
    setSelectedItems(selected => selected.includes(key) ? selected.filter(id => id !== key) : [...selected, key]);
  };

  const handleCheckout = async () => {
    if (orderItems.length === 0) {
      toast.error(t('请选择要结算的商品'));
      return;
    }
    if (!quote || quoteLoading || quoteError || addressLoading || addressError || !selectedAddress || submittingRequest.current || cartMutation.current || !isCurrentSession()) return;

    submittingRequest.current = true;
    setSubmitting(true);
    try {
      const data = await orderApi.create({ items: orderItems, shipping_address_id: selectedAddress.address_id, ...(selectedCouponId !== undefined && { user_coupon_id: selectedCouponId }) });
      if (!isCurrentSession()) return;
      orderItems.forEach(item => removeItem(item.product_id, item.sku_id));
      setSelectedItems([]);
      toast.success(t('订单创建成功'));
      router.push(`/orders/${data.order_id}`);
    } catch (error) {
      if (!isCurrentSession()) return;
      toast.error(t(requestFailure(error).response?.data?.error || requestFailure(error).response?.data?.message || '创建订单失败'));
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
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <FiShoppingCart className="h-7 w-7" aria-hidden="true" />
          </span>
          <h3 className="mb-1 text-lg font-medium text-gray-900">{t("购物车是空的")}</h3>
          <p className="mb-6 text-sm text-gray-500">{t("去逛逛，添加一些商品吧")}</p>
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
                aria-label={t("全选")}
                checked={availableItems.length > 0 && orderItems.length === availableItems.length}
                disabled={submitting || cartUpdating || availableItems.length === 0}
                onChange={handleSelectAll}
                className="h-5 w-5 rounded-sm accent-primary-600"
              />
              <span className="ml-3 font-medium">{t("全选")}</span>
            </div>

            {/* 商品列表 */}
            {items.map((item) => (
              <CartItemRow key={cartItemKey(item)} item={item} selected={selectedItems.includes(cartItemKey(item))} submitting={submitting || cartUpdating}
                onToggle={() => handleToggleSelect(item)} onQuantityChange={quantity => handleQuantityChange(item, quantity)}
                onRemove={() => handleRemove(item)} />
            ))}
          </div>

          {/* 结算信息 */}
          <div className="lg:col-span-1">
            <CheckoutSummary itemCount={orderItems.length} submitting={submitting} cartUpdating={cartUpdating}
              addresses={addresses} addressLoading={addressLoading} addressError={addressError}
              selectedAddressId={selectedAddress?.address_id}
              onSelectAddress={id => setAddressSelection({ key: sessionKey, id })}
              onReloadAddresses={() => setAddressRevision(value => value + 1)}
              quote={quote} quoteLoading={quoteLoading} quoteError={quoteError} onRetryQuote={() => setQuoteRevision(value => value + 1)}
              selectedCouponId={selectedCouponId} onSelectCoupon={setSelectedCouponId} onCheckout={handleCheckout} />
          </div>
        </div>
      </div>
    </div>
  );
}
