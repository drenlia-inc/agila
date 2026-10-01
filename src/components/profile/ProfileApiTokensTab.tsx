import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listUserApiTokens,
  createUserApiToken,
  revokeUserApiToken,
  updateUserApiToken,
  type UserApiTokenMeta
} from '../../api';
import { toast } from '../../utils/toast';
import { formFieldClass } from '../../utils/formFieldClasses';
import { ADMIN_NUMERIC_INPUT_CLASS } from '../../utils/adminFieldLimits';
import { BetaSup } from '../HelpAssistantTitle';

const IMPERSONATOR_TOKEN_KEY = 'agila.impersonatorToken';

type Props = {
  isAdmin: boolean;
};

const ProfileApiTokensTab: React.FC<Props> = ({ isAdmin }) => {
  const { t } = useTranslation('common');
  const [tokens, setTokens] = useState<UserApiTokenMeta[]>([]);
  const [rawToken, setRawToken] = useState<{ id: string; value: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lifetimeInput, setLifetimeInput] = useState('1');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskAck, setRiskAck] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tokenList = await listUserApiTokens();
      setTokens(tokenList.filter((tok) => !tok.revokedAt));
    } catch (error) {
      console.error('Failed to load API tokens:', error);
      toast.error(t('profile.devLoadError'), '');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!riskOpen && !revokeId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setRiskOpen(false);
      setRevokeId(null);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [riskOpen, revokeId]);

  const lifetimeDays = (() => {
    const trimmed = lifetimeInput.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const days = Number(trimmed);
    if (days < 1 || days > 30) return null;
    return days;
  })();

  const mint = async (adminRiskAcknowledged: boolean) => {
    if (lifetimeDays == null) return;
    setBusy(true);
    try {
      const result = await createUserApiToken({
        name: name.trim() || t('profile.devDefaultTokenName'),
        description: description.trim(),
        lifetimeDays,
        adminRiskAcknowledged
      });
      setRawToken({ id: result.token.id, value: result.rawToken });
      setName('');
      setDescription('');
      setLifetimeInput('1');
      setEditingId(null);
      setRiskOpen(false);
      setRiskAck(false);
      await load();
      toast.success(t('profile.devTokenCreated'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devTokenCreateError'), '');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = () => {
    if (lifetimeDays == null) return;
    if (isAdmin) {
      setRiskAck(false);
      setRiskOpen(true);
      return;
    }
    void mint(false);
  };

  const handleRevoke = async (id: string) => {
    setBusy(true);
    try {
      await revokeUserApiToken(id);
      setRevokeId(null);
      if (rawToken?.id === id) setRawToken(null);
      if (editingId === id) setEditingId(null);
      await load();
      toast.success(t('profile.devTokenRevoked'), '');
    } catch (error) {
      console.error(error);
      toast.error(t('profile.devTokenRevokeError'), '');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (tok: UserApiTokenMeta) => {
    setEditingId(tok.id);
    setEditName(tok.name);
    setEditDescription(tok.description || '');
  };

  const saveEdit = async (id: string) => {
    const nextName = editName.trim();
    if (!nextName) return;
    setBusy(true);
    try {
      const updated = await updateUserApiToken(id, {
        name: nextName,
        description: editDescription.trim()
      });
      setTokens((current) => current.map((tok) => (tok.id === id ? { ...tok, ...updated } : tok)));
      setEditingId(null);
    } catch (error) {
      console.error(error);
      toast.error(t('profile.apiTokenUpdateError'), '');
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('profile.devCopied'), '');
    } catch {
      toast.error(t('profile.devCopyError'), '');
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">{t('profile.apiTokensLoading')}</p>;
  }

  return (
    <div className="space-y-4" data-help-target="profile-api-tokens">
      <div>
        <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">
          {t('profile.devApiTokens')}
          <BetaSup />
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('profile.devApiTokensHint')}</p>
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('profile.apiTokenName')}
          <input
            className={formFieldClass(false, { widthClass: 'mt-1 block w-full' })}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('profile.apiTokenDescription')}
          <input
            className={formFieldClass(false, { widthClass: 'mt-1 block w-full' })}
            value={description}
            maxLength={500}
            placeholder={t('profile.apiTokenDescriptionPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('profile.apiTokenLifetime')}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={formFieldClass(false, {
              widthClass: 'mt-1 block w-24',
              extra: ADMIN_NUMERIC_INPUT_CLASS
            })}
            value={lifetimeInput}
            aria-invalid={lifetimeDays == null}
            onChange={(e) => setLifetimeInput(e.target.value)}
          />
          {lifetimeDays == null && (
            <span className="mt-1 block text-sm font-normal text-red-600 dark:text-red-400">
              {t('profile.apiTokenLifetimeInvalid')}
            </span>
          )}
        </label>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={handleGenerate}
        className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {t('profile.devGenerateToken')}
      </button>

      <ul className="divide-y divide-gray-200 dark:divide-gray-700 border-t border-gray-200 dark:border-gray-700">
        {tokens.length === 0 && (
          <li className="py-3 text-sm text-gray-500 dark:text-gray-400">{t('profile.devNoTokens')}</li>
        )}
        {tokens.map((tok) => {
          const editing = editingId === tok.id;
          const nameMissing = editing && !editName.trim();
          return (
            <li key={tok.id} className="py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                {rawToken?.id === tok.id && (
                  <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-3">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">{t('profile.devTokenShowOnce')}</p>
                    <code className="block text-sm break-all font-mono text-gray-800 dark:text-gray-100 mb-2">{rawToken.value}</code>
                    <button type="button" onClick={() => void copyText(rawToken.value)} className="text-sm text-blue-600 hover:underline">
                      {t('profile.devCopy')}
                    </button>
                  </div>
                )}
                {editing ? (
                  <>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('profile.apiTokenName')}
                      <input
                        className={formFieldClass(false, { widthClass: 'mt-1 block w-full' })}
                        value={editName}
                        maxLength={100}
                        aria-invalid={nameMissing}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      {nameMissing && (
                        <span className="mt-1 block text-sm font-normal text-red-600 dark:text-red-400">
                          {t('profile.apiTokenNameRequired')}
                        </span>
                      )}
                    </label>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('profile.apiTokenDescription')}
                      <input
                        className={formFieldClass(false, { widthClass: 'mt-1 block w-full' })}
                        value={editDescription}
                        maxLength={500}
                        placeholder={t('profile.apiTokenDescriptionPlaceholder')}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{tok.name}</div>
                    {tok.description ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300">{tok.description}</div>
                    ) : null}
                  </>
                )}
                <div className="text-sm text-gray-500 dark:text-gray-400 font-mono">{tok.tokenPrefix}…</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t('profile.devCreated')}: {new Date(tok.createdAt).toLocaleString()}
                  {tok.expiresAt ? ` · ${t('profile.apiTokenExpires')}: ${new Date(tok.expiresAt).toLocaleString()}` : ''}
                  {tok.lastUsedAt ? ` · ${t('profile.devLastUsed')}: ${new Date(tok.lastUsedAt).toLocaleString()}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {editing ? (
                  <>
                    <button
                      type="button"
                      disabled={busy || nameMissing}
                      onClick={() => void saveEdit(tok.id)}
                      className="text-sm text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {t('buttons.save')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                      className="text-sm text-gray-600 hover:underline disabled:opacity-50 dark:text-gray-300"
                    >
                      {t('buttons.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startEdit(tok)}
                    className="text-sm text-blue-600 hover:underline disabled:opacity-50"
                  >
                    {t('buttons.edit')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRevokeId(tok.id)}
                  className="text-sm text-red-600 hover:underline disabled:opacity-50"
                >
                  {t('profile.devRevoke')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {revokeId && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setRevokeId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-w-md w-full rounded-lg bg-white dark:bg-gray-800 p-4 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-gray-800 dark:text-gray-100">{t('profile.devTokenRevokeConfirm')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-1 text-sm" onClick={() => setRevokeId(null)}>
                {t('profile.apiTokenCancel')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRevoke(revokeId)}
                className="px-3 py-1 text-sm font-medium text-white bg-red-600 rounded-md disabled:opacity-50"
              >
                {t('profile.devRevoke')}
              </button>
            </div>
          </div>
        </div>
      )}

      {riskOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={() => setRiskOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-w-md w-full rounded-lg bg-white dark:bg-gray-800 p-4 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-gray-800 dark:text-gray-100">
              {t('profile.apiTokenAdminRisk', { days: lifetimeDays })}
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input type="checkbox" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} />
              <span>{t('profile.apiTokenAdminRiskAck')}</span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="px-3 py-1 text-sm" onClick={() => setRiskOpen(false)}>
                {t('profile.apiTokenCancel')}
              </button>
              <button
                type="button"
                disabled={!riskAck || busy}
                onClick={() => void mint(true)}
                className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md disabled:opacity-50"
              >
                {t('profile.devGenerateToken')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { IMPERSONATOR_TOKEN_KEY };
export default ProfileApiTokensTab;
