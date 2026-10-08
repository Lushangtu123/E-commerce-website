import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDetail from '@/components/ProductDetail';
import api, { productApi, recommendationApi, reviewApi, favoriteApi, browseApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { captureHandler, clickTogether, CommitLog, deferred, render, settle } from './helpers';

const navigation = vi.hoisted(() => ({ id: '1', push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation, useParams: () => ({ id: navigation.id }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const product = { product_id: 1, title: 'Fixture', price: 10, stock: 3, sales_count: 0, rating: 0, review_count: 0 };
beforeEach(() => {
  navigation.id = '1';
  useAuthStore.getState().login({ user_id: 1, username: 'Synthetic', email: 'synthetic@example.test' }, 'first-session');
  useAuthStore.setState({ isHydrated: true });
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Unexpected outbound request'));
  vi.spyOn(productApi, 'getDetail').mockImplementation(async id => ({ product: { ...product, product_id: id } }));
  vi.spyOn(recommendationApi, 'getRelated').mockResolvedValue({ related_products: [] });
  vi.spyOn(reviewApi, 'listByProduct').mockResolvedValue({ reviews: [], total: 0, totalPages: 0 });
  vi.spyOn(browseApi, 'record').mockResolvedValue({} as never);
  vi.spyOn(favoriteApi, 'check').mockResolvedValue({ is_favorited: true });
  vi.spyOn(favoriteApi, 'toggle').mockResolvedValue({ is_favorited: false, message: '取消收藏成功' });
});
describe('favorite state recovery', () => {
  it('blocks both the rendered action and a captured handler until the state is known', async () => {
    const pending = deferred<{ is_favorited: boolean }>();
    vi.mocked(favoriteApi.check).mockReturnValueOnce(pending.promise);
    render(<ProductDetail initialProduct={product} />); await settle();
    const button = screen.getByRole('button', { name: '收藏' });
    expect(button).toBeDisabled();
    await captureHandler(button)();
    expect(favoriteApi.toggle).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ is_favorited: true }));
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeEnabled();
  });
  it.each(['zh-CN', 'en'] as const)('failed reads cannot remove a saved product and recover independently (%s)', async locale => {
    useLocaleStore.setState({ locale });
    vi.mocked(favoriteApi.check).mockRejectedValueOnce(new Error('503'));
    render(<ProductDetail initialProduct={product} />); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(locale === 'en'
      ? 'Unable to load favorite status. Please try again.' : '加载收藏状态失败，请重试');
    const add = screen.getByRole('button', { name: locale === 'en' ? 'Add to favorites' : '收藏' });
    expect(add).toBeDisabled(); await captureHandler(add)();
    expect(favoriteApi.toggle).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: locale === 'en' ? 'Retry favorite status' : '重新加载收藏状态' });
    clickTogether(retry, retry); await settle();
    expect(favoriteApi.check).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Remove from favorites' : '取消收藏' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(productApi.getDetail).toHaveBeenCalledTimes(1);
    expect(recommendationApi.getRelated).toHaveBeenCalledTimes(1);
    expect(reviewApi.listByProduct).toHaveBeenCalledTimes(1);
    expect(browseApi.record).toHaveBeenCalledTimes(1);
  });
  it('an unselected product becomes collectible after a successful retry', async () => {
    vi.mocked(favoriteApi.check).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ is_favorited: false });
    vi.mocked(favoriteApi.toggle).mockResolvedValueOnce({ is_favorited: true, message: '收藏成功' });
    render(<ProductDetail initialProduct={product} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载收藏状态' })); await settle();
    fireEvent.click(screen.getByRole('button', { name: '收藏' })); await settle();
    expect(favoriteApi.toggle).toHaveBeenCalledExactlyOnceWith(1);
    expect(screen.getByRole('button', { name: '取消收藏' })).toBeEnabled();
  });
  it.each(['success', 'failure'] as const)('late old-context %s cannot overwrite the new product state', async outcome => {
    const pending = deferred<{ is_favorited: boolean }>();
    vi.mocked(favoriteApi.check).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ is_favorited: false });
    const commits: HTMLElement[] = [];
    const view = render(<CommitLog commits={commits}><ProductDetail initialProduct={product} /></CommitLog>); await settle();
    navigation.id = '2'; commits.length = 0;
    view.rerender(<CommitLog commits={commits}><ProductDetail initialProduct={{ ...product, product_id: 2 }} /></CommitLog>); await settle();
    expect(commits[0].querySelector('button[title="收藏"]')).toBeDisabled();
    await act(async () => outcome === 'success' ? pending.resolve({ is_favorited: true }) : pending.reject(new Error('503')));
    expect(screen.getByRole('button', { name: '收藏' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(favoriteApi.check).toHaveBeenLastCalledWith(2);
  });
  it('the previous account action cannot toggle for a changed session', async () => {
    render(<ProductDetail initialProduct={product} />); await settle();
    const oldAction = captureHandler(screen.getByRole('button', { name: '取消收藏' }));
    act(() => useAuthStore.getState().login({ user_id: 2, username: 'Second', email: 'second@example.test' }, 'second-session'));
    await oldAction(); await settle();
    expect(favoriteApi.toggle).not.toHaveBeenCalled();
    expect(favoriteApi.check).toHaveBeenCalledTimes(2);
  });
});
