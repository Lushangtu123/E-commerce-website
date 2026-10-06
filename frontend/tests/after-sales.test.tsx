import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderAfterSales from '@/components/OrderAfterSales';
import api, { type AfterSalesRequest } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

type Response = { after_sales: AfterSalesRequest | null };
type Write = { id: number; data?: unknown; action?: 'withdraw' };

const customer = { user_id: 1, username: 'Customer', email: 'customer@test' };
const replacement = { user_id: 2, username: 'Replacement', email: 'replacement@test' };
const request = (status: AfterSalesRequest['status'] = 'requested', reason = 'Damaged item'): AfterSalesRequest =>
  ({ request_id: 7, order_id: 1, order_no: 'ORDER-1', type: 'return', reason, status, review_note: null, created_at: '2026-10-04T00:00:00Z' });

let reads: { id: number; authorization: unknown }[] = [];
let writes: Write[] = [];
const originalAdapter = api.defaults.adapter;

interface Setup {
  get?: () => Promise<Response>;
  create?: () => Promise<Response>;
  withdraw?: () => Promise<Response>;
}

/** Signs the customer in, answers the real API client at the transport layer and renders order 1's section. */
async function setup({ get = async () => ({ after_sales: null }), create = async () => ({ after_sales: request() }),
  withdraw = async () => ({ after_sales: request('withdrawn') }) }: Setup = {}) {
  useAuthStore.getState().login(customer, 'session-a');
  const adapter: AxiosAdapter = async config => {
    let data: Response;
    if (config.method === 'get') {
      reads.push({ id: 1, authorization: config.headers.get('Authorization') });
      data = await get();
    } else if (config.url?.endsWith('/withdraw')) {
      writes.push({ id: 1, action: 'withdraw' });
      data = await withdraw();
    } else {
      writes.push({ id: 1, data: JSON.parse(config.data) });
      data = await create();
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const view = render(<OrderAfterSales orderId={1} />);
  await settle();
  return view;
}

const form = () => document.querySelector('form');
const reasonField = () => document.querySelector('textarea')!;
const withdrawButton = () => screen.queryByRole('button', { name: '撤回申请' });

function fillRequest(reason = ' Damaged item ') {
  fireEvent.change(document.querySelector('select')!, { target: { value: 'return' } });
  fireEvent.change(reasonField(), { target: { value: reason } });
}

async function submit() {
  fireEvent.submit(form()!);
  await settle();
}

describe('customer after-sales', () => {
  beforeEach(() => {
    reads = [];
    writes = [];
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it('submits a normalized request once, shows the canonical status and withdraws without claiming a refund', async () => {
    await setup();
    fillRequest();
    await submit();

    expect(writes).toEqual([{ id: 1, data: { type: 'return', reason: 'Damaged item' } }]);
    expect(screen.getByText('审核状态：待审核')).toBeInTheDocument();
    expect(screen.getByText(/不会自动退款/)).toBeInTheDocument();
    expect(form()).toBeNull();

    fireEvent.click(withdrawButton()!);
    await settle();
    expect(writes.at(-1)).toEqual({ id: 1, action: 'withdraw' });
    expect(screen.getByText('审核状态：已撤回')).toBeInTheDocument();
    expect(withdrawButton()).toBeNull();
    expect(form()).toBeNull();
  });

  it.each(['approved', 'rejected', 'withdrawn'] as const)('shows the review note of a %s request without offering another application or withdrawal', async (status) => {
    await setup({ get: async () => ({ after_sales: { ...request(status), review_note: 'Please contact support' } }) });

    expect(screen.getByText(/Please contact support/)).toBeInTheDocument();
    expect(form()).toBeNull();
    expect(withdrawButton()).toBeNull();
    if (status === 'approved') expect(screen.getByText('审核状态：审核通过')).toBeInTheDocument();
  });

  it('blocks a duplicate submission while saving and keeps the draft when the server fails', async () => {
    const pending = deferred<Response>();
    await setup({ create: () => pending.promise });
    fillRequest();

    submitTogether(form()!, form()!);
    expect(writes).toHaveLength(1);
    await settle();
    expect(reasonField()).toBeDisabled();

    await act(async () => pending.reject(apiError('提交售后申请失败')));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('提交售后申请失败');
    expect(reasonField()).toHaveValue(' Damaged item ');
    expect(screen.getByRole('button', { name: '提交申请' })).toBeEnabled();
  });

  it.each(['', ' ', 'x'.repeat(501)])('refuses an invalid reason (%#)', async (reason) => {
    await setup();
    fillRequest(reason);
    await submit();
    expect(writes).toEqual([]);
  });

  it("cannot submit the previous account's form after the account changes", async () => {
    await setup();
    fillRequest();
    const staleSubmit = captureHandler(form()!, 'onSubmit');

    act(() => useAuthStore.getState().login(replacement, 'session-b'));
    await staleSubmit();

    expect(writes).toEqual([]);
  });

  it('cannot submit after another browser tab changes the token', async () => {
    await setup();
    fillRequest();
    localStorage.setItem('token', 'session-b');

    await submit();

    expect(writes).toEqual([]);
  });

  it("hides the previous account's record and ignores its delayed response", async () => {
    const old = deferred<Response>();
    await setup({ get: () => useAuthStore.getState().token === 'session-a' ? old.promise
      : Promise.resolve({ after_sales: request('approved', 'Replacement request') }) });

    act(() => useAuthStore.getState().login(replacement, 'session-b'));
    expect(screen.queryByText(/Damaged item/)).not.toBeInTheDocument();
    await settle();
    expect(screen.getByText(/Replacement request/)).toBeInTheDocument();

    await act(async () => old.resolve({ after_sales: request() }));
    await settle();
    expect(screen.queryByText(/Damaged item/)).not.toBeInTheDocument();
    expect(screen.getByText(/Replacement request/)).toBeInTheDocument();
    expect(reads.map(read => read.authorization)).toEqual(['Bearer session-a', 'Bearer session-b']);
  });

  const lateCases = (['account', 'storage', 'unmount'] as const).flatMap(change =>
    (['success', 'failure'] as const).map(outcome => ({ change, outcome })));

  it.each(lateCases)('publishes nothing from a late $outcome after a $change change', async ({ change, outcome }) => {
    const pending = deferred<Response>();
    const view = await setup({ create: () => pending.promise });
    fillRequest();
    fireEvent.submit(form()!);

    if (change === 'account') {
      act(() => useAuthStore.getState().login(replacement, 'session-b'));
      await settle();
    }
    if (change === 'storage') localStorage.setItem('token', 'session-b');
    if (change === 'unmount') view.unmount();
    const readCount = reads.length;

    await act(async () => {
      if (outcome === 'success') pending.resolve({ after_sales: request() });
      else pending.reject(apiError('Old request failure'));
    });
    await settle();

    expect(reads).toHaveLength(readCount);
    expect(screen.queryByText('Old request failure')).not.toBeInTheDocument();
    expect(screen.queryByText(/售后申请已提交/)).not.toBeInTheDocument();
  });
});
