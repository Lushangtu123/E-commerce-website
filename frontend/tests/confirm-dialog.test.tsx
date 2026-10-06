import { act, fireEvent, screen } from '@testing-library/react';
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
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['a click outside the dialog', () => fireEvent.click(dialog()!.parentElement!)],
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
    fireEvent.click(dialog()!);
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
});
