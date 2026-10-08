import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetailPage from '@/components/ProductDetail';
import { cartApi, favoriteApi, productApi, type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useCartStore } from '@/store/useCartStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { apiError, captureHandler, deferred, render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const params = vi.hoisted(() => ({ id: '1' }));
const notifications = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => params }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notifications.push(message); };
  const toast = { error: record, success: record };
  return { default: toast, toast };
});
vi.mock('@/components/ProductCard', () => ({ default: () => null }));
vi.mock('@/lib/api', () => ({
  productApi: { getDetail: vi.fn() },
  cartApi: { add: vi.fn(async () => ({})) },
  reviewApi: { listByProduct: vi.fn(async () => ({ reviews: [] })) },
  recommendationApi: { getRelated: vi.fn(async () => ({ related_products: [] })) },
  favoriteApi: { check: vi.fn(async () => ({ is_favorited: false })), toggle: vi.fn(async () => ({ is_favorited: true })) },
  browseApi: { record: vi.fn(async () => ({})) },
}));

type Detail = { product: Product };
const firstUser = { user_id: 1, username: 'first', email: 'first@example.test' };
const secondUser = { user_id: 2, username: 'second', email: 'second@example.test' };
const base: Product = { product_id: 1, title: 'Shirt', price: 10, stock: 99, sales_count: 0, rating: 5, main_image: '/base.jpg' };
const product: Product = { ...base, has_sku: true, skus: [
  { sku_id: 101, product_id: 1, sku_code: 'RED', specs: { Color: 'Red', Size: 'M' }, price: 20, stock: 2, image: '/red.jpg', status: 1 },
  { sku_id: 102, product_id: 1, sku_code: 'BLUE', specs: { Color: 'Blue', Size: 'L' }, price: 30, stock: 4, image: '/blue.jpg', status: 1 },
  { sku_id: 103, product_id: 1, sku_code: 'EMPTY', specs: { Color: 'Black' }, price: 40, stock: 0, status: 1 },
] };

async function setup({ detail = async () => ({ product }), authenticated = true }: { detail?: (id: number) => Promise<Detail>; authenticated?: boolean } = {}) {
  if (authenticated) useAuthStore.getState().login(firstUser, 'first-session');
  else useAuthStore.getState().hydrate();
  vi.mocked(productApi.getDetail).mockImplementation(detail);
  const view = render(<ProductDetailPage />);
  await settle();
  return { view, rerender: () => act(() => view.rerender(<ProductDetailPage />)) };
}

const sku = () => screen.queryByLabelText<HTMLSelectElement>('商品规格');
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const additions = () => vi.mocked(cartApi.add).mock.calls.map(([input]) => input);

async function chooseSku(value: string) {
  fireEvent.change(sku()!, { target: { value } });
  await settle();
}

async function click(name: string) {
  fireEvent.click(button(name));
  await settle();
}

