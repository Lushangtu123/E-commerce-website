import { create } from 'zustand';
import type { SpecTranslations } from '@/lib/product-content';

export interface CartItem {
  cart_id: number;
  product_id: number;
  quantity: number;
  title: string;
  title_en?: string | null;
  /** MySQL DECIMAL: the server sends a string, local additions a number. */
  price: number | string;
  main_image?: string | null;
  stock: number;
  sku_id?: number | null;
  sku_code?: string | null;
  sku_specs?: Record<string, string | number | boolean> | null;
  sku_specs_en?: SpecTranslations | null;
  available?: boolean | 0 | 1;
  unavailable_reason?: string | null;
}

export const cartItemKey = (item: { product_id: number; sku_id?: number | null }) =>
  `${item.product_id}:${item.sku_id ?? 'base'}`;

interface CartState {
  items: CartItem[];
  /** Every cart change invalidates reads started before it, including writes awaiting a receipt. */
  revision: number;
  syncStatus: 'idle' | 'loading' | 'ready' | 'error';
  pendingWrites: number;
  setItems: (items: CartItem[]) => void;
  addItem: (item: CartItem) => void;
  updateQuantity: (productId: number, quantity: number, skuId?: number | null) => void;
  removeItem: (productId: number, skuId?: number | null) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
  getTotalCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  revision: 0,
  syncStatus: 'idle',
  pendingWrites: 0,
  setItems: (items) => set(state => ({ items, revision: state.revision + 1, syncStatus: 'ready' })),
  addItem: (item) =>
    set((state) => {
      const key = cartItemKey(item);
      const existingItem = state.items.find((i) => cartItemKey(i) === key);
      if (existingItem) {
        return {
          revision: state.revision + 1, syncStatus: 'ready',
          items: state.items.map((i) =>
            cartItemKey(i) === key
              ? { ...i, quantity: i.quantity + item.quantity }
              : i
          ),
        };
      }
      return { items: [...state.items, item], revision: state.revision + 1, syncStatus: 'ready' };
    }),
  updateQuantity: (productId, quantity, skuId) =>
    set((state) => ({
      revision: state.revision + 1, syncStatus: 'ready',
      items: state.items.map((item) =>
        cartItemKey(item) === cartItemKey({ product_id: productId, sku_id: skuId }) ? { ...item, quantity } : item
      ),
    })),
  removeItem: (productId, skuId) =>
    set((state) => ({
      revision: state.revision + 1, syncStatus: 'ready',
      items: state.items.filter((item) => cartItemKey(item) !== cartItemKey({ product_id: productId, sku_id: skuId })),
    })),
  clearCart: () => set(state => ({ items: [], revision: state.revision + 1, syncStatus: 'idle', pendingWrites: 0 })),
  getTotalPrice: () => {
    const state = get();
    return state.items.reduce((total, item) => total + Number(item.price) * item.quantity, 0);
  },
  getTotalCount: () => {
    const state = get();
    return state.items.reduce((total, item) => total + item.quantity, 0);
  },
}));
