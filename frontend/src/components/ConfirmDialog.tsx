'use client';

import { useRef } from 'react';
import ModalDialog from '@/components/ModalDialog';
import { answerConfirm, useConfirmStore } from '@/lib/confirm';
import { useI18n } from '@/lib/i18n';

/** The site-wide confirmation dialog behind confirmAction(); mounted once by AppShell. */
export default function ConfirmDialog() {
  const { t } = useI18n();
  const request = useConfirmStore(state => state.request);
  const confirmButton = useRef<HTMLButtonElement>(null);

  if (!request) return null;
  return (
    <ModalDialog titleId="confirm-dialog-message" role="alertdialog" busy={false} initialFocus={confirmButton}
      returnFocus={request.returnFocus} onClose={() => answerConfirm(false)} dismissOnBackdrop>
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
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
    </ModalDialog>
  );
}
