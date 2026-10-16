import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminTwoFactorStep, { type AdminTwoFactorView } from '@/components/AdminTwoFactorStep';
import { render, settle } from './helpers';

const toasts = vi.hoisted(() => [] as [string, string][]);
vi.mock('react-hot-toast', () => {
  const toast = { success: (message: string) => { toasts.push(['success', message]); }, error: (message: string) => { toasts.push(['error', message]); } };
  return { default: toast, toast };
});

const setupStep: AdminTwoFactorView = {
  kind: 'setup', challenge: 'c',
  setup: { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/Store:root?secret=JBSWY3DPEHPK3PXP&issuer=Store' },
};
const codes = ['aaaaa-11111', 'bbbbb-22222'];

function show(step: AdminTwoFactorView, loading = false) {
  const handlers = { onSubmitCode: vi.fn(), onFinish: vi.fn(), onRestart: vi.fn() };
  render(<AdminTwoFactorStep step={step} loading={loading} {...handlers} />);
  return handlers;
}

describe('administrator two-step verification step', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  beforeEach(() => {
    toasts.length = 0;
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('draws the QR code in the browser and copies the key', async () => {
    show(setupStep);
    await settle();

    expect(screen.getByRole('img', { name: '验证器二维码' }).getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await settle();
    expect(writeText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
    expect(toasts).toEqual([['success', '已复制']]);
    expect(screen.getByLabelText('验证码')).toHaveAttribute('inputmode', 'numeric');
  });

  it('submits a trimmed code, ignores a blank one and can go back to the password', () => {
    const handlers = show({ kind: 'verify', challenge: 'c' });

    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '   ' } });
    fireEvent.submit(document.querySelector('form')!);
    expect(handlers.onSubmitCode).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: ' aaaaa-11111 ' } });
    fireEvent.submit(document.querySelector('form')!);
    expect(handlers.onSubmitCode).toHaveBeenCalledWith('aaaaa-11111');

    fireEvent.click(screen.getByRole('button', { name: '返回重新输入密码' }));
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while a code is being checked', () => {
    show({ kind: 'verify', challenge: 'c' }, true);

    expect(screen.getByRole('button', { name: '验证中...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '返回重新输入密码' })).toBeDisabled();
  });

  it('lets the recovery codes be copied or downloaded before continuing', async () => {
    const createObjectURL = vi.fn(() => 'blob:codes');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const handlers = show({ kind: 'recovery', codes });

    fireEvent.click(screen.getByRole('button', { name: '复制恢复码' }));
    await settle();
    expect(writeText).toHaveBeenCalledWith('aaaaa-11111\nbbbbb-22222');

    fireEvent.click(screen.getByRole('button', { name: '下载恢复码' }));
    await settle();
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes');

    fireEvent.click(screen.getByRole('button', { name: '我已保存，进入后台' }));
    expect(handlers.onFinish).toHaveBeenCalledTimes(1);
  });

  it('asks for a manual copy when the clipboard is unavailable', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    show({ kind: 'recovery', codes });

    fireEvent.click(screen.getByRole('button', { name: '复制恢复码' }));
    await settle();
    expect(toasts).toEqual([['error', '复制失败，请手动选择文本复制']]);
  });
});
