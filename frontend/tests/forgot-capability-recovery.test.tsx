import { act, fireEvent, render as renderRoot, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '@/app/forgot-password/page';
import { userApi } from '@/lib/api';
import { captureHandler, deferred, render, settle } from './helpers';

vi.mock('@/lib/api', () => ({ userApi: { passwordCapabilities: vi.fn(), forgotPassword: vi.fn(async () => ({})) } }));

const submit = () => screen.getByRole('button', { name: '发送重置邮件' });
const capabilities = vi.mocked(userApi.passwordCapabilities);
type Capabilities = Awaited<ReturnType<typeof userApi.passwordCapabilities>>;
const capability = (passwordResetAvailable: boolean): Capabilities => ({ passwordResetAvailable, passwordMinLength: 12, passwordMaxBytes: 72 });

describe('forgot password capability recovery', () => {
  it('distinguishes a failed capability check from a disabled service and recovers without sending mail', async () => {
    const retry = deferred<Capabilities>();
    capabilities.mockRejectedValueOnce(Object.assign(new Error('Offline'), { response: { status: 503 } })).mockReturnValueOnce(retry.promise);
    render(<ForgotPasswordPage />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载邮件服务状态失败，请重试');
    expect(screen.queryByText('密码找回邮件服务暂不可用，请联系商家')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'customer@example.test' } });
    fireEvent.submit(document.querySelector('form')!);
    expect(userApi.forgotPassword).not.toHaveBeenCalled();
    const retryRead = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    void retryRead();
    void retryRead();
    await settle();
    expect(capabilities).toHaveBeenCalledTimes(2);
    expect(submit()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在确认邮件服务...');
    await act(async () => retry.resolve(capability(true)));
    await settle();
    expect(submit()).toBeEnabled();
    expect(screen.getByRole('textbox')).toHaveValue('customer@example.test');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(userApi.forgotPassword).not.toHaveBeenCalled();
  });

  it('keeps a genuinely disabled service unavailable and does not offer a failure retry', async () => {
    capabilities.mockResolvedValue(capability(false));
    render(<ForgotPasswordPage />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('密码找回邮件服务暂不可用，请联系商家');
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.submit(document.querySelector('form')!);
    expect(userApi.forgotPassword).not.toHaveBeenCalled();
  });

  it('keeps a repeated capability failure retryable, then recognizes the service is off', async () => {
    capabilities.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Still offline'))
      .mockResolvedValueOnce(capability(false));
    render(<ForgotPasswordPage />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('加载邮件服务状态失败，请重试');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('密码找回邮件服务暂不可用，请联系商家');
    expect(submit()).toBeDisabled();
    expect(userApi.forgotPassword).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('does not accept a late capability retry %s after unmount', async outcome => {
    const retry = deferred<Capabilities>();
    capabilities.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise);
    const view = render(<ForgotPasswordPage />);
    await settle();
    const staleRetry = captureHandler(screen.getByRole('button', { name: '重新加载' }));
    void staleRetry();
    await settle();
    view.unmount();
    await act(async () => {
      if (outcome === 'success') retry.resolve(capability(true));
      else retry.reject(new Error('Late error'));
    });
    await staleRetry();
    expect(capabilities).toHaveBeenCalledTimes(2);
    expect(userApi.forgotPassword).not.toHaveBeenCalled();
  });

  it('ignores a stale capability result from a Strict Mode effect replay', async () => {
    const first = deferred<Capabilities>();
    capabilities.mockReturnValueOnce(first.promise).mockResolvedValueOnce(capability(false));
    renderRoot(<StrictMode><ForgotPasswordPage /></StrictMode>);
    await settle();
    await act(async () => first.resolve(capability(true)));
    await settle();
    expect(capabilities).toHaveBeenCalledTimes(2);
    expect(submit()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('密码找回邮件服务暂不可用，请联系商家');
  });
});
