import { useTranslation } from 'react-i18next';

/** Marks the sprint (or backlog) currently associated with a task in assignment dropdowns. */
export default function SprintAssignmentCurrentPill() {
  const { t } = useTranslation('tasks');
  return (
    <span className="ml-2 shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      {t('sprintSelector.current')}
    </span>
  );
}
