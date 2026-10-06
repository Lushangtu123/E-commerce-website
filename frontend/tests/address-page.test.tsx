import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddressPage from '@/app/profile/address/page';
import { addressApi, type ShippingAddress } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { CommitLog, apiError, captureHandler, clickTogether, deferred, render, settle, submitTogether } from './helpers';

const notifications = vi.hoisted(() => [] as string[]);
// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile/address' }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notifications.push(message); };
  const toast = { error: record, success: record };
  return { default: toast, toast };
});
vi.mock('@/lib/api', () => ({ addressApi: { list: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) } }));

type List = { addresses: ShippingAddress[] };
const customer = { user_id: 1, username: 'one', email: 'one@test' };
// user_id is not part of the client type, but the server sends it and it must never be echoed back.
const address = { address_id: 41, receiver_name: 'Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: false, user_id: 1 } as ShippingAddress;
const fields = ['receiver_name', 'phone', 'province', 'city', 'district', 'detail_address'] as const;

async function setup(list: () => Promise<List> = async () => ({ addresses: [address] }), confirm = () => true) {
  useAuthStore.getState().login(customer, 'one');
  vi.stubGlobal('confirm', confirm);
  vi.mocked(addressApi.list).mockImplementation(list);
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><AddressPage /></CommitLog>);
  await settle();
  return { view, commits };
}

const secondCustomer = { ...customer, user_id: 2 };
const switchAccount = () => act(() => useAuthStore.getState().login(secondCustomer, 'two'));
const input = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const form = () => document.querySelector('form')!;
const writes = () => [
  ...vi.mocked(addressApi.create).mock.calls.map(([body]) => ({ method: 'create', body })),
  ...vi.mocked(addressApi.update).mock.calls.map(([id, body]) => ({ method: 'update', id, body })),
  ...vi.mocked(addressApi.remove).mock.calls.map(([id]) => ({ method: 'remove', id })),
];

async function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await settle();
}

async function submit() {
  fireEvent.submit(form());
  await settle();
}

