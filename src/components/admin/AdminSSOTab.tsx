import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { SsoLoginButton } from '../auth/SsoLoginButton';
import { isMaskedApiKeyDisplay } from '../../utils/maskSecret';
import { revertAdminSettingField } from '../../utils/adminSettingsDirty';
import {
  buildByoOAuthDraftFromManaged,
  buildByoOAuthDraftFromOff,
  buildGithubByoDraft,
  buildGithubSsoRemoveDraft,
  buildGoogleSsoRemoveDraft,
  buildM365ByoDraft,
  buildM365SsoRemoveDraft,
  GITHUB_SSO_SAVE_KEYS,
  githubSsoKeysDirty,
  formatSsoLastUsed,
  GOOGLE_SSO_SAVE_KEYS,
  googleSsoResumeMode,
  isGoogleSsoConfigured,
  isGoogleSsoManagedEligible,
  isSimpleSsoConfigured,
  M365_SSO_SAVE_KEYS,
  m365SsoKeysDirty,
  oauthSettingKeysDirty,
  pickSettingsKeys,
  resolveGoogleSsoModeFromSettings,
  resolveSimpleSsoMode,
  revertSettingsKeys,
  SSO_LAST_SUCCESS_KEYS,
  tenantGithubCallbackUrl,
  tenantGoogleCallbackUrl,
  tenantM365CallbackUrl,
  type SsoProviderId,
} from '../../utils/ssoAdminValidation';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import { adminFieldClass, adminInputWideClass } from './AdminSection';
import api from '../../api';
import { toast } from '../../utils/toast';

interface Settings {
  [key: string]: string | undefined;
}

interface AdminSSOTabProps {
  settings: Settings;
  editingSettings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: (settings?: Settings) => void | Promise<void | boolean>;
  onCancel: () => void;
  onSettingsReload?: (options?: { quiet?: boolean }) => void | Promise<void>;
  onApplySettingsPatch?: (patch: Record<string, string | undefined>) => void;
}

type ConfirmDialogKind =
  | 'byo'
  | 'restoreManaged'
  | 'disableGoogle'
  | 'disableGithub'
  | 'disableM365'
  | 'removeGoogle'
  | 'removeGithub'
  | 'removeM365'
  | null;

const sectionClass =
  'rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30 p-3 space-y-2.5';
const headerBtnClass =
  'text-xs px-2.5 py-1 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function useDismissible(open: boolean, onClose: () => void, dialogAttr: string) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    let outside: ((e: MouseEvent) => void) | undefined;
    const timer = window.setTimeout(() => {
      outside = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest(`[${dialogAttr}]`)) return;
        onClose();
      };
      document.addEventListener('mousedown', outside);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      if (outside) document.removeEventListener('mousedown', outside);
    };
  }, [open, onClose, dialogAttr]);
}

