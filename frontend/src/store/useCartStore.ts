import { create } from 'zustand';

export interface CartItem {
  cart_id: number;
  product_id: number;
  quantity: number;
  title: string;
  /** MySQL DECIMAL: the server sends a string, local additions a number. */
  price: number | string;
  main_image?: string | null;
  stock: number;
  sku_id?: number | null;
  sku_code?: string | null;
  sku_specs?: Record<string, string | number | boolean> | null;
  available?: boolean | 0 | 1;
  unavailable_reason?: string | null;
}

export const cartItemKey = (item: { product_id: number; sku_id?: number | null }) =>
  `${item.product_id}:${item.sku_id ?? 'base'}`;

interface CartState {
  items: CartItem[];
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
  setItems: (items) => set({ items }),
  addItem: (item) =>
    set((state) => {
      const key = cartItemKey(item);
      const existingItem = state.items.find((i) => cartItemKey(i) === key);
      if (existingItem) {
        return {
          items: state.items.map((i) =>
            cartItemKey(i) === key
              ? { ...i, quantity: i.quantity + item.quantity }
              : i
          ),
        };
      }
      return { items: [...state.items, item] };
    }),
  updateQuantity: (productId, quantity, skuId) =>
    set((state) => ({
      items: state.items.map((item) =>
        cartItemKey(item) === cartItemKey({ product_id: productId, sku_id: skuId }) ? { ...item, quantity } : item
      ),
    })),
  removeItem: (productId, skuId) =>
    set((state) => ({
      items: state.items.filter((item) => cartItemKey(item) !== cartItemKey({ product_id: productId, sku_id: skuId })),
    })),
  clearCart: () => set({ items: [] }),
  getTotalPrice: () => {
    const state = get();
    return state.items.reduce((total, item) => total + Number(item.price) * item.quantity, 0);
  },
  getTotalCount: () => {
    const state = get();
    return state.items.reduce((total, item) => total + item.quantity, 0);
  },
}));
