import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import api from '@/lib/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { reactHandler, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

type Kind = 'favorites' | 'history';
const pages = { favorites: FavoritesPage, history: HistoryPage };
const customer = { user_id: 1, username: 'Customer', email: 'customer@example.test' };
const item = (id = 1) => ({ favorite_id: id, id, product_id: id, title: '棉质衬衫', title_en: 'Cotton shirt',
  main_image: '/fixture-shirt.jpg', price: '10.00', stock: 0, status: 1, has_sku: false,
  browsed_at: '2026-10-09T00:00:00Z' });
type Item = ReturnType<typeof item>;
const originalAdapter = api.defaults.adapter;
let requests: { method: string | undefined; url: string | undefined }[] = [];
// Exercise the installed Next Link's anchor/default-event behavior, with only its router boundary supplied.
const linkRouter = {
  pathname: '/', route: '/', query: {}, asPath: '/', basePath: '', isReady: true,
  push: vi.fn(async () => true), replace: vi.fn(async () => true), prefetch: vi.fn(async () => undefined),
  beforePopState: vi.fn(),
} as unknown as NextRouter;

beforeEach(() => { requests = []; });
afterEach(() => { api.defaults.adapter = originalAdapter; });

async function setup(kind: Kind, rows: Item[] = [item()], total = rows.length) {
  useAuthStore.getState().login(customer, 'links-session');
  api.defaults.adapter = async config => {
    requests.push({ method: config.method, url: config.url });
    const data = config.url === '/products/1' ? { product: { ...rows[0], stock: 3, has_sku: true } }
      : { [kind]: config.params?.page === 2 ? [item(21)] : rows, pagination: { total, total_pages: Math.ceil(total / 20) } };
    return { data, config, status: 200, statusText: 'OK', headers: {} };
  };
  const Page = pages[kind];
  const view = render(<RouterContext.Provider value={linkRouter}><Page /></RouterContext.Provider>);
  await settle();
  return view;
}

function productLinks(name = '棉质衬衫') {
  const links = screen.getAllByRole<HTMLAnchorElement>('link', { name: new RegExp(name) });
  expect(links).toHaveLength(2);
  return links;
}

const writes = () => requests.filter(request => request.method !== 'get');

describe.each(['favorites', 'history'] as const)('%s product links', kind => {
  it.each(['zh-CN', 'en'] as const)('opens sold-out products using Tab and Enter on the image and title (%s)', async locale => {
    useLocaleStore.setState({ locale });
    await setup(kind);
    const links = productLinks(locale === 'en' ? 'Cotton shirt' : '棉质衬衫');
    const keyboard = userEvent.setup();
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Add to cart' : '加入购物车' })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 2 })).toContainElement(links[1]);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/products/1');
      expect(link.tabIndex).toBe(0);
      expect(link.querySelector('button')).toBeNull();
      for (let step = 0; step < 5 && document.activeElement !== link; step += 1) await keyboard.tab();
      expect(link).toHaveFocus();
      await keyboard.keyboard('{Enter}');
      expect(linkRouter.push).toHaveBeenCalledExactlyOnceWith('/products/1', '/products/1', expect.objectContaining({ scroll: true }));
      vi.mocked(linkRouter.push).mockClear();
    }
    expect(router.push).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('keeps ordinary image and title clicks as Next Link navigation without writing customer activity', async () => {
    await setup(kind);
    for (const link of productLinks()) {
      fireEvent.click(link);
      expect(linkRouter.push).toHaveBeenCalledExactlyOnceWith('/products/1', '/products/1', expect.anything());
      vi.mocked(linkRouter.push).mockClear();
    }
    expect(router.push).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])('leaves modified clicks to the browser for open-new-tab (%j)', async modifier => {
    await setup(kind);
    for (const link of productLinks()) {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, ...modifier });
      expect(fireEvent(link, click)).toBe(true);
      expect(click.defaultPrevented).toBe(false);
    }
    expect(linkRouter.push).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('preserves current middle-click and context-menu browser behavior', async () => {
    await setup(kind);
    for (const link of productLinks()) {
      for (const type of ['auxclick', 'contextmenu']) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'auxclick' ? 1 : 2 });
        expect(fireEvent(link, event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(linkRouter.push).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('blocks native normal, Ctrl/Cmd and middle clicks plus context menus after another tab replaces the session', async () => {
    await setup(kind);
    localStorage.setItem('session', 'other-tab-session');
    for (const link of productLinks()) {
      for (const init of [{}, { ctrlKey: true }, { metaKey: true }]) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        expect(fireEvent(link, event)).toBe(false);
        expect(event.defaultPrevented).toBe(true);
      }
      for (const type of ['auxclick', 'contextmenu']) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true });
        expect(fireEvent(link, event)).toBe(false);
        expect(event.defaultPrevented).toBe(true);
      }
    }
    expect(linkRouter.push).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it.each(['account', 'page', 'unmount'] as const)('cancels an earlier rendered link handler after a %s change', async change => {
    const view = await setup(kind, [item()], 21);
    const links = productLinks();
    const handlers = links.map(link => reactHandler(link, 'onClick'));
    if (change === 'account') act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'next-session'));
    if (change === 'page') fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    if (change === 'unmount') view.unmount();
    await settle();
    for (const [index, handler] of Array.from(handlers.entries())) {
      for (const init of [{}, { ctrlKey: true }, { metaKey: true }]) {
        // Detached nodes cannot dispatch through React; run the captured Next Link event boundary.
        const event = new MouseEvent('click', { cancelable: true, ...init });
        Object.defineProperty(event, 'currentTarget', { value: links[index] });
        act(() => handler(event));
        expect(event.defaultPrevented).toBe(true);
      }
    }
    expect(linkRouter.push).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('retains independent SKU selection, removal buttons and unavailable product states', async () => {
    await setup(kind, [{ ...item(), stock: 3, has_sku: true }, { ...item(2), title: '商品已不存在', title_en: '', status: -1 }]);
    const links = productLinks();
    for (const link of links) expect(link.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: '加入购物车' })[0]).toBeDisabled();
    expect(screen.getByRole('heading', { name: '商品已不存在' })).toBeVisible();
    const removals = document.querySelectorAll(`button[title="${kind === 'favorites' ? '取消收藏' : '删除记录'}"]`);
    expect(removals).toHaveLength(2);
    for (const button of Array.from(removals)) expect(button).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '选择规格' }));
    await settle();
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/products/1');
    expect(requests.filter(request => request.url === '/products/1')).toHaveLength(1);
    expect(writes()).toEqual([]);
    expect(linkRouter.push).not.toHaveBeenCalled();
  });
});
