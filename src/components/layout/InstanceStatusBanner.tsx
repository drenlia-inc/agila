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

function statusColorClass(status: string): string {
  switch (status) {
    case 'suspended':
      return 'bg-amber-100 border-amber-500 text-amber-900 dark:bg-amber-950 dark:border-amber-600 dark:text-amber-100';
    case 'terminated':
    case 'failed':
      return 'bg-red-100 border-red-500 text-red-800 dark:bg-red-950 dark:border-red-600 dark:text-red-100';
    case 'deploying':
      return 'bg-blue-100 border-blue-500 text-blue-800 dark:bg-blue-950 dark:border-blue-600 dark:text-blue-100';
    default:
      return 'bg-gray-100 border-gray-500 text-gray-800 dark:bg-gray-800 dark:border-gray-500 dark:text-gray-100';
  }
}

export default function InstanceStatusBanner({
  status,
  message,
  isDismissed = false,
  onDismiss,
  layout = 'header',
}: InstanceStatusBannerProps) {
  const { t } = useTranslation('common');

  if (!instanceStatusIsBlocking(status) || isDismissed) {
    return null;
  }

  const title = t(`instanceStatus.titles.${status}`, {
    defaultValue: t('instanceStatus.titles.unavailable'),
  });
  const body =
    message ||
    t(`instanceStatus.messages.${status}`, {
      defaultValue: t('instanceStatus.messages.unavailable'),
    });
  const canDismiss = DISMISSABLE.has(status) && typeof onDismiss === 'function';
  const positionClass =
    layout === 'page'
      ? 'sticky top-0 z-[80] w-full'
      : 'relative w-full';

  return (
    <div
      role="status"
      className={`${positionClass} border-b-2 border-l-4 px-4 py-3 shadow-sm ${statusColorClass(status)}`}
      data-instance-status-banner={status}
    >
      <div className="flex items-start justify-between gap-3 max-w-7xl mx-auto">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-sm mt-0.5">{body}</p>
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
