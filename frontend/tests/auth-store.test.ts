import { describe, expect, it } from 'vitest';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';

const first = { user_id: 1, username: 'first', email: 'first@example.test' };
const second = { user_id: 2, username: 'second', email: 'second@example.test' };
const cartItem: CartItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'Product', price: 10, stock: 5 };

describe('customer auth store', () => {
  it('hydration restores persisted customer login before protected pages decide authentication', () => {
    const user = { user_id: 1, username: 'customer', email: 'customer@example.test' };
    localStorage.setItem('session', 'customer-session');
    localStorage.setItem('user', JSON.stringify(user));

    expect(useAuthStore.getState()).toMatchObject({ isHydrated: false, isAuthenticated: false });
    useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({ isHydrated: true, isAuthenticated: true, sessionId: 'customer-session', user });
  });

  it.each([
    ['absent', undefined],
    ['malformed', '{invalid-json'],
  ])('%s customer storage finishes hydration without authenticating an admin session', (_, user) => {
    localStorage.setItem('session', 'customer-session');
    if (user) localStorage.setItem('user', user);
    localStorage.setItem('admin_token', 'admin-session');
    localStorage.setItem('admin_user', '{"admin_id":2}');

    useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({ isHydrated: true, isAuthenticated: false, user: null, sessionId: null });
  });

  it('switching customer login and logging out clear cart contents and the header count', () => {
    localStorage.setItem('admin_token', 'admin-session');
    useAuthStore.getState().login(first, 'first-session');
    useCartStore.getState().setItems([cartItem]);
    expect(useCartStore.getState().getTotalCount()).toBe(3);

    useAuthStore.getState().login(second, 'second-session');

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().getTotalCount()).toBe(0);
    expect(useCartStore.getState().getTotalPrice()).toBe(0);

    useCartStore.getState().setItems([cartItem]);
    useAuthStore.getState().logout();

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().getTotalCount()).toBe(0);
    expect(localStorage.getItem('admin_token')).toBe('admin-session');
  });

  it("rehydrating another tab's customer session clears the previous cart, while the same session preserves it", () => {
    useAuthStore.getState().login(first, 'first-session');
    useCartStore.getState().setItems([cartItem]);
    useAuthStore.getState().hydrate();
    expect(useCartStore.getState().getTotalCount()).toBe(3);

    localStorage.setItem('session', 'second-session');
    localStorage.setItem('user', JSON.stringify(second));
    useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().sessionId).toBe('second-session');
    expect(useAuthStore.getState().user?.user_id).toBe(2);
    expect(useCartStore.getState().getTotalCount()).toBe(0);

    useCartStore.getState().setItems([cartItem]);
    localStorage.removeItem('session');
    localStorage.removeItem('user');
    useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useCartStore.getState().getTotalCount()).toBe(0);
  });

  it('signs out a session stored as a signed token before cookies, and forgets the token', () => {
    localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiJ9.legacy.signature');
    localStorage.setItem('user', JSON.stringify(first));

    useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({ isHydrated: true, isAuthenticated: false, sessionId: null, user: null });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('keeps a current session while dropping a leftover signed token', () => {
    localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiJ9.legacy.signature');
    localStorage.setItem('session', 'current-session');
    localStorage.setItem('user', JSON.stringify(first));

    useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, sessionId: 'current-session', user: first });
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('names every sign-in with a fresh id of its own and stores no token', () => {
    useAuthStore.getState().login(first);
    const firstId = useAuthStore.getState().sessionId;
    useAuthStore.getState().login(first);
    const secondId = useAuthStore.getState().sessionId;

    expect(firstId).toEqual(expect.any(String));
    expect(secondId).not.toBe(firstId);
    expect(localStorage.getItem('session')).toBe(secondId);
    expect(localStorage.getItem('token')).toBeNull();
  });
});
