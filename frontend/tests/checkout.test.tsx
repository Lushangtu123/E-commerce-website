import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CartPage from '@/app/cart/page';
import { addressApi, cartApi, orderApi, type CartInput, type OrderCreateInput, type OrderInput, type OrderPreview, type ShippingAddress } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore, type CartItem } from '@/store/useCartStore';
import { CommitLog, apiError, clickTogether, deferred, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { error: (message: string) => { notifications.push(message); }, success: vi.fn() };
  return { default: toast, toast };
});
vi.mock('@/lib/api', () => ({
  addressApi: { list: vi.fn() },
  cartApi: { list: vi.fn(), updateQuantity: vi.fn(), remove: vi.fn() },
  orderApi: { preview: vi.fn(), create: vi.fn() },
}));

const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const firstItem: CartItem = { cart_id: 1, product_id: 12, quantity: 3, title: 'Product', price: 10, stock: 5 };
const shippingAddress: ShippingAddress = { address_id: 41, receiver_name: 'First Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一西路 1 号', is_default: true };
const coupon = { user_coupon_id: 7, name: 'Summer', code: 'SUMMER', discount_amount: 20 };

function quote(total = 90, selectedCoupon = false): OrderPreview {
  return {
    original_amount: total, discount_amount: selectedCoupon ? 20 : 0,
    total_amount: selectedCoupon ? total - 20 : total,
    coupon: selectedCoupon ? coupon : null, available_coupons: [coupon],
  };
}

interface Setup {
  preview?: (input: OrderInput) => Promise<OrderPreview>;
  create?: (input: OrderCreateInput) => Promise<{ message: string; order_id: number }>;
  cartItems?: CartItem[];
  search?: string;
  updateQuantity?: (input: CartInput) => Promise<unknown>;
  remove?: (productId: number, skuId?: number | null) => Promise<unknown>;
  addresses?: () => Promise<{ addresses: ShippingAddress[] }>;
}

const previews = () => vi.mocked(orderApi.preview).mock.calls.map(([input]) => input);
const creates = () => vi.mocked(orderApi.create).mock.calls.map(([input]) => input);
const cartItems = () => useCartStore.getState().items;

/** Renders the cart for the first customer and waits until the first server quote is shown. */
async function setupCheckout({
  preview = async () => quote(), create = async () => ({ message: 'ok', order_id: 55 }), cartItems: rows = [firstItem], search = '',
  updateQuantity = async () => ({}), remove = async () => ({}), addresses = async () => ({ addresses: [shippingAddress] }),
}: Setup = {}) {
  if (search) window.history.replaceState(null, '', `/cart${search}`);
  useAuthStore.getState().login(firstUser, 'first-session');
  vi.mocked(addressApi.list).mockImplementation(addresses);
  // A fresh array per response, as the server would send.
  vi.mocked(cartApi.list).mockImplementation(async () => ({ items: [...rows] }));
  vi.mocked(cartApi.updateQuantity).mockImplementation(async input => (await updateQuantity(input)) as never);
  vi.mocked(cartApi.remove).mockImplementation(async (...args) => (await remove(...args)) as never);
  vi.mocked(orderApi.preview).mockImplementation(preview);
  vi.mocked(orderApi.create).mockImplementation(create);
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><CartPage /></CommitLog>);
  await settle();
  return { view, commits };
}

const couponSelect = () => screen.getByLabelText<HTMLSelectElement>('优惠券');
const couponOptions = () => Array.from(couponSelect().options, option => option.value);
const addressSelect = () => screen.queryByRole<HTMLSelectElement>('combobox', { name: '收货地址' });
const checkoutButton = (root: HTMLElement = document.body) => within(root).getByRole<HTMLButtonElement>('button', { name: /^结算 \(/ });
const checkboxes = () => screen.getAllByRole<HTMLInputElement>('checkbox');
const increase = () => screen.getAllByRole('button', { name: '+' });
const decrease = () => screen.getAllByRole('button', { name: '-' });
const removeButtons = () => screen.getAllByRole('button', { name: '删除' });
/** The summary row text, e.g. "应付金额¥90.00". */
const amountRow = (label: string, root: HTMLElement = document.body) =>
  within(root).getByText(label, { selector: 'span' }).parentElement?.textContent;

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await settle();
}

