import { act, fireEvent, screen } from '@testing-library/react';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import Coupons from '@/app/coupons/page';
import api from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { translate } from '@/lib/i18n';
import { render, settle } from './helpers';
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; });
const customer = { user_id: 1, username: 'Fixture', email: 'fixture@example.test' };
const coupon = { coupon_id: 1, name: 'Fixture', code: 'FIXTURE', type: 3, discount_value: 5, min_amount: 0, total_quantity: 10, remain_quantity: 10, per_user_limit: 2, status: 1, start_time: '2020-01-01', end_time: '2099-01-01' };
const t = (key: string) => translate(key);
const receive = () => screen.getByRole('button', { name: new RegExp(`^(${t('立即领取')}|${t('重试领取')})$`) });
async function setup(mode: 'committed' | 'not_committed' | 'rejected' | 'success' = 'committed', firstResponse?: unknown) {
  useAuthStore.getState().login(customer, 'claim-session');
  const writes: { coupon_id?: number; code?: string; claim_key?: string }[] = [], receipts = new Map<string, number>();
  api.defaults.adapter = (async config => {
    if (config.method === 'get') return { config, status: 200, statusText: 'OK', headers: {}, data: { data: [{ ...coupon, remain_quantity: 10 - receipts.size }], pagination: { total: 1, total_pages: 1 } } };
    const body = JSON.parse(config.data); writes.push(body);
    const key = body.claim_key ?? `unprotected-${writes.length}`;
    if (!(writes.length === 1 && ['not_committed', 'rejected'].includes(mode)) && !receipts.has(key)) receipts.set(key, receipts.size + 1);
    if (writes.length === 1 && mode === 'rejected') throw new AxiosError('Rejected', AxiosError.ERR_BAD_REQUEST, config, undefined, { config, status: 400, statusText: 'Bad Request', headers: {}, data: { message: '优惠券已领完' } });
    if (writes.length === 1 && ['committed', 'not_committed'].includes(mode)) throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
    if (writes.length === 1 && firstResponse !== undefined) return { config, status: 200, statusText: 'OK', headers: {}, data: firstResponse };
    return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { user_coupon_id: receipts.get(key) } } };
  }) as AxiosAdapter;
  const view = render(<Coupons />); await settle(); return { view, writes, receipts };
}
describe('coupon deliberate retry identity', () => {
  it.each(['zh-CN', 'en'] as const)('recovers the same allocation after an invalid HTTP 200 receipt in %s', async locale => {
    useLocaleStore.getState().setLocale(locale);
    const { writes, receipts } = await setup('success', { success: false, data: { user_coupon_id: 0 } });
    fireEvent.click(receive()); await settle();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(t('领取结果尚未确认，重试不会重复领取'));
    expect(screen.getByRole('button', { name: t('重试领取') })).toBeEnabled();
    fireEvent.click(receive()); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key);
    expect(receipts.size).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    fireEvent.click(receive()); await settle();
    expect(writes[2].claim_key).not.toBe(writes[0].claim_key);
    expect(receipts.size).toBe(2);
  });
  it.each([
    { response: null }, { response: {} }, { response: { success: true } },
    { response: { success: 'true', data: { user_coupon_id: 1 } } },
    { response: { success: true, data: null } }, { response: { success: true, data: {} } },
    ...['1', 0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]
      .map(id => ({ response: { success: true, data: { user_coupon_id: id } } })),
  ])('does not finalize a malformed claim receipt $response', async ({ response }) => {
    const { writes, receipts } = await setup('success', response);
    fireEvent.click(receive()); await settle();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t('重试领取') })).toBeEnabled();
    fireEvent.click(receive()); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key);
    expect(receipts.size).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it('accepts a valid receipt at the database ID boundary', async () => {
    await setup('success', { success: true, data: { user_coupon_id: 2147483647 } });
    fireEvent.click(receive()); await settle();
    expect(toast.success).toHaveBeenCalledWith(t('领取成功！'));
    expect(screen.queryByRole('button', { name: t('重试领取') })).toBeNull();
  });
  it.each(['throws', 'ignored', 'verification read fails'])('keeps the claim identity when receipt cleanup %s', async failure => {
    const { view, writes, receipts } = await setup('success');
    const remove = sessionStorage.removeItem.bind(sessionStorage);
    const get = sessionStorage.getItem.bind(sessionStorage);
    let failVerification = false;
    const getSpy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(key => {
      if (failVerification && key.startsWith('pending-coupon-claim:')) { failVerification = false; throw new Error('Cannot verify cleanup'); }
      return get(key);
    });
    const removeSpy = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(key => {
      if (failure === 'throws') throw new Error('Cannot clear receipt');
      if (failure === 'ignored') return;
      remove(key); failVerification = true;
    });
    fireEvent.click(receive()); await settle();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(t('领取结果尚未确认，重试不会重复领取'));
    expect(screen.getByRole('button', { name: t('重试领取') })).toBeEnabled();
    removeSpy.mockRestore(); getSpy.mockRestore();
    view.unmount(); render(<Coupons />); await settle();
    fireEvent.click(receive()); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key);
    expect(receipts.size).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it('keeps the in-memory claim identity when cleanup removes storage and re-saving is unavailable', async () => {
    const { writes, receipts } = await setup('success');
    const remove = sessionStorage.removeItem.bind(sessionStorage);
    const get = sessionStorage.getItem.bind(sessionStorage);
    let cannotReadClaim = false;
    const getSpy = vi.spyOn(sessionStorage, 'getItem').mockImplementation(key => {
      if (cannotReadClaim && key.startsWith('pending-coupon-claim:')) throw new Error('Cannot read recovery storage');
      return get(key);
    });
    const removeSpy = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(key => { remove(key); cannotReadClaim = true; });
    fireEvent.click(receive()); await settle();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t('重试领取') })).toBeEnabled();
    fireEvent.click(receive()); await settle();
    expect(writes).toHaveLength(1);
    expect(toast.error).toHaveBeenLastCalledWith(t('无法保存领取请求，请检查浏览器存储后重试'));
    removeSpy.mockRestore(); getSpy.mockRestore();
    fireEvent.click(receive()); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key);
    expect(receipts.size).toBe(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it.each(['zh-CN', 'en'] as const)('reuses the lost successful claim, then permits a distinct next intent in %s', async locale => {
    useLocaleStore.getState().setLocale(locale); const { writes, receipts } = await setup();
    fireEvent.click(receive()); await settle(); fireEvent.click(receive()); await settle();
    expect(writes[0]).toMatchObject({ coupon_id: 1, claim_key: expect.stringMatching(/^[a-f\d-]{36}$/i) });
    expect(writes[1].claim_key).toBe(writes[0].claim_key); expect(receipts.size).toBe(1);
    fireEvent.click(receive()); await settle(); expect(writes[2].claim_key).not.toBe(writes[0].claim_key); expect(receipts.size).toBe(2);
  });
  it('retains the same identity across unmount and reload after an uncertain response', async () => {
    const { view, writes, receipts } = await setup(); fireEvent.click(receive()); await settle(); view.unmount();
    render(<Coupons />); await settle(); fireEvent.click(receive()); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key); expect(receipts.size).toBe(1);
  });
  it('retries the same identity when the first attempt never committed', async () => {
    const { writes, receipts } = await setup('not_committed'); fireEvent.click(receive()); await settle(); fireEvent.click(receive()); await settle();
    expect(writes[0].claim_key).toBeTruthy(); expect(writes[1].claim_key).toBe(writes[0].claim_key); expect(receipts.size).toBe(1);
  });
  it('starts a new identity after a definitive 400 rejection', async () => {
    const { writes } = await setup('rejected'); fireEvent.click(receive()); await settle(); fireEvent.click(receive()); await settle();
    expect(writes[0].claim_key).toBeTruthy(); expect(writes[1].claim_key).not.toBe(writes[0].claim_key);
  });
  it('does not reuse another account recovery state', async () => {
    const { writes } = await setup(); fireEvent.click(receive()); await settle();
    act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'other-session')); await settle(); fireEvent.click(receive()); await settle();
    expect(writes[0].claim_key).toBeTruthy(); expect(writes[1].claim_key).not.toBe(writes[0].claim_key);
  });
  it.each([408, 429, 500])('retains the receipt identity after HTTP %s', async status => {
    useAuthStore.getState().login(customer, 'claim-session'); const writes: { claim_key?: string }[] = []; const receipts = new Map<string, number>();
    api.defaults.adapter = (async config => {
      if (config.method === 'get') return { config, status: 200, statusText: 'OK', headers: {}, data: { data: [coupon], pagination: { total: 1, total_pages: 1 } } };
      const body = JSON.parse(config.data); writes.push(body); const key = body.claim_key ?? `unprotected-${writes.length}`;
      if (!receipts.has(key)) receipts.set(key, receipts.size + 1);
      if (writes.length === 1) throw new AxiosError('Uncertain', AxiosError.ERR_BAD_RESPONSE, config, undefined, { config, status, statusText: 'Uncertain', headers: {}, data: { message: 'Uncertain' } });
      return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { user_coupon_id: receipts.get(key) } } };
    }) as AxiosAdapter;
    render(<Coupons />); await settle(); fireEvent.click(receive()); await settle(); fireEvent.click(receive()); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key); expect(receipts.size).toBe(1);
  });

  it.each(['lost response', 'invalid receipt'])('recovers the last allocation after reload following a %s even though the available list no longer contains it', async failure => {
    useAuthStore.getState().login(customer, 'claim-session'); let receipt = 0; const writes: { claim_key?: string }[] = [];
    api.defaults.adapter = (async config => {
      if (config.method === 'get') return { config, status: 200, statusText: 'OK', headers: {}, data: { data: receipt ? [] : [{ ...coupon, remain_quantity: 1 }], pagination: { total: receipt ? 0 : 1, total_pages: receipt ? 0 : 1 } } };
      const body = JSON.parse(config.data); writes.push(body);
      if (!receipt) {
        receipt = 7;
        if (failure === 'lost response') throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
        return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { user_coupon_id: null } } };
      }
      return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: { user_coupon_id: receipt } } };
    }) as AxiosAdapter;
    const view = render(<Coupons />); await settle(); fireEvent.click(receive()); await settle(); view.unmount();
    render(<Coupons />); await settle(); fireEvent.click(screen.getByRole('button', { name: t('重试领取') })); await settle();
    expect(writes[1].claim_key).toBe(writes[0].claim_key); expect(receipt).toBe(7);
    expect(screen.queryByRole('button', { name: t('重试领取') })).toBeNull();
  });

  it('does not write when it cannot persist the recovery identity', async () => {
    const { writes } = await setup(); vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    fireEvent.click(receive()); await settle(); expect(writes).toHaveLength(0);
  });
  it('does not write when browser storage silently ignores the recovery identity', async () => {
    const { writes } = await setup(); vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {});
    fireEvent.click(receive()); await settle(); expect(writes).toHaveLength(0);
  });
});
