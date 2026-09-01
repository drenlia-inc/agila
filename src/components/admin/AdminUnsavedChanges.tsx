import React from 'react';
import { useTranslation } from 'react-i18next';

/** Compact amber hint for form footers next to Save / Cancel. */
export const AdminUnsavedHint: React.FC<{ show: boolean; message?: string }> = ({
  show,
  message,
}) => {
  const { t } = useTranslation('admin');
  if (!show) return null;
  return (
    <p className="text-sm font-medium text-amber-700 dark:text-amber-300 flex items-center gap-2">
      <span
        className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0"
        aria-hidden
      />
      {message || t('unsavedChanges')}
    </p>
  );
};

interface AdminUnsavedChangesBannerProps {
  visible: boolean;
  onSave: () => void;
  onDiscard: () => void;
  isSaving?: boolean;
  /** When true, Save is disabled (e.g. while another save is in flight). */
  saveDisabled?: boolean;
}

/** Compact inline actions for the Admin header (left of settings search). */
export const AdminUnsavedChangesBanner: React.FC<AdminUnsavedChangesBannerProps> = ({
  visible,
  onSave,
  onDiscard,
  isSaving = false,
  saveDisabled = false,
}) => {
  const { t } = useTranslation('admin');
  if (!visible) return null;

  return (
    <div
      className="flex items-center gap-2 flex-shrink-0 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-2.5 py-1.5"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1.5 whitespace-nowrap">
        <span
          className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0"
          aria-hidden
        />
        {t('unsavedChanges')}
      </p>
      <button
        type="button"
        onClick={() => onDiscard()}
        disabled={isSaving}
        className="px-2 py-1 text-xs font-medium rounded border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
      >
        {t('discardChanges')}
      </button>
      <button
        type="button"
        onClick={() => onSave()}
        disabled={isSaving || saveDisabled}
        className="px-2 py-1 text-xs font-medium rounded text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 whitespace-nowrap"
      >
        {isSaving ? t('users.saving') : t('saveChanges')}
      </button>
    </div>
  );
};
