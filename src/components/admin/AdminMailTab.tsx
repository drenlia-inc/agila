import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import api from '../../api';
import { toast } from '../../utils/toast';
import { isMaskedApiKeyDisplay } from '../../utils/maskSecret';
import {
  adminSettingsHaveChanges,
  revertAdminSettingField,
} from '../../utils/adminSettingsDirty';
import {
  ADMIN_NUMERIC_INPUT_CLASS,
  SMTP_PORT,
  clampIntToString,
} from '../../utils/adminFieldLimits';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import {
  AdminActionsBar,
  AdminPageShell,
  AdminSection,
  adminInputBoundedClass,
  adminInputShortClass,
} from './AdminSection';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';

interface Settings {
  MAIL_ENABLED?: string;
  MAIL_MANAGED?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_PASSWORD_SET?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_SECURE?: string;
  [key: string]: string | undefined;
}

interface TestEmailResult {
  message: string;
  messageId: string;
  settings: {
    to: string;
    host: string;
    port: string;
    secure: string;
    from: string;
  };
}

interface AdminMailTabProps {
  settings: Settings;
  editingSettings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: () => void;
  onCancel: () => void;
  onTestEmail: () => Promise<void>;
  onMailServerDisabled: () => void;
  isTestingEmail: boolean;
  showTestEmailModal: boolean;
  testEmailResult: TestEmailResult | null;
  onCloseTestModal: () => void;
  showTestEmailErrorModal: boolean;
  testEmailError: string;
  onCloseTestErrorModal: () => void;
  onAutoSave?: (key: string, value: string) => Promise<void>;
  onSettingsReload?: (options?: { quiet?: boolean }) => Promise<void>;
}

