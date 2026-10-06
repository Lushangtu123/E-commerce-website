'use client';

import { useEffect, useRef } from 'react';
import { answerConfirm, useConfirmStore } from '@/lib/confirm';
import { useI18n } from '@/lib/i18n';

/** The site-wide confirmation dialog behind confirmAction(); mounted once by AppShell. */
export default function ConfirmDialog() {
  const { t } = useI18n();
  const request = useConfirmStore(state => state.request);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') answerConfirm(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [request]);

  if (!request) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => answerConfirm(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-message"
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}>
        <p id="confirm-dialog-message" className="text-gray-900">{request.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => answerConfirm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
            {t('取消')}
          </button>
          <button ref={confirmButton} onClick={() => answerConfirm(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700">
            {t('确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
