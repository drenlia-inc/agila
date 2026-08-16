import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface WatchThisTaskButtonProps {
  watching: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export default function WatchThisTaskButton({
  watching,
  onClick,
  disabled = false,
}: WatchThisTaskButtonProps) {
  const { t } = useTranslation('tasks');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sm font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-50"
    >
      {watching ? <EyeOff className="h-4 w-4 shrink-0" aria-hidden /> : <Eye className="h-4 w-4 shrink-0" aria-hidden />}
      {watching ? t('taskPage.unwatchThisTask') : t('taskPage.watchThisTask')}
    </button>
  );
}