const AdminSSOTab: React.FC<AdminSSOTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onSettingsReload,
  onApplySettingsPatch,
}) => {
  const { t, i18n } = useTranslation('admin');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogKind>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [modeActionBusy, setModeActionBusy] = useState(false);
  const [savingProvider, setSavingProvider] = useState<SsoProviderId | null>(null);

  const savedGoogleMode = resolveGoogleSsoModeFromSettings(settings);
  const draftGoogleMode = resolveGoogleSsoModeFromSettings(editingSettings);
  const savedGithubMode = resolveSimpleSsoMode(settings, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID');
  const draftGithubMode = resolveSimpleSsoMode(editingSettings, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID');
  const savedM365Mode = resolveSimpleSsoMode(settings, 'M365_SSO_MODE', 'M365_CLIENT_ID');
  const draftM365Mode = resolveSimpleSsoMode(editingSettings, 'M365_SSO_MODE', 'M365_CLIENT_ID');
  const managedEligible = isGoogleSsoManagedEligible(settings);

  const googleConfigured =
    isGoogleSsoConfigured(settings) || isGoogleSsoConfigured(editingSettings);
  const githubConfigured =
    isSimpleSsoConfigured(settings, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID') ||
    isSimpleSsoConfigured(editingSettings, 'GITHUB_SSO_MODE', 'GITHUB_CLIENT_ID');
  const m365Configured =
    isSimpleSsoConfigured(settings, 'M365_SSO_MODE', 'M365_CLIENT_ID') ||
    isSimpleSsoConfigured(editingSettings, 'M365_SSO_MODE', 'M365_CLIENT_ID');
  const showGoogle = googleConfigured;
  const showGithub = githubConfigured;
  const showM365 = m365Configured;
  const googleDisabled = googleConfigured && savedGoogleMode === 'off' && draftGoogleMode === 'off';
  const githubDisabled = githubConfigured && savedGithubMode === 'off';
  const m365Disabled = m365Configured && savedM365Mode === 'off';
  const googleActive = savedGoogleMode === 'managed' || savedGoogleMode === 'byo';
  const githubActive = savedGithubMode === 'byo';
  const m365Active = savedM365Mode === 'byo';
  const googlePending =
    (draftGoogleMode === 'managed' || draftGoogleMode === 'byo') && !googleActive;
  const githubPending = draftGithubMode === 'byo' && !githubActive;
  const m365Pending = draftM365Mode === 'byo' && !m365Active;
  const googleResume = googleSsoResumeMode(settings);
  const availableProviders = useMemo(
    () =>
      (
        [
          { id: 'google' as const, hidden: googleConfigured },
          { id: 'github' as const, hidden: githubConfigured },
          { id: 'm365' as const, hidden: m365Configured },
        ] as const
      ).filter((p) => !p.hidden),
    [googleConfigured, githubConfigured, m365Configured]
  );

  const googleDirty = useMemo(
    () => oauthSettingKeysDirty(settings, editingSettings),
    [settings, editingSettings]
  );
  const githubDirty = useMemo(
    () => githubSsoKeysDirty(settings, editingSettings),
    [settings, editingSettings]
  );
  const m365Dirty = useMemo(
    () => m365SsoKeysDirty(settings, editingSettings),
    [settings, editingSettings]
  );

  const googleCallbackExample = useMemo(() => tenantGoogleCallbackUrl(), []);
  const githubCallbackExample = useMemo(() => tenantGithubCallbackUrl(), []);
  const m365CallbackExample = useMemo(() => tenantM365CallbackUrl(), []);
  const hubCallbackDisplay =
    settings.GOOGLE_SSO_HUB_CALLBACK_URL ||
    editingSettings.GOOGLE_SSO_HUB_CALLBACK_URL ||
    'https://auth.agila.dev/api/auth/google/callback';

  const closeConfirm = () => setConfirmDialog(null);
  const closeAddMenu = () => setAddMenuOpen(false);
  useDismissible(Boolean(confirmDialog), closeConfirm, 'data-sso-confirm-dialog');
  useDismissible(addMenuOpen, closeAddMenu, 'data-sso-add-menu');

  const handleInputChange = (key: string, value: string) => {
    onSettingsChange({ ...editingSettings, [key]: value });
  };

  const revertField = (key: string) => {
    onSettingsChange(revertAdminSettingField(key, settings, editingSettings));
  };

  const reloadSettings = async () => {
    if (onSettingsReload) await onSettingsReload({ quiet: true });
  };

  const applySsoResponse = (data: { settings?: Record<string, string | undefined> }) => {
    if (data?.settings && onApplySettingsPatch) {
      onApplySettingsPatch(data.settings);
    }
  };

  const handleDisableGoogleSso = async () => {
    setModeActionBusy(true);
    try {
      const { data } = await api.post('/admin/settings/google-sso/disable');
      applySsoResponse(data);
      toast.success(t('sso.disableSuccess'), '');
      closeConfirm();
      await reloadSettings();
    } catch (err: unknown) {
      toast.error(t('sso.disableFailed'), '');
      console.error(err);
    } finally {
      setModeActionBusy(false);
    }
  };

  const handleEnableGoogleSso = async () => {
    setModeActionBusy(true);
    try {
      const { data } = await api.post('/admin/settings/google-sso/enable');
      applySsoResponse(data);
      toast.success(t('sso.reenableSuccess'), '');
      closeConfirm();
      await reloadSettings();
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'not_eligible') {
        toast.error(t('sso.restoreManagedNotEligible'), '');
      } else if (code === 'platform_unavailable') {
        toast.error(t('sso.restoreManagedUnavailable'), '');
      } else {
        toast.error(t('sso.reenableFailed'), '');
      }
      console.error(err);
    } finally {
      setModeActionBusy(false);
    }
  };

  const handleRestoreManaged = async () => {
    setModeActionBusy(true);
    try {
      const { data } = await api.post('/admin/settings/google-sso/restore-managed');
      applySsoResponse(data);
      toast.success(t('sso.restoreManagedSuccess'), '');
      closeConfirm();
      await reloadSettings();
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'not_eligible') {
        toast.error(t('sso.restoreManagedNotEligible'), '');
      } else if (code === 'platform_unavailable') {
        toast.error(t('sso.restoreManagedUnavailable'), '');
      } else {
        toast.error(t('sso.restoreManagedFailed'), '');
      }
      console.error(err);
    } finally {
      setModeActionBusy(false);
    }
  };

  const handleSaveProvider = async (id: SsoProviderId) => {
    const keys =
      id === 'google'
        ? GOOGLE_SSO_SAVE_KEYS
        : id === 'github'
          ? GITHUB_SSO_SAVE_KEYS
          : M365_SSO_SAVE_KEYS;
    setSavingProvider(id);
    try {
      const payload = pickSettingsKeys(editingSettings, keys);
      if (id === 'github' && !String(payload.GITHUB_CALLBACK_URL || '').trim()) {
        payload.GITHUB_CALLBACK_URL = tenantGithubCallbackUrl();
      }
      if (id === 'm365' && !String(payload.M365_CALLBACK_URL || '').trim()) {
        payload.M365_CALLBACK_URL = tenantM365CallbackUrl();
      }
      if (id === 'google' && !String(payload.GOOGLE_CALLBACK_URL || '').trim()) {
        payload.GOOGLE_CALLBACK_URL = tenantGoogleCallbackUrl();
      }
      await onSave(payload);
    } finally {
      setSavingProvider(null);
    }
  };

  const persistSimpleSsoMode = async (id: 'github' | 'm365', mode: 'off' | 'byo') => {
    const modeKey = id === 'github' ? 'GITHUB_SSO_MODE' : 'M365_SSO_MODE';
    const keys = id === 'github' ? GITHUB_SSO_SAVE_KEYS : M365_SSO_SAVE_KEYS;
    const patch = { ...pickSettingsKeys(editingSettings, keys), [modeKey]: mode };
    const result = await onSave(patch);
    if (result === false) return false;
    onApplySettingsPatch?.(patch);
    return true;
  };

  const handleDisableSimple = async (id: 'github' | 'm365') => {
    setModeActionBusy(true);
    try {
      if ((await persistSimpleSsoMode(id, 'off')) === false) return;
      closeConfirm();
      await reloadSettings();
    } finally {
      setModeActionBusy(false);
    }
  };

  const handleEnableSimple = async (id: 'github' | 'm365') => {
    setModeActionBusy(true);
    try {
      if ((await persistSimpleSsoMode(id, 'byo')) === false) return;
      await reloadSettings();
    } finally {
      setModeActionBusy(false);
    }
  };

  const handleRemoveProvider = async (id: SsoProviderId) => {
    setModeActionBusy(true);
    try {
      if (id === 'google') {
        const { data } = await api.post('/admin/settings/google-sso/remove');
        applySsoResponse(data);
        onSettingsChange(buildGoogleSsoRemoveDraft(editingSettings));
      } else {
        const path = id === 'github' ? '/admin/settings/github-sso/remove' : '/admin/settings/m365-sso/remove';
        const { data } = await api.post(path);
        applySsoResponse(data);
        onSettingsChange(
          id === 'github'
            ? buildGithubSsoRemoveDraft(editingSettings)
            : buildM365SsoRemoveDraft(editingSettings)
        );
      }
      toast.success(t('sso.removeSuccess', { provider: t(`sso.providers.${id}`) }), '');
      closeConfirm();
      await reloadSettings();
    } catch (err: unknown) {
      toast.error(t('sso.removeFailed', { provider: t(`sso.providers.${id}`) }), '');
      console.error(err);
    } finally {
      setModeActionBusy(false);
    }
  };

  const addProvider = (id: SsoProviderId) => {
    closeAddMenu();
    if (id === 'google') {
      if (managedEligible) {
        void handleEnableGoogleSso();
        return;
      }
      onSettingsChange(buildByoOAuthDraftFromOff(editingSettings));
      return;
    }
    if (id === 'github') {
      onSettingsChange(buildGithubByoDraft(editingSettings));
      return;
    }
    onSettingsChange(buildM365ByoDraft(editingSettings));
  };

  const confirmCopy = useMemo(() => {
    if (confirmDialog === 'byo') {
      return {
        title: t('sso.switchToByo'),
        body: t('sso.switchToByoConfirm'),
        confirm: t('sso.switchToByo'),
        onConfirm: () => {
          closeConfirm();
          onSettingsChange(buildByoOAuthDraftFromManaged(editingSettings));
        },
      };
    }
    if (confirmDialog === 'restoreManaged') {
      return {
        title: t('sso.restoreManagedTitle'),
        body: t('sso.restoreManagedConfirm'),
        confirm: t('sso.restoreManagedAction'),
        onConfirm: handleRestoreManaged,
      };
    }
    if (confirmDialog === 'disableGoogle') {
      return {
        title: t('sso.disableTitle'),
        body: t('sso.disableConfirm'),
        confirm: t('sso.disableAction'),
        onConfirm: handleDisableGoogleSso,
      };
    }
    if (confirmDialog === 'disableGithub') {
      return {
        title: t('sso.githubDisableTitle'),
        body: t('sso.githubDisableConfirm'),
        confirm: t('sso.githubDisableAction'),
        onConfirm: () => handleDisableSimple('github'),
      };
    }
    if (confirmDialog === 'disableM365') {
      return {
        title: t('sso.m365DisableTitle'),
        body: t('sso.m365DisableConfirm'),
        confirm: t('sso.m365DisableAction'),
        onConfirm: () => handleDisableSimple('m365'),
      };
    }
    if (confirmDialog === 'removeGoogle') {
      return {
        title: t('sso.removeTitle', { provider: t('sso.providers.google') }),
        body: t('sso.removeConfirm', { provider: t('sso.providers.google') }),
        confirm: t('sso.removeAction'),
        danger: true,
        onConfirm: () => void handleRemoveProvider('google'),
      };
    }
    if (confirmDialog === 'removeGithub') {
      return {
        title: t('sso.removeTitle', { provider: t('sso.providers.github') }),
        body: t('sso.removeConfirm', { provider: t('sso.providers.github') }),
        confirm: t('sso.removeAction'),
        danger: true,
        onConfirm: () => void handleRemoveProvider('github'),
      };
    }
    if (confirmDialog === 'removeM365') {
      return {
        title: t('sso.removeTitle', { provider: t('sso.providers.m365') }),
        body: t('sso.removeConfirm', { provider: t('sso.providers.m365') }),
        confirm: t('sso.removeAction'),
        danger: true,
        onConfirm: () => void handleRemoveProvider('m365'),
      };
    }
    return null;
  }, [confirmDialog, editingSettings, onSettingsChange, t]);

  const renderSecretField = (opts: {
    keyName: string;
    label: string;
    description: string;
    placeholder: string;
    leaveBlank: string;
    showLabel: string;
    hideLabel: string;
    disabled?: boolean;
    compact?: boolean;
  }) => {
    const draft = editingSettings[opts.keyName] || '';
    const secretSet =
      editingSettings[`${opts.keyName}_SET`] === 'true' ||
      Boolean(draft && isMaskedApiKeyDisplay(draft));
    const masked = isMaskedApiKeyDisplay(draft);
    const showToggle = draft.length > 0 && !masked;
    const visible = Boolean(showSecrets[opts.keyName]);
    const inputClass = opts.compact
      ? `${adminFieldClass(Boolean(opts.disabled), 'w-full')}${showToggle ? ' pr-10' : ''}`
      : `${adminInputWideClass}${showToggle ? ' pr-10' : ''}${opts.disabled ? ' opacity-70 cursor-not-allowed' : ''}`;
    return (
      <div data-setting-key={opts.keyName} className={opts.compact ? 'min-w-0' : undefined}>
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          <span>{opts.label}</span>
          <AdminFieldDraftControls
            settingKey={opts.keyName}
            saved={settings}
            draft={editingSettings}
            onRevert={() => revertField(opts.keyName)}
            hideWas
          />
        </label>
        <div className={`relative ${opts.compact ? 'w-full' : 'w-full max-w-xl'}`}>
          <input
            type={visible ? 'text' : 'password'}
            value={draft}
            onChange={(e) => handleInputChange(opts.keyName, e.target.value)}
            onFocus={() => {
              if (masked && !opts.disabled) handleInputChange(opts.keyName, '');
            }}
            disabled={opts.disabled}
            autoComplete="new-password"
            className={inputClass}
            placeholder={secretSet ? opts.leaveBlank : opts.placeholder}
          />
          {showToggle && (
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              onClick={() =>
                setShowSecrets((prev) => ({ ...prev, [opts.keyName]: !prev[opts.keyName] }))
              }
              aria-label={visible ? opts.hideLabel : opts.showLabel}
            >
              {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{opts.description}</p>
      </div>
    );
  };

  const renderTextField = (opts: {
    keyName: string;
    label: string;
    description: string;
    placeholder: string;
    disabled?: boolean;
    compact?: boolean;
  }) => (
    <div data-setting-key={opts.keyName} className={opts.compact ? 'min-w-0' : undefined}>
      <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        <span>{opts.label}</span>
        <AdminFieldDraftControls
          settingKey={opts.keyName}
          saved={settings}
          draft={editingSettings}
          onRevert={() => revertField(opts.keyName)}
        />
      </label>
      <input
        type="text"
        value={editingSettings[opts.keyName] || ''}
        onChange={(e) => handleInputChange(opts.keyName, e.target.value)}
        disabled={opts.disabled}
        className={
          opts.compact
            ? adminFieldClass(Boolean(opts.disabled), 'w-full')
            : `${adminInputWideClass}${opts.disabled ? ' opacity-70 cursor-not-allowed' : ''}`
        }
        placeholder={opts.placeholder}
      />
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{opts.description}</p>
    </div>
  );

  const credentialRow = (left: React.ReactNode, right: React.ReactNode) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{left}{right}</div>
  );

  const statusBadge = (active: boolean, pending: boolean) => {
    if (active) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:text-green-300">
          <CheckCircle2 size={12} aria-hidden />
          {t('sso.badgeActive')}
        </span>
      );
    }
    if (pending) {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
          {t('sso.badgePendingSave')}
        </span>
      );
    }
    return null;
  };

  const lastUsedLine = (provider: SsoProviderId) => {
    const formatted = formatSsoLastUsed(
      settings[SSO_LAST_SUCCESS_KEYS[provider]] ||
        editingSettings[SSO_LAST_SUCCESS_KEYS[provider]],
      i18n.language
    );
    if (!formatted) return null;
    return (
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
        {t('sso.lastUsed', { time: formatted })}
      </p>
    );
  };

  const loginPreview = (provider: SsoProviderId, hidden: boolean) => (
    <div
      className={`shrink-0 rounded-lg border border-dashed border-gray-200 dark:border-gray-600 bg-white/80 dark:bg-gray-800/50 px-2.5 py-2${
        hidden ? ' opacity-45 grayscale' : ''
      }`}
      aria-hidden="true"
    >
      <SsoLoginButton provider={provider} preview />
    </div>
  );

  const callbackWithPreview = (
    field: React.ReactNode,
    provider: SsoProviderId,
    hidden: boolean
  ) => (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">{field}</div>
      <div className="shrink-0 pt-7 flex justify-end">{loginPreview(provider, hidden)}</div>
    </div>
  );

  const cardSaveRow = (
    dirty: boolean,
    onRevert: () => void,
    onSaveCard: () => void,
    busy: boolean
  ) => (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
      <AdminUnsavedHint show={dirty} />
      <button
        type="button"
        onClick={onRevert}
        disabled={!dirty || busy}
        className="px-3 py-1.5 text-sm bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('sso.cancel')}
      </button>
      <button
        type="button"
        onClick={onSaveCard}
        disabled={!dirty || busy}
        className={`px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
          dirty ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-amber-400 ring-offset-2' : 'bg-blue-600'
        }`}
      >
        {t('sso.saveConfiguration')}
      </button>
    </div>
  );

  const removeCardButton = (
    kind: Exclude<ConfirmDialogKind, null>,
    provider: SsoProviderId,
    dirty: boolean
  ) => (
    <button
      type="button"
      onClick={() => setConfirmDialog(kind)}
      disabled={modeActionBusy || dirty}
      className={`${headerBtnClass} inline-flex items-center justify-center p-1 bg-transparent text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40`}
      aria-label={t('sso.removeAria', { provider: t(`sso.providers.${provider}`) })}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            {t('sso.pageTitle')}
          </h3>
        </div>
        {availableProviders.length > 0 && (
          <div className="relative shrink-0" data-sso-add-menu>
            <button
              type="button"
              onClick={() => setAddMenuOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('sso.addProvider')}
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1"
              >
                {availableProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    role="menuitem"
                    onClick={() => addProvider(provider.id)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {t(`sso.providers.${provider.id}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        {!showGoogle && !showGithub && !showM365 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('sso.emptyState')}</p>
        )}

        {showGoogle && (
          <section className={sectionClass} data-setting-key="GOOGLE_SSO_MODE">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t('sso.title')}
                  </h4>
                  {statusBadge(googleActive, googlePending)}
                  {savedGoogleMode === 'managed' && (
                    <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:text-blue-200">
                      {t('sso.badgeManaged')}
                    </span>
                  )}
                  {savedGoogleMode === 'byo' && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                      {t('sso.badgeByo')}
                    </span>
                  )}
                  {googleDisabled && (
                    <span className="inline-flex items-center rounded-full bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200">
                      {t('sso.badgeDisabled')}
                    </span>
                  )}
                </div>
                {lastUsedLine('google')}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {savedGoogleMode === 'managed' && draftGoogleMode === 'managed' && (
                  <button
                    type="button"
                    onClick={() => setConfirmDialog('byo')}
                    disabled={modeActionBusy || googleDirty}
                    className={`${headerBtnClass} bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-700`}
                  >
                    {t('sso.switchToByo')}
                  </button>
                )}
                {managedEligible && savedGoogleMode === 'byo' && (
                  <button
                    type="button"
                    onClick={() => setConfirmDialog('restoreManaged')}
                    disabled={modeActionBusy || googleDirty}
                    className={`${headerBtnClass} bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-700`}
                  >
                    {t('sso.restoreManagedAction')}
                  </button>
                )}
                {googleDisabled && (
                  <button
                    type="button"
                    onClick={() => void handleEnableGoogleSso()}
                    disabled={modeActionBusy}
                    className={`${headerBtnClass} bg-blue-600 text-white hover:bg-blue-700`}
                  >
                    {t('sso.reenableAction')}
                  </button>
                )}
                {(savedGoogleMode === 'managed' || savedGoogleMode === 'byo') && (
                  <button
                    type="button"
                    onClick={() => setConfirmDialog('disableGoogle')}
                    disabled={modeActionBusy || googleDirty}
                    className={`${headerBtnClass} bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`}
                  >
                    {t('sso.disableAction')}
                  </button>
                )}
                {removeCardButton('removeGoogle', 'google', googleDirty)}
              </div>
            </div>

            {googleDisabled && (
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                {googleResume === 'managed'
                  ? t('sso.disabledManagedDescription')
                  : t('sso.disabledByoDescription')}
              </p>
            )}

            {savedGoogleMode === 'managed' && draftGoogleMode === 'managed' && (
              <div
                className="rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/40 p-2.5"
                data-setting-key="GOOGLE_SSO_MANAGED"
              >
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-blue-700 dark:text-blue-300 leading-snug">
                      {t('sso.managedDescription')}
                    </p>
                    <p className="mt-1.5 text-xs text-blue-700 dark:text-blue-300">
                      <span className="font-medium">{t('sso.managedCallbackLabel')}: </span>
                      <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded break-all">
                        {hubCallbackDisplay}
                      </code>
                    </p>
                  </div>
                  {loginPreview('google', googleDisabled)}
                </div>
              </div>
            )}

            {(draftGoogleMode === 'byo' || (googleDisabled && googleResume === 'byo')) && (
              <>
                {credentialRow(
                  renderTextField({
                    keyName: 'GOOGLE_CLIENT_ID',
                    label: t('sso.googleClientId'),
                    description: t('sso.googleClientIdDescription'),
                    placeholder: t('sso.enterGoogleClientId'),
                    disabled: googleDisabled,
                    compact: true,
                  }),
                  renderSecretField({
                    keyName: 'GOOGLE_CLIENT_SECRET',
                    label: t('sso.googleClientSecret'),
                    description: t('sso.googleClientSecretDescription'),
                    placeholder: t('sso.enterGoogleClientSecret'),
                    leaveBlank: t('sso.googleClientSecretLeaveBlank'),
                    showLabel: t('sso.showGoogleClientSecret'),
                    hideLabel: t('sso.hideGoogleClientSecret'),
                    disabled: googleDisabled,
                    compact: true,
                  })
                )}
                {callbackWithPreview(
                  renderTextField({
                    keyName: 'GOOGLE_CALLBACK_URL',
                    label: t('sso.googleCallbackUrl'),
                    description: t('sso.googleCallbackUrlDescription', {
                      callbackUrl: googleCallbackExample,
                    }),
                    placeholder: t('sso.googleCallbackUrlPlaceholder', {
                      callbackUrl: googleCallbackExample,
                    }),
                    disabled: googleDisabled,
                  }),
                  'google',
                  googleDisabled
                )}
                {!googleDisabled &&
                  cardSaveRow(
                    googleDirty,
                    () =>
                      onSettingsChange(
                        revertSettingsKeys(GOOGLE_SSO_SAVE_KEYS, settings, editingSettings)
                      ),
                    () => void handleSaveProvider('google'),
                    savingProvider === 'google'
                  )}
              </>
            )}
            {googleDisabled && googleResume === 'managed' && (
              <div className="flex justify-end">{loginPreview('google', true)}</div>
            )}
          </section>
        )}

        {showGithub && (
          <section className={sectionClass} data-help-target="github-sso">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t('sso.githubTitle')}
                  </h4>
                  {statusBadge(githubActive, githubPending)}
                  {githubDisabled && (
                    <span className="inline-flex items-center rounded-full bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200">
                      {t('sso.badgeDisabled')}
                    </span>
                  )}
                </div>
                {lastUsedLine('github')}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {githubDisabled ? (
                  <button
                    type="button"
                    onClick={() => void handleEnableSimple('github')}
                    disabled={modeActionBusy}
                    className={`${headerBtnClass} bg-blue-600 text-white hover:bg-blue-700`}
                  >
                    {t('sso.reenableAction')}
                  </button>
                ) : (
                  savedGithubMode === 'byo' && (
                    <button
                      type="button"
                      onClick={() => setConfirmDialog('disableGithub')}
                      disabled={modeActionBusy || githubDirty}
                      className={`${headerBtnClass} bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`}
                    >
                      {t('sso.githubDisableAction')}
                    </button>
                  )
                )}
                {removeCardButton('removeGithub', 'github', githubDirty)}
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
              {t('sso.githubSaveNote')}
            </p>
            {credentialRow(
              renderTextField({
                keyName: 'GITHUB_CLIENT_ID',
                label: t('sso.githubClientId'),
                description: t('sso.githubClientIdDescription'),
                placeholder: t('sso.enterGithubClientId'),
                disabled: githubDisabled,
                compact: true,
              }),
              renderSecretField({
                keyName: 'GITHUB_CLIENT_SECRET',
                label: t('sso.githubClientSecret'),
                description: t('sso.githubClientSecretDescription'),
                placeholder: t('sso.enterGithubClientSecret'),
                leaveBlank: t('sso.githubClientSecretLeaveBlank'),
                showLabel: t('sso.showGithubClientSecret'),
                hideLabel: t('sso.hideGithubClientSecret'),
                disabled: githubDisabled,
                compact: true,
              })
            )}
            {callbackWithPreview(
              renderTextField({
                keyName: 'GITHUB_CALLBACK_URL',
                label: t('sso.githubCallbackUrl'),
                description: t('sso.githubCallbackUrlDescription', {
                  callbackUrl: githubCallbackExample,
                }),
                placeholder: t('sso.githubCallbackUrlPlaceholder', {
                  callbackUrl: githubCallbackExample,
                }),
                disabled: githubDisabled,
              }),
              'github',
              githubDisabled
            )}
            {!githubDisabled &&
              cardSaveRow(
                githubDirty,
                () =>
                  onSettingsChange(revertSettingsKeys(GITHUB_SSO_SAVE_KEYS, settings, editingSettings)),
                () => void handleSaveProvider('github'),
                savingProvider === 'github'
              )}
          </section>
        )}

        {showM365 && (
          <section className={sectionClass} data-help-target="m365-sso">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t('sso.m365Title')}
                  </h4>
                  {statusBadge(m365Active, m365Pending)}
                  {m365Disabled && (
                    <span className="inline-flex items-center rounded-full bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200">
                      {t('sso.badgeDisabled')}
                    </span>
                  )}
                </div>
                {lastUsedLine('m365')}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {m365Disabled ? (
                  <button
                    type="button"
                    onClick={() => void handleEnableSimple('m365')}
                    disabled={modeActionBusy}
                    className={`${headerBtnClass} bg-blue-600 text-white hover:bg-blue-700`}
                  >
                    {t('sso.reenableAction')}
                  </button>
                ) : (
                  savedM365Mode === 'byo' && (
                    <button
                      type="button"
                      onClick={() => setConfirmDialog('disableM365')}
                      disabled={modeActionBusy || m365Dirty}
                      className={`${headerBtnClass} bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`}
                    >
                      {t('sso.m365DisableAction')}
                    </button>
                  )
                )}
                {removeCardButton('removeM365', 'm365', m365Dirty)}
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
              {t('sso.m365SaveNote')}
            </p>
            {credentialRow(
              renderTextField({
                keyName: 'M365_CLIENT_ID',
                label: t('sso.m365ClientId'),
                description: t('sso.m365ClientIdDescription'),
                placeholder: t('sso.enterM365ClientId'),
                disabled: m365Disabled,
                compact: true,
              }),
              renderSecretField({
                keyName: 'M365_CLIENT_SECRET',
                label: t('sso.m365ClientSecret'),
                description: t('sso.m365ClientSecretDescription'),
                placeholder: t('sso.enterM365ClientSecret'),
                leaveBlank: t('sso.m365ClientSecretLeaveBlank'),
                showLabel: t('sso.showM365ClientSecret'),
                hideLabel: t('sso.hideM365ClientSecret'),
                disabled: m365Disabled,
                compact: true,
              })
            )}
            {renderTextField({
              keyName: 'M365_TENANT_ID',
              label: t('sso.m365TenantId'),
              description: t('sso.m365TenantIdDescription'),
              placeholder: t('sso.enterM365TenantId'),
              disabled: m365Disabled,
            })}
            {callbackWithPreview(
              renderTextField({
                keyName: 'M365_CALLBACK_URL',
                label: t('sso.m365CallbackUrl'),
                description: t('sso.m365CallbackUrlDescription', {
                  callbackUrl: m365CallbackExample,
                }),
                placeholder: t('sso.m365CallbackUrlPlaceholder', {
                  callbackUrl: m365CallbackExample,
                }),
                disabled: m365Disabled,
              }),
              'm365',
              m365Disabled
            )}
            {!m365Disabled &&
              cardSaveRow(
                m365Dirty,
                () =>
                  onSettingsChange(revertSettingsKeys(M365_SSO_SAVE_KEYS, settings, editingSettings)),
                () => void handleSaveProvider('m365'),
                savingProvider === 'm365'
              )}
          </section>
        )}
      </div>

      {confirmDialog && confirmCopy && (
        <div
          className="fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            data-sso-confirm-dialog
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
          >
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              {confirmCopy.title}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">
              {confirmCopy.body}
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={modeActionBusy}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md"
              >
                {t('sso.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmCopy.onConfirm}
                disabled={modeActionBusy}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 ${
                  confirmCopy.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600'
                }`}
              >
                {confirmCopy.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSSOTab;
