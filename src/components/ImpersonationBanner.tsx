import React from 'react';
import { useTranslation } from 'react-i18next';

const IMPERSONATOR_TOKEN_KEY = 'agila.impersonatorToken';

const ImpersonationBanner: React.FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation('common');
  if (typeof sessionStorage === 'undefined' || !sessionStorage.getItem(IMPERSONATOR_TOKEN_KEY)) {
    return null;
  }

  const restore = () => {
    const adminToken = sessionStorage.getItem(IMPERSONATOR_TOKEN_KEY);
    if (!adminToken) return;
    localStorage.setItem('authToken', adminToken);
    sessionStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
    window.location.reload();
  };

  return (
    <div className="sticky top-0 z-[70] flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm text-amber-950">
      <span>{t('profile.impersonating', { name })}</span>
      <button type="button" className="font-medium underline" onClick={restore}>
        {t('profile.returnToAccount')}
      </button>
    </div>
  );
};

export default ImpersonationBanner;
