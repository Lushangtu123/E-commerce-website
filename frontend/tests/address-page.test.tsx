import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddressPage from '@/app/profile/address/page';
import { addressApi, type ShippingAddress } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useQueryClient } from '@tanstack/react-query';
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
vi.mock('@/lib/api', () => ({ addressApi: { list: vi.fn(), create: vi.fn(async () => ({ address_id: 88, creation_status: 'created' })), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) } }));

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

  const fillNew = async () => {
    await click('新增地址');
    for (const name of fields) fireEvent.change(input(name), { target: { value: address[name] } });
  };
  const unavailable = (status?: number) => Object.assign(new Error('network unavailable'), status ? { response: { status, data: { error: '暂时不可用' } } } : {});

  it('keeps the original creation UUID and payload after an unknown result and recovers explicitly after refresh', async () => {
    const { view } = await setup();
    vi.mocked(addressApi.create).mockRejectedValueOnce(unavailable()).mockResolvedValue({ address_id: 88, creation_status: 'replayed' });
    await fillNew();
    await submit();
    const first = vi.mocked(addressApi.create).mock.calls[0][0];
    expect(first).toMatchObject({ create_key: expect.stringMatching(/^[a-f0-9-]{36}$/), receiver_name: 'Receiver' });
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    expect(input('receiver_name')).toBeDisabled();
    expect(notifications).not.toContain('地址已添加');
    view.unmount();
    await setup();
    expect(addressApi.create).toHaveBeenCalledTimes(1);
    await click('恢复新增地址');
    expect(addressApi.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addressApi.create).mock.calls[1][0]).toEqual(first);
    expect(screen.getByRole('button', { name: '新增地址' })).toBeEnabled();
  });

  it.each([408, 429, 409, 500, 502])('keeps creation identity and fields locked on status %i', async status => {
    await setup();
    vi.mocked(addressApi.create).mockRejectedValue(unavailable(status));
    await fillNew(); await submit();
    expect(screen.getByRole('button', { name: '恢复新增地址' })).toBeEnabled();
    expect(input('detail_address')).toBeDisabled();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
  });

  it('releases a first validation rejection for correction but a 400 after uncertainty keeps the original intent', async () => {
    await setup(); await fillNew();
    vi.mocked(addressApi.create).mockRejectedValueOnce(apiError('地址字段无效'));
    await submit();
    expect(input('receiver_name')).toBeEnabled();
    fireEvent.change(input('receiver_name'), { target: { value: 'Corrected' } });
    vi.mocked(addressApi.create).mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(apiError('地址字段无效'));
    await submit();
    const attempt = vi.mocked(addressApi.create).mock.calls[1][0];
    await click('恢复新增地址');
    expect(vi.mocked(addressApi.create).mock.calls[2][0]).toEqual(attempt);
    expect(input('receiver_name')).toBeDisabled();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
  });

  it('does not treat an invalid 200 body as confirmed creation and does not guess from similar list rows', async () => {
    await setup(); await fillNew();
    vi.mocked(addressApi.create).mockResolvedValue({ address_id: 0 } as never);
    await submit();
    expect(screen.getByRole('button', { name: '恢复新增地址' })).toBeEnabled();
    expect(notifications).not.toContain('地址已添加');
  });

  it('accepts a deleted receipt without recreating the old address', async () => {
    await setup(); await fillNew();
    vi.mocked(addressApi.create).mockRejectedValueOnce(unavailable()).mockResolvedValueOnce({ address_id: 88, creation_status: 'deleted' });
    await submit(); await click('恢复新增地址');
    expect(screen.getByRole('button', { name: '新增地址' })).toBeEnabled();
    expect(notifications).not.toContain('地址已添加');
    expect(screen.getByText('原新增地址已删除，可重新添加地址')).toBeInTheDocument();
  });

  it('verifies an uncertain edit with canonical GET, preserves the draft, and only retries reads after GET failure', async () => {
    let lists = 0;
    await setup(async () => {
      if (++lists === 2) throw unavailable();
      return { addresses: [{ ...address, detail_address: lists >= 3 ? '服务端最新地址' : address.detail_address }] };
    });
    await click('编辑');
    fireEvent.change(input('detail_address'), { target: { value: '需要纠正的草稿' } });
    vi.mocked(addressApi.update).mockRejectedValue(unavailable());
    await submit();
    expect(addressApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    expect(input('detail_address')).toBeDisabled();
    await click('重新核对地址');
    expect(addressApi.update).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/服务端最新地址/)).toBeInTheDocument();
    expect(input('detail_address')).toHaveValue('需要纠正的草稿');
    expect(input('detail_address')).toBeEnabled();
    expect(notifications).not.toContain('地址已更新');
  });

  it('does not report success when the successful write cannot refresh the canonical list', async () => {
    let calls = 0;
    await setup(async () => {
      if (++calls > 1) throw unavailable();
      return { addresses: [address] };
    });
    await click('设为默认');
    expect(addressApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '重新核对地址' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    expect(notifications).not.toContain('默认地址已更新');
  });

  it('blocks the delete accepted after another action has acquired the creation recovery lock', async () => {
    await setup();
    const confirmation = deferred<boolean>();
    vi.stubGlobal('confirm', () => confirmation.promise);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await fillNew();
    vi.mocked(addressApi.create).mockRejectedValue(unavailable());
    await submit();
    await act(async () => { confirmation.resolve(true); await Promise.resolve(); });
    await settle();
    expect(addressApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '恢复新增地址' })).toBeEnabled();
  });

  it('does not allow an old save handler to write while canonical verification is still required', async () => {
    let calls = 0;
    await setup(async () => {
      if (++calls > 1) throw unavailable();
      return { addresses: [address] };
    });
    await click('编辑');
    const savedHandler = captureHandler(form(), 'onSubmit');
    vi.mocked(addressApi.update).mockRejectedValue(unavailable());
    await submit();
    await savedHandler();
    await settle();
    expect(addressApi.update).toHaveBeenCalledTimes(1);
  });

  it('cancels an old query refresh so it cannot overwrite the canonical list after a write', async () => {
    const oldRead = deferred<List>();
    let calls = 0;
    useAuthStore.getState().login(customer, 'one');
    vi.mocked(addressApi.list).mockImplementation(() => {
      if (++calls === 2) return oldRead.promise;
      return Promise.resolve({ addresses: [{ ...address, detail_address: calls > 2 ? '刚核对的最新地址' : '旧地址' }] });
    });
    function RefreshQuery() {
      const client = useQueryClient();
      return <button onClick={() => client.refetchQueries({ queryKey: ['addresses', 'one', 1], exact: true })}>后台刷新</button>;
    }
    render(<><AddressPage /><RefreshQuery /></>);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '后台刷新' }));
    await settle();
    await click('设为默认');
    expect(screen.getByText(/刚核对的最新地址/)).toBeInTheDocument();
    await act(() => oldRead.resolve({ addresses: [{ ...address, detail_address: '旧后台结果' }] }));
    await settle();
    expect(screen.getByText(/刚核对的最新地址/)).toBeInTheDocument();
    expect(screen.queryByText(/旧后台结果/)).not.toBeInTheDocument();
  });

  const seedPendingCreation = () => sessionStorage.setItem('pending-address-create:one:1', JSON.stringify({
    key: '861dc7fb-0207-4b9a-98c3-95e6d28acb28', uncertain: true,
    input: { receiver_name: address.receiver_name, phone: address.phone, province: address.province,
      city: address.city, district: address.district, detail_address: address.detail_address, is_default: false },
  }));

  it('blocks reload during canonical recovery so a late query cannot replace the confirmed list', async () => {
    seedPendingCreation();
    const canonical = deferred<List>(), competing = deferred<List>();
    let reads = 0;
    await setup(async () => {
      if (++reads === 1) throw unavailable();
      return reads === 2 ? canonical.promise : competing.promise;
    });
    vi.mocked(addressApi.create).mockResolvedValue({ address_id: 88, creation_status: 'replayed' });
    fireEvent.click(screen.getByRole('button', { name: '恢复新增地址' }));
    await settle();
    expect(addressApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '重新加载地址' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新加载地址' }));
    await settle();
    await act(async () => { canonical.resolve({ addresses: [{ ...address, detail_address: '已确认的最新地址' }] }); });
    await settle();
    await act(async () => { competing.resolve({ addresses: [{ ...address, detail_address: '恢复期间的旧列表' }] }); });
    await settle();
    expect(screen.getByText(/已确认的最新地址/)).toBeInTheDocument();
    expect(screen.queryByText(/恢复期间的旧列表/)).not.toBeInTheDocument();
    expect(addressApi.list).toHaveBeenCalledTimes(2);
  });

  it('guards a reload event before the busy state has disabled its DOM button', async () => {
    seedPendingCreation();
    let reads = 0;
    await setup(async () => {
      if (++reads === 1) throw unavailable();
      return { addresses: [address] };
    });
    clickTogether(screen.getByRole('button', { name: '恢复新增地址' }), screen.getByRole('button', { name: '重新加载地址' }));
    await settle();
    expect(addressApi.create).toHaveBeenCalledTimes(1);
    expect(addressApi.list).toHaveBeenCalledTimes(2);
  });

  it('blocks a fresh creation before POST if its recovery identity cannot be stored', async () => {
    await setup(); await fillNew();
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    await submit();
    expect(addressApi.create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    expect(input('receiver_name')).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新读取新增地址' })).toBeEnabled();
  });

  it('does not discard a corrupt persisted identity or allow a new address after refresh', async () => {
    sessionStorage.setItem('pending-address-create:one:1', '{broken');
    await setup();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    await click('重新读取新增地址');
    expect(sessionStorage.getItem('pending-address-create:one:1')).toBe('{broken');
    expect(writes()).toEqual([]);
  });

  it('persists uncertainty before the first POST settles so a refresh cannot clear it on a later 400', async () => {
    const first = deferred();
    const { view } = await setup(); await fillNew();
    vi.mocked(addressApi.create).mockReturnValueOnce(first.promise as never).mockRejectedValueOnce(apiError('地址字段无效'));
    fireEvent.submit(form()); await settle();
    const attempt = vi.mocked(addressApi.create).mock.calls[0][0];
    view.unmount(); await setup();
    expect(addressApi.create).toHaveBeenCalledTimes(1);
    await click('恢复新增地址');
    expect(vi.mocked(addressApi.create).mock.calls[1][0]).toEqual(attempt);
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    await act(async () => { first.resolve({ address_id: 88, creation_status: 'created' }); await Promise.resolve(); });
    expect(notifications).toEqual([]);
  });

  it('scopes a persisted creation by account and sign-in, and ignores its old recovery handler', async () => {
    await setup(); await fillNew();
    vi.mocked(addressApi.create).mockRejectedValue(unavailable()); await submit();
    const recover = captureHandler(screen.getByRole('button', { name: '恢复新增地址' }));
    switchAccount(); await settle();
    expect(screen.queryByRole('button', { name: '恢复新增地址' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeEnabled();
    await recover();
    expect(addressApi.create).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.getState().login(customer, 'a-new-sign-in')); await settle();
    expect(screen.queryByRole('button', { name: '恢复新增地址' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeEnabled();
  });

  it.each(['删除', '设为默认'])('uses the latest canonical list after an uncertain %s and never repeats that write', async action => {
    let reads = 0;
    await setup(async () => ({ addresses: ++reads === 1 ? [address] : action === '删除' ? [] : [{ ...address, is_default: true }] }));
    vi.mocked(addressApi.remove).mockRejectedValue(unavailable());
    vi.mocked(addressApi.update).mockRejectedValue(unavailable());
    await click(action);
    expect(addressApi.list).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(1);
    expect(notifications).toEqual([]);
    if (action === '删除') expect(screen.queryByText(/Receiver/)).not.toBeInTheDocument();
    else expect(screen.getByText('默认地址')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增地址' })).toBeEnabled();
  });

  it('keeps writes locked if canonical GET resolves with a malformed address list', async () => {
    let reads = 0;
    await setup(async () => ++reads === 1 ? { addresses: [address] } : ({ addresses: 'invalid' } as never));
    vi.mocked(addressApi.update).mockRejectedValue(unavailable());
    await click('设为默认');
    await click('重新核对地址');
    expect(addressApi.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '新增地址' })).toBeDisabled();
    expect(notifications).toEqual([]);
  });

  it('adds, edits, sets default and deletes with the owned full fields only', async () => {
    await setup();
    expect(screen.getByText(/Receiver/)).toBeInTheDocument();

    await click('新增地址');
    for (const name of fields) fireEvent.change(input(name), { target: { value: address[name] } });
    fireEvent.click(input('is_default'));
    await submit();
    expect(addressApi.create).toHaveBeenCalledWith({ receiver_name: 'Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: true, create_key: expect.stringMatching(/^[a-f0-9-]{36}$/) });

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

  it.each([
    ['the customer declines', () => false],
    ['another tab signs in while the question is open', () => { localStorage.setItem('session', 'two'); return true; }],
  ])('keeps the address when %s', async (_, answer) => {
    const confirm = vi.fn(answer);
    await setup(undefined, confirm);
    await click('删除');
    expect(confirm).toHaveBeenCalledWith('确定删除这个收货地址吗？');
    expect(writes()).toEqual([]);
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
