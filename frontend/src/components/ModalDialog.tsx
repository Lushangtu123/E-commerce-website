'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/** Native modality makes the background inert; explicit boundary wrapping keeps Tab in the editor. */
export default function ModalDialog({ titleId, busy, onClose, children, role = 'dialog', initialFocus, returnFocus, dismissOnBackdrop = false }: {
  titleId: string; busy: boolean; onClose: () => void; children: ReactNode;
  role?: 'dialog' | 'alertdialog'; initialFocus?: RefObject<HTMLElement | null>; dismissOnBackdrop?: boolean;
  returnFocus?: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    element.showModal();
    (initialFocus?.current ?? element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ??
      element.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) {
        previous.focus();
        // Callers may lock the opener until the confirmation promise settles.
        if (document.activeElement !== previous && previous.matches(':disabled')) {
          requestAnimationFrame(() => {
            if (previous.isConnected && !previous.matches(':disabled') && document.activeElement === document.body) previous.focus();
          });
        }
      }
    };
  }, [initialFocus, returnFocus]);

  return <dialog ref={dialog} role={role} aria-modal="true" aria-labelledby={titleId}
    onClick={event => { if (dismissOnBackdrop && !busy && event.target === event.currentTarget) onClose(); }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [tabindex]',
      )).filter(control => control.tabIndex >= 0 && !control.matches(':disabled') &&
        control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden');
      const destination = event.shiftKey ? controls.at(-1) : controls[0];
      const boundary = event.shiftKey ? controls[0] : controls.at(-1);
      if (!controls.length || document.activeElement === boundary) {
        event.preventDefault();
        (destination ?? event.currentTarget).focus();
      }
    }}
    className="fixed inset-0 m-0 h-dvh w-screen max-h-none max-w-none border-0 bg-transparent p-4 backdrop:bg-black/50 open:flex open:items-center open:justify-center">
    {children}
  </dialog>;
}
