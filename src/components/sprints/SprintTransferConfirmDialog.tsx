import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SprintTransferOffer } from '../utils/sprintActiveWorkTransfer';

interface SprintTransferConfirmDialogProps {
  offer: SprintTransferOffer | null;
  toName: string;
  busy?: boolean;
  onMove: () => void;
  onKeep: () => void;
  /** Dismiss with no save — Escape and click-outside (do not activate / transfer). */
  onCancel: () => void;
}

const SprintTransferConfirmDialog: React.FC<SprintTransferConfirmDialogProps> = ({
  offer,
  toName,
  busy = false,
  onMove,
  onKeep,
  onCancel,
}) => {
  const { t } = useTranslation('admin');

  useEffect(() => {
    if (!offer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [offer, busy, onCancel]);

  useEffect(() => {
    if (!offer || busy) return;
    let remove: (() => void) | undefined;
    const timeoutId = window.setTimeout(() => {
      const onPointer = (event: MouseEvent) => {
        const target = event.target as Element | null;
        if (target?.closest('[data-sprint-transfer-dialog]')) return;
        onCancel();
      };
      document.addEventListener('mousedown', onPointer);
      remove = () => document.removeEventListener('mousedown', onPointer);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      remove?.();
    };
  }, [offer, busy, onCancel]);

  if (!offer) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4">
      <div
        data-sprint-transfer-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="sprint-transfer-title"
        aria-describedby="sprint-transfer-desc"
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
      >
        <h3
          id="sprint-transfer-title"
          className="text-base font-semibold text-gray-900 dark:text-white mb-3"
        >
          {t('sprintSettings.transferTitle')}
        </h3>
        <div id="sprint-transfer-desc" className="mb-4">
          <p className="text-center text-3xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-white">
            {offer.count}/{offer.total}
          </p>
          <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
            {t('sprintSettings.transferUnfinishedLabel', { count: offer.count })}
          </p>
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('sprintSettings.transferFrom')}
              </div>
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {offer.fromName}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('sprintSettings.transferTo')}
              </div>
              <div className="text-base font-semibold text-gray-900 dark:text-white">
                {toName}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t('sprintSettings.transferHint')}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 mr-auto"
          >
            {t('sprintSettings.cancel')}
          </button>
          <button
            type="button"
            onClick={onKeep}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {t('sprintSettings.transferKeep', { fromName: offer.fromName })}
          </button>
          <button
            type="button"
            onClick={onMove}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('sprintSettings.transferMove')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SprintTransferConfirmDialog;
