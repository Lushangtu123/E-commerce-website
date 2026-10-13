import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import DeleteAccount from '@/components/DeleteAccount';
import { userApi } from '@/lib/api';
import { CustomerSessionChanged } from '@/lib/customer-auth-flow';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { apiError, deferred, render, settle } from './helpers';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({ userApi: { deleteAccount: vi.fn() } }));

const user = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
beforeEach(() => { useAuthStore.getState().login(user, 'session-one'); });

const confirm = () => fireEvent.click(screen.getByRole('checkbox', { name: '我已了解注销后无法恢复' }));
const typePassword = (value = 'my password') => fireEvent.change(screen.getByLabelText('输入当前密码以确认注销'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '注销账号' }));

it('requires the confirmation and the password before sending anything', async () => {
  render(<DeleteAccount />);
  typePassword(); submit(); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('请确认已了解注销的后果');
  confirm(); typePassword(''); submit(); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('请输入密码');
  expect(userApi.deleteAccount).not.toHaveBeenCalled();
});

it('deletes the account, signs out locally and goes home', async () => {
  vi.mocked(userApi.deleteAccount).mockResolvedValue({ message: '账号已注销' });
  render(<DeleteAccount />);
  confirm(); typePassword(); submit(); await settle();
  expect(userApi.deleteAccount).toHaveBeenCalledWith('my password', expect.any(Function));
  expect(toast.success).toHaveBeenCalledWith('账号已注销');
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(router.push).toHaveBeenCalledWith('/');
});

it('shows a refusal and keeps the customer signed in', async () => {
  vi.mocked(userApi.deleteAccount).mockRejectedValue(Object.assign(apiError('有未完成的订单或售后，处理完成后才能注销账号'), { response: { status: 409, data: { error: '有未完成的订单或售后，处理完成后才能注销账号' } } }));
  render(<DeleteAccount />);
  confirm(); typePassword(); submit(); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('有未完成的订单或售后，处理完成后才能注销账号');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  act(() => useLocaleStore.setState({ locale: 'en' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Finish your open orders and after-sales requests before deleting the account');
});

it('treats a lost reply as possibly deleted: signs out and never resends the password', async () => {
  vi.mocked(userApi.deleteAccount).mockRejectedValue(new Error('Network Error'));
  render(<DeleteAccount />);
  confirm(); typePassword(); submit(); await settle();
  expect(userApi.deleteAccount).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('注销结果尚未确认，请尝试重新登录；无法登录说明账号已注销');
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(router.push).toHaveBeenCalledWith('/login');
});

it('sends one request at a time', async () => {
  const pending = deferred<{ message: string }>();
  vi.mocked(userApi.deleteAccount).mockReturnValue(pending.promise);
  render(<DeleteAccount />);
  confirm(); typePassword(); submit();
  const busy = screen.getByRole('button', { name: '处理中...' });
  expect(busy).toBeDisabled();
  fireEvent.submit(busy.closest('form')!);
  expect(userApi.deleteAccount).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ message: '账号已注销' })); await settle();
});

it('reports a session change instead of acting on another account', async () => {
  vi.mocked(userApi.deleteAccount).mockRejectedValue(new CustomerSessionChanged());
  render(<DeleteAccount />);
  confirm(); typePassword(); submit(); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('登录状态已变化，请刷新后重试');
  expect(router.push).not.toHaveBeenCalled();
});
