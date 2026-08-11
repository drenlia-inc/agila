import React from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, adminInputClass } from './AdminSection';
import { AdminToggle, adminSettingIsEnabled } from './AdminToggle';

interface AdminFeaturesSettingsTabProps {
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onAutoSave?: (key: string, value: string) => Promise<void>;
}

const FEATURE_TOGGLES = [
  {
    key: 'SHOW_BOARD_TAB_TASK_COUNTS',
    defaultEnabled: true,
    titleKey: 'boardTabTaskCounts',
    descriptionKey: 'boardTabTaskCountsDescription',
  },
  {
    key: 'SHOW_BOARD_TAB_EFFORT',
    defaultEnabled: false,
    titleKey: 'boardTabEffort',
    descriptionKey: 'boardTabEffortDescription',
  },
  {
    key: 'SHOW_COLUMN_TASK_COUNTS',
    defaultEnabled: true,
    titleKey: 'columnTaskCounts',
    descriptionKey: 'columnTaskCountsDescription',
  },
  {
    key: 'SHOW_COLUMN_EFFORT',
    defaultEnabled: false,
    titleKey: 'columnEffort',
    descriptionKey: 'columnEffortDescription',
  },
] as const;

const AdminFeaturesSettingsTab: React.FC<AdminFeaturesSettingsTabProps> = ({
  editingSettings,
  onSettingsChange,
  onAutoSave,
}) => {
  const { t } = useTranslation('admin', { keyPrefix: 'featuresSettings' });

  const setSetting = async (key: string, newValue: string) => {
    onSettingsChange({
      ...editingSettings,
      [key]: newValue,
    });
    if (onAutoSave) {
      await onAutoSave(key, newValue);
    }
  };

  const setToggle = async (key: string, next: boolean) => {
    await setSetting(key, next ? 'true' : 'false');
  };

  const highlightOverdue = adminSettingIsEnabled(
    editingSettings.HIGHLIGHT_OVERDUE_TASKS,
    true
  );

  return (
    <div className="space-y-4" data-tour-id="admin-features-panel">
      <p className="text-sm text-gray-600 dark:text-gray-400">{t('description')}</p>

      <AdminSection title={t('boardTabsSection')} description={t('boardTabsSectionDescription')} dense>
        <div className="space-y-3">
          {FEATURE_TOGGLES.filter((row) => row.key.startsWith('SHOW_BOARD_TAB_')).map((row) => {
            const checked = adminSettingIsEnabled(editingSettings[row.key], row.defaultEnabled);
            return (
              <div key={row.key} className="flex items-center justify-between gap-3" data-setting-key={row.key}>
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t(row.titleKey)}
                  </label>
                  <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
                    {t(row.descriptionKey)}
                  </p>
                </div>
                <AdminToggle
                  checked={checked}
                  onChange={(next) => void setToggle(row.key, next)}
                  label={checked ? t('enabled') : t('disabled')}
                  id={`feature-${row.key}`}
                />
              </div>
            );
          })}
        </div>
      </AdminSection>

      <AdminSection title={t('columnsSection')} description={t('columnsSectionDescription')} dense>
        <div className="space-y-3">
          {FEATURE_TOGGLES.filter((row) => row.key.startsWith('SHOW_COLUMN_')).map((row) => {
            const checked = adminSettingIsEnabled(editingSettings[row.key], row.defaultEnabled);
            return (
              <div key={row.key} className="flex items-center justify-between gap-3" data-setting-key={row.key}>
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t(row.titleKey)}
                  </label>
                  <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
                    {t(row.descriptionKey)}
                  </p>
                </div>
                <AdminToggle
                  checked={checked}
                  onChange={(next) => void setToggle(row.key, next)}
                  label={checked ? t('enabled') : t('disabled')}
                  id={`feature-${row.key}`}
                />
              </div>
            );
          })}
        </div>
      </AdminSection>

      <AdminSection title={t('effortUnit')} description={t('effortUnitDescription')} dense>
        <select
          data-setting-key="EFFORT_UNIT"
          value={editingSettings.EFFORT_UNIT === 'points' ? 'points' : 'hours'}
          onChange={(e) => {
            const newValue = e.target.value === 'points' ? 'points' : 'hours';
            void setSetting('EFFORT_UNIT', newValue);
          }}
          className={`max-w-xs ${adminInputClass}`}
          aria-label={t('effortUnit')}
        >
          <option value="hours">{t('effortUnitHours')}</option>
          <option value="points">{t('effortUnitPoints')}</option>
        </select>
      </AdminSection>

      <AdminSection dense>
        <div className="flex items-center justify-between gap-3" data-setting-key="HIGHLIGHT_OVERDUE_TASKS">
          <div className="min-w-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('highlightOverdueTasks')}
            </label>
            <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">
              {t('highlightOverdueTasksDescription')}
            </p>
          </div>
          <AdminToggle
            checked={highlightOverdue}
            onChange={(next) => void setToggle('HIGHLIGHT_OVERDUE_TASKS', next)}
            label={highlightOverdue ? t('enabled') : t('disabled')}
            id="feature-HIGHLIGHT_OVERDUE_TASKS"
          />
        </div>
      </AdminSection>
    </div>
  );
};

export default AdminFeaturesSettingsTab;