async function choose(select: HTMLElement, value: string) {
  fireEvent.change(select, { target: { value } });
  await settle();
}

function switchCustomer() {
  act(() => useAuthStore.getState().login(secondUser, 'second-session'));
}

describe('checkout', () => {
  beforeEach(() => {
    notifications.length = 0;
  });

  it('defaults to no coupon and displays the server product price and payable amount', async () => {
    await setupCheckout();

    expect(previews()).toEqual([{ items: [{ product_id: 12, quantity: 3 }] }]);
    expect(couponSelect()).toHaveValue('');
    expect(couponOptions()).toEqual(['', '7']);
    expect(amountRow('商品总价')).toBe('商品总价¥90.00');
    expect(amountRow('优惠券优惠')).toBe('优惠券优惠-¥0.00');
    expect(amountRow('应付金额')).toBe('应付金额¥90.00');
  });

  it('keeps two SKUs of one product independently selected, quoted, updated, removed and purchased', async () => {
    const variants: CartItem[] = [
      { ...firstItem, sku_id: 101, sku_code: 'RED', sku_specs: { Color: 'Red' }, quantity: 1 },
      { ...firstItem, cart_id: 2, sku_id: 102, sku_code: 'BLUE', sku_specs: { Color: 'Blue' }, quantity: 2 },
    ];
    await setupCheckout({ cartItems: variants });
    expect(previews().at(-1)?.items).toEqual([{ product_id: 12, quantity: 1, sku_id: 101 }, { product_id: 12, quantity: 2, sku_id: 102 }]);
    expect(screen.getByText('Color: Red')).toBeInTheDocument();
    expect(screen.getByText('Color: Blue')).toBeInTheDocument();

    await click(increase()[0]);
    expect(vi.mocked(cartApi.updateQuantity).mock.calls).toEqual([[{ product_id: 12, quantity: 2, sku_id: 101 }]]);
    expect(cartItems().map(item => item.quantity)).toEqual([2, 2]);

    await click(checkboxes()[2]);
    expect(previews().at(-1)?.items).toEqual([{ product_id: 12, quantity: 2, sku_id: 101 }]);

    await click(checkoutButton());
    expect(creates().at(-1)?.items).toEqual([{ product_id: 12, quantity: 2, sku_id: 101 }]);
    expect(cartItems().map(item => item.sku_id)).toEqual([102]);

    await click(removeButtons()[0]);
    expect(vi.mocked(cartApi.remove).mock.calls).toEqual([[12, 102]]);
    expect(cartItems()).toHaveLength(0);
  });

  it('cannot select or quote unavailable rows and explains how to reselect a SKU', async () => {
    await setupCheckout({ cartItems: [
      { ...firstItem, available: false, unavailable_reason: '请选择商品规格' },
      { ...firstItem, cart_id: 2, sku_id: 102, available: 0, unavailable_reason: '规格已停用' },
      { ...firstItem, cart_id: 3, product_id: 22, available: true },
    ] });
    expect(previews().at(-1)?.items).toEqual([{ product_id: 22, quantity: 3 }]);
    expect(checkboxes()[1]).toBeDisabled();
    expect(checkboxes()[2]).toBeDisabled();
    expect(screen.getByText('请选择商品规格')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '重新选规格' })).toHaveLength(2);

    await click(checkboxes()[0]);
    expect(checkoutButton()).toBeDisabled();

    await click(checkboxes()[0]);
    expect(previews().at(-1)?.items).toEqual([{ product_id: 22, quantity: 3 }]);
  });

  it('requotes when a coupon is selected and submits only its ID with the selected quantities', async () => {
    await setupCheckout({ preview: async input => quote(90, input.user_coupon_id === 7) });

    await choose(couponSelect(), '7');
    expect(previews().at(-1)?.user_coupon_id).toBe(7);
    expect(amountRow('优惠券优惠')).toBe('优惠券优惠-¥20.00');
    expect(amountRow('应付金额')).toBe('应付金额¥70.00');

    await click(checkoutButton());
    expect(creates()).toEqual([{ items: [{ product_id: 12, quantity: 3 }], user_coupon_id: 7, shipping_address_id: 41 }]);
    expect(router.push.mock.calls).toEqual([['/orders/55']]);
  });

  it('stays disabled while a preview is loading or failed and can retry the server quote', async () => {
    const first = deferred<OrderPreview>();
    let calls = 0;
    await setupCheckout({ preview: () => ++calls === 1 ? first.promise : Promise.resolve(quote()) });

    expect(checkoutButton()).toBeDisabled();
    await click(checkoutButton());
    expect(creates()).toEqual([]);

    await act(async () => first.reject(apiError('商品库存不足')));
    await settle();
    expect(checkoutButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('商品库存不足');

    await click(screen.getByRole('button', { name: '重新计算' }));
    expect(checkoutButton()).toBeEnabled();
    expect(amountRow('应付金额')).toBe('应付金额¥90.00');
  });

  it('requests a new quote after a quantity change and ignores a late previous quote', async () => {
    const first = deferred<OrderPreview>();
    await setupCheckout({ preview: input => input.items[0].quantity === 3 ? first.promise : Promise.resolve(quote(120)) });

    await click(increase()[0]);
    expect(previews().at(-1)).toEqual({ items: [{ product_id: 12, quantity: 4 }] });
    expect(amountRow('应付金额')).toBe('应付金额¥120.00');

    await act(async () => first.resolve(quote(90)));
    await settle();
    expect(amountRow('应付金额')).toBe('应付金额¥120.00');
  });

  it('invalidates the previous quote in the same render that changes the selected items', async () => {
    const secondItem = { ...firstItem, cart_id: 2, product_id: 22, quantity: 1 };
    const { commits } = await setupCheckout({
      cartItems: [firstItem, secondItem],
      preview: input => input.items.length === 2 ? Promise.resolve(quote(120)) : new Promise(() => {}),
    });
    expect(checkoutButton()).toBeEnabled();
    const before = commits.length;

    await click(checkboxes()[2]);

    // The first commit after the click is what the user sees before the quote effect runs.
    const firstRender = commits[before];
    expect(checkoutButton(firstRender)).toBeDisabled();
    expect(amountRow('应付金额', firstRender)).not.toContain('120.00');
    expect(checkoutButton()).toBeDisabled();
    await click(checkoutButton());
    expect(creates()).toEqual([]);
    expect(previews().at(-1)).toEqual({ items: [{ product_id: 12, quantity: 3 }] });
  });

  it('selects a valid coupon carried from my coupons once and lets it be removed', async () => {
    await setupCheckout({ search: '?user_coupon_id=7', preview: async input => quote(90, input.user_coupon_id === 7) });

    expect(couponSelect()).toHaveValue('7');
    expect(amountRow('应付金额')).toBe('应付金额¥70.00');
    expect(previews().map(input => input.user_coupon_id)).toEqual([undefined, 7]);

    await choose(couponSelect(), '');
    expect(couponSelect()).toHaveValue('');
    expect(amountRow('应付金额')).toBe('应付金额¥90.00');
  });

  it('reports an unavailable carried coupon and never sends it to preview or checkout', async () => {
    await setupCheckout({ search: '?user_coupon_id=999' });

    expect(couponSelect()).toHaveValue('');
    expect(notifications).toContain('所选优惠券当前不可用，请重新选择');
    expect(previews()).toEqual([{ items: [{ product_id: 12, quantity: 3 }] }]);
  });

  it('shows the server error for an expired coupon and refreshes the choices without it', async () => {
    let available = true;
    await setupCheckout({ preview: async input => {
      if (input.user_coupon_id) {
        available = false;
        throw apiError('优惠券已过期');
      }
      return { ...quote(), available_coupons: available ? [coupon] : [] };
    } });

    await choose(couponSelect(), '7');

    expect(notifications).toContain('优惠券已过期');
    expect(couponSelect()).toHaveValue('');
    expect(couponOptions()).toEqual(['']);
    expect(previews().map(input => input.user_coupon_id)).toEqual([undefined, 7, undefined]);
    expect(checkoutButton()).toBeEnabled();
  });

  it('removes only purchased rows after checkout and leaves unselected products in the cart', async () => {
    const secondItem = { ...firstItem, cart_id: 2, product_id: 22, quantity: 1 };
    await setupCheckout({ cartItems: [firstItem, secondItem] });
    await click(checkboxes()[2]);

    await click(checkoutButton());

    expect(creates()).toEqual([{ items: [{ product_id: 12, quantity: 3 }], shipping_address_id: 41 }]);
    expect(cartItems().map(item => item.product_id)).toEqual([22]);
    expect(useCartStore.getState().getTotalCount()).toBe(1);
    expect(router.push.mock.calls).toEqual([['/orders/55']]);
  });

  it.each(['success', 'failure'] as const)("never lets a late checkout %s for customer A change customer B's cart or page", async (outcome) => {
    const order = deferred<{ message: string; order_id: number }>();
    await setupCheckout({ create: () => order.promise });
    fireEvent.click(checkoutButton());
    act(() => {
      useAuthStore.getState().logout();
      useAuthStore.getState().login(secondUser, 'second-session');
    });
    await settle();
    expect(cartItems()).toHaveLength(1);

    await act(async () => {
      if (outcome === 'success') order.resolve({ message: 'ok', order_id: 55 });
      else order.reject(apiError('A优惠券已过期'));
    });
    await settle();

    expect(cartItems()).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(notifications).not.toContain('A优惠券已过期');
  });

  it('clears the coupon choice and pending submission when the customer changes, then requotes', async () => {
    await setupCheckout({ preview: async input => quote(90, input.user_coupon_id === 7), create: () => new Promise(() => {}) });
    await choose(couponSelect(), '7');
    fireEvent.click(checkoutButton());

    switchCustomer();
    await settle();

    expect(couponSelect()).toHaveValue('');
    expect(previews().at(-1)?.user_coupon_id).toBeUndefined();
    expect(checkoutButton()).toBeEnabled();
  });

  it('keeps the cart and refreshes the server choices when order creation rejects the coupon', async () => {
    let available = true;
    await setupCheckout({
      preview: async input => ({ ...quote(90, input.user_coupon_id === 7), available_coupons: available ? [coupon] : [] }),
      create: async () => {
        available = false;
        throw apiError('优惠券已被使用');
      },
    });
    await choose(couponSelect(), '7');

    await click(checkoutButton());

    expect(notifications).toContain('优惠券已被使用');
    expect(cartItems()).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(couponSelect()).toHaveValue('');
    expect(previews().at(-1)?.user_coupon_id).toBeUndefined();
    expect(couponOptions()).toEqual(['']);
  });

  it('creates only one order when checkout is clicked again before React re-renders', async () => {
    const order = deferred<{ message: string; order_id: number }>();
    await setupCheckout({ create: () => order.promise });
    const button = checkoutButton();

    clickTogether(button, button);
    expect(creates()).toHaveLength(1);

    await act(async () => order.resolve({ message: 'ok', order_id: 55 }));
    await settle();
    expect(creates()).toHaveLength(1);
  });

  it.each(['quantity', 'remove'] as const)("cannot let a late %s response modify the next customer's cart or selection", async (operation) => {
    const mutation = deferred();
    await setupCheckout({ updateQuantity: () => mutation.promise, remove: () => mutation.promise });
    fireEvent.click(operation === 'quantity' ? increase()[0] : removeButtons()[0]);

    switchCustomer();
    await settle();
    await act(async () => mutation.resolve({}));
    await settle();

    expect(cartItems()).toHaveLength(1);
    expect(cartItems()[0].quantity).toBe(3);
    expect(checkboxes()[1]).toBeChecked();
    expect(checkoutButton()).toBeEnabled();
  });

  it('refuses a different browser tab token before the local auth store catches up', async () => {
    await setupCheckout();
    localStorage.setItem('token', 'second-session');

    await click(checkoutButton());

    expect(creates()).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('lets a line with reduced stock lower its quantity to recover and be selected again', async () => {
    const rows: CartItem[] = [{ ...firstItem, sku_id: 101, quantity: 3, stock: 2, available: false, unavailable_reason: '库存不足' }];
    const updates: CartInput[] = [];
    await setupCheckout({ cartItems: rows, updateQuantity: async input => {
      updates.push(input);
      rows[0] = { ...rows[0], quantity: input.quantity, available: true, unavailable_reason: null };
    } });
    expect(decrease()[0]).toBeEnabled();

    await click(decrease()[0]);

    expect(updates).toEqual([{ product_id: 12, sku_id: 101, quantity: 2 }]);
    expect(cartItems()[0].available).toBe(true);
    for (const box of checkboxes()) expect(box).toBeEnabled();
  });

  it.each(['empty', 'loading', 'failure'] as const)('requires a loaded owned address (%s) while the quote stays independent', async (outcome) => {
    await setupCheckout({ addresses: () => outcome === 'loading' ? new Promise(() => {})
      : outcome === 'empty' ? Promise.resolve({ addresses: [] }) : Promise.reject(new Error('Unavailable')) });

    expect(checkoutButton()).toBeDisabled();
    await click(checkoutButton());
    expect(creates()).toEqual([]);
    expect(previews()).toHaveLength(1);
    expect(screen.getByRole('link', { name: '管理收货地址' })).toHaveAttribute('href', '/profile/address');
  });

  it('selects the default address and submits an explicitly chosen address ID', async () => {
    const other = { ...shippingAddress, address_id: 42, receiver_name: 'Other Receiver', is_default: false };
    await setupCheckout({ addresses: async () => ({ addresses: [other, shippingAddress] }) });
    expect(addressSelect()).toHaveValue('41');

    await choose(addressSelect()!, '42');
    await click(checkoutButton());

    expect(creates()[0].shipping_address_id).toBe(42);
    for (const input of previews()) expect(input).not.toHaveProperty('shipping_address_id');
  });

  it('retries a failed address load and enables checkout only after addresses arrive', async () => {
    let calls = 0;
    await setupCheckout({ addresses: async () => {
      if (++calls === 1) throw new Error('Unavailable');
      return { addresses: [shippingAddress] };
    } });
    expect(checkoutButton()).toBeDisabled();

    await click(screen.getByRole('button', { name: '重新加载地址' }));
    expect(checkoutButton()).toBeEnabled();

    await click(checkoutButton());
    expect(creates()[0].shipping_address_id).toBe(41);
  });

  it.each(['success', 'failure'] as const)('hides old address options at once and ignores a late address %s after the customer changes', async (outcome) => {
    const firstLoad = deferred<{ addresses: ShippingAddress[] }>();
    let calls = 0;
    const { commits } = await setupCheckout({ addresses: () => ++calls === 1 ? firstLoad.promise
      : Promise.resolve({ addresses: [{ ...shippingAddress, address_id: 42, receiver_name: 'Second Receiver' }] }) });
    const before = commits.length;

    switchCustomer();
    expect(commits[before].textContent).not.toContain('First Receiver');
    await settle();
    expect(addressSelect()).toHaveTextContent('Second Receiver');

    await act(async () => {
      if (outcome === 'success') firstLoad.resolve({ addresses: [shippingAddress] });
      else firstLoad.reject(new Error('Old address error'));
    });
    await settle();
    expect(addressSelect()).toHaveTextContent('Second Receiver');
    expect(screen.queryByText(/First Receiver/)).not.toBeInTheDocument();

    await click(checkoutButton());
    expect(creates()[0].shipping_address_id).toBe(42);
  });

  it("removes customer A's loaded address options in customer B's first render", async () => {
    let calls = 0;
    const { commits } = await setupCheckout({ addresses: () => ++calls === 1 ? Promise.resolve({ addresses: [shippingAddress] }) : new Promise(() => {}) });
    expect(addressSelect()).toHaveTextContent('First Receiver');
    const before = commits.length;

    switchCustomer();

    expect(commits[before].textContent).not.toContain('First Receiver');
    await settle();
    expect(checkoutButton()).toBeDisabled();
  });

  it('makes no cart change or navigation when the page is left before create returns', async () => {
    const order = deferred<{ message: string; order_id: number }>();
    const { view } = await setupCheckout({ create: () => order.promise });
    fireEvent.click(checkoutButton());

    view.unmount();
    await act(async () => order.resolve({ message: 'ok', order_id: 55 }));
    await settle();

    expect(cartItems()).toHaveLength(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('reloads addresses after create rejects a deleted one and cannot submit it again', async () => {
    let exists = true;
    await setupCheckout({
      addresses: async () => ({ addresses: exists ? [shippingAddress] : [] }),
      create: async () => {
        exists = false;
        throw apiError('收货地址不存在');
      },
    });

    await click(checkoutButton());

    expect(addressApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByText('请先添加收货地址')).toBeInTheDocument();
    expect(checkoutButton()).toBeDisabled();
    await click(checkoutButton());
    expect(creates()).toHaveLength(1);
    expect(cartItems()).toHaveLength(1);
    expect(notifications).toContain('收货地址不存在');
  });
});