describe('product SKU purchase', () => {
  it('waits for the initial favorite read before allowing a toggle', async () => {
    const pending = deferred<{ is_favorited: boolean }>();
    vi.mocked(favoriteApi.check).mockReturnValue(pending.promise);
    await setup(); await click('收藏');
    expect(button('收藏')).toBeDisabled();
    expect(favoriteApi.toggle).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ is_favorited: false })); await settle();
    await click('收藏');
    expect(button('取消收藏')).toBeEnabled();
  });

  it('locks repeated favorite actions synchronously while a toggle is pending', async () => {
    const pending = deferred<{ message: string; is_favorited: boolean }>();
    vi.mocked(favoriteApi.toggle).mockReturnValue(pending.promise);
    await setup(); const toggle = captureHandler(button('收藏'));
    const first = toggle(); const second = toggle();
    expect(favoriteApi.toggle).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ message: '收藏成功', is_favorited: true }));
    await Promise.all([first, second]); await settle();
    expect(button('取消收藏')).toBeEnabled();
  });

  it('keeps the loaded favorite state when its toggle fails', async () => {
    const read = deferred<{ is_favorited: boolean }>();
    vi.mocked(favoriteApi.check).mockReturnValue(read.promise);
    vi.mocked(favoriteApi.toggle).mockRejectedValue(apiError('操作失败', 'message'));
    await setup();
    await act(async () => read.resolve({ is_favorited: true })); await settle();
    await click('取消收藏');
    expect(button('取消收藏')).toBeEnabled();
  });

  beforeEach(() => {
    params.id = '1';
    notifications.length = 0;
  });

  it('switches product and variant content while preserving the selected SKU and bilingual cart data', async () => {
    const detail: Product = { ...base, title: '棉质衬衫', title_en: 'Cotton shirt', description: '柔软舒适', description_en: 'Soft and comfortable',
      specs: { 材质: '棉' }, specs_en: { 材质: { name: 'Material', value: 'Cotton' } }, has_sku: true,
      skus: [{ ...product.skus![0], specs: { 颜色: '红色', 尺寸: 42 }, specs_en: { 颜色: { name: 'Color', value: 'Red' }, 尺寸: { name: 'Size' } } }] };
    await setup({ detail: async () => ({ product: detail }) });
    await chooseSku('101');
    act(() => useLocaleStore.setState({ locale: 'en' }));
    expect(screen.getByRole('heading', { name: 'Cotton shirt' })).toBeVisible();
    expect(screen.getByText('Soft and comfortable')).toBeVisible();
    expect(screen.getByRole('option', { name: /Color: Red \/ Size: 42/ })).toHaveValue('101');
    expect(screen.getByLabelText('Product options')).toHaveValue('101');
    expect(screen.getByText('Cotton', { exact: true })).toBeVisible();
    await click('Add to cart');
    expect(additions()).toEqual([{ product_id: 1, sku_id: 101, quantity: 1 }]);
    expect(useCartStore.getState().items[0]).toMatchObject({ title: '棉质衬衫', title_en: 'Cotton shirt', sku_specs: { 颜色: '红色', 尺寸: 42 }, sku_specs_en: detail.skus![0].specs_en });
    act(() => useLocaleStore.setState({ locale: 'zh-CN' }));
    expect(screen.getByRole('heading', { name: '棉质衬衫' })).toBeVisible();
    expect(screen.getByLabelText('商品规格')).toHaveValue('101');
  });

  it.each([
    { price: '99.00', original_price: '100.00', discounted: true },
    { price: '100.00', original_price: '99.00', discounted: false },
    { price: '100.00', original_price: '100.00', discounted: false },
    { price: '9.99', original_price: '10.00', discounted: true },
    { price: 99, original_price: 100, discounted: true },
    { price: '99.00', original_price: 100, discounted: true },
    { price: 99, original_price: '100.00', discounted: true },
    { price: '0.00', original_price: '10.00', discounted: true },
    { price: '100.00', original_price: 0, discounted: false },
    { price: '100.00', original_price: '0.00', discounted: false },
    { price: '100.00', original_price: null, discounted: false },
    { price: '100.00', original_price: undefined, discounted: false },
  ])('uses the selected variant original price $original_price against $price', async ({ price, original_price, discounted }) => {
    const variant: Product = { ...product, original_price: 999, skus: [
      { sku_id: 101, product_id: 1, sku_code: 'SALE', specs: { Color: 'Red' }, price, original_price, stock: 2, status: 1 },
    ] };
    const { view } = await setup({ detail: async () => ({ product: variant }) });
    await chooseSku('101');
    for (const locale of ['zh-CN', 'en'] as const) {
      act(() => useLocaleStore.setState({ locale }));
      const strike = view.container.querySelector('.line-through');
      if (discounted) expect(strike).toHaveTextContent(`¥${original_price}`);
      else expect(strike).toBeNull();
      expect(view.container.querySelector('span.text-3xl')).toHaveTextContent(`¥${price}`);
      expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    }
  });

  it('waits for an explicit variant and updates its sale price when switching between variants', async () => {
    const detail: Product = { ...product, original_price: 999, skus: [
      { sku_id: 101, product_id: 1, sku_code: 'SALE', specs: { Color: 'Red' }, price: 100, original_price: 200, stock: 2, status: 1 },
      { sku_id: 102, product_id: 1, sku_code: 'REGULAR', specs: { Color: 'Blue' }, price: 150, original_price: null, stock: 2, status: 1 },
    ] };
    const { view } = await setup({ detail: async () => ({ product: detail }) });
    expect(view.container.querySelector('.line-through')).toBeNull();
    await chooseSku('101');
    expect(view.container.querySelector('.line-through')).toHaveTextContent('¥200');
    await chooseSku('102');
    expect(view.container.querySelector('.line-through')).toBeNull();
    expect(view.container.querySelector('span.text-3xl')).toHaveTextContent('¥150');
    await chooseSku('');
    expect(view.container.querySelector('.line-through')).toBeNull();
  });

  it.each([150, '150.00', null])('keeps a simple product original price %s', async original_price => {
    const { view } = await setup({ detail: async () => ({ product: { ...base, has_sku: false, price: 100, original_price } }) });
    const strike = view.container.querySelector('.line-through');
    if (original_price === null) expect(strike).toBeNull();
    else expect(strike).toHaveTextContent(`¥${original_price}`);
  });

  it("requires an explicit variant and uses that variant's price, image, stock and cart identity", async () => {
    await setup();
    expect(sku(), 'an explicit SKU selector must be rendered').not.toBeNull();
    expect(sku()).toHaveValue('');
    expect(button('加入购物车')).toBeDisabled();
    // React ignores clicks on a disabled button, so call its handler: it must refuse as well.
    await act(() => captureHandler(button('立即购买'))());
    expect(additions()).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();

    await chooseSku('101');
    expect(screen.getByText('¥20')).toBeInTheDocument();
    expect(screen.getByText('库存 2 件')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Shirt' })).toHaveAttribute('src', '/red.jpg');
    const quantity = screen.getByLabelText<HTMLInputElement>('数量:');
    expect(quantity).toHaveAttribute('max', '2');
    fireEvent.change(quantity, { target: { value: '99' } });
    expect(quantity).toHaveValue(2);

    await click('立即购买');
    expect(additions()).toEqual([{ product_id: 1, quantity: 2, sku_id: 101 }]);
    expect(useCartStore.getState().items[0]).toMatchObject({ sku_id: 101, price: 20, main_image: '/red.jpg', sku_specs: { Color: 'Red', Size: 'M' }, sku_code: 'RED' });
    expect(router.push.mock.calls).toEqual([['/cart']]);
  });

  it.each([true, false])('never reports success or opens the cart after a failed add or anonymous buy (signed in: %s)', async (authenticated) => {
    vi.mocked(cartApi.add).mockRejectedValue(apiError('库存不足'));
    await setup({ authenticated, detail: async () => ({ product: { ...base, has_sku: false } }) });

    await click('立即购买');

    expect(router.push).not.toHaveBeenCalledWith('/cart');
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(additions()).toHaveLength(authenticated ? 1 : 0);
    expect(notifications).not.toContain('已加入购物车');
  });

  it('cannot fall back to plentiful base inventory when every SKU row is disabled', async () => {
    await setup({ detail: async () => ({ product: { ...base, has_sku: true, skus: [] } }) });
    expect(screen.getByText('暂无可用规格')).toBeInTheDocument();

    // Both purchase buttons read 已售罄 here, so find them by their shared class.
    const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('button.flex-1.btn'));
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action).toBeDisabled();
    await act(() => captureHandler(actions[1])());

    expect(additions()).toEqual([]);
  });

  it.each(['success', 'failure'] as const)("cannot let a late previous product %s replace the route or select a variant on the next product", async (outcome) => {
    const first = deferred<Detail>();
    const { rerender } = await setup({ detail: id => id === 1 ? first.promise : Promise.resolve({ product: { ...product, product_id: 2, title: 'Second shirt' } }) });

    params.id = '2';
    rerender();
    await settle();
    await chooseSku('102');
    await act(async () => {
      if (outcome === 'success') first.resolve({ product });
      else first.reject(new Error('Old product unavailable'));
    });
    await settle();

    expect(screen.getByRole('heading', { name: 'Second shirt' })).toBeInTheDocument();
    expect(sku()).toHaveValue('102');
    expect(router.push).not.toHaveBeenCalled();
    expect(notifications).not.toContain('商品不存在');
  });

  it.each(['success', 'failure'] as const)('ignores a late product retry %s after navigating to another product', async outcome => {
    const retry = deferred<Detail>();
    let firstRequests = 0;
    const { rerender } = await setup({ detail: id => {
      if (id !== 1) return Promise.resolve({ product: { ...product, product_id: 2, title: 'Second shirt' } });
      if (++firstRequests === 1) return Promise.reject(new Error('Offline'));
      return retry.promise;
    } });
    const staleRetry = captureHandler(button('重新加载'));
    void staleRetry();
    await settle();
    params.id = '2';
    rerender();
    await settle();
    await chooseSku('102');
    const noticesBefore = [...notifications];

    await act(async () => {
      if (outcome === 'success') retry.resolve({ product });
      else retry.reject(new Error('Old retry failed'));
    });
    await staleRetry();
    await settle();
    expect(screen.getByRole('heading', { name: 'Second shirt' })).toBeInTheDocument();
    expect(sku()).toHaveValue('102');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(notifications).toEqual(noticesBefore);
    expect(firstRequests).toBe(2);
  });

  const lateAddCases = (['route', 'account', 'storage', 'unmount'] as const).flatMap(change =>
    (['success', 'failure'] as const).map(outcome => ({ change, outcome })));

  it.each(lateAddCases)('keeps a late add $outcome after a $change change from touching another cart or navigating', async ({ change, outcome }) => {
    const pending = deferred();
    vi.mocked(cartApi.add).mockReturnValue(pending.promise as never);
    const { view, rerender } = await setup();
    await chooseSku('101');
    fireEvent.click(button('立即购买'));

    if (change === 'route') {
      params.id = '2';
      rerender();
      await settle();
    }
    if (change === 'account') {
      act(() => useAuthStore.getState().login(secondUser, 'second-session'));
      await settle();
    }
    if (change === 'storage') localStorage.setItem('session', 'second-session');
    if (change === 'unmount') view.unmount();
    useCartStore.getState().setItems([{ cart_id: 9, product_id: 1, sku_id: 102, quantity: 1, title: 'B item', price: 30, stock: 4 }]);
    await act(async () => {
      if (outcome === 'success') pending.resolve({});
      else pending.reject(apiError('旧请求失败'));
    });
    await settle();

    expect(useCartStore.getState().items.map(item => item.sku_id)).toEqual([102]);
    expect(router.push).not.toHaveBeenCalled();
    expect(notifications).not.toContain('已加入购物车');
    expect(notifications).not.toContain('旧请求失败');
  });

  it('ignores a late favorite read and requires a fresh explicit variant after the customer changes', async () => {
    const pending = deferred<{ is_favorited: boolean }>();
    let calls = 0;
    vi.mocked(favoriteApi.check).mockImplementation(() => ++calls === 1 ? pending.promise : Promise.resolve({ is_favorited: false }));
    await setup();
    await chooseSku('101');

    act(() => useAuthStore.getState().login(secondUser, 'second-session'));
    await settle();
    expect(sku()).toHaveValue('');

    await act(async () => pending.resolve({ is_favorited: true }));
    await settle();
    expect(document.querySelectorAll('button[title="收藏"]')).toHaveLength(1);
    expect(calls).toBe(2);
  });
});
