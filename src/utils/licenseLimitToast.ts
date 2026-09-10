import type { TFunction } from 'i18next';

type LimitKind = 'USER_LIMIT' | 'TASK_LIMIT' | 'BOARD_LIMIT' | 'STORAGE_LIMIT' | 'WEBHOOK_LIMIT' | string;

function parseLegacyCounts(details?: string): { current?: number; maximum?: number } {
  if (!details) return {};
  const match = details.match(/Current:\s*(\d+).+Maximum:\s*(\d+)/i);
  if (!match) return {};
  return { current: Number(match[1]), maximum: Number(match[2]) };
}

function formatBytesCompact(n: number): string {
  const mb = n / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)}\u00a0MB`;
  if (mb >= 1) return `${mb.toFixed(1)}\u00a0MB`;
  const kb = n / 1024;
  if (kb >= 1) return `${Math.round(kb)}\u00a0KB`;
  return `${n}\u00a0B`;
}

/**
 * Short, wrap-safe copy for plan-limit toasts. Avoids "Maximum:\\n5".
 */
export function licenseLimitToastCopy(
  t: TFunction,
  payload: {
    limit?: LimitKind;
    current?: number;
    maximum?: number;
    details?: string;
  }
): { title: string; message: string } {
  const parsed = parseLegacyCounts(payload.details);
  const current = payload.current ?? parsed.current;
  const maximum = payload.maximum ?? parsed.maximum;

  switch (payload.limit) {
    case 'USER_LIMIT':
      return {
        title: t('licenseLimits.userTitle'),
        message:
          current != null && maximum != null
            ? t('licenseLimits.usageUsers', { current, maximum })
            : '',
      };
    case 'TASK_LIMIT':
      return {
        title: t('licenseLimits.taskTitle'),
        message:
          current != null && maximum != null
            ? t('licenseLimits.usageTasks', { current, maximum })
            : '',
      };
    case 'BOARD_LIMIT':
      return {
        title: t('licenseLimits.boardTitle'),
        message:
          current != null && maximum != null
            ? t('licenseLimits.usageBoards', { current, maximum })
            : '',
      };
    case 'STORAGE_LIMIT':
      return {
        title: t('licenseLimits.storageTitle'),
        message:
          current != null && maximum != null
            ? t('licenseLimits.usageStorage', {
                current: formatBytesCompact(current),
                maximum: formatBytesCompact(maximum),
              })
            : '',
      };
    case 'WEBHOOK_LIMIT':
      return {
        title: t('licenseLimits.webhookTitle'),
        message:
          current != null && maximum != null
            ? t('licenseLimits.usageWebhooks', { current, maximum })
            : '',
      };
    default:
      return {
        title: t('licenseLimits.genericTitle'),
        message:
          current != null && maximum != null
            ? t('licenseLimits.usageGeneric', { current, maximum })
            : payload.details || '',
      };
  }
}
