import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, X } from 'lucide-react';

const STORAGE_KEY = 'agila.mobileUnoptimizedDismissed';
/** Tailwind `md` — phones and small portrait devices. */
const MOBILE_QUERY = '(max-width: 767px)';

type Props = {
  /** Show only on the board after login. */
  enabled: boolean;
};

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function MobileUnoptimizedBanner({ enabled }: Props) {
  const { t } = useTranslation('common');
  const [isMobile, setIsMobile] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readDismissed());
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore quota / private mode
    }
    setDismissed(true);
  };

  if (!enabled || !isMobile || dismissed) {
    return null;
  }

  return (
    <div
      className="shrink-0 border-b border-amber-300/80 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/50 px-3 py-2.5"
      role="status"
      aria-labelledby="mobile-unoptimized-title"
      aria-describedby="mobile-unoptimized-body"
    >
      <div className="flex items-start gap-2.5 max-w-3xl mx-auto">
        <Smartphone
          className="w-4 h-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p
            id="mobile-unoptimized-title"
            className="text-sm font-semibold text-amber-950 dark:text-amber-100"
          >
            {t('mobileWarning.title')}
          </p>
          <p
            id="mobile-unoptimized-body"
            className="mt-0.5 text-xs text-amber-900/90 dark:text-amber-200/90 leading-snug"
          >
            {t('mobileWarning.body')}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded-md text-amber-800 dark:text-amber-200 hover:bg-amber-200/70 dark:hover:bg-amber-900/80"
          aria-label={t('mobileWarning.dismiss')}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
