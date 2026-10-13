import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import { metadata as privacyMetadata } from '@/app/privacy/layout';
import { metadata as termsMetadata } from '@/app/terms/layout';
import SiteFooter from '@/components/SiteFooter';
import RegisterPage from '@/app/register/page';
import { PRIVACY_POLICY, USER_AGREEMENT } from '@/lib/legal-content';
import { translate } from '@/lib/i18n';
import { PUBLIC_STATIC_PATHS } from '@/lib/site';
import { userApi } from '@/lib/api';
import { useLocaleStore } from '@/store/useLocaleStore';
import toast from 'react-hot-toast';
import { render, settle } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), userApi: { register: vi.fn() } }));

const keys = (page: typeof PRIVACY_POLICY) => [page.title, page.intro, ...page.sections.flatMap(section => [section.title, ...section.body])];

describe('legal pages', () => {
  it.each([['privacy', PRIVACY_POLICY], ['terms', USER_AGREEMENT]] as const)('%s has English for every line', (_, page) => {
    for (const key of keys(page)) {
      const english = translate(key, {}, 'en');
      expect(english, `untranslated ${key}`).not.toBe(key);
      expect(english, `Chinese left in ${key}`).not.toMatch(/[一-鿿]/);
    }
  });

  it.each([['/privacy', PrivacyPage, privacyMetadata, '隐私政策', 'Privacy policy'], ['/terms', TermsPage, termsMetadata, '用户协议', 'User agreement']] as const)(
    '%s renders in both languages with its canonical', (path, Page, metadata, zh, en) => {
      expect(metadata.alternates?.canonical).toBe(path);
      expect(PUBLIC_STATIC_PATHS).toContain(path);
      render(<Page />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(zh);
      act(() => useLocaleStore.setState({ locale: 'en' }));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en);
    });

  it('states the retention periods and the rights the account pages offer', () => {
    const text = keys(PRIVACY_POLICY).join('\n');
    for (const fact of ['180 天', '三年', '导出', '注销账号', 'Vercel', 'Aiven', 'Upstash', '十四周岁']) expect(text).toContain(fact);
  });

  it('are linked from the footer', () => {
    render(<SiteFooter />);
    const hrefs = Array.from(document.querySelectorAll('a'), link => link.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/privacy', '/terms']));
  });
});

describe('registration consent', () => {
  it('links both documents and refuses to register until they are accepted', async () => {
    render(<RegisterPage />);
    const agreement = screen.getByRole('checkbox', { name: /我已阅读并同意/ });
    expect(screen.getByRole('link', { name: '用户协议' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: '隐私政策' })).toHaveAttribute('href', '/privacy');
    const fill = (name: string, value: string) => fireEvent.change(document.querySelector(`input[name="${name}"]`)!, { target: { name, value } });
    fill('username', 'Customer'); fill('email', 'customer@example.test');
    fill('password', 'private test password'); fill('confirmPassword', 'private test password');
    fireEvent.submit(document.querySelector('form')!); await settle();
    expect(toast.error).toHaveBeenCalledWith('请阅读并同意用户协议和隐私政策');
    expect(userApi.register).not.toHaveBeenCalled();
    expect(agreement).not.toBeChecked();
  });
});
