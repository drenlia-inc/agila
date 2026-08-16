import { useTranslation } from 'react-i18next';

export const BETA_SUP_CLASS =
  'ml-1 text-[0.58em] font-medium uppercase tracking-[0.12em] text-slate-500 dark:text-gray-400';

export function BetaSup() {
  const { t } = useTranslation('common');
  return <sup className={BETA_SUP_CLASS}>{t('help.assistant.beta')}</sup>;
}

export default function HelpAssistantTitle() {
  const { t } = useTranslation('common');
  return (
    <span className="min-w-0">
      <span className="truncate">{t('help.assistant.title')}</span>
      <BetaSup />
    </span>
  );
}
