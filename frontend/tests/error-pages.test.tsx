import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';
import { logger } from '@/lib/logger';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

type ErrorProps = { error: Error & { digest?: string }; retry: () => void };
const pages: [string, ComponentType<ErrorProps>][] = [['error.tsx', ErrorPage], ['global-error.tsx', GlobalError]];

describe.each(pages)('%s', (_, Page) => {
  it('offers retry and home, logs the error and shows its digest', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const retry = vi.fn();
    render(<Page error={error} retry={retry} />);

    expect(screen.getByRole('heading', { name: '页面出错了' })).toBeInTheDocument();
    expect(screen.getByText('错误编号：abc123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0][1]).toBe(error);
    expect(screen.getAllByRole('link').filter(link => link.getAttribute('href') === '/')).toHaveLength(1);
  });
});

it('renders its own document for the global error page and hides a missing digest', () => {
  render(<GlobalError error={new Error('boom')} retry={vi.fn()} />);

  expect(document.documentElement).toHaveAttribute('lang', 'zh-CN');
  expect(screen.getByRole('alert').closest('body')).not.toBeNull();
  expect(document.body.textContent).not.toContain('错误编号');
});
