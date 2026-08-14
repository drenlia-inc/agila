import { useTranslation } from 'react-i18next';

export default function HelpAssistantTitle() {
  const { t } = useTranslation('common');
  return (
    <span className="min-w-0">
      <span className="truncate">{t('help.assistant.title')}</span>
      <sup className="ml-1 text-[0.58em] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-gray-400">
        {t('help.assistant.beta')}
      </sup>
    </span>
  );
}
