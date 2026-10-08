import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useI18n } from '@/lib/i18n';
import { useLocaleStore } from '@/store/useLocaleStore';

function Label() {
  const { locale, t, formatDate } = useI18n();
  return <p>{locale}: {t('登录')} / {formatDate('2026-10-02T12:00:00Z', true)}</p>;
}

describe('locale hydration snapshots', () => {
  it('hydrates Chinese server content after another boundary restores English', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Label />);
    const serverText = container.textContent;
    expect(serverText).toContain('zh-CN: 登录');
    // AppShell can restore the preference before a streamed child hydrates.
    useLocaleStore.getState().setLocale('en');
    const failures: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Label />, { onRecoverableError: error => failures.push(error) });
      });
      expect(failures).toEqual([]);
      expect(container.textContent).toContain('en: Sign in');
      expect(container.textContent).toContain(new Date('2026-10-02T12:00:00Z').toLocaleDateString('en-US'));
    } finally { if (root) await act(() => root.unmount()); }
  });

  it('uses the server snapshot even when the shared store already holds English during SSR', () => {
    const expected = renderToString(<Label />);
    useLocaleStore.getState().setLocale('en');
    expect(renderToString(<Label />)).toBe(expected);
  });
});
