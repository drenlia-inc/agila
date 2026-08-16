import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AdminSection } from './AdminSection';

export type TaskNotificationChannel = 'email' | 'both' | 'webhooks';

type AdminNotificationChannelModeProps = {
  radioName: string;
  channelMode: string;
  webhookCount: number;
  extraHint?: React.ReactNode;
  uncoveredProjects?: { id: string; name: string }[];
  onSelect: (mode: TaskNotificationChannel) => void;
};

export function AdminNotificationChannelMode({
  radioName,
  channelMode,
  webhookCount,
  extraHint,
  uncoveredProjects = [],
  onSelect,
}: AdminNotificationChannelModeProps) {
  const { t } = useTranslation('admin');
  const hasWebhooks = webhookCount > 0;
  const normalized: TaskNotificationChannel =
    channelMode === 'both' || channelMode === 'webhooks' ? channelMode : 'email';

  return (
    <AdminSection
      title={t('webhooks.channelModeTitle')}
      description={t('webhooks.channelModeHint')}
      dense
      settingKey="TASK_NOTIFICATION_CHANNELS"
    >
      <div className="flex flex-col gap-3">
        {(['email', 'both', 'webhooks'] as const).map((mode) => {
          const needsWebhook = mode === 'both' || mode === 'webhooks';
          const disabled = needsWebhook && !hasWebhooks;
          return (
            <label
              key={mode}
              className={`flex items-start gap-2 text-sm ${
                disabled
                  ? 'cursor-not-allowed text-gray-400 dark:text-gray-500'
                  : 'cursor-pointer text-gray-800 dark:text-gray-200'
              }`}
            >
              <input
                type="radio"
                name={radioName}
                className="mt-1"
                checked={normalized === mode}
                disabled={disabled}
                onChange={() => onSelect(mode)}
              />
              <span>
                <span className="font-medium">{t(`webhooks.channel.${mode}`)}</span>
                <span className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-gray-400">
                  {t(`webhooks.channelHelp.${mode}`)}
                  {disabled ? ` ${t('webhooks.channelNeedsWebhook')}` : ''}
                </span>
              </span>
            </label>
          );
        })}
        {extraHint}
        {uncoveredProjects.length > 0 && (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            {t('webhooks.uncoveredProjects', {
              list: uncoveredProjects
                .map((p) => (p.name && p.name !== p.id ? `${p.id} — ${p.name}` : p.id))
                .join(', '),
            })}
          </p>
        )}
      </div>
    </AdminSection>
  );
}

type ConfirmWebhooksOnlyDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmWebhooksOnlyDialog({
  open,
  onCancel,
  onConfirm,
}: ConfirmWebhooksOnlyDialogProps) {
  const { t } = useTranslation('admin');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) return;
    let remove: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointerDown = (e: PointerEvent) => {
        const target = e.target as Node | null;
        if (panelRef.current && target && !panelRef.current.contains(target)) {
          onCancel();
        }
      };
      document.addEventListener('pointerdown', onPointerDown);
      remove = () => document.removeEventListener('pointerdown', onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      remove?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="my-auto w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg bg-white p-4 shadow-lg dark:bg-gray-800"
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('webhooks.confirmWebhooksOnlyTitle')}
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-snug">
          {t('webhooks.confirmWebhooksOnlyBody')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
            onClick={onCancel}
          >
            {t('webhooks.cancel')}
          </button>
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            onClick={onConfirm}
          >
            {t('webhooks.confirmWebhooksOnlyAction')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
