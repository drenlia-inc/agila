import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BETA_SUP_CLASS } from '../HelpAssistantTitle';
import {
  listUserApiTokens,
  createUserApiToken,
  revokeUserApiToken,
  getUserSshKey,
  generateUserSshKey,
  downloadUserSshPrivateKey,
  getUserGithubToken,
  saveUserGithubToken,
  deleteUserGithubToken,
  type UserApiTokenMeta,
  type UserSshKeyMeta,
  type UserGithubTokenMeta
} from '../../api';
import { toast } from '../../utils/toast';
import { isMaskedApiKeyDisplay } from '../../utils/maskSecret';
import { formFieldClass } from '../../utils/formFieldClasses';

function StatusBadge({
  ok,
  okLabel,
  missingLabel,
}: {
  ok: boolean;
  okLabel: string;
  missingLabel: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok
          ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
      }`}
    >
      {ok ? okLabel : missingLabel}
    </span>
  );
}

const ProfileDevTab: React.FC = () => {
  const { t } = useTranslation('common');
  const [tokens, setTokens] = useState<UserApiTokenMeta[]>([]);
  const [sshKey, setSshKey] = useState<UserSshKeyMeta | null>(null);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [githubMeta, setGithubMeta] = useState<UserGithubTokenMeta | null>(null);
  const [githubDraft, setGithubDraft] = useState('');
  const [replacingPat, setReplacingPat] = useState(false);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [privateKeyOnce, setPrivateKeyOnce] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenList, ssh, gh] = await Promise.all([
        listUserApiTokens(),
        getUserSshKey(),
        getUserGithubToken()
      ]);
      setTokens(tokenList.filter((tok) => !tok.revokedAt));
      setSshKey(ssh.key);
      setGithubConfigured(Boolean(gh.configured));
      setGithubMeta(gh.token);
      setGithubDraft('');
      setReplacingPat(false);
    } catch (error) {
      console.error('Failed to load Dev credentials:', error);
      toast.error(t('profile.devLoadError'), '');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateToken = async () => {
    setBusy(true);
    try {
      const result = await createUserApiToken(t('profile.devDefaultTokenName'));
      setRawToken(result.rawToken);
      await load();
      toast.success(t('profile.devTokenCreated'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devTokenCreateError'), '');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm(t('profile.devTokenRevokeConfirm'))) return;
    setBusy(true);
    try {
      await revokeUserApiToken(id);
      await load();
      toast.success(t('profile.devTokenRevoked'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devTokenRevokeError'), '');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateSsh = async () => {
    if (sshKey && !window.confirm(t('profile.devSshRegenerateConfirm'))) return;
    setBusy(true);
    try {
      const result = await generateUserSshKey();
      setSshKey(result.key);
      setPrivateKeyOnce(result.privateKey);
      toast.success(t('profile.devSshGenerated'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devSshGenerateError'), '');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPrivate = async () => {
    setBusy(true);
    try {
      const result = privateKeyOnce
        ? { privateKey: privateKeyOnce }
        : await downloadUserSshPrivateKey();
      const blob = new Blob([result.privateKey], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'easy-kanban-agent-ed25519';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devSshDownloadError'), '');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveGithub = async () => {
    const trimmed = githubDraft.trim();
    if (!trimmed || isMaskedApiKeyDisplay(trimmed)) {
      toast.error(t('profile.devGithubTokenRequired'), '');
      return;
    }
    setBusy(true);
    try {
      const result = await saveUserGithubToken(trimmed);
      setGithubConfigured(true);
      setGithubMeta(result.token);
      setGithubDraft('');
      setReplacingPat(false);
      toast.success(t('profile.devGithubTokenSaved'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devGithubTokenSaveError'), '');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGithub = async () => {
    if (!window.confirm(t('profile.devGithubTokenDeleteConfirm'))) return;
    setBusy(true);
    try {
      await deleteUserGithubToken();
      setGithubConfigured(false);
      setGithubMeta(null);
      setGithubDraft('');
      setReplacingPat(false);
      toast.success(t('profile.devGithubTokenDeleted'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devGithubTokenDeleteError'), '');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('profile.devCopied'), '');
    } catch {
      toast.error(t('profile.devCopyError'), '');
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">{t('profile.devLoading')}</div>;
  }

  const showPatForm = !githubConfigured || replacingPat;

  return (
    <div className="space-y-6">
      {/* —— Git access (agent → repos) —— */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">
            {t('profile.devGitAccess')}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t('profile.devGitAccessIntro')}
          </p>
        </div>

        {/* PAT */}
        <div className="relative rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('profile.devGithubPat')}
            </h4>
            <span className="text-xs text-teal-700 dark:text-teal-300 font-medium">
              {t('profile.devRecommended')}
            </span>
            <StatusBadge
              ok={githubConfigured}
              okLabel={t('profile.devStatusConfigured')}
              missingLabel={t('profile.devStatusNotSet')}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
            {t('profile.devGithubPatHint')}
          </p>

          {githubConfigured && !replacingPat && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <code className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate max-w-full">
                {githubMeta?.hint || '••••••••'}
              </code>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setReplacingPat(true);
                  setGithubDraft('');
                }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                {t('profile.devGithubPatReplace')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteGithub()}
                className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                {t('profile.devGithubPatDelete')}
              </button>
            </div>
          )}

          {showPatForm && (
            <form
              className="space-y-1.5"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveGithub();
              }}
            >
              {/* Absorb credential autofill so browsers don't fill the board search behind the modal */}
              <div
                aria-hidden="true"
                className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
              >
                <input type="text" name="username" autoComplete="username" tabIndex={-1} />
                <input type="password" name="password" autoComplete="new-password" tabIndex={-1} />
              </div>
              <input
                type="password"
                name="easy-kanban-github-pat"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                spellCheck={false}
                value={githubDraft}
                onChange={(e) => setGithubDraft(e.target.value)}
                placeholder={t('profile.devGithubPatPlaceholder')}
                className={formFieldClass(false, {
                  widthClass: 'block w-full',
                  py: '1.5',
                  extra: 'px-2.5 font-mono',
                })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {t('profile.devGithubPatSave')}
                </button>
                {replacingPat && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReplacingPat(false);
                      setGithubDraft('');
                    }}
                    className="px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:underline disabled:opacity-50"
                  >
                    {t('buttons.cancel')}
                  </button>
                )}
                <a
                  href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {t('profile.devGithubPatDocs')}
                </a>
              </div>
            </form>
          )}
        </div>

        {/* SSH (optional) */}
        <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t('profile.devSshKey')}
            </h4>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('profile.devOptional')}
            </span>
            <StatusBadge
              ok={Boolean(sshKey)}
              okLabel={t('profile.devStatusGenerated')}
              missingLabel={t('profile.devStatusNotSet')}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
            {t('profile.devSshKeyHint')}
          </p>

          {sshKey ? (
            <div className="space-y-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-600 dark:text-gray-300">
                  {t('profile.devFingerprint')}:
                </span>{' '}
                <code className="text-gray-800 dark:text-gray-200 break-all">
                  {sshKey.fingerprint}
                </code>
              </div>
              <textarea
                readOnly
                value={sshKey.publicKey}
                rows={2}
                className={formFieldClass(true, {
                  widthClass: 'w-full',
                  py: '1.5',
                  extra: 'px-2 text-xs font-mono resize-none',
                })}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {t('profile.devSshAddHint')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyText(sshKey.publicKey)}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  {t('profile.devCopyPublicKey')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDownloadPrivate()}
                  className="px-2.5 py-1 text-xs font-medium text-gray-800 dark:text-gray-100 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {t('profile.devDownloadPrivateKey')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleGenerateSsh()}
                  className="px-2 py-1 text-xs text-gray-700 dark:text-gray-200 hover:underline disabled:opacity-50"
                >
                  {t('profile.devRegenerateSsh')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleGenerateSsh()}
              className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {t('profile.devGenerateSsh')}
            </button>
          )}
        </div>
      </section>

      {/* —— Agila API tokens (external → Kanban) —— */}
      <section>
        <div className="mb-2">
          <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">
            <span>{t('profile.devApiTokens')}</span>
            <sup className={BETA_SUP_CLASS}>
              {t('help.assistant.beta')}
            </sup>
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t('profile.devApiTokensHint')}
          </p>
        </div>

        {rawToken && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-1">
              {t('profile.devTokenShowOnce')}
            </p>
            <code className="block text-xs break-all text-gray-800 dark:text-gray-100 mb-1">
              {rawToken}
            </code>
            <button
              type="button"
              onClick={() => void copyText(rawToken)}
              className="text-xs text-blue-600 hover:underline"
            >
              {t('profile.devCopy')}
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleCreateToken()}
          className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {t('profile.devGenerateToken')}
        </button>

        <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700">
          {tokens.length === 0 && (
            <li className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{t('profile.devNoTokens')}</li>
          )}
          {tokens.map((tok) => (
            <li key={tok.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{tok.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{tok.tokenPrefix}…</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  {t('profile.devCreated')}: {new Date(tok.createdAt).toLocaleString()}
                  {tok.lastUsedAt
                    ? ` · ${t('profile.devLastUsed')}: ${new Date(tok.lastUsedAt).toLocaleString()}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRevoke(tok.id)}
                className="text-xs text-red-600 hover:underline disabled:opacity-50 shrink-0"
              >
                {t('profile.devRevoke')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default ProfileDevTab;
