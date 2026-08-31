import React from 'react';
import { useTranslation } from 'react-i18next';
import { Github } from 'lucide-react';
import type { SsoProviderId } from '../../utils/ssoAdminValidation';

const interactiveClass =
  'w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-gray-700';

const previewClass =
  'inline-flex items-center justify-center py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white shadow-none cursor-default pointer-events-none select-none dark:bg-white dark:text-gray-700';

function GoogleMark() {
  return (
    <svg className="w-5 h-5 mr-2 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg className="w-5 h-5 mr-2 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

function providerLabelKey(provider: SsoProviderId): string {
  if (provider === 'github') return 'login.signInWithGithub';
  if (provider === 'm365') return 'login.signInWithMicrosoft';
  return 'login.signInWithGoogle';
}

function ProviderMark({ provider }: { provider: SsoProviderId }) {
  if (provider === 'github') return <Github className="w-5 h-5 mr-2 shrink-0" aria-hidden />;
  if (provider === 'm365') return <MicrosoftMark />;
  return <GoogleMark />;
}

interface SsoLoginButtonProps {
  provider: SsoProviderId;
  preview?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export const SsoLoginButton: React.FC<SsoLoginButtonProps> = ({
  provider,
  preview = false,
  disabled = false,
  onClick,
}) => {
  const { t } = useTranslation('auth');
  const label = t(providerLabelKey(provider));

  if (preview) {
    return (
      <div className={previewClass} aria-hidden="true">
        <ProviderMark provider={provider} />
        {label}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={interactiveClass}
    >
      <ProviderMark provider={provider} />
      {label}
    </button>
  );
};
