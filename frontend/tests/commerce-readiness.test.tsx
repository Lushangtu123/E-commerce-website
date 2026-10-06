import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrdersPage from '@/app/orders/page';
import { orderApi, paymentApi, type PaymentSettings } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { render, settle } from './helpers';

// Next returns the same router on every render; pages list it as an effect dependency.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const notices = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const record = (message: string) => { notices.push(message); };
  const toast = { success: record, error: record };
  return { default: toast, toast };
});
vi.mock('@/lib/api', () => ({
  paymentApi: { getSettings: vi.fn() },
  orderApi: {
    list: vi.fn(async () => ({ orders: [{ order_id: 1, order_no: 'ORDER-1', status: 0, total_amount: 10, created_at: '2026-10-02T00:00:00Z' }], total: 1, page: 1, limit: 10, totalPages: 1 })),
    pay: vi.fn(async () => ({})),
  },
}));

async function setup(getSettings: () => Promise<PaymentSettings>) {
  useAuthStore.getState().login({ user_id: 1, username: 'Customer', email: 'c@test' }, 'session');
  vi.mocked(paymentApi.getSettings).mockImplementation(getSettings);
  render(<OrdersPage />);
  await settle();
}

describe('payment readiness', () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it.each([
    ['disabled', async () => ({ mode: 'disabled', canPay: false, isDemo: false } as PaymentSettings)],
    ['unavailable', async () => { throw new Error('Offline'); }],
    ['inconsistent', async () => ({ mode: 'disabled', canPay: true, isDemo: false } as PaymentSettings)],
  ])('exposes no payment action when settings are %s', async (_, getSettings) => {
    await setup(getSettings);

    expect(screen.queryByRole('button', { name: '立即支付' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '模拟支付' })).not.toBeInTheDocument();
    expect(screen.getByText(/暂未开通在线支付/)).toBeInTheDocument();
    expect(orderApi.pay).not.toHaveBeenCalled();
  });

  it('labels the explicit demo action and its success without suggesting money was collected', async () => {
    await setup(async () => ({ mode: 'demo', canPay: true, isDemo: true }));
    expect(screen.getByText(/不会实际扣款/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即支付' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '模拟支付' }));
    await settle();

    expect(vi.mocked(orderApi.pay).mock.calls).toEqual([[1]]);
    expect(notices).toEqual(['模拟支付完成，未实际扣款']);
  });
});
