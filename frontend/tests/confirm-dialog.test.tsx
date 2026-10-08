import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '@/components/ConfirmDialog';
import { confirmAction, useConfirmStore } from '@/lib/confirm';
import { useLocaleStore } from '@/store/useLocaleStore';
import { render } from './helpers';

// tests/setup.ts answers confirmAction through window.confirm everywhere else; this file tests the real
// one (vi.unmock is hoisted above the imports).
vi.unmock('@/lib/confirm');

function ask(message = '确定要取消订单吗？') {
  let answer: boolean | undefined;
  act(() => { void confirmAction(message).then(value => { answer = value; }); });
  return () => answer;
}
const settle = () => act(async () => { await Promise.resolve(); });
const dialog = () => screen.queryByRole('alertdialog');

describe('confirmation dialog', () => {
  // The open question lives in a module store shared by the tests in this file.
  beforeEach(() => { useConfirmStore.setState({ request: null }); });

  it('shows the question and resolves true when confirmed', async () => {
    render(<ConfirmDialog />);
    expect(dialog()).not.toBeInTheDocument();

    const answer = ask();
    expect(dialog()).toHaveAccessibleName('确定要取消订单吗？');
    expect(screen.getByRole('button', { name: '确定' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await settle();

    expect(answer()).toBe(true);
    expect(dialog()).not.toBeInTheDocument();
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it.each([
    ['the cancel button', () => fireEvent.click(screen.getByRole('button', { name: '取消' }))],
    ['native Escape cancellation', () => fireEvent(dialog()!, new Event('cancel', { cancelable: true }))],
    ['a click on the backdrop', () => fireEvent.click(dialog()!)],
  ])('resolves false on %s', async (_, dismiss) => {
    render(<ConfirmDialog />);
    const answer = ask();
    dismiss();
    await settle();
    expect(answer()).toBe(false);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('keeps a click inside the dialog from dismissing it', async () => {
    render(<ConfirmDialog />);
    const answer = ask();
    fireEvent.click(screen.getByText('确定要取消订单吗？'));
    await settle();
    expect(answer()).toBeUndefined();
    expect(dialog()).toBeInTheDocument();
  });

  it('declines a second question while one is open and keeps the first', async () => {
    render(<ConfirmDialog />);
    const first = ask('First?');
    const second = ask('Second?');
    await settle();
    expect(second()).toBe(false);
    expect(dialog()).toHaveAccessibleName('First?');

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await settle();
    expect(first()).toBe(true);
  });

  it('returns focus to the control that asked and labels its buttons in the chosen language', async () => {
    act(() => useLocaleStore.getState().setLocale('en'));
    render(<><button>Cancel order</button><ConfirmDialog /></>);
    const opener = screen.getByRole('button', { name: 'Cancel order' });
    opener.focus();

    ask('Cancel this order?');
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(opener).toHaveFocus();
  });
  it.each(['zh-CN', 'en'] as const)('uses native modality and contains keyboard focus in %s', async locale => {
    // happy-dom has no layout; real visibility and background inertness are covered by Chromium.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    useLocaleStore.setState({ locale });
    const background = vi.fn();
    render(<><button onClick={background}>Background action</button><ConfirmDialog /></>);
    ask();
    const modal = dialog()!;
    expect(modal.tagName).toBe('DIALOG');
    expect(modal).toHaveAttribute('open');
    const confirm = screen.getByRole('button', { name: locale === 'en' ? 'OK' : '确定' });
    const cancel = screen.getByRole('button', { name: locale === 'en' ? 'Cancel' : '取消' });
    await userEvent.tab(); expect(cancel).toHaveFocus();
    await userEvent.tab({ shift: true }); expect(confirm).toHaveFocus();
    expect(background).not.toHaveBeenCalled();
    fireEvent(modal, new Event('cancel', { cancelable: true })); await settle();
    expect(dialog()).toBeNull();
  });
  it('captures the opener before the caller disables it and restores it once unlocked', async () => {
    let restore: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { restore = callback; return 1; });
    render(<><button>Locked opener</button><ConfirmDialog /></>);
    const opener = screen.getByRole<HTMLButtonElement>('button', { name: 'Locked opener' }); opener.focus();
    act(() => {
      void confirmAction('Continue?');
      opener.disabled = true; opener.blur();
    });
    expect(useConfirmStore.getState().request).toEqual(expect.objectContaining({ returnFocus: opener }));
    fireEvent(dialog()!, new Event('cancel', { cancelable: true })); await settle();
    opener.disabled = false;
    restore?.(0);
    expect(opener).toHaveFocus();
  });
});
