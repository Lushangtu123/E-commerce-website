import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import api, { type Product } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({ id: navigation.id }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const originalAdapter = api.defaults.adapter;
const product: Product = { product_id: 1, title: 'Server product', price: '10.00', stock: 3, status: 1, sales_count: 0, rating: 0 };
const sku = { sku_id: 11, product_id: 1, sku_code: 'RED', specs: { Color: 'Red' }, price: '10.00', stock: 3, status: 1 };
type Call = { method?: string; path?: string; body?: Record<string, unknown> };
let detail: unknown;
let calls: Call[];

beforeEach(() => {
  navigation.id = '1';
  useAuthStore.getState().login({ user_id: 1, username: 'Buyer', email: 'buyer@example.test' }, 'buyer-session');
  detail = { product }; calls = [];
  const adapter: AxiosAdapter = async config => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    calls.push({ method: config.method, path: config.url, body });
    let data: unknown;
    if (config.method === 'get' && config.url?.startsWith('/products/')) data = await detail;
    else if (config.url?.startsWith('/reviews/product/')) data = { reviews: [], total: 0, totalPages: 0 };
    else if (config.url?.startsWith('/recommendations/related/')) data = { related_products: [] };
    else if (config.url?.startsWith('/favorites/check/')) data = { is_favorited: false };
    else if (config.url === '/browse/record') data = {};
    else throw new Error(`Unexpected mocked HTTP call ${config.method} ${config.url}`);
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
});
afterEach(() => { api.defaults.adapter = originalAdapter; });

const reads = () => calls.filter(call => call.method === 'get' && call.path?.startsWith('/products/'));
const browseWrites = () => calls.filter(call => call.path === '/browse/record');
const purchaseWrites = () => calls.filter(call => call.path === '/cart');

describe('product detail response recovery', () => {
  it('keeps a missing product retryable with the server copy locked and retries only the detail read', async () => {
    detail = {};
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    expect(screen.getByRole('heading', { name: product.title })).toBeVisible();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '立即购买' })).toBeDisabled();
    detail = { product: { ...product, price: '8.00', stock: 2 } };
    act(() => {
      const retry = screen.getByRole('button', { name: '重新加载' });
      retry.click(); retry.click();
    });
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('¥8.00')).toBeVisible();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeEnabled();
    expect(reads()).toHaveLength(2);
    expect(browseWrites()).toHaveLength(1);
    expect(purchaseWrites()).toHaveLength(0);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('rejects another product before displaying it or allowing a purchase for the route product', async () => {
    detail = { product: { ...product, product_id: 2, title: 'Wrong product', price: '99.00' } };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    expect(screen.getByRole('heading', { name: product.title })).toBeVisible();
    expect(screen.queryByText('Wrong product')).toBeNull();
    const add = screen.getByRole('button', { name: '加入购物车' });
    const buy = screen.getByRole('button', { name: '立即购买' });
    expect(add).toBeDisabled(); expect(buy).toBeDisabled();
    await act(() => captureHandler(add)());
    await act(() => captureHandler(buy)());
    expect(purchaseWrites()).toHaveLength(0);
    expect(sessionStorage.getItem('buy-now:buyer-session:1')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each([
    ['missing price', { price: undefined }], ['null price', { price: null }], ['blank price', { price: '' }],
    ['coerced price', { price: '1e2' }], ['fractional cent', { price: 10.001 }], ['negative price', { price: -1 }],
    ['missing stock', { stock: undefined }], ['coerced stock', { stock: '3' }], ['fractional stock', { stock: 1.5 }],
    ['negative stock', { stock: -1 }],
  ])('rejects %s instead of making the product purchasable', async (_, changes) => {
    detail = { product: { ...product, ...changes } };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '立即购买' })).toBeDisabled();
    expect(purchaseWrites()).toHaveLength(0);
  });

  it.each([
    ['another product\'s SKU', { skus: [{ ...sku, product_id: 2 }] }],
    ['missing SKU identity', { skus: [{ ...sku, sku_id: undefined }] }],
    ['duplicate SKU identity', { skus: [sku, sku] }],
    ['missing SKU list', { skus: undefined }],
    ['invalid variant flag', { has_sku: 'false' }],
    ['variants with a false flag', { has_sku: false }],
    ['missing SKU price', { skus: [{ ...sku, price: undefined }] }],
    ['coerced SKU stock', { skus: [{ ...sku, stock: '3' }] }],
    ['inactive SKU', { skus: [{ ...sku, status: 0 }] }],
  ])('rejects %s before exposing variant purchase controls', async (_, changes) => {
    detail = { product: { ...product, has_sku: true, skus: [sku], ...changes } };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    expect(screen.queryByLabelText('商品规格')).toBeNull();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
    expect(purchaseWrites()).toHaveLength(0);
  });

  it.each([
    ['missing title', { title: undefined }], ['blank title', { title: ' ' }], ['missing sales count', { sales_count: undefined }],
    ['missing rating', { rating: undefined }], ['unpublished product', { status: 0 }],
    ['invalid English title', { title_en: 10 }], ['invalid original price', { original_price: 'unknown' }],
    ['invalid image', { main_image: [] }], ['invalid specifications', { specs: [] }],
    ['invalid specification translation', { specs_en: { Color: { name: 10 } } }],
    ['missing SKU code', { has_sku: true, skus: [{ ...sku, sku_code: undefined }] }],
    ['invalid SKU original price', { has_sku: true, skus: [{ ...sku, original_price: 'unknown' }] }],
    ['invalid SKU image', { has_sku: true, skus: [{ ...sku, image: [] }] }],
    ['invalid SKU specifications', { has_sku: true, skus: [{ ...sku, specs: [] }] }],
    ['invalid SKU translation', { has_sku: true, skus: [{ ...sku, specs_en: { Color: { name: 10 } } }] }],
  ])('keeps %s out of the rendered client snapshot', async (_, changes) => {
    detail = { product: { ...product, ...changes } };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    expect(screen.getByRole('heading', { name: product.title })).toBeVisible();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
    expect(purchaseWrites()).toHaveLength(0);
  });

  it.each([{ success: false }, { error: 'Unable to load product' }])('rejects an error envelope %j even with a usable product', async envelope => {
    detail = { ...envelope, product };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载商品失败，请重试');
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
  });

  it.each([null, { product: null }, { product: [] }, { product: false }])('offers a translated retry for %j without a server copy', async response => {
    useLocaleStore.setState({ locale: 'en' }); detail = response;
    const view = render(<ProductDetail />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load this product. Please try again.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it.each([
    ['omitted optional fields', { ...product, status: undefined }],
    ['nullable optional fields', { ...product, title_en: null, description: null, description_en: null,
      original_price: null, main_image: null, specs: null, specs_en: null }],
    ['zero numeric money and inventory', { ...product, price: 0, stock: 0, has_sku: 0 }],
    ['zero decimal strings', { ...product, price: '0.00', original_price: '0.00', rating: '0.00' }],
    ['maximum decimal money', { ...product, price: '99999999.99' }],
  ] as const)('accepts backend-supported %s', async (_, actual) => {
    detail = { product: actual };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: product.title })).toBeVisible();
    expect(screen.getByText(`¥${actual.price}`)).toBeVisible();
    if (actual.stock > 0) expect(screen.getByRole('button', { name: '加入购物车' })).toBeEnabled();
    else expect(screen.getAllByRole('button', { name: '已售罄' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it.each([true, 1])('accepts active variants and summed inventory with has_sku %s', async has_sku => {
    detail = { product: { ...product, has_sku, stock: 4294967294, rating: '4.50', review_count: 2,
      title_en: 'Client product', specs: { Color: 'Red', Size: 42, Waterproof: false, Details: { Material: 'Cotton' } },
      specs_en: { Color: { name: 'Colour', value: 'Crimson' } }, skus: [
        { ...sku, stock: 2147483647, price: '0.00', original_price: null, image: null,
          specs: { Color: 'Red', Size: 42, Waterproof: false }, specs_en: { Color: { name: 'Colour', value: 'Crimson' } } },
        { ...sku, sku_id: 12, stock: 2147483647 },
      ] } };
    useLocaleStore.setState({ locale: 'en' });
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Client product' })).toBeVisible();
    expect(screen.getByText('4294967294 in stock')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Product options'), { target: { value: '11' } });
    expect(screen.getByText('¥0.00')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    expect(purchaseWrites()).toHaveLength(0);
  });

  it('keeps a variant product with no active variants sold out without falling back to its base stock', async () => {
    detail = { product: { ...product, has_sku: true, skus: [], stock: 0 } };
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('商品规格')).toBeDisabled();
    expect(screen.getAllByRole('button', { name: '已售罄' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(purchaseWrites()).toHaveLength(0);
  });

  it('ignores a late invalid response from the previous customer without replacing the current product or error', async () => {
    const previous = deferred(); detail = previous.promise;
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled();
    detail = { product: { ...product, title: 'Current customer product', price: '7.00' } };
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Next', email: 'next@example.test' }, 'next-session'));
    await settle();
    await act(async () => previous.resolve({ product: { ...product, product_id: 2, title: 'Old response' } })); await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Current customer product' })).toBeVisible();
    expect(screen.queryByText('Old response')).toBeNull();
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeEnabled();
    expect(purchaseWrites()).toHaveLength(0);
    expect(reads()).toHaveLength(2);
  });
});
