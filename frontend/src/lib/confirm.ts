'use client';

import { create } from 'zustand';

interface ConfirmRequest {
  message: string;
  resolve: (confirmed: boolean) => void;
  returnFocus: HTMLElement | null;
}

/** The question the confirmation dialog is showing, if any; ConfirmDialog renders it. */
export const useConfirmStore = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

/**
 * Asks the person to confirm an action in the site's dialog instead of the browser's blocking
 * confirm(). Unlike confirm(), the page keeps running while it is open, so callers must check
 * again afterwards that the session and the data they acted on are still current.
 * A second question while one is open is declined.
 */
export function confirmAction(message: string): Promise<boolean> {
  if (useConfirmStore.getState().request) return Promise.resolve(false);
  return new Promise(resolve => {
    // Capture before React applies the caller's pending/disabled state.
    const returnFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    useConfirmStore.setState({ request: { message, resolve, returnFocus } });
  });
}

/** Closes the open question with the person's answer. */
export function answerConfirm(confirmed: boolean) {
  const { request } = useConfirmStore.getState();
  if (!request) return;
  useConfirmStore.setState({ request: null });
  request.resolve(confirmed);
}
