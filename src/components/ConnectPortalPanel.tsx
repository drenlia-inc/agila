import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Link2, Loader2 } from 'lucide-react';
import api from '../api';
import { buildSelfHostSupportUrl } from '../utils/customerPortalUrl';

type ConnectPortalPanelProps = {
  onLinked: () => void | Promise<void>;
  language?: string;
  ownerEmail?: string | null;
  openSupportInNewTab?: boolean;
  className?: string;
};

export function ConnectPortalPanel({
  onLinked,
  language,
  ownerEmail,
  openSupportInNewTab = true,
  className = ''
}: ConnectPortalPanelProps) {
  const { t, i18n } = useTranslation('common');
  const [pairingCode, setPairingCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openGetSupport = () => {
    const target = buildSelfHostSupportUrl(language || i18n.language, ownerEmail || undefined);
    if (openSupportInNewTab) {
      window.open(target, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = target;
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = pairingCode.trim();
    if (code.length < 8) {
      setError(t('connectPortal.codeRequired'));
      return;
    }
    setConnecting(true);
    try {
      await api.post('/admin/connect-portal', { pairingCode: code });
      setPairingCode('');
      await onLinked();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; code?: string } } };
      const codeKey = axiosErr.response?.data?.code;
      if (codeKey === 'already_linked') {
        setError(t('connectPortal.alreadyLinked'));
      } else if (codeKey === 'invalid_pairing_code' || codeKey === 'pairing_code_expired') {
        setError(t('connectPortal.invalidCode'));
      } else if (codeKey === 'portal_unreachable') {
        setError(t('connectPortal.portalUnreachable'));
      } else {
        setError(axiosErr.response?.data?.error || t('connectPortal.failed'));
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className={className}>
      <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
        {t('connectPortal.title')}
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
        {t('connectPortal.description')}
      </p>

      <form onSubmit={handleConnect} className="space-y-3 mb-6">
        <label htmlFor="portal-pairing-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('connectPortal.codeLabel')}
        </label>
        <input
          id="portal-pairing-code"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={pairingCode}
          onChange={(e) => setPairingCode(e.target.value)}
          placeholder={t('connectPortal.codePlaceholder')}
          className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono tracking-wide text-gray-900 dark:text-white"
          disabled={connecting}
        />
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={connecting}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium text-sm"
        >
          {connecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {t('connectPortal.submitting')}
            </>
          ) : (
            <>
              <Link2 className="mr-2 h-4 w-4" aria-hidden />
              {t('connectPortal.submit')}
            </>
          )}
        </button>
      </form>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {t('connectPortal.needCode')}
        </p>
        <button
          type="button"
          onClick={openGetSupport}
          className="inline-flex items-center px-4 py-2 border border-blue-600 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors font-medium text-sm"
        >
          {t('profile.getSelfHostedSupport')}
          <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
