import { productApi, cartApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';

/** Shared by cards, favorites and history; SKU choices always happen on the detail page. */
export async function quickAddToCart(productId: number, isActive: () => boolean = () => true): Promise<'select' | 'added' | null> {
  const session = useAuthStore.getState();
  if (!session.isHydrated || !session.isAuthenticated || !session.token || !session.user) throw new Error('请先登录');
  const current = () => {
    const state = useAuthStore.getState();
    return isActive() && state.token === session.token && state.user?.user_id === session.user?.user_id &&
      localStorage.getItem('token') === session.token;
  };
  if (!current()) return null;
  try {
    const data = await productApi.getDetail(productId);
    if (!current()) return null;
    const product = data.product;
    if (product.has_sku) return 'select';
    if (Number(product.stock) <= 0) throw new Error('商品已售罄');
    await cartApi.add({ product_id: productId, quantity: 1 });
    if (!current()) return null;
    useCartStore.getState().addItem({ cart_id: Date.now(), product_id: productId, quantity: 1,
      title: product.title, price: Number(product.price), main_image: product.main_image ?? undefined,
      stock: Number(product.stock), available: true });
    return 'added';
  } catch (error) {
    if (current()) throw error;
    return null;
  }
}
