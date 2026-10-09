import { act, fireEvent, screen } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAfterSalesPage from '@/app/admin/after-sales/page';
import AdminOrdersPage from '@/app/admin/orders/page';
import api, { type AfterSalesRequest } from '@/lib/api';
import { CommitLog, apiError, captureHandler, deferred, render, settle, submitTogether } from './helpers';

/**
 * The administrator sign-in a request went out for. The httpOnly cookie names it to the API, so a
 * request that still carried a token header would show up here as that header instead.
 */
const sentSession = (config: { headers: { get(name: string): unknown } }) =>
  config.headers.get('Authorization') ?? `session:${localStorage.getItem('admin_session')}`;


const notices = vi.hoisted(() => [] as string[]);
// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/admin' }));
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notices.push(message); };
  const toast = { success: record, error: record };
  return { default: toast, toast };
});

interface Call { path?: string; params?: unknown; data?: unknown; authorization: unknown }

const request = (status: AfterSalesRequest['status'] = 'requested'): AfterSalesRequest =>
  ({ request_id: 7, order_id: 1, order_no: 'ORDER-1', type: 'return', reason: 'Damaged item', status, review_note: null, created_at: '2026-10-04T00:00:00Z' });
const defaults = {
  orders: { orders: [{ order_id: 1, order_no: 'ORDER-1', status: 1, total_amount: '10.00', shipping_company: null, tracking_number: null, created_at: '2026-10-04T00:00:00Z' }], pagination: { total: 1 } },
  'after-sales': { requests: [request()], pagination: { total: 1 } },
};
const pages = { orders: AdminOrdersPage, 'after-sales': AdminAfterSalesPage };

let reads: Call[] = [];
let writes: Call[] = [];
const originalAdapter = api.defaults.adapter;

interface Setup {
  list?: (call: Call) => Promise<unknown>;
  mutate?: (call: Call) => Promise<unknown>;
}

/** Signs administrator A in, answers the real API client at the transport layer and renders the page. */
async function setup(kind: keyof typeof pages, { list, mutate = async () => kind === 'orders' ? { message: '更新成功', status: 2 } : {} }: Setup = {}) {
  localStorage.setItem('admin_session', 'admin-a');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 1, username: 'Admin A' }));
  vi.stubGlobal('confirm', () => true);
  const adapter: AxiosAdapter = async config => {
    const call = { path: config.url, params: config.params, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      authorization: sentSession(config) };
    let data;
    if (config.method === 'get') {
      reads.push(call);
      data = list ? await list(call) : defaults[kind];
    } else {
      writes.push(call);
      data = await mutate(call);
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  api.defaults.adapter = adapter;
  const Page = pages[kind];
  const commits: HTMLElement[] = [];
  const view = render(<CommitLog commits={commits}><Page /></CommitLog>);
  await settle();
  return { view, commits, rerender: () => view.rerender(<CommitLog commits={commits}><Page /></CommitLog>) };
}

/** Another administrator signs in from a different tab. */
function changeAdmin() {
  localStorage.setItem('admin_session', 'admin-b');
  localStorage.setItem('admin_user', JSON.stringify({ admin_id: 2, username: 'Admin B' }));
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'admin_session' })); });
}

const form = (root: ParentNode = document) => root.querySelector<HTMLFormElement>('form:not([role="search"])');
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

async function click(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await settle();
}

async function submit() {
  fireEvent.submit(form()!);
  await settle();
}

