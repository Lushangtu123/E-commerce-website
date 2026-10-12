import { productApi } from '@/lib/api';
import { useAuthStore, storedSessionId } from '@/store/useAuthStore';
import { addToCart } from '@/lib/cart-add';
import { validProductDetailResponse } from '@/lib/product-detail-response';

/** Shared by cards, favorites and history; SKU choices always happen on the detail page. */
export async function quickAddToCart(productId: number, isActive: () => boolean = () => true): Promise<'select' | 'added' | null> {
  const session = useAuthStore.getState();
  if (!session.isHydrated || !session.isAuthenticated || !session.sessionId || !session.user) throw new Error('请先登录');
  const current = () => {
    const state = useAuthStore.getState();
    return isActive() && state.sessionId === session.sessionId && state.user?.user_id === session.user?.user_id &&
      storedSessionId() === session.sessionId;
  };
  if (!current()) return null;
  try {
    const data = await productApi.getDetail(productId);
    if (!current()) return null;
    if (!validProductDetailResponse(data, productId)) throw new Error('加载商品失败，请重试');
    const product = data.product;
    if (product.has_sku) return 'select';
    if (Number(product.stock) <= 0) throw new Error('商品已售罄');
    if (!await addToCart({ product_id: productId, quantity: 1 }, current)) return null;
    if (!current()) return null;
    return 'added';
  } catch (error) {
    if (current()) throw error;
    return null;
  }
}
