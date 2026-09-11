import React from 'react';
import { useTranslation } from 'react-i18next';

export interface InstanceStatusBannerProps {
  status: string;
  message?: string;
  isDismissed?: boolean;
  onDismiss?: () => void;
  /** `header` sits in the sticky app chrome; `page` is for login / unauthenticated. */
  layout?: 'header' | 'page';
}

const DISMISSABLE = new Set(['deploying']);

export function instanceStatusIsBlocking(status: string): boolean {
  return Boolean(status) && status !== 'active';
}

function statusColorClass(): string {
  return 'bg-slate-50/95 text-slate-900 dark:bg-slate-900/70 dark:text-slate-100 border-slate-200 dark:border-slate-700';
}

export default function InstanceStatusBanner({
  status,
  isDismissed = false,
  onDismiss,
  layout = 'header',
}: InstanceStatusBannerProps) {
  const { t } = useTranslation('common');

  if (!instanceStatusIsBlocking(status) || isDismissed) {
    return null;
  }

  const title = t('instanceStatus.titles.unavailable');
  const body = t('instanceStatus.messages.unavailable');
  const canDismiss = DISMISSABLE.has(status) && typeof onDismiss === 'function';
  const positionClass =
    layout === 'page'
      ? 'sticky top-0 z-[80] w-full'
      : 'relative w-full';

  return (
    <div
      role="status"
      className={`${positionClass} border-b px-4 py-2.5 ${statusColorClass()}`}
      data-instance-status-banner={status}
    >
      <div className="flex items-start justify-between gap-3 max-w-3xl mx-auto">
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-tight">{title}</p>
          <p className="text-sm mt-0.5 opacity-80">{body}</p>
        </div>
        {canDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex-shrink-0 text-current opacity-70 hover:opacity-100"
            aria-label={t('buttons.dismiss')}
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