describe('address management', () => {
  beforeEach(() => {
    notifications.length = 0;
  });

  it('adds, edits, sets default and deletes with the owned full fields only', async () => {
    await setup();
    expect(screen.getByText(/Receiver/)).toBeInTheDocument();

    await click('新增地址');
    for (const name of fields) fireEvent.change(input(name), { target: { value: address[name] } });
    fireEvent.click(input('is_default'));
    await submit();
    expect(addressApi.create).toHaveBeenCalledWith({ receiver_name: 'Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: true });

    await click('编辑');
    fireEvent.change(input('detail_address'), { target: { value: '文一路 2 号' } });
    await submit();
    const [id, body] = vi.mocked(addressApi.update).mock.calls[0];
    expect(id).toBe(41);
    expect(body.detail_address).toBe('文一路 2 号');
    expect(body).not.toHaveProperty('user_id');
    expect(body).not.toHaveProperty('address_id');

    await click('设为默认');
    expect(vi.mocked(addressApi.update).mock.calls[1][1]).toMatchObject({ is_default: true, receiver_name: 'Receiver' });

    await click('删除');
    expect(addressApi.remove).toHaveBeenCalledWith(41);
  });

  it('blocks writes for missing fields and an invalid phone with actionable messages', async () => {
    await setup();
    await click('新增地址');

    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('请填写');
    expect(writes()).toEqual([]);

    for (const name of fields) fireEvent.change(input(name), { target: { value: name === 'phone' ? '123' : address[name] } });
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('7 至 15');
    expect(writes()).toEqual([]);
  });

  it('retries a failed list and keeps an edit open for correction after a server validation error', async () => {
    let calls = 0;
    await setup(async () => {
      if (++calls === 1) throw new Error('Unavailable');
      return { addresses: [address] };
    });
    vi.mocked(addressApi.update).mockRejectedValue(apiError('最多保存20个地址'));
    expect(screen.getByText(/加载收货地址失败/)).toBeInTheDocument();

    await click('重新加载地址');
    await click('编辑');
    await submit();

    expect(screen.getByText(/最多保存20个地址/)).toBeInTheDocument();
    expect(input('receiver_name')).toHaveValue(address.receiver_name);
  });

  it('hides old addresses at once when the account changes and ignores a late list', async () => {
    const first = deferred<List>();
    let calls = 0;
    const { commits } = await setup(() => ++calls === 1 ? first.promise
      : Promise.resolve({ addresses: [{ ...address, address_id: 42, receiver_name: 'Second Receiver' }] }));

    const before = commits.length;
    act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'two'));
    expect(commits[before].textContent).not.toContain('Receiver');
    await settle();
    expect(screen.getByText(/Second Receiver/)).toBeInTheDocument();

    await act(async () => first.resolve({ addresses: [address] }));
    await settle();
    expect(screen.getByText(/Second Receiver/)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  const lateCases = (['account', 'storage', 'unmount'] as const).flatMap(change =>
    (['success', 'failure'] as const).map(outcome => ({ change, outcome })));

  it.each(lateCases)('neither refreshes nor reports a late $outcome after a $change change', async ({ change, outcome }) => {
    const pending = deferred();
    const { view } = await setup();
    vi.mocked(addressApi.update).mockReturnValue(pending.promise as never);
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }));

    if (change === 'account') {
      act(() => useAuthStore.getState().login({ ...customer, user_id: 2 }, 'two'));
      await settle();
    }
    if (change === 'storage') localStorage.setItem('session', 'two');
    if (change === 'unmount') view.unmount();
    const lists = vi.mocked(addressApi.list).mock.calls.length;
    await act(async () => {
      if (outcome === 'success') pending.resolve({});
      else pending.reject(apiError('旧地址错误'));
    });
    await settle();

    expect(addressApi.list).toHaveBeenCalledTimes(lists);
    expect(notifications).toEqual([]);
  });

  it("cannot send a mutation for another tab's customer from a stale form", async () => {
    await setup();
    await click('编辑');
    const staleSubmit = captureHandler(form(), 'onSubmit');
    localStorage.setItem('session', 'two');

    await staleSubmit();

    expect(writes()).toEqual([]);
  });

  it('edits legacy NULL regions as blank required fields without crashing or sending incomplete data', async () => {
    await setup(async () => ({ addresses: [{ ...address, province: null, city: null, district: null }] }));
    await click('编辑');
    for (const name of ['province', 'city', 'district']) expect(input(name)).toHaveValue('');

    await submit();

    expect(screen.getByRole('alert')).toHaveTextContent('请填写省份');
    expect(writes()).toEqual([]);
  });

  it('refreshes the list after a successful change', async () => {
    let defaulted = false;
    vi.mocked(addressApi.update).mockImplementation(async () => { defaulted = true; return {} as never; });
    await setup(async () => ({ addresses: [{ ...address, is_default: defaulted }] }));
    expect(screen.queryByText('默认地址')).not.toBeInTheDocument();

    await click('设为默认');

    expect(addressApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByText('默认地址')).toBeInTheDocument();
    expect(notifications).toEqual(['默认地址已更新']);
  });

  it('sends one change for a double click or a double submit', async () => {
    const pending = deferred();
    await setup();
    vi.mocked(addressApi.update).mockReturnValue(pending.promise as never);

    const setDefault = screen.getByRole('button', { name: '设为默认' });
    clickTogether(setDefault, setDefault);
    expect(writes()).toHaveLength(1);
    await act(async () => pending.resolve({}));
    await settle();

    await click('编辑');
    submitTogether(form(), form());
    expect(writes()).toHaveLength(2);
  });

  it("closes the previous customer's open form when the account changes", async () => {
    await setup(async () => ({ addresses: [useAuthStore.getState().user?.user_id === 2 ? { ...address, address_id: 42, receiver_name: 'Second Receiver' } : address] }));
    await click('编辑');
    expect(input('receiver_name')).toHaveValue('Receiver');

    switchAccount();
    await settle();

    expect(screen.getByText(/Second Receiver/)).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });

  it("lets the next customer act while the previous customer's change is pending, and keeps the next customer's own lock", async () => {
    const previous = deferred();
    const next = deferred();
    await setup();
    vi.mocked(addressApi.update).mockReturnValueOnce(previous.promise as never).mockReturnValueOnce(next.promise as never);
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }));

    switchAccount();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '设为默认' }));
    expect(writes()).toHaveLength(2);

    await act(async () => previous.resolve({}));
    await settle();
    // The finished change belongs to the previous customer; the next customer's change still holds the lock.
    await captureHandler(screen.getByRole('button', { name: '设为默认' }))();
    expect(writes()).toHaveLength(2);
  });

  it("neither opens a form, asks, nor sends a change for the customer another tab signed in", async () => {
    const confirm = vi.fn(() => true);
    await setup(undefined, confirm);
    localStorage.setItem('session', 'two');

    for (const name of ['新增地址', '编辑']) {
      fireEvent.click(screen.getByRole('button', { name }));
      await settle();
      expect(document.querySelector('form'), `${name} must not open a form`).toBeNull();
    }
    await click('删除');
    await click('设为默认');

    expect(confirm).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
