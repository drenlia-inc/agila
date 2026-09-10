import React from 'react';
import { useTranslation } from 'react-i18next';

export function isAdminSecretUnreadable(
  settings: Record<string, string | undefined> | null | undefined,
  key: string
): boolean {
  return settings?.[`${key}_UNREADABLE`] === 'true';
}

/** Shown when a stored admin secret cannot be decrypted (JWT / SETTINGS_ENCRYPTION_KEY rotated). */
export const AdminSecretUnreadableHint: React.FC = () => {
  const { t } = useTranslation('admin');
  return (
    <p className="mt-1 text-xs text-amber-800 dark:text-amber-200 leading-snug">
      {t('secretUnreadableHint')}
    </p>
  );
};