describe('admin fulfillment', () => {
  beforeEach(() => {
    reads = [];
    writes = [];
    notices.length = 0;
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  describe('shipping', () => {
    async function fillShipment() {
      await click('发货');
      fireEvent.change(field('shipping_company'), { target: { value: ' SF Express ' } });
      fireEvent.change(field('tracking_number'), { target: { value: ' SF123456 ' } });
    }

    it('requires both fields before the legal transition and deduplicates status updates', async () => {
      const pending = deferred();
      await setup('orders', { mutate: () => pending.promise });
      await click('发货');
      await submit();
      expect(writes).toEqual([]);
      expect(notices).toContain('请填写有效的快递公司和运单号');

      await fillShipment();
      submitTogether(form()!, form()!);
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe('/admin/orders/1/status');
      expect(writes[0].data).toEqual({ status: 2, shipping_company: 'SF Express', tracking_number: 'SF123456' });
      expect(writes[0].authorization).toBe('session:admin-a');
      await settle();
      expect(screen.getByRole('button', { name: '确认发货' })).toBeDisabled();

      await act(async () => pending.resolve({ message: '更新成功', status: 2 }));
      await settle();
      expect(notices).toContain('订单状态已更新');
    });

    it('drops the draft and the stale handler when another administrator signs in', async () => {
      const { commits } = await setup('orders');
      await fillShipment();
      const staleSubmit = captureHandler(form()!, 'onSubmit');
      const before = commits.length;

      changeAdmin();
      expect(form(commits[before])).toBeNull();
      await staleSubmit();
      expect(writes).toEqual([]);

      await settle();
      await click('发货');
      expect(field('shipping_company')).toHaveValue('');
      expect(field('tracking_number')).toHaveValue('');
    });

    const lateCases = (['storage', 'unmount'] as const).flatMap(change =>
      (['success', 'failure'] as const).map(outcome => ({ change, outcome })));

    it.each(lateCases)('neither refreshes nor notifies on a late $outcome after a $change change', async ({ change, outcome }) => {
      const pending = deferred();
      const { view } = await setup('orders', { mutate: () => pending.promise });
      await fillShipment();
      fireEvent.submit(form()!);

      if (change === 'storage') localStorage.setItem('admin_session', 'admin-b');
      else view.unmount();
      const readCount = reads.length;
      await act(async () => {
        if (outcome === 'success') pending.resolve({ message: '更新成功', status: 2 });
        else pending.reject(apiError('Old shipping failure'));
      });
      await settle();

      expect(reads).toHaveLength(readCount);
      expect(notices).toEqual([]);
    });
  });

  describe('after-sales review', () => {
    async function fillReview(decision: '通过审核' | '拒绝申请' = '通过审核') {
      await click(decision);
      fireEvent.change(document.querySelector('textarea')!, { target: { value: ' Contact the customer to arrange follow-up ' } });
    }

    it('reviews by request_id, requires a note and states that approval refunds no money', async () => {
      const pending = deferred();
      await setup('after-sales', { mutate: () => pending.promise });
      expect(screen.getByText(/不会自动退款/)).toBeInTheDocument();
      await click('通过审核');
      await submit();
      expect(writes).toEqual([]);
      expect(notices).toContain('请填写1至500个字符的审核说明');

      await fillReview();
      submitTogether(form()!, form()!);
      expect(writes).toHaveLength(1);
      expect(writes[0].path).toBe('/admin/after-sales/7/review');
      expect(writes[0].data).toEqual({ status: 'approved', note: 'Contact the customer to arrange follow-up' });
      expect(writes[0].authorization).toBe('session:admin-a');

      await act(async () => pending.resolve({}));
      await settle();
      expect(notices.at(-1)).toBe('售后审核已保存，未执行资金退款');
    });

    it.each(['filter', 'account', 'storage'] as const)('clears the draft and invalidates the old handler after a %s change', async (change) => {
      const { rerender } = await setup('after-sales');
      await fillReview('拒绝申请');
      const staleSubmit = captureHandler(form()!, 'onSubmit');

      if (change === 'filter') fireEvent.change(screen.getByRole('combobox', { name: '审核状态' }), { target: { value: 'rejected' } });
      if (change === 'account') changeAdmin();
      if (change === 'storage') localStorage.setItem('admin_session', 'admin-b');
      await staleSubmit();
      expect(writes).toEqual([]);

      act(() => rerender());
      expect(form()).toBeNull();
    });

    it('neither refreshes nor notifies a replacement administrator when an old review finishes', async () => {
      const pending = deferred();
      await setup('after-sales', { mutate: () => pending.promise });
      await fillReview();
      fireEvent.submit(form()!);
      changeAdmin();
      await settle();
      const readCount = reads.length;

      await act(async () => pending.resolve({}));
      await settle();

      expect(reads).toHaveLength(readCount);
      expect(notices).toEqual([]);
    });

    it('shows the review_note of a reviewed request and offers no decision', async () => {
      await setup('after-sales', { list: async () => ({ requests: [{ ...request('rejected'), review_note: 'Merchant note' }], pagination: { total: 1 } }) });

      expect(screen.getByText(/Merchant note/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '通过审核' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '拒绝申请' })).not.toBeInTheDocument();
    });
  });
});
