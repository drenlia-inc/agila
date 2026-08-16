import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, RefreshCw } from 'lucide-react';
import { toast } from '../../utils/toast';
import { ModernCheckbox } from '../ModernCheckbox';
import {
  ADMIN_NUMERIC_INPUT_CLASS,
  UPLOAD_MAX_MB,
  clampUploadMaxMb,
} from '../../utils/adminFieldLimits';
import { isAdminSettingFieldDirty } from '../../utils/adminSettingsDirty';
import { AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import {
  AdminActionsBar,
  AdminPageShell,
  AdminSection,
  adminInputClass,
} from './AdminSection';

interface AdminFileUploadsTabProps {
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  onCancel: () => void;
  discardNonce?: number;
}

interface FileTypeConfig {
  [mimeType: string]: boolean;
}

const AdminFileUploadsTab: React.FC<AdminFileUploadsTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  discardNonce = 0,
}) => {
  const { t } = useTranslation('admin');
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingLimits, setIsTogglingLimits] = useState(false);
  const [fileTypes, setFileTypes] = useState<FileTypeConfig>({});
  const [maxFileSize, setMaxFileSize] = useState(10); // MB
  const [limitsEnforced, setLimitsEnforced] = useState(true); // Default enforced

  // Define all possible file types with their descriptions
  const fileTypeCategories = [
    {
      name: t('fileUploads.categories.images'),
      types: [
        { mime: 'image/jpeg', label: t('fileUploads.types.jpegImages'), ext: '.jpg, .jpeg' },
        { mime: 'image/png', label: t('fileUploads.types.pngImages'), ext: '.png' },
        { mime: 'image/gif', label: t('fileUploads.types.gifImages'), ext: '.gif' },
        { mime: 'image/webp', label: t('fileUploads.types.webpImages'), ext: '.webp' },
        { mime: 'image/svg+xml', label: t('fileUploads.types.svgImages'), ext: '.svg' },
        { mime: 'image/bmp', label: t('fileUploads.types.bmpImages'), ext: '.bmp' },
        { mime: 'image/tiff', label: t('fileUploads.types.tiffImages'), ext: '.tiff, .tif' },
        { mime: 'image/ico', label: t('fileUploads.types.iconFiles'), ext: '.ico' },
        { mime: 'image/heic', label: t('fileUploads.types.heicImages'), ext: '.heic' },
        { mime: 'image/heif', label: t('fileUploads.types.heifImages'), ext: '.heif' },
        { mime: 'image/avif', label: t('fileUploads.types.avifImages'), ext: '.avif' }
      ]
    },
    {
      name: t('fileUploads.categories.videos'),
      types: [
        { mime: 'video/mp4', label: t('fileUploads.types.mp4Videos'), ext: '.mp4' },
        { mime: 'video/webm', label: t('fileUploads.types.webmVideos'), ext: '.webm' },
        { mime: 'video/ogg', label: t('fileUploads.types.oggVideos'), ext: '.ogv' },
        { mime: 'video/quicktime', label: t('fileUploads.types.quicktimeVideos'), ext: '.mov' },
        { mime: 'video/x-msvideo', label: t('fileUploads.types.aviVideos'), ext: '.avi' },
        { mime: 'video/x-ms-wmv', label: t('fileUploads.types.wmvVideos'), ext: '.wmv' },
        { mime: 'video/x-matroska', label: t('fileUploads.types.mkvVideos'), ext: '.mkv' },
        { mime: 'video/mpeg', label: t('fileUploads.types.mpegVideos'), ext: '.mpeg, .mpg' },
        { mime: 'video/3gpp', label: t('fileUploads.types.3gpVideos'), ext: '.3gp' }
      ]
    },
    {
      name: t('fileUploads.categories.documents'),
      types: [
        { mime: 'application/pdf', label: t('fileUploads.types.pdfDocuments'), ext: '.pdf' },
        { mime: 'text/plain', label: t('fileUploads.types.textFiles'), ext: '.txt' },
        { mime: 'text/csv', label: t('fileUploads.types.csvFiles'), ext: '.csv' }
      ]
    },
    {
      name: t('fileUploads.categories.officeDocuments'),
      types: [
        { mime: 'application/msword', label: t('fileUploads.types.wordDocumentsLegacy'), ext: '.doc' },
        { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: t('fileUploads.types.wordDocuments'), ext: '.docx' },
        { mime: 'application/vnd.ms-excel', label: t('fileUploads.types.excelSpreadsheetsLegacy'), ext: '.xls' },
        { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: t('fileUploads.types.excelSpreadsheets'), ext: '.xlsx' },
        { mime: 'application/vnd.ms-powerpoint', label: t('fileUploads.types.powerPointPresentationsLegacy'), ext: '.ppt' },
        { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: t('fileUploads.types.powerPointPresentations'), ext: '.pptx' }
      ]
    },
    {
      name: t('fileUploads.categories.archives'),
      types: [
        { mime: 'application/zip', label: t('fileUploads.types.zipArchives'), ext: '.zip' },
        { mime: 'application/x-rar-compressed', label: t('fileUploads.types.rarArchives'), ext: '.rar' },
        { mime: 'application/x-7z-compressed', label: t('fileUploads.types.7zipArchives'), ext: '.7z' }
      ]
    },
    {
      name: t('fileUploads.categories.codeFiles'),
      types: [
        { mime: 'text/javascript', label: t('fileUploads.types.javascriptFiles'), ext: '.js' },
        { mime: 'text/css', label: t('fileUploads.types.cssFiles'), ext: '.css' },
        { mime: 'text/html', label: t('fileUploads.types.htmlFiles'), ext: '.html' },
        { mime: 'application/json', label: t('fileUploads.types.jsonFiles'), ext: '.json' }
      ]
    }
  ];

  const allPossibleMimeTypes = fileTypeCategories.flatMap((category) =>
    category.types.map((type) => type.mime)
  );

  /** Expand stored JSON to a full mime→bool map (missing keys default to true). */
  const completeFileTypeConfig = (rawJson: string | undefined): FileTypeConfig => {
    let parsed: FileTypeConfig = {};
    try {
      parsed = JSON.parse(rawJson || '{}');
    } catch {
      parsed = {};
    }
    return allPossibleMimeTypes.reduce((acc, mimeType) => {
      if (Object.keys(parsed).length === 0) {
        acc[mimeType] = true;
      } else if (mimeType === 'image/jpeg' && parsed['image/jpg'] !== undefined) {
        acc[mimeType] = parsed['image/jpg'];
      } else {
        acc[mimeType] = parsed[mimeType] !== undefined ? parsed[mimeType] : true;
      }
      return acc;
    }, {} as FileTypeConfig);
  };

  // Initialize file types from draft settings (re-run on Discard)
  useEffect(() => {
    setFileTypes(completeFileTypeConfig(editingSettings.UPLOAD_FILETYPES));
    // fileTypeCategories labels change with i18n; mime list is stable enough for this hydrate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSettings.UPLOAD_FILETYPES, discardNonce]);

  // Initialize max file size from settings
  useEffect(() => {
    const sizeBytes = parseInt(editingSettings.UPLOAD_MAX_FILESIZE || '10485760');
    const sizeMB = Math.round(sizeBytes / (1024 * 1024));
    setMaxFileSize(sizeMB);
  }, [editingSettings.UPLOAD_MAX_FILESIZE, discardNonce]);

  // Initialize limits enforced from settings
  useEffect(() => {
    const enforced = editingSettings.UPLOAD_LIMITS_ENFORCED !== 'false'; // Default to true
    setLimitsEnforced(enforced);
  }, [editingSettings.UPLOAD_LIMITS_ENFORCED, discardNonce]);

  const handleSave = async () => {
    if (!hasChanges()) {
      return;
    }

    const clampedMb = clampUploadMaxMb(maxFileSize);
    if (clampedMb !== maxFileSize) {
      setMaxFileSize(clampedMb);
    }
    
    setIsSaving(true);
    try {
      // Convert max file size from MB to bytes
      const sizeBytes = clampedMb * 1024 * 1024;
      
      const newSettings = {
        ...editingSettings,
        UPLOAD_MAX_FILESIZE: sizeBytes.toString(),
        UPLOAD_FILETYPES: JSON.stringify(fileTypes)
        // Note: UPLOAD_LIMITS_ENFORCED is auto-saved via handleToggleLimitsEnforced
      };
      
      // Debug logging
      console.log('handleSave - sending settings:', {
        UPLOAD_MAX_FILESIZE: newSettings.UPLOAD_MAX_FILESIZE,
        UPLOAD_FILETYPES: newSettings.UPLOAD_FILETYPES,
        fileTypes: fileTypes,
        rarValue: fileTypes['application/x-rar-compressed']
      });
      
      // Update settings with current values - merge with existing settings
      const updatedSettings = {
        ...editingSettings,
        ...newSettings
      };
      onSettingsChange(updatedSettings);
      
      // Call onSave with the updated settings directly
      await onSave(updatedSettings);
      console.log('✅ Save completed successfully');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileTypeToggle = (mimeType: string) => {
    setFileTypes((prev) => {
      const next = { ...prev, [mimeType]: !prev[mimeType] };
      syncDraftToEditing(maxFileSize, next);
      return next;
    });
  };

  const syncDraftToEditing = (sizeMb: number, types: FileTypeConfig) => {
    onSettingsChange({
      ...editingSettings,
      UPLOAD_MAX_FILESIZE: String(sizeMb * 1024 * 1024),
      UPLOAD_FILETYPES: JSON.stringify(types),
    });
  };

  const handleMaxFileSizeChange = (value: string) => {
    if (value === '') {
      setMaxFileSize(0);
      syncDraftToEditing(0, fileTypes);
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const sizeMb = Math.trunc(n);
    setMaxFileSize(sizeMb);
    syncDraftToEditing(sizeMb, fileTypes);
  };

  const toggleAllFileTypes = (enabled: boolean) => {
    // Get all possible file types from all categories
    const allPossibleTypes = fileTypeCategories.flatMap(category => 
      category.types.map(type => type.mime)
    );
    
    // Create a new config with all types set to the same value
    const updatedTypes = allPossibleTypes.reduce((acc, mimeType) => {
      acc[mimeType] = enabled;
      return acc;
    }, {} as FileTypeConfig);
    
    setFileTypes(updatedTypes);
    syncDraftToEditing(maxFileSize, updatedTypes);
  };

  const handleToggleLimitsEnforced = async () => {
    const newValue = !limitsEnforced;
    setLimitsEnforced(newValue);
    setIsTogglingLimits(true);
    
    try {
      const updatedSettings = {
        ...editingSettings,
        UPLOAD_LIMITS_ENFORCED: newValue.toString()
      };
      
      onSettingsChange(updatedSettings);
      await onSave(updatedSettings);
      toast.success(t('fileUploads.limitsEnforcedUpdated'), '');
    } catch (error: any) {
      console.error('Failed to save limits enforced setting:', error);
      // Revert on error
      setLimitsEnforced(!newValue);
      const errorMessage = error.response?.data?.error || error.message || t('fileUploads.failedToUpdateLimitsEnforced');
      toast.error(errorMessage, '');
    } finally {
      setIsTogglingLimits(false);
    }
  };

  const hasChanges = () => {
    // Compare with ORIGINAL settings, not editingSettings
    // Note: UPLOAD_LIMITS_ENFORCED is excluded because it auto-saves
    const originalSizeBytes = parseInt(settings.UPLOAD_MAX_FILESIZE || '10485760');
    const originalSizeMB = Math.round(originalSizeBytes / (1024 * 1024));
    // Normalize both sides so partial saved JSON vs full UI map does not look dirty
    const originalFileTypes = completeFileTypeConfig(settings.UPLOAD_FILETYPES);

    const sizeChanged = maxFileSize !== originalSizeMB;
    const fileTypesChanged = JSON.stringify(fileTypes) !== JSON.stringify(originalFileTypes);

    return sizeChanged || fileTypesChanged;
  };

  return (
    <div data-setting-key="UPLOADS_SECTION">
      <AdminPageShell width="full">
        <AdminSection dense>
          <div className="flex items-start justify-between gap-3 pb-2 border-b border-gray-100 dark:border-gray-800">
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                {t('fileUploads.enforceUploadRestrictions')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {t('fileUploads.enforceUploadRestrictionsDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleLimitsEnforced}
              disabled={isTogglingLimits}
              className={`
                relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
                focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
                ${isTogglingLimits ? 'opacity-50 cursor-not-allowed' : ''}
                ${limitsEnforced
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500'
                }
              `}
            >
              <span
                className={`
                  inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${limitsEnforced ? 'translate-x-6' : 'translate-x-1'}
                `}
              />
            </button>
          </div>

          <div className="flex items-start justify-between gap-3 pt-1">
            <div className="flex-1 min-w-0">
              <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>{t('fileUploads.maximumFileSize')}</span>
                <AdminFieldDraftControls
                  dirty={isAdminSettingFieldDirty(
                    'UPLOAD_MAX_FILESIZE',
                    settings,
                    editingSettings
                  )}
                  savedValue={String(
                    Math.round(
                      parseInt(settings.UPLOAD_MAX_FILESIZE || '10485760', 10) / (1024 * 1024)
                    )
                  )}
                  onRevert={() => {
                    const originalMb = Math.round(
                      parseInt(settings.UPLOAD_MAX_FILESIZE || '10485760', 10) / (1024 * 1024)
                    );
                    setMaxFileSize(originalMb);
                    syncDraftToEditing(originalMb, fileTypes);
                  }}
                />
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {t('fileUploads.maximumFileSizeDescription', {
                  min: UPLOAD_MAX_MB.min,
                  max: UPLOAD_MAX_MB.max,
                })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={maxFileSize}
                onChange={(e) => handleMaxFileSizeChange(e.target.value)}
                onBlur={() => {
                  const clamped = clampUploadMaxMb(maxFileSize);
                  setMaxFileSize(clamped);
                  syncDraftToEditing(clamped, fileTypes);
                }}
                className={`w-20 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('fileUploads.mb')}</span>
            </div>
          </div>
        </AdminSection>

        <AdminSection
          title={t('fileUploads.allowedFileTypes')}
          description={t('fileUploads.allowedFileTypesDescription')}
          headerRight={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleAllFileTypes(true)}
                className="px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                {t('fileUploads.allowAll')}
              </button>
              <button
                type="button"
                onClick={() => toggleAllFileTypes(false)}
                className="px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
              >
                {t('fileUploads.blockAll')}
              </button>
            </div>
          }
          dense
        >
          <div className="space-y-2.5">
            {fileTypeCategories.map((category) => {
              const enabledCount = category.types.filter((ft) => fileTypes[ft.mime]).length;
              const totalCount = category.types.length;
              return (
                <div
                  key={category.name}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                      {category.name}
                    </h4>
                    <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                      {enabledCount}/{totalCount}
                    </span>
                  </div>
                  <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {category.types.map((fileType) => (
                      <div
                        key={fileType.mime}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <ModernCheckbox
                          id={fileType.mime}
                          checked={fileTypes[fileType.mime] || false}
                          onChange={() => handleFileTypeToggle(fileType.mime)}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <label
                            htmlFor={fileType.mime}
                            className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
                          >
                            {fileType.label}
                          </label>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{fileType.ext}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </AdminSection>

        <AdminActionsBar className="justify-between">
          <AdminUnsavedHint show={hasChanges()} />
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onCancel}
              disabled={!hasChanges() || isSaving}
              className="px-4 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('fileUploads.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasChanges() || isSaving}
              className={`px-4 py-1.5 text-sm font-medium text-white border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center ${
                hasChanges()
                  ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-amber-400 ring-offset-2'
                  : 'bg-blue-600'
              }`}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  {t('fileUploads.saving')}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {t('fileUploads.saveChanges')}
                </>
              )}
            </button>
          </div>
        </AdminActionsBar>
      </AdminPageShell>
    </div>
  );
};

export default AdminFileUploadsTab;
