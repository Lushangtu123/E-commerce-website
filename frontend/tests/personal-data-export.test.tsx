import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import PersonalDataExport from '@/components/PersonalDataExport';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { useLocaleStore } from '@/store/useLocaleStore';
import { apiError, deferred, render, settle } from './helpers';

vi.mock('@/lib/api', () => ({ userApi: { exportData: vi.fn() } }));

const user = { user_id: 1, username: 'Buyer', email: 'buyer@example.test' };
let downloads: { name: string; type: string; text: Promise<string> }[];

beforeEach(() => {
  useAuthStore.getState().login(user, 'session-one');
  downloads = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => { downloads.push({ name: '', type: blob.type, text: blob.text() }); return 'blob:export'; }),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads[downloads.length - 1].name = this.download;
  });
});

const button = () => screen.getByRole('button', { name: '导出个人信息' });

it('downloads the signed-in customer\'s data as a JSON file', async () => {
  vi.mocked(userApi.exportData).mockResolvedValue({ format_version: 1, account: { user_id: 1 } });
  render(<PersonalDataExport />);
  fireEvent.click(button()); await settle();
  expect(userApi.exportData).toHaveBeenCalledTimes(1);
  expect(downloads).toHaveLength(1);
  expect(downloads[0].name).toMatch(/^personal-data-\d{8}\.json$/);
  expect(downloads[0].type).toBe('application/json');
  expect(JSON.parse(await downloads[0].text)).toEqual({ format_version: 1, account: { user_id: 1 } });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
  expect(screen.getByRole('status')).toHaveTextContent('个人信息已导出');
});

it('runs one export at a time', async () => {
  const pending = deferred<Record<string, unknown>>();
  vi.mocked(userApi.exportData).mockReturnValue(pending.promise);
  render(<PersonalDataExport />);
  fireEvent.click(button());
  expect(screen.getByRole('button', { name: '导出中...' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '导出中...' }));
  expect(userApi.exportData).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ format_version: 1 })); await settle();
  expect(downloads).toHaveLength(1);
});

it('shows the server error and downloads nothing', async () => {
  vi.mocked(userApi.exportData).mockRejectedValue(apiError('导出个人信息失败，请稍后重试'));
  render(<PersonalDataExport />);
  fireEvent.click(button()); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('导出个人信息失败，请稍后重试');
  expect(downloads).toHaveLength(0);
  act(() => useLocaleStore.setState({ locale: 'en' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to export your personal data. Please try again later.');
});

it('discards an export that finishes after the account changed', async () => {
  const pending = deferred<Record<string, unknown>>();
  vi.mocked(userApi.exportData).mockReturnValue(pending.promise);
  render(<PersonalDataExport />);
  fireEvent.click(button());
  act(() => useAuthStore.getState().login({ ...user, user_id: 2, email: 'other@example.test' }, 'session-two'));
  await act(async () => pending.resolve({ account: { user_id: 1 } })); await settle();
  expect(downloads).toHaveLength(0);
  expect(screen.queryByRole('status')).toBeNull();
});
