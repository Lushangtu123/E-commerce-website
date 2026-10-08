'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Native modality makes the background inert; explicit boundary wrapping keeps Tab in the editor. */
export default function ModalDialog({ titleId, busy, onClose, children }: {
  titleId: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    (element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ??
      element.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return <dialog ref={dialog} aria-modal="true" aria-labelledby={titleId}
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
