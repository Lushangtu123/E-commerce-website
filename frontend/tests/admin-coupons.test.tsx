import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import AdminCouponsPage from '@/app/admin/coupons/page';
import { adminCouponApi } from '@/lib/api';
import { apiError, render, settle } from './helpers';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-hot-toast', () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});
vi.mock('@/components/AdminLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/lib/api', () => ({
  adminCouponApi: { getList: vi.fn(), create: vi.fn(), updateStatus: vi.fn() },
}));

const active = {
  coupon_id: 3, code: 'SAVE10', name: 'Save ten', type: 1, discount_value: 10, min_amount: 50, max_discount: 0,
  total_quantity: 100, remain_quantity: 60, received_count: 40, used_count: 12, per_user_limit: 1,
  start_time: '2026-01-01T00:00:00Z', end_time: '2099-01-01T00:00:00Z', status: 1, created_at: '2026-01-01T00:00:00Z',
};
const disabled = { ...active, coupon_id: 4, code: 'OFF', name: 'Paused', type: 3, status: 0 };

const list = vi.mocked(adminCouponApi.getList);
const create = vi.mocked(adminCouponApi.create);
const updateStatus = vi.mocked(adminCouponApi.updateStatus);

async function setup(coupons: unknown[] = [active, disabled]) {
  list.mockResolvedValue({ data: coupons } as never);
  render(<AdminCouponsPage />);
  await settle();
}

const field = (label: RegExp) => screen.getByLabelText<HTMLInputElement>(label);
async function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
  await settle();
}
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const formHeading = () => screen.queryByRole('heading', { name: '创建优惠券' });

beforeEach(() => {
  localStorage.setItem('admin_session', 'admin-session');
  localStorage.setItem('admin_user', JSON.stringify({ username: 'Admin' }));
  list.mockReset();
  create.mockReset();
  updateStatus.mockReset();
});

describe('admin coupons', () => {
  it('lists each coupon with its type, value, quantities, usage and status', async () => {
    await setup();
    expect(list).toHaveBeenCalledWith(1, 50);
    const rows = screen.getAllByRole('row').slice(1).map(row => row.textContent);
    expect(rows[0]).toContain('Save ten');
    expect(rows[0]).toContain('代码: SAVE10');
    expect(rows[0]).toContain('满减券');
    expect(rows[0]).toContain('¥10');
    expect(rows[0]).toContain('剩余: 60');
    expect(rows[0]).toContain('总量: 100');
    expect(rows[0]).toContain('已领: 40');
    expect(rows[0]).toContain('已用: 12');
    expect(rows[0]).toMatch(/启用禁用$/);
    expect(rows[1]).toContain('无门槛券');
    expect(rows[1]).toMatch(/禁用启用$/);
  });

  it('enables and disables a coupon, then reloads the list', async () => {
    await setup();
    updateStatus.mockResolvedValue({} as never);
    fireEvent.click(screen.getAllByRole('button', { name: '禁用' })[0]);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '启用' }));
    await settle();

    expect(updateStatus.mock.calls).toEqual([[3, 0], [4, 1]]);
    expect(vi.mocked(toast.success).mock.calls).toEqual([['状态更新成功！'], ['状态更新成功！']]);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('shows the server error when a status change fails', async () => {
    await setup();
    updateStatus.mockRejectedValue(apiError('优惠券不存在'));
    fireEvent.click(screen.getAllByRole('button', { name: '禁用' })[0]);
    await settle();

    expect(toast.error).toHaveBeenCalledWith('优惠券不存在');
    expect(list).toHaveBeenCalledOnce();
  });

  it('creates a coupon from every field, closes the form, reloads and starts the next one blank', async () => {
    await setup();
    create.mockResolvedValue({} as never);
    await click('+ 创建优惠券');
    expect(formHeading()).toBeInTheDocument();

    type(/^优惠券代码/, 'summer25');
    expect(field(/^优惠券代码/)).toHaveValue('SUMMER25');
    type(/^优惠券名称/, 'Summer');
    type(/^描述/, 'Warm days');
    expect(screen.getByLabelText(/^优惠值/)).toBeInTheDocument();
    type(/^类型/, '2');
    expect(screen.queryByLabelText(/^优惠值/)).not.toBeInTheDocument();
    type(/^减免比例/, '20');
    type(/^最低消费金额/, '100');
    type(/^最大优惠金额/, '30');
    type(/^发行总量/, '500');
    type(/^每人限领/, '2');
    type(/^生效时间/, '2026-11-01T10:00');
    type(/^失效时间/, '2026-12-01T10:00');
    // happy-dom's step check rejects decimals such as 100 against step 0.01, which browsers accept.
    fireEvent.submit(screen.getByRole('button', { name: '创建' }).closest('form')!);
    await settle();

    expect(create.mock.calls).toEqual([[{
      code: 'SUMMER25', name: 'Summer', description: 'Warm days', type: 2, discount_value: 20, min_amount: 100, max_discount: 30,
      total_quantity: 500, per_user_limit: 2,
      start_time: new Date('2026-11-01T10:00').toISOString(), end_time: new Date('2026-12-01T10:00').toISOString(),
    }]]);
    expect(toast.success).toHaveBeenCalledWith('创建成功！');
    expect(formHeading()).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);

    await click('+ 创建优惠券');
    expect([/^优惠券代码/, /^优惠券名称/, /^类型/, /^优惠值/, /^发行总量/, /^每人限领/, /^生效时间/].map(label => field(label).value))
      .toEqual(['', '', '1', '0', '100', '1', '']);
  });

  it('keeps the form and its draft open when creation fails', async () => {
    await setup();
    create.mockRejectedValue(apiError('优惠券代码已存在'));
    await click('+ 创建优惠券');
    type(/^优惠券代码/, 'dup');
    type(/^优惠券名称/, 'Duplicate');
    type(/^生效时间/, '2026-11-01T10:00');
    type(/^失效时间/, '2026-12-01T10:00');
    await click('创建');

    expect(toast.error).toHaveBeenCalledWith('优惠券代码已存在');
    expect(formHeading()).toBeInTheDocument();
    expect(field(/^优惠券代码/)).toHaveValue('DUP');
    expect(list).toHaveBeenCalledOnce();
  });

  it('closes the form from cancel and keeps the draft for the next time it opens', async () => {
    await setup();
    await click('+ 创建优惠券');
    type(/^优惠券名称/, 'Draft');
    await click('取消');
    expect(formHeading()).not.toBeInTheDocument();

    await click('+ 创建优惠券');
    expect(field(/^优惠券名称/)).toHaveValue('Draft');
    expect(create).not.toHaveBeenCalled();
  });

  it('offers to create the first coupon when there are none', async () => {
    await setup([]);
    expect(screen.getByText('暂无优惠券')).toBeInTheDocument();
    await click('创建第一个优惠券');
    expect(formHeading()).toBeInTheDocument();
  });

  it('shows the server error when the list cannot load', async () => {
    list.mockRejectedValue(apiError('无权访问'));
    render(<AdminCouponsPage />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('无权访问');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.queryByText('暂无优惠券')).not.toBeInTheDocument();
  });
});