const AdminMailTab: React.FC<AdminMailTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onTestEmail,
  onMailServerDisabled,
  isTestingEmail,
  showTestEmailModal,
  testEmailResult,
  onCloseTestModal,
  showTestEmailErrorModal,
  testEmailError,
  onCloseTestErrorModal,
  onAutoSave,
  onSettingsReload,
}) => {
  const { t } = useTranslation('admin');
  const hasChanges = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );
  const [showFirstConfirm, setShowFirstConfirm] = useState(false);
  const [showSecondConfirm, setShowSecondConfirm] = useState(false);

  useEscapeDismiss(
    () => {
      if (showSecondConfirm) {
        setShowSecondConfirm(false);
        return;
      }
      if (showFirstConfirm) {
        setShowFirstConfirm(false);
        return;
      }
      if (showTestEmailModal) {
        onCloseTestModal();
        return;
      }
      if (showTestEmailErrorModal) {
        onCloseTestErrorModal();
      }
    },
    {
      enabled:
        showFirstConfirm ||
        showSecondConfirm ||
        showTestEmailModal ||
        showTestEmailErrorModal,
    }
  );
  
  const handleInputChange = (key: string, value: string) => {
    onSettingsChange({ ...editingSettings, [key]: value });
  };

  const revertField = (key: string) => {
    onSettingsChange(revertAdminSettingField(key, settings, editingSettings));
  };

  const mailFieldLabel = (key: string, label: string, opts?: { hideWas?: boolean }) => (
    <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      <span>{label}</span>
      {!isManagedEmail && (
        <AdminFieldDraftControls
          settingKey={key}
          saved={settings}
          draft={editingSettings}
          onRevert={() => revertField(key)}
          hideWas={opts?.hideWas}
        />
      )}
    </label>
  );
  
  const smtpPasswordSet =
    editingSettings.SMTP_PASSWORD_SET === 'true' ||
    Boolean(editingSettings.SMTP_PASSWORD && isMaskedApiKeyDisplay(editingSettings.SMTP_PASSWORD));
  const smtpPasswordDraft = editingSettings.SMTP_PASSWORD || '';
  const smtpPasswordReady =
    smtpPasswordSet ||
    (Boolean(smtpPasswordDraft.trim()) && !isMaskedApiKeyDisplay(smtpPasswordDraft));

  // Check if all required fields for testing are filled
  const canTestEmail = () => {
    return editingSettings.SMTP_HOST && 
           editingSettings.SMTP_PORT && 
           editingSettings.SMTP_USERNAME && 
           smtpPasswordReady && 
           editingSettings.SMTP_FROM_EMAIL;
  };

  // Check if running in demo mode
  const isDemoMode = process.env.DEMO_ENABLED === 'true';
  
  // Check if email is managed
  const isManagedEmail = editingSettings.MAIL_MANAGED === 'true';

  const mailFieldClass = (disabled = false) =>
    `${adminInputBoundedClass}${disabled ? ' bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : ''}`;

  return (
    <>
      <div data-setting-key="MAIL_SECTION">
      <AdminPageShell width="full">
        {/* Demo Mode Warning */}
        {isDemoMode && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/40 p-3">
            <div className="flex items-start gap-2">
              <svg className="h-5 w-5 text-amber-400 dark:text-amber-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('mail.demoModeActive')}</h3>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5 leading-snug">
                  {t('mail.demoModeDescription')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Managed Email Status */}
        {editingSettings.MAIL_MANAGED === 'true' && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/40 p-3">
            <div className="flex items-start gap-2">
              <svg className="h-5 w-5 text-blue-400 dark:text-blue-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">{t('mail.managedEmailService')}</h3>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5 leading-snug">
                  {t('mail.managedEmailDescription')} <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{editingSettings.SMTP_FROM_EMAIL || 'noreply@agila.dev'}</code>.
                </p>
                <div className="mt-2" data-owner-setup="switch-custom-smtp">
                  <button
                    type="button"
                    onClick={() => setShowFirstConfirm(true)}
                    className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2.5 py-1 rounded-md hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors"
                  >
                    {t('mail.switchToCustomSMTP')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <AdminSection dense>
          <div className="flex items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-gray-800" data-setting-key="MAIL_ENABLED">
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('mail.mailServerStatus')}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {isDemoMode
                  ? t('mail.statusDemoMode')
                  : !testEmailResult
                    ? t('mail.statusTestRequired')
                    : t('mail.statusTestedSuccessfully')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`text-xs font-medium ${
                isDemoMode ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'
              }`}>
                {isDemoMode ? t('mail.disabledDemo') : editingSettings.MAIL_ENABLED === 'true' ? t('mail.enabled') : t('mail.disabled')}
              </span>
              <button
                type="button"
                onClick={async () => {
                  if (!isDemoMode && testEmailResult) {
                    const newValue = editingSettings.MAIL_ENABLED === 'true' ? 'false' : 'true';
                    handleInputChange('MAIL_ENABLED', newValue);
                    try {
                      await api.put('/admin/settings', { key: 'MAIL_ENABLED', value: newValue });
                      if (newValue === 'false' && testEmailResult) {
                        onMailServerDisabled();
                      }
                    } catch (error) {
                      console.error('Failed to save mail server toggle:', error);
                      handleInputChange('MAIL_ENABLED', editingSettings.MAIL_ENABLED === 'true' ? 'false' : 'true');
                    }
                  }
                }}
                disabled={isDemoMode || !testEmailResult}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  isDemoMode || !testEmailResult
                    ? 'bg-gray-200 dark:bg-gray-600 cursor-not-allowed'
                    : editingSettings.MAIL_ENABLED === 'true'
                      ? 'bg-blue-600 dark:bg-blue-500 cursor-pointer'
                      : 'bg-gray-200 dark:bg-gray-600 cursor-pointer'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-300 shadow ring-0 transition duration-200 ease-in-out ${
                    editingSettings.MAIL_ENABLED === 'true' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div
            className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-gray-800"
            data-setting-key="TASK_EMAIL_NOTIFICATIONS_ENABLED"
          >
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('mail.taskEmailNotificationsLabel')}
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {editingSettings.TASK_NOTIFICATION_CHANNELS === 'webhooks'
                  ? t('mail.taskEmailNotificationsWebhooksOnlyHint')
                  : t('mail.taskEmailNotificationsHint')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {editingSettings.TASK_EMAIL_NOTIFICATIONS_ENABLED !== 'false'
                  ? t('mail.taskEmailNotificationsOn')
                  : t('mail.taskEmailNotificationsOff')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={editingSettings.TASK_EMAIL_NOTIFICATIONS_ENABLED !== 'false'}
                aria-label={t('mail.taskEmailNotificationsLabel')}
                disabled={editingSettings.TASK_NOTIFICATION_CHANNELS === 'webhooks'}
                onClick={async () => {
                  if (editingSettings.TASK_NOTIFICATION_CHANNELS === 'webhooks') return;
                  const currentlyOn = editingSettings.TASK_EMAIL_NOTIFICATIONS_ENABLED !== 'false';
                  const newValue = currentlyOn ? 'false' : 'true';
                  handleInputChange('TASK_EMAIL_NOTIFICATIONS_ENABLED', newValue);
                  try {
                    await api.put('/admin/settings', {
                      key: 'TASK_EMAIL_NOTIFICATIONS_ENABLED',
                      value: newValue,
                    });
                    toast.success(
                      newValue === 'true'
                        ? t('mail.taskEmailNotificationsEnabledToast')
                        : t('mail.taskEmailNotificationsPausedToast'),
                      ''
                    );
                  } catch (error) {
                    console.error('Failed to save task email notifications toggle:', error);
                    handleInputChange(
                      'TASK_EMAIL_NOTIFICATIONS_ENABLED',
                      currentlyOn ? 'true' : 'false'
                    );
                    toast.error(t('failedToSaveSettings'), '');
                  }
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  editingSettings.TASK_NOTIFICATION_CHANNELS === 'webhooks'
                    ? 'bg-gray-200 dark:bg-gray-600 cursor-not-allowed'
                    : editingSettings.TASK_EMAIL_NOTIFICATIONS_ENABLED !== 'false'
                    ? 'bg-blue-600 dark:bg-blue-500 cursor-pointer'
                    : 'bg-gray-200 dark:bg-gray-600 cursor-pointer'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-300 shadow ring-0 transition duration-200 ease-in-out ${
                    editingSettings.TASK_EMAIL_NOTIFICATIONS_ENABLED !== 'false'
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div data-setting-key="SMTP_HOST">
                {mailFieldLabel('SMTP_HOST', t('mail.smtpHost'))}
                <input
                  type="text"
                  value={editingSettings.SMTP_HOST || ''}
                  onChange={(e) => handleInputChange('SMTP_HOST', e.target.value)}
                  onFocus={() => {
                    if (!editingSettings.SMTP_HOST) {
                      handleInputChange('SMTP_HOST', 'smtp.gmail.com');
                    }
                  }}
                  disabled={isManagedEmail}
                  className={mailFieldClass(isManagedEmail)}
                  placeholder="smtp.gmail.com"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.smtpHostDescription')} <span className="text-blue-600">{t('mail.autoFillHint')}</span>
                </p>
              </div>

              <div data-setting-key="SMTP_PORT">
                {mailFieldLabel('SMTP_PORT', t('mail.smtpPort'))}
                <input
                  type="number"
                  inputMode="numeric"
                  value={editingSettings.SMTP_PORT || ''}
                  onChange={(e) => handleInputChange('SMTP_PORT', e.target.value)}
                  onFocus={() => {
                    if (!editingSettings.SMTP_PORT) {
                      handleInputChange('SMTP_PORT', '587');
                    }
                  }}
                  onBlur={() => {
                    const raw = editingSettings.SMTP_PORT;
                    if (raw === undefined || raw === '') return;
                    handleInputChange(
                      'SMTP_PORT',
                      clampIntToString(raw, SMTP_PORT.min, SMTP_PORT.max, 587)
                    );
                  }}
                  disabled={isManagedEmail}
                  className={`${adminInputShortClass}${isManagedEmail ? ' bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : ''} ${ADMIN_NUMERIC_INPUT_CLASS}`}
                  placeholder="587"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.smtpPortDescription')} <span className="text-blue-600">{t('mail.autoFillPortHint')}</span>
                </p>
              </div>

              <div data-setting-key="SMTP_FROM_EMAIL">
                {mailFieldLabel('SMTP_FROM_EMAIL', t('mail.fromEmail'))}
                <input
                  type="email"
                  value={editingSettings.SMTP_FROM_EMAIL || ''}
                  onChange={(e) => handleInputChange('SMTP_FROM_EMAIL', e.target.value)}
                  disabled={isManagedEmail}
                  className={mailFieldClass(isManagedEmail)}
                  placeholder="admin@example.com"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.fromEmailDescription')}
                </p>
              </div>

              <div data-setting-key="SMTP_FROM_NAME">
                {mailFieldLabel('SMTP_FROM_NAME', t('mail.fromName'))}
                <input
                  type="text"
                  value={editingSettings.SMTP_FROM_NAME || ''}
                  onChange={(e) => handleInputChange('SMTP_FROM_NAME', e.target.value)}
                  disabled={isManagedEmail}
                  className={mailFieldClass(isManagedEmail)}
                  placeholder={t('mail.fromNamePlaceholder')}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.fromNameDescription')}
                </p>
              </div>

              <div data-setting-key="SMTP_USERNAME">
                {mailFieldLabel('SMTP_USERNAME', t('mail.smtpUsername'))}
                <input
                  type="text"
                  value={editingSettings.SMTP_USERNAME || ''}
                  onChange={(e) => handleInputChange('SMTP_USERNAME', e.target.value)}
                  disabled={isManagedEmail}
                  className={mailFieldClass(isManagedEmail)}
                  placeholder="admin@example.com"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.smtpUsernameDescription')}
                </p>
              </div>

              <div data-setting-key="SMTP_PASSWORD">
                <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <span>{t('mail.smtpPassword')}</span>
                  {!isManagedEmail && (
                    <AdminFieldDraftControls
                      settingKey="SMTP_PASSWORD"
                      saved={settings}
                      draft={editingSettings}
                      onRevert={() => revertField('SMTP_PASSWORD')}
                      hideWas
                    />
                  )}
                </label>
                <input
                  type="password"
                  value={smtpPasswordDraft}
                  onChange={(e) => handleInputChange('SMTP_PASSWORD', e.target.value)}
                  onFocus={() => {
                    if (isMaskedApiKeyDisplay(smtpPasswordDraft)) {
                      handleInputChange('SMTP_PASSWORD', '');
                    }
                  }}
                  disabled={isManagedEmail}
                  autoComplete="new-password"
                  className={mailFieldClass(isManagedEmail)}
                  placeholder={
                    smtpPasswordSet
                      ? t('mail.smtpPasswordLeaveBlank')
                      : t('mail.enterSmtpPassword')
                  }
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.smtpPasswordDescription')}
                </p>
              </div>

              <div data-setting-key="SMTP_SECURE">
                {mailFieldLabel('SMTP_SECURE', t('mail.smtpSecurity'))}
                <select
                  value={editingSettings.SMTP_SECURE || 'tls'}
                  onChange={(e) => handleInputChange('SMTP_SECURE', e.target.value)}
                  disabled={isManagedEmail}
                  className={mailFieldClass(isManagedEmail)}
                >
                  <option value="tls">{t('mail.tlsRecommended')}</option>
                  <option value="ssl">{t('mail.ssl')}</option>
                  <option value="none">{t('mail.nonePlain')}</option>
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('mail.smtpSecurityDescription')}
                </p>
              </div>
          </div>
        </AdminSection>

        {!isDemoMode && !testEmailResult && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/40 p-3">
            <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('mail.testingRequired')}</h4>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300 leading-snug">
              {t('mail.testingRequiredDescription')}
            </p>
          </div>
        )}

        <AdminActionsBar className="justify-between">
            <AdminUnsavedHint show={hasChanges} />
            <div className="flex flex-wrap gap-2 ml-auto">
              <button
                type="button"
                onClick={onCancel}
                disabled={!hasChanges}
                className="px-4 py-1.5 text-sm bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('mail.cancel')}
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
                {t('mail.saveConfiguration')}
              </button>
              <button
                type="button"
                onClick={isDemoMode || isManagedEmail ? undefined : onTestEmail}
                disabled={isTestingEmail || isDemoMode || isManagedEmail || !canTestEmail()}
                data-setting-key="MAIL_TEST_EMAIL"
                className={`px-4 py-1.5 text-sm text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isTestingEmail || isDemoMode || isManagedEmail || !canTestEmail()
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                }`}
                title={
                  isDemoMode
                    ? t('mail.testDisabledDemo')
                    : isManagedEmail
                      ? t('mail.testNotNeededManaged')
                      : !canTestEmail()
                        ? t('mail.fillRequiredFields')
                        : undefined
                }
              >
                {isTestingEmail ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('mail.testing')}
                  </>
                ) : isDemoMode ? (
                  t('mail.testEmailDisabledDemo')
                ) : isManagedEmail ? (
                  t('mail.testEmailNotNeededManaged')
                ) : (
                  t('mail.testEmail')
                )}
              </button>
            </div>
        </AdminActionsBar>
      </AdminPageShell>
      </div>

      {/* Test Email Success Modal */}
      {showTestEmailModal && testEmailResult && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border border-gray-300 dark:border-gray-600 w-96 shadow-lg rounded-md bg-white dark:bg-gray-800">
            <div className="mt-3 text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100 mt-4">
                {t('mail.emailSentSuccessfully')}
              </h3>
              <div className="mt-4 px-2 py-3 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600 space-y-2">
                  <p><strong>{t('mail.message')}:</strong> {testEmailResult.message}</p>
                  <p><strong>{t('mail.to')}:</strong> {testEmailResult.settings.to}</p>
                  <p><strong>{t('mail.messageId')}:</strong> {testEmailResult.messageId}</p>
                  <div className="border-t pt-2 mt-2">
                    <p className="font-medium text-gray-700 mb-1">{t('mail.configurationUsed')}:</p>
                    <p><strong>{t('mail.host')}:</strong> {testEmailResult.settings.host}</p>
                    <p><strong>{t('mail.port')}:</strong> {testEmailResult.settings.port}</p>
                    <p><strong>{t('mail.secure')}:</strong> {testEmailResult.settings.secure}</p>
                    <p><strong>{t('mail.from')}:</strong> {testEmailResult.settings.from}</p>
                  </div>
                </div>
              </div>
              <div className="items-center px-4 py-3">
                <button
                  onClick={onCloseTestModal}
                  className="px-4 py-2 bg-blue-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {t('mail.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test Email Error Modal */}
      {showTestEmailErrorModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border border-gray-300 dark:border-gray-600 w-96 shadow-lg rounded-md bg-white dark:bg-gray-800">
            <div className="mt-3 text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </div>
              <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-gray-100 mt-4">
                {t('mail.emailTestFailed')}
              </h3>
              <div className="mt-4 px-2 py-3 bg-red-50 rounded-lg">
                <div className="text-sm text-red-700">
                  <p className="font-medium mb-2">{t('mail.backendResponseDetails')}:</p>
                  <pre className="bg-red-100 p-2 rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                    {testEmailError}
                  </pre>
                  <div className="mt-3 text-xs text-red-600">
                    <p>{t('mail.commonTroubleshootingSteps')}:</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>{t('mail.checkEndpoint')}</li>
                      <li>{t('mail.verifySmtpSettings')}</li>
                      <li>{t('mail.checkCredentials')}</li>
                      <li>{t('mail.verifyPortSecurity')}</li>
                      <li>{t('mail.testNetworkConnectivity')}</li>
                    </ul>
                  </div>
                </div>
              </div>
              <div className="items-center px-4 py-3">
                <button
                  onClick={onCloseTestErrorModal}
                  className="px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {t('mail.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* First Confirmation Modal */}
      {showFirstConfirm && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                  {t('mail.switchToCustomSMTP')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('mail.switchToCustomSMTPConfirm')}
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowFirstConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {t('buttons.cancel', { ns: 'common' })}
              </button>
              <button
                onClick={() => {
                  setShowFirstConfirm(false);
                  setShowSecondConfirm(true);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {t('buttons.continue', { ns: 'common' }) || 'Continue'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Second Confirmation Modal */}
      {showSecondConfirm && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start mb-4">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                  {t('mail.switchToCustomSMTP')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('mail.switchToCustomSMTPConfirmFinal')}
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowSecondConfirm(false);
                  setShowFirstConfirm(true);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {t('buttons.back', { ns: 'common' }) || 'Back'}
              </button>
              <button
                onClick={async () => {
                  setShowSecondConfirm(false);
                  try {
                    // Clear all mail-related settings in the database with a single API call
                    await api.post('/admin/settings/clear-mail');
                    
                    // Reload settings from server to get the cleared values
                    if (onSettingsReload) {
                      await onSettingsReload();
                    }
                    
                    // Update local state to clear all mail-related fields
                    // Note: SMTP_SECURE is initialized to 'tls' (the default) so it will be saved
                    // when the user saves or tests, even if they don't explicitly change the dropdown
                    const updatedSettings = {
                      ...editingSettings,
                      MAIL_MANAGED: 'false',
                      SMTP_HOST: '',
                      SMTP_PORT: '',
                      SMTP_USERNAME: '',
                      SMTP_PASSWORD: '',
                      SMTP_FROM_EMAIL: '',
                      SMTP_FROM_NAME: '',
                      SMTP_SECURE: 'tls', // Initialize to default 'tls' so it will be saved
                      MAIL_ENABLED: 'false',
                    };
                    onSettingsChange(updatedSettings);
                    
                    // Show success message
                    toast.success(t('mail.switchedToCustomSMTP') || 'Switched to custom SMTP settings', '');
                  } catch (error) {
                    console.error('Failed to switch to custom SMTP:', error);
                    toast.error(t('mail.failedToSwitchToCustomSMTP') || 'Failed to switch to custom SMTP settings', '');
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                {t('buttons.confirm', { ns: 'common' }) || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default AdminMailTab;
