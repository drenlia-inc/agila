import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, X } from 'lucide-react';
import api from '../../api';
import { getAuthenticatedAvatarUrl } from '../../utils/authImageUrl';
import { useSettings } from '../../contexts/SettingsContext';
import { adminSettingsHaveChanges } from '../../utils/adminSettingsDirty';
import { revertAdminSettingField } from '../../utils/adminSettingsDirty';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import AdminLogoCropModal from './AdminLogoCropModal';
import {
  AdminActionsBar,
  AdminPageShell,
  AdminSection,
  adminInputFullClass,
} from './AdminSection';
import {
  DEFAULT_SITE_LOGO,
  DEFAULT_SITE_LOGO_DARK,
  isPublicBrandAssetPath,
} from '../../constants';

interface Settings {
  SITE_NAME?: string;
  SITE_URL?: string;
  WEBSITE_URL?: string;
  SITE_OPENS_NEW_TAB?: string;
  SITE_LOGO?: string;
  SITE_LOGO_DARK?: string;
  HIDE_GITHUB_LINK?: string;
  HIDE_SITE_LOGO?: string;
  [key: string]: string | undefined;
}

interface AdminSiteSettingsTabProps {
  settings: Settings;
  editingSettings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onSave: () => void;
  onCancel: () => void;
  onAutoSave?: (key: string, value: string) => Promise<void>;
}

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

type LogoCropSession = {
  variant: 'light' | 'dark';
  imageSrc: string;
  /** True when imageSrc is a blob: URL we must revoke on close */
  revokeOnClose: boolean;
};

