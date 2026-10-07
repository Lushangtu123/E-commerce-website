import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import InfoPage from '@/components/InfoPage';
import SiteFooter from '@/components/SiteFooter';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render } from './helpers';

const surfaces = [
  ['footer', () => <SiteFooter />],
  ['help page', () => <InfoPage title="帮助中心" intro="下单、优惠券和售后的常见问题。" sections={[]} />],
] as const;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPPORT_PHONE', '');
  vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', '');
});

describe.each(surfaces)('published contacts: %s', (_, surface) => {
  it('does not offer fake contact links when the merchant has not configured contacts', () => {
    render(surface());
    expect(document.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
    expect(screen.getByText('客服联系方式暂未公布')).toBeInTheDocument();
  });

  it('omits unusable phone numbers and email addresses', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_PHONE', 'call-me+123');
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'support@shop.test?subject=unexpected');
    render(surface());
    expect(document.querySelector('a[href^="tel:"], a[href^="mailto:"]')).toBeNull();
    expect(screen.getByText('客服联系方式暂未公布')).toBeInTheDocument();
  });

  it('publishes the configured contacts with usable call and email links', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_PHONE', ' +1 (415) 555-1234 ');
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', ' support+orders@shop.test ');
    render(surface());
    expect(screen.getByRole('link', { name: '+1 (415) 555-1234' })).toHaveAttribute('href', 'tel:+14155551234');
    expect(screen.getByRole('link', { name: 'support+orders@shop.test' })).toHaveAttribute('href', 'mailto:support%2Borders@shop.test');
    expect(screen.queryByText('客服联系方式暂未公布')).not.toBeInTheDocument();
  });

  it('supports one configured contact without exposing a placeholder for the other', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'support@shop.test');
    render(surface());
    expect(screen.getByRole('link', { name: 'support@shop.test' })).toHaveAttribute('href', 'mailto:support@shop.test');
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.queryByText('客服联系方式暂未公布')).not.toBeInTheDocument();
  });

  it('translates the unconfigured state in English', () => {
    useLocaleStore.setState({ locale: 'en' });
    render(surface());
    expect(screen.getByText('Customer service contact details have not been published yet.')).toBeInTheDocument();
  });
});
