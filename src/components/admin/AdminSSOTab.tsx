import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isMaskedApiKeyDisplay } from '../../utils/maskSecret';
import {
  adminSettingsHaveChanges,
  revertAdminSettingField,
} from '../../utils/adminSettingsDirty';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import {
  AdminActionsBar,
  AdminPageShell,
  AdminSection,
  adminInputWideClass,
} from './AdminSection';

interface Settings {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_SECRET_SET?: string;
  GOOGLE_CALLBACK_URL?: string;
  [key: string]: string | undefined;
}

interface AdminSSOTabProps {
  settings: Settings;
  editingSettings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: () => void;
  onCancel: () => void;
  onReloadOAuth: () => void;
}

const AdminSSOTab: React.FC<AdminSSOTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onReloadOAuth,
}) => {
  const { t } = useTranslation('admin');
  const hasChanges = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );
  const googleCallbackExample = useMemo(() => {
    if (typeof window === 'undefined') {
      return '/api/auth/google/callback';
    }
    return `${window.location.origin}/api/auth/google/callback`;
  }, []);
  const handleInputChange = (key: string, value: string) => {
    onSettingsChange({ ...editingSettings, [key]: value });
  };

  const revertField = (key: string) => {
    onSettingsChange(revertAdminSettingField(key, settings, editingSettings));
  };

  const clientSecretSet =
    editingSettings.GOOGLE_CLIENT_SECRET_SET === 'true' ||
    Boolean(
      editingSettings.GOOGLE_CLIENT_SECRET &&
        isMaskedApiKeyDisplay(editingSettings.GOOGLE_CLIENT_SECRET)
    );
  const clientSecretDraft = editingSettings.GOOGLE_CLIENT_SECRET || '';

  return (
    <AdminPageShell width="full">
      <AdminSection title={t('sso.title')} description={t('sso.description')} dense>
        <div className="space-y-2.5">
          <div data-setting-key="GOOGLE_CLIENT_ID">
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('sso.googleClientId')}</span>
              <AdminFieldDraftControls
                settingKey="GOOGLE_CLIENT_ID"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('GOOGLE_CLIENT_ID')}
              />
            </label>
            <input
              type="text"
              value={editingSettings.GOOGLE_CLIENT_ID || ''}
              onChange={(e) => handleInputChange('GOOGLE_CLIENT_ID', e.target.value)}
              className={adminInputWideClass}
              placeholder={t('sso.enterGoogleClientId')}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('sso.googleClientIdDescription')}
            </p>
          </div>

          <div data-setting-key="GOOGLE_CLIENT_SECRET">
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('sso.googleClientSecret')}</span>
              <AdminFieldDraftControls
                settingKey="GOOGLE_CLIENT_SECRET"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('GOOGLE_CLIENT_SECRET')}
                hideWas
              />
            </label>
            <input
              type="password"
              value={clientSecretDraft}
              onChange={(e) => handleInputChange('GOOGLE_CLIENT_SECRET', e.target.value)}
              onFocus={() => {
                if (isMaskedApiKeyDisplay(clientSecretDraft)) {
                  handleInputChange('GOOGLE_CLIENT_SECRET', '');
                }
              }}
              autoComplete="new-password"
              className={adminInputWideClass}
              placeholder={
                clientSecretSet
                  ? t('sso.googleClientSecretLeaveBlank')
                  : t('sso.enterGoogleClientSecret')
              }
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('sso.googleClientSecretDescription')}
            </p>
          </div>

          <div data-setting-key="GOOGLE_CALLBACK_URL">
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('sso.googleCallbackUrl')}</span>
              <AdminFieldDraftControls
                settingKey="GOOGLE_CALLBACK_URL"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('GOOGLE_CALLBACK_URL')}
              />
            </label>
            <input
              type="text"
              value={editingSettings.GOOGLE_CALLBACK_URL || ''}
              onChange={(e) => handleInputChange('GOOGLE_CALLBACK_URL', e.target.value)}
              className={adminInputWideClass}
              placeholder={t('sso.googleCallbackUrlPlaceholder', {
                callbackUrl: googleCallbackExample,
              })}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('sso.googleCallbackUrlDescription', {
                callbackUrl: googleCallbackExample,
              })}
            </p>
          </div>

          <div className="rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/40 p-3">
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {t('sso.hotReloadEnabled')}
            </h4>
            <div className="mt-1 text-xs text-blue-700 dark:text-blue-300 leading-snug">
              <p>{t('sso.hotReloadDescription')}</p>
            </div>
          </div>
        </div>
      </AdminSection>

      <AdminActionsBar className="justify-between">
        <AdminUnsavedHint show={hasChanges} />
        <div className="flex flex-wrap gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            disabled={!hasChanges}
            className="px-4 py-1.5 text-sm bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('sso.cancel')}
          </button>
          <button
            type="button"
            onClick={onReloadOAuth}
            className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            {t('sso.reloadOAuthConfig')}
          </button>
          <button
            type="button"
            onClick={() => onSave()}
            disabled={!hasChanges}
            className={`px-4 py-1.5 text-sm text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              hasChanges
                ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-amber-400 ring-offset-2'
                : 'bg-blue-600'
            }`}
          >
            {t('sso.saveConfiguration')}
          </button>
        </div>
      </AdminActionsBar>
    </AdminPageShell>
  );
};

export default AdminSSOTab;