const AdminSiteSettingsTab: React.FC<AdminSiteSettingsTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onAutoSave,
}) => {
  const { t } = useTranslation('admin');
  const { updateSiteSetting } = useSettings();
  const lightFileRef = useRef<HTMLInputElement>(null);
  const darkFileRef = useRef<HTMLInputElement>(null);
  const [uploadingLight, setUploadingLight] = useState(false);
  const [uploadingDark, setUploadingDark] = useState(false);
  const [cropSession, setCropSession] = useState<LogoCropSession | null>(null);
  const hasChanges = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );

  const handleInputChange = (key: string, value: string) => {
    onSettingsChange({ ...editingSettings, [key]: value });
  };

  const revertField = (key: string) => {
    onSettingsChange(revertAdminSettingField(key, settings, editingSettings));
  };

  const resolvePreviewSrc = (value: string | undefined, variant: 'light' | 'dark') => {
    const trimmed = value?.trim() || '';
    if (trimmed) {
      if (
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        isPublicBrandAssetPath(trimmed)
      ) {
        return trimmed;
      }
      // Never fall back to bare `/avatars/...` (Express returns 404 for that path)
      return (
        getAuthenticatedAvatarUrl(trimmed) ||
        (variant === 'dark' ? DEFAULT_SITE_LOGO_DARK : DEFAULT_SITE_LOGO)
      );
    }
    // Match header fallback: dark → light custom → theme default Agila logo
    if (variant === 'dark') {
      const light = editingSettings.SITE_LOGO?.trim() || '';
      if (light) {
        if (
          light.startsWith('http://') ||
          light.startsWith('https://') ||
          isPublicBrandAssetPath(light)
        ) {
          return light;
        }
        return getAuthenticatedAvatarUrl(light) || DEFAULT_SITE_LOGO_DARK;
      }
      return DEFAULT_SITE_LOGO_DARK;
    }
    return DEFAULT_SITE_LOGO;
  };

  const closeCropSession = () => {
    setCropSession((current) => {
      if (current?.revokeOnClose) {
        URL.revokeObjectURL(current.imageSrc);
      }
      return null;
    });
  };

  const validateLogoFile = (file: File): string | null => {
    const mime = String(file.type || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!LOGO_ALLOWED_MIME.has(mime)) {
      return t('siteSettings.logoInvalidType');
    }
    if (file.size > LOGO_MAX_BYTES) {
      return t('siteSettings.logoTooLarge');
    }
    const name = file.name.toLowerCase();
    if (name.endsWith('.svg') || name.endsWith('.svgz')) {
      return t('siteSettings.logoInvalidType');
    }
    return null;
  };

  const openCropForFile = (file: File, variant: 'light' | 'dark') => {
    const validationError = validateLogoFile(file);
    if (validationError) {
      alert(validationError);
      return;
    }
    const imageSrc = URL.createObjectURL(file);
    setCropSession({ variant, imageSrc, revokeOnClose: true });
  };

  const openCropForPreview = (variant: 'light' | 'dark') => {
    const settingKey = variant === 'dark' ? 'SITE_LOGO_DARK' : 'SITE_LOGO';
    const value = editingSettings[settingKey]?.trim() || '';
    if (!value) {
      // No custom logo yet — start an upload instead
      const ref = variant === 'dark' ? darkFileRef : lightFileRef;
      ref.current?.click();
      return;
    }
    const imageSrc = resolvePreviewSrc(value, variant);
    if (
      !imageSrc ||
      imageSrc === DEFAULT_SITE_LOGO ||
      imageSrc === DEFAULT_SITE_LOGO_DARK
    ) {
      const ref = variant === 'dark' ? darkFileRef : lightFileRef;
      ref.current?.click();
      return;
    }
    setCropSession({ variant, imageSrc, revokeOnClose: false });
  };

  const uploadLogo = async (file: File, variant: 'light' | 'dark'): Promise<boolean> => {
    const setUploading = variant === 'dark' ? setUploadingDark : setUploadingLight;
    const settingKey = variant === 'dark' ? 'SITE_LOGO_DARK' : 'SITE_LOGO';
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const response = await api.post(`/admin/settings/logo?variant=${variant}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const path = response.data?.value || '';
      handleInputChange(settingKey, path);
      updateSiteSetting(settingKey, path);
      closeCropSession();
      return true;
    } catch (error) {
      console.error(`Failed to upload ${variant} logo:`, error);
      alert(t('siteSettings.logoUploadFailed'));
      return false;
    } finally {
      setUploading(false);
    }
  };

  const clearLogo = async (settingKey: 'SITE_LOGO' | 'SITE_LOGO_DARK') => {
    handleInputChange(settingKey, '');
    updateSiteSetting(settingKey, '');
    try {
      if (onAutoSave) {
        await onAutoSave(settingKey, '');
      } else {
        await api.put('/admin/settings', { key: settingKey, value: '' });
      }
    } catch (error) {
      console.error('Failed to clear logo:', error);
    }
  };

  const renderLogoField = (
    settingKey: 'SITE_LOGO' | 'SITE_LOGO_DARK',
    label: string,
    description: string,
    fileRef: React.RefObject<HTMLInputElement | null>,
    uploading: boolean,
    variant: 'light' | 'dark'
  ) => {
    const value = editingSettings[settingKey] || '';
    const src = resolvePreviewSrc(value, variant);
    const isDefaultPreview = !value.trim() && (variant === 'light' || !(editingSettings.SITE_LOGO || '').trim());
    const canRecrop = Boolean(value.trim());

    return (
      <div data-setting-key={settingKey}>
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          <span>{label}</span>
          <AdminFieldDraftControls
            settingKey={settingKey}
            saved={settings}
            draft={editingSettings}
            onRevert={() => revertField(settingKey)}
          />
        </label>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{description}</p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
          <div className="flex-1 space-y-2">
            <input
              type="url"
              value={value}
              onChange={(e) => handleInputChange(settingKey, e.target.value)}
              className={adminInputFullClass}
              placeholder={t('siteSettings.logoUrlPlaceholder')}
            />
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) openCropForFile(file, variant);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                <Upload size={14} />
                {uploading ? t('siteSettings.uploading') : t('siteSettings.uploadLogo')}
              </button>
              {value.trim() && (
                <button
                  type="button"
                  onClick={() => clearLogo(settingKey)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <X size={14} />
                  {t('siteSettings.clearLogo')}
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => openCropForPreview(variant)}
            disabled={uploading}
            title={
              canRecrop
                ? t('siteSettings.logoPreviewCropTitle')
                : t('siteSettings.logoPreviewUploadTitle')
            }
            aria-label={
              canRecrop
                ? t('siteSettings.logoPreviewCropTitle')
                : t('siteSettings.logoPreviewUploadTitle')
            }
            className="w-28 h-14 flex flex-col items-center justify-center rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 overflow-hidden px-1 transition-colors hover:border-blue-400 hover:bg-blue-50/60 dark:hover:border-blue-500 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {src ? (
              <>
                <img src={src} alt="" className="max-h-10 max-w-full object-contain pointer-events-none" />
                {isDefaultPreview ? (
                  <span className="text-[10px] text-gray-400 mt-0.5">
                    {t('siteSettings.defaultLogoPreview')}
                  </span>
                ) : (
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
                    {t('siteSettings.logoPreviewCropHint')}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400 px-2 text-center">{t('siteSettings.noLogoPreview')}</span>
            )}
          </button>
        </div>
      </div>
    );
  };

  const hideGithub = editingSettings.HIDE_GITHUB_LINK === 'true';
  const hideSiteLogo = editingSettings.HIDE_SITE_LOGO === 'true';

  const renderToggleRow = (
    label: string,
    description: string,
    enabled: boolean,
    onToggle: () => void | Promise<void>
  ) => (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0 flex-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {enabled ? t('siteSettings.enabled') : t('siteSettings.disabled')}
        </span>
        <button
          type="button"
          onClick={() => void onToggle()}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            enabled ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out dark:bg-gray-300 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );

  const opensNewTab =
    editingSettings.SITE_OPENS_NEW_TAB === 'true' ||
    editingSettings.SITE_OPENS_NEW_TAB === undefined;

  const cropTitle =
    cropSession?.variant === 'dark'
      ? t('siteSettings.logoCropTitleDark')
      : t('siteSettings.logoCropTitle');

  return (
    <div data-setting-key="SITE_SETTINGS_SECTION">
    <AdminPageShell description={t('siteSettings.description')} className="p-6">
      <AdminSection dense>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div data-setting-key="SITE_NAME">
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('siteSettings.siteName')}</span>
              <AdminFieldDraftControls
                settingKey="SITE_NAME"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('SITE_NAME')}
              />
            </label>
            <input
              type="text"
              value={editingSettings.SITE_NAME ?? ''}
              onChange={(e) => handleInputChange('SITE_NAME', e.target.value)}
              className={adminInputFullClass}
              placeholder={t('siteSettings.enterSiteName')}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('siteSettings.siteNameEmptyHint')}
            </p>
          </div>

          <div data-setting-key="SITE_URL">
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('siteSettings.siteUrl')}</span>
              <AdminFieldDraftControls
                settingKey="SITE_URL"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('SITE_URL')}
              />
            </label>
            <input
              type="url"
              value={editingSettings.SITE_URL || ''}
              onChange={(e) => handleInputChange('SITE_URL', e.target.value)}
              className={adminInputFullClass}
              placeholder="https://example.com"
            />
          </div>
        </div>

        <div className="pt-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('siteSettings.websiteUrl')}
          </label>
          <input
            type="url"
            value={editingSettings.WEBSITE_URL || ''}
            readOnly
            disabled
            className={`${adminInputFullClass} bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed`}
            placeholder="https://customer-portal.example.com"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('siteSettings.websiteUrlDescription')}
          </p>
        </div>
      </AdminSection>

      <AdminSection title={t('siteSettings.brandingSection')} dense>
        <div className="space-y-3">
          {renderLogoField(
            'SITE_LOGO',
            t('siteSettings.siteLogo'),
            t('siteSettings.siteLogoDescription'),
            lightFileRef,
            uploadingLight,
            'light'
          )}

          {renderLogoField(
            'SITE_LOGO_DARK',
            t('siteSettings.siteLogoDark'),
            t('siteSettings.siteLogoDarkDescription'),
            darkFileRef,
            uploadingDark,
            'dark'
          )}
        </div>
      </AdminSection>

      <AdminSection dense>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {renderToggleRow(
            t('siteSettings.hideSiteLogo'),
            t('siteSettings.hideSiteLogoDescription'),
            hideSiteLogo,
            async () => {
              const newValue = hideSiteLogo ? 'false' : 'true';
              handleInputChange('HIDE_SITE_LOGO', newValue);
              updateSiteSetting('HIDE_SITE_LOGO', newValue);
              try {
                if (onAutoSave) {
                  await onAutoSave('HIDE_SITE_LOGO', newValue);
                } else {
                  await api.put('/admin/settings', { key: 'HIDE_SITE_LOGO', value: newValue });
                }
              } catch (error) {
                console.error('Failed to save hide site logo toggle:', error);
                handleInputChange('HIDE_SITE_LOGO', hideSiteLogo ? 'true' : 'false');
                updateSiteSetting('HIDE_SITE_LOGO', hideSiteLogo ? 'true' : 'false');
              }
            }
          )}
          {renderToggleRow(
            t('siteSettings.opensNewTab'),
            t('siteSettings.opensNewTabDescription'),
            opensNewTab,
            async () => {
              const currentValue =
                editingSettings.SITE_OPENS_NEW_TAB === undefined
                  ? 'true'
                  : editingSettings.SITE_OPENS_NEW_TAB;
              const newValue = currentValue === 'true' ? 'false' : 'true';
              handleInputChange('SITE_OPENS_NEW_TAB', newValue);
              try {
                if (onAutoSave) {
                  await onAutoSave('SITE_OPENS_NEW_TAB', newValue);
                } else {
                  await api.put('/admin/settings', { key: 'SITE_OPENS_NEW_TAB', value: newValue });
                }
              } catch (error) {
                console.error('Failed to save opens new tab toggle:', error);
                handleInputChange('SITE_OPENS_NEW_TAB', currentValue);
              }
            }
          )}
          {renderToggleRow(
            t('siteSettings.hideGithubLink'),
            t('siteSettings.hideGithubLinkDescription'),
            hideGithub,
            async () => {
              const newValue = hideGithub ? 'false' : 'true';
              handleInputChange('HIDE_GITHUB_LINK', newValue);
              try {
                if (onAutoSave) {
                  await onAutoSave('HIDE_GITHUB_LINK', newValue);
                } else {
                  await api.put('/admin/settings', { key: 'HIDE_GITHUB_LINK', value: newValue });
                }
              } catch (error) {
                console.error('Failed to save hide GitHub toggle:', error);
                handleInputChange('HIDE_GITHUB_LINK', hideGithub ? 'true' : 'false');
              }
            }
          )}
        </div>
      </AdminSection>

      <AdminActionsBar className="justify-between">
        <AdminUnsavedHint show={hasChanges} />
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            disabled={!hasChanges}
            className="px-4 py-1.5 text-sm bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('siteSettings.cancel')}
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
            {t('siteSettings.saveChanges')}
          </button>
        </div>
      </AdminActionsBar>

      {cropSession && (
        <AdminLogoCropModal
          isOpen
          imageSrc={cropSession.imageSrc}
          fileName={
            cropSession.variant === 'dark' ? 'site-logo-dark.png' : 'site-logo.png'
          }
          title={cropTitle}
          onCancel={closeCropSession}
          onApply={async (file) => uploadLogo(file, cropSession.variant)}
        />
      )}
    </AdminPageShell>
    </div>
  );
};

export default AdminSiteSettingsTab;
