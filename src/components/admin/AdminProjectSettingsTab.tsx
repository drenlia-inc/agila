import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  adminInputClass, adminInputFullClass,
} from './AdminSection';
import AdminDefaultBoardColumnsTable from './AdminDefaultBoardColumnsTable';
import { toast } from '../../utils/toast';
import {
  parseDefaultBoardColumns,
  parseFinishedKeywordList,
  serializeDefaultBoardColumns,
  isArchiveColumnTitle,
  uniqueNewFinishedKeywords,
  type DefaultBoardColumnRow,
} from '../../utils/defaultBoardColumns';
import { COLUMN_TITLE_MAX_LENGTH } from '../../constants/appConstants';

interface AdminProjectSettingsTabProps {
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  onCancel: () => void;
  onAutoSave?: (key: string, value: string, options?: { silent?: boolean }) => Promise<void>;
  /** When nested under Project Settings hub, hide duplicate page chrome. */
  embedded?: boolean;
}

const AdminProjectSettingsTab: React.FC<AdminProjectSettingsTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onAutoSave,
  embedded = false,
}) => {
  const { t } = useTranslation('admin', { keyPrefix: 'projectSettings' });
  const { t: tAdmin } = useTranslation('admin');
  const [finishedColumnNames, setFinishedColumnNames] = useState<string[]>([]);
  const [newColumnName, setNewColumnName] = useState('');
  const [defaultBoardColumns, setDefaultBoardColumns] = useState<DefaultBoardColumnRow[]>(() =>
    parseDefaultBoardColumns(editingSettings.DEFAULT_BOARD_COLUMNS)
  );
  const hasChanges = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );

  // Initialize finished column names from settings
  useEffect(() => {
    setFinishedColumnNames(parseFinishedKeywordList(editingSettings.DEFAULT_FINISHED_COLUMN_NAMES));
  }, [editingSettings.DEFAULT_FINISHED_COLUMN_NAMES]);

  useEffect(() => {
    setDefaultBoardColumns(parseDefaultBoardColumns(editingSettings.DEFAULT_BOARD_COLUMNS));
  }, [editingSettings.DEFAULT_BOARD_COLUMNS]);

  const handleInputChange = (key: string, value: string) => {
    onSettingsChange({
      ...editingSettings,
      [key]: value
    });
  };

  const revertField = (key: string) => {
    onSettingsChange(
      revertAdminSettingField(key, settings, editingSettings) as { [key: string]: string }
    );
  };

  const addFinishedColumnName = async () => {
    const trimmedName = newColumnName.trim();
    if (isArchiveColumnTitle(trimmedName)) {
      toast.error(t('defaultColumnsArchiveReserved'), '');
      return;
    }
    if (trimmedName && !finishedColumnNames.includes(trimmedName)) {
      const updatedNames = [...finishedColumnNames, trimmedName];
      setFinishedColumnNames(updatedNames);
      setNewColumnName('');
      
      // Update local settings
      onSettingsChange({
        ...editingSettings,
        DEFAULT_FINISHED_COLUMN_NAMES: JSON.stringify(updatedNames)
      });
      
      // Auto-save to database
      if (onAutoSave) {
        await onAutoSave('DEFAULT_FINISHED_COLUMN_NAMES', JSON.stringify(updatedNames));
      }
    }
  };

  const removeFinishedColumnName = async (nameToRemove: string) => {
    const updatedNames = finishedColumnNames.filter(name => name !== nameToRemove);
    setFinishedColumnNames(updatedNames);
    
    // Update local settings
    onSettingsChange({
      ...editingSettings,
      DEFAULT_FINISHED_COLUMN_NAMES: JSON.stringify(updatedNames)
    });
    
    // Auto-save to database
    if (onAutoSave) {
      await onAutoSave('DEFAULT_FINISHED_COLUMN_NAMES', JSON.stringify(updatedNames));
    }
  };

  const persistDefaultBoardColumns = (
    rows: DefaultBoardColumnRow[],
    extraKeywords: string[] = [],
    options?: { autoSave?: boolean }
  ) => {
    const complete = rows.filter((r) => r.titleEn.trim() && r.titleFr.trim());
    if (complete.length < 2) {
      toast.error(t('defaultColumnsMinTwo'), '');
      return;
    }
    if (complete.filter((r) => r.isFinished).length !== 1) {
      toast.error(t('defaultColumnsNeedFinished'), '');
      return;
    }
    if (complete.some((r) => isArchiveColumnTitle(r.titleEn) || isArchiveColumnTitle(r.titleFr))) {
      toast.error(t('defaultColumnsArchiveReserved'), '');
      return;
    }
    const json = serializeDefaultBoardColumns(complete);
    const prevColumnsJson = editingSettings.DEFAULT_BOARD_COLUMNS ?? '';
    const columnsChanged = json !== prevColumnsJson;
    setDefaultBoardColumns(complete);
    const extras = uniqueNewFinishedKeywords(extraKeywords, finishedColumnNames);
    const names = extras.length ? [...finishedColumnNames, ...extras] : finishedColumnNames;
    if (extras.length) {
      setFinishedColumnNames(names);
    }
    const namesJson = JSON.stringify(names);
    const prevNamesJson = editingSettings.DEFAULT_FINISHED_COLUMN_NAMES ?? '';
    const namesChanged = extras.length > 0 && namesJson !== prevNamesJson;
    if (!columnsChanged && !namesChanged) {
      return;
    }
    onSettingsChange({
      ...editingSettings,
      DEFAULT_BOARD_COLUMNS: json,
      ...(namesChanged ? { DEFAULT_FINISHED_COLUMN_NAMES: namesJson } : {}),
    });
    if (options?.autoSave && onAutoSave) {
      const saves: Promise<void>[] = [];
      if (columnsChanged) {
        saves.push(onAutoSave('DEFAULT_BOARD_COLUMNS', json, { silent: true }));
      }
      if (namesChanged) {
        saves.push(onAutoSave('DEFAULT_FINISHED_COLUMN_NAMES', namesJson, { silent: true }));
      }
      void Promise.all(saves)
        .then(() => {
          toast.success(tAdmin('settingsSavedSuccessfully'), '', 3000);
        })
        .catch(() => {
          /* errors already toasted by onAutoSave */
        });
    }
  };

  const handleFinishedNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFinishedColumnName();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setNewColumnName('');
      e.currentTarget.blur();
    }
  };

  const handlePrefixKeyDown = (key: 'DEFAULT_PROJ_PREFIX' | 'DEFAULT_TASK_PREFIX') =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      revertField(key);
      e.currentTarget.blur();
    };

  const handleSave = async () => {
    if (defaultBoardColumns.length < 2) {
      toast.error(t('defaultColumnsMinTwo'), '');
      return;
    }
    if (defaultBoardColumns.filter((r) => r.isFinished).length !== 1) {
      toast.error(t('defaultColumnsNeedFinished'), '');
      return;
    }
    if (defaultBoardColumns.some((r) => !r.isFinished) === false) {
      toast.error(t('defaultColumnsMinTwo'), '');
      return;
    }
    if (defaultBoardColumns.some((r) => !r.titleEn.trim() || !r.titleFr.trim())) {
      toast.error(t('defaultColumnsTitlesRequired'), '');
      return;
    }
    if (
      defaultBoardColumns.some(
        (r) => isArchiveColumnTitle(r.titleEn) || isArchiveColumnTitle(r.titleFr)
      )
    ) {
      toast.error(t('defaultColumnsArchiveReserved'), '');
      return;
    }
    await onSave();
  };

  const content = (
    <>
      <AdminSection
        title={t('defaultColumnsTitle')}
        description={t('defaultColumnsDescription', {
          languageSetting: tAdmin('appSettings.defaultApplicationLanguage'),
        })}
        dense
      >
        <div data-setting-key="DEFAULT_BOARD_COLUMNS">
          <AdminDefaultBoardColumnsTable
            rows={defaultBoardColumns}
            finishedKeywords={finishedColumnNames}
            onRowsChange={persistDefaultBoardColumns}
          />
        </div>
      </AdminSection>

      <AdminSection title={t('finishedColumnNames')} description={t('finishedColumnNamesDescription')} dense>
        <div data-setting-key="DEFAULT_FINISHED_COLUMN_NAMES">
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onKeyDown={handleFinishedNameKeyDown}
              placeholder={t('enterColumnName')}
              className={`flex-1 ${adminInputClass}`}
              maxLength={COLUMN_TITLE_MAX_LENGTH}
            />
            <button
              onClick={addFinishedColumnName}
              disabled={!newColumnName.trim() || finishedColumnNames.includes(newColumnName.trim())}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:disabled:bg-blue-600/40"
            >
              {t('add')}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {finishedColumnNames.map((name) => (
              <div
                key={name}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-100 text-blue-800 text-sm rounded-full dark:bg-blue-900/40 dark:text-blue-200"
              >
                <span>{name}</span>
                <button
                  onClick={() => removeFinishedColumnName(name)}
                  className="ml-0.5 text-blue-600 hover:text-blue-800 focus:outline-none dark:text-blue-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </AdminSection>

      <AdminSection dense>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('defaultProjectPrefix')}</span>
              <AdminFieldDraftControls
                settingKey="DEFAULT_PROJ_PREFIX"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('DEFAULT_PROJ_PREFIX')}
              />
            </label>
            <input
              type="text"
              value={editingSettings.DEFAULT_PROJ_PREFIX || ''}
              onChange={(e) => handleInputChange('DEFAULT_PROJ_PREFIX', e.target.value)}
              onKeyDown={handlePrefixKeyDown('DEFAULT_PROJ_PREFIX')}
              className={adminInputFullClass}
              placeholder="PROJ-"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('defaultProjectPrefixDescription')}
            </p>
            <p className="mt-1 text-[11px] leading-snug italic text-gray-500 dark:text-gray-400">
              {t('defaultProjectPrefixFutureNote')}
            </p>
          </div>

          <div>
            <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span>{t('defaultTaskPrefix')}</span>
              <AdminFieldDraftControls
                settingKey="DEFAULT_TASK_PREFIX"
                saved={settings}
                draft={editingSettings}
                onRevert={() => revertField('DEFAULT_TASK_PREFIX')}
              />
            </label>
            <input
              type="text"
              value={editingSettings.DEFAULT_TASK_PREFIX || ''}
              onChange={(e) => handleInputChange('DEFAULT_TASK_PREFIX', e.target.value)}
              onKeyDown={handlePrefixKeyDown('DEFAULT_TASK_PREFIX')}
              className={adminInputFullClass}
              placeholder="TASK-"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('defaultTaskPrefixDescription')}
            </p>
          </div>
        </div>
      </AdminSection>

      <AdminSection tone="indigo" dense>
        <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1.5">{t('howItWorks')}</h4>
        <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5 leading-snug">
          <li>• {t('howItWorks1', { prefix: editingSettings.DEFAULT_PROJ_PREFIX || 'PROJ-' })}</li>
          <li>• {t('howItWorks2', { prefix: editingSettings.DEFAULT_TASK_PREFIX || 'TASK-' })}</li>
          <li>• {t('howItWorks3')}</li>
          <li>• {t('howItWorks4')}</li>
          <li>• {t('howItWorks6')}</li>
        </ul>
      </AdminSection>

      <AdminActionsBar className="justify-between">
        <AdminUnsavedHint show={hasChanges} />
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            disabled={!hasChanges}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={!hasChanges}
            className={`px-4 py-1.5 text-sm font-medium text-white border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
              hasChanges
                ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-amber-400 ring-offset-2'
                : 'bg-blue-600'
            }`}
            title={!hasChanges ? tAdmin('noChangesToSave') : undefined}
          >
            {t('saveSettings')}
          </button>
        </div>
      </AdminActionsBar>
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <AdminPageShell>{content}</AdminPageShell>
  );
};

export default AdminProjectSettingsTab;
