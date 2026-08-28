import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Task } from '../types';

interface TaskDeleteConfirmationProps {
  isOpen: boolean;
  task: Task | null;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
  /** When true, confirm permanent (hard) delete instead of soft-delete to trash. */
  permanent?: boolean;
  position: { top: number; left: number } | null;
}

const TaskDeleteConfirmation: React.FC<TaskDeleteConfirmationProps> = ({
  isOpen,
  task,
  onConfirm,
  onCancel,
  isDeleting = false,
  permanent = false,
  position
}) => {
  const { t } = useTranslation(['tasks', 'common']);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isDeleting) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen || !task || !position) return null;

  return createPortal(
    <div 
      className="delete-confirmation fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-3 z-[9999] max-w-[220px]"
      role="dialog"
      aria-modal="true"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="mb-3">
        {permanent ? (
          <>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-snug">
              {t('deleteConfirmation.areYouSurePermanentTitle')}
            </p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-snug">
              {t('deleteConfirmation.areYouSurePermanentBody')}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-snug">
            {t('deleteConfirmation.areYouSure')}
          </p>
        )}
      </div>
      <div className="flex space-x-2 justify-end">
        <button
          onClick={onCancel}
          disabled={isDeleting}
          className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          {t('buttons.no', { ns: 'common' })}
        </button>
        <button
          onClick={onConfirm}
          disabled={isDeleting}
          className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {isDeleting
            ? (permanent ? t('deleteConfirmation.deletingPermanent') : t('deleteConfirmation.deleting'))
            : t('buttons.yes', { ns: 'common' })}
        </button>
      </div>
    </div>,
    document.body
  );
};

export default TaskDeleteConfirmation;
