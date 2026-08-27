import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, {
  getUserSettings,
  getCspReports,
  clearCspReports,
  type CspReportRow,
} from '../../api';
import {
  FE_CLIENT_DEBUG_KEYS,
  SERVER_DEBUG_KEYS,
  type FeClientDebugKey,
  type ServerDebugKey,
} from '../../constants/clientDebugKeys';
import { useSettings } from '../../contexts/SettingsContext';
import {
  isPerfTestsUserSettingEnabled,
  PERF_TESTS_USER_SETTING_KEY,
  setPerfTestsUserPreference,
  subscribePerfTestsPreference,
} from '../../perfTests';
import { toast } from '../../utils/toast';
import { formSecondaryButtonClass } from '../../utils/formFieldClasses';
import { ADMIN_TABLE_ROW_CLASS } from '../../utils/adminFieldLimits';

type TroubleshootKey = FeClientDebugKey | ServerDebugKey;

interface AdminTroubleshootingTabProps {
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onAutoSave: (key: string, value: string) => Promise<void>;
}

function isEnabled(value: string | undefined): boolean {
  return value === 'true';
}

const AdminTroubleshootingTab: React.FC<AdminTroubleshootingTabProps> = ({
  editingSettings,
  onSettingsChange,
  onAutoSave,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const { updateSiteSettings } = useSettings();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [perfTestsEnabled, setPerfTestsEnabled] = useState(false);
  const [perfTestsLoaded, setPerfTestsLoaded] = useState(false);
  const [cspReports, setCspReports] = useState<CspReportRow[]>([]);
  const [cspCount, setCspCount] = useState(0);
  const [cspLoading, setCspLoading] = useState(false);
  const [cspClearing, setCspClearing] = useState(false);

  const [cspClearConfirmOpen, setCspClearConfirmOpen] = useState(false);

  const loadCspReports = useCallback(async () => {
    setCspLoading(true);
    try {
      const data = await getCspReports();
      setCspReports(Array.isArray(data.reports) ? data.reports : []);
      setCspCount(typeof data.count === 'number' ? data.count : 0);
    } catch (error) {
      console.error('Failed to load CSP reports:', error);
      toast.error(t('appSettings.cspReportsLoadError'), '');
    } finally {
      setCspLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadCspReports();
  }, [loadCspReports]);

  useEffect(() => {
    if (!cspClearConfirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCspClearConfirmOpen(false);
    };
    // Defer outside-click so the opening click does not immediately close
    let removeOutside: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointer = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('[data-csp-clear-dialog]')) return;
        setCspClearConfirmOpen(false);
      };
      document.addEventListener('mousedown', onPointer);
      removeOutside = () => document.removeEventListener('mousedown', onPointer);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      removeOutside?.();
    };
  }, [cspClearConfirmOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getUserSettings();
        if (cancelled) return;
        setPerfTestsEnabled(
          isPerfTestsUserSettingEnabled(settings?.[PERF_TESTS_USER_SETTING_KEY])
        );
      } catch (error) {
        console.error('Failed to load perf tests preference:', error);
      } finally {
        if (!cancelled) setPerfTestsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribePerfTestsPreference(setPerfTestsEnabled), []);

  const handleClearCspReports = useCallback(async () => {
    setCspClearing(true);
    try {
      await clearCspReports();
      setCspReports([]);
      setCspCount(0);
      setCspClearConfirmOpen(false);
      toast.success(t('appSettings.cspReportsCleared'), '');
    } catch (error) {
      console.error('Failed to clear CSP reports:', error);
      toast.error(t('appSettings.cspReportsClearError'), '');
    } finally {
      setCspClearing(false);
    }
  }, [t]);

  const toggle = useCallback(
    async (key: TroubleshootKey) => {
      const previous = editingSettings[key] ?? 'false';
      const newValue = isEnabled(previous) ? 'false' : 'true';
      onSettingsChange({ ...editingSettings, [key]: newValue });
      setSavingKey(key);
      try {
        await onAutoSave(key, newValue);
      } catch (error) {
        console.error(`Failed to save ${key}:`, error);
        onSettingsChange({ ...editingSettings, [key]: previous });
      } finally {
        setSavingKey(null);
      }
    },
    [editingSettings, onAutoSave, onSettingsChange]
  );

  const togglePerfTests = useCallback(async () => {
    const previous = perfTestsEnabled;
    const next = !previous;
    setPerfTestsEnabled(next);
    setSavingKey(PERF_TESTS_USER_SETTING_KEY);
    try {
      await setPerfTestsUserPreference(next);
      toast.success(t('appSettings.settingSaved'), '');
    } catch (error) {
      console.error('Failed to save perf tests preference:', error);
      setPerfTestsEnabled(previous);
      toast.error(t('failedToSaveSetting', { key: PERF_TESTS_USER_SETTING_KEY }), '');
    } finally {
      setSavingKey(null);
    }
  }, [perfTestsEnabled, t]);

  const setMany = useCallback(
    async (keys: readonly string[], value: 'true' | 'false') => {
      const snapshot = { ...editingSettings };
      const settings: Record<string, string> = {};
      for (const key of keys) {
        settings[key] = value;
      }
      onSettingsChange({ ...editingSettings, ...settings });
      setSavingKey('bulk');
      try {
        await api.put('/admin/settings/bulk', { settings });
        updateSiteSettings(settings);
        toast.success(t('appSettings.settingSaved'), '');
      } catch (error) {
        console.error('Failed to bulk-update debug flags:', error);
        onSettingsChange(snapshot);
        toast.error(t('failedToSaveSettings'), '');
      } finally {
        setSavingKey(null);
      }
    },
    [editingSettings, onSettingsChange, t, updateSiteSettings]
  );

  const renderToggle = (key: TroubleshootKey, label: string, description: string, warn?: boolean) => {
    const on = isEnabled(editingSettings[key]);
    const busy = savingKey === key || savingKey === 'bulk';
    return (
      <div
        key={key}
        className={`flex items-center justify-between gap-4 py-3 ${
          warn ? 'rounded-md border border-amber-300/60 dark:border-amber-600/40 bg-amber-50/50 dark:bg-amber-900/10 px-3' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </label>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          <p className="mt-0.5 font-mono text-xs text-gray-400 dark:text-gray-500">{key}</p>
        </div>
        <div className="flex flex-shrink-0 items-center">
          <span className="mr-3 text-sm font-medium text-gray-700 dark:text-gray-300">
            {on ? t('appSettings.enabled') : t('appSettings.disabled')}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => toggle(key)}
            aria-pressed={on}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              on ? 'bg-blue-600 dark:bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-300 shadow ring-0 transition duration-200 ease-in-out ${
                on ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    );
  };

  const perfBusy =
    !perfTestsLoaded ||
    savingKey === PERF_TESTS_USER_SETTING_KEY ||
    savingKey === 'bulk';

  return (
    <div className="space-y-8" data-setting-key="TROUBLESHOOTING_SECTION">
      <div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('appSettings.troubleshootingTitle')}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line">
          {t('appSettings.troubleshootingDescription')}
        </p>
      </div>

      {/* Performance Test Overlay — per admin (user_settings) */}
      <section className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">
              {t('appSettings.perfTests')}
            </h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.perfTestsDescription')}
            </p>
            <p className="mt-0.5 font-mono text-xs text-gray-400 dark:text-gray-500">
              user_settings.{PERF_TESTS_USER_SETTING_KEY}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center pt-0.5">
            <span className="mr-3 text-sm font-medium text-gray-700 dark:text-gray-300">
              {perfTestsEnabled
                ? t('appSettings.enabled')
                : t('appSettings.disabled')}
            </span>
            <button
              type="button"
              disabled={perfBusy}
              onClick={() => togglePerfTests()}
              aria-pressed={perfTestsEnabled}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
                perfTestsEnabled
                  ? 'bg-blue-600 dark:bg-blue-500'
                  : 'bg-gray-200 dark:bg-gray-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-gray-300 shadow ring-0 transition duration-200 ease-in-out ${
                  perfTestsEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Browser console */}
      <section className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">
              {t('appSettings.troubleshootingBrowserSection')}
            </h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.troubleshootingBrowserSectionDescription')}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={savingKey !== null}
              onClick={() => setMany(FE_CLIENT_DEBUG_KEYS, 'true')}
              className={formSecondaryButtonClass}
            >
              {t('appSettings.enableAll')}
            </button>
            <button
              type="button"
              disabled={savingKey !== null}
              onClick={() => setMany(FE_CLIENT_DEBUG_KEYS, 'false')}
              className={formSecondaryButtonClass}
            >
              {t('appSettings.disableAll')}
            </button>
          </div>
        </div>
        <div className="px-6 py-2 divide-y divide-gray-100 dark:divide-gray-700">
          {FE_CLIENT_DEBUG_KEYS.map((key) =>
            renderToggle(
              key,
              t(`appSettings.debugFlags.${key}.label`),
              t(`appSettings.debugFlags.${key}.description`)
            )
          )}
        </div>
      </section>

      {/* Server logs */}
      <section className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">
            {t('appSettings.troubleshootingServerSection')}
          </h4>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('appSettings.troubleshootingServerSectionDescription')}
          </p>
        </div>
        <div className="px-6 py-2 space-y-1">
          {SERVER_DEBUG_KEYS.map((key) =>
            renderToggle(
              key,
              t(`appSettings.debugFlags.${key}.label`),
              t(`appSettings.debugFlags.${key}.description`),
              key === 'SERVER_DEBUG_SQL'
            )
          )}
        </div>
      </section>

      {/* CSP reports */}
      <section className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">
              {t('appSettings.cspReportsSection')}
            </h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.cspReportsSectionDescription')}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('appSettings.cspReportsCount', { count: cspCount })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={cspLoading}
              onClick={() => loadCspReports()}
              className={formSecondaryButtonClass}
            >
              {t('appSettings.cspReportsRefresh')}
            </button>
            <button
              type="button"
              disabled={cspClearing || cspCount === 0}
              onClick={() => setCspClearConfirmOpen(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50"
            >
              {t('appSettings.cspReportsClear')}
            </button>
          </div>
        </div>
        <div className="px-6 py-3 overflow-x-auto">
          {cspLoading && cspReports.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">…</p>
          ) : cspReports.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('appSettings.cspReportsEmpty')}
            </p>
          ) : (
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">
                    {t('appSettings.cspReportsTime')}
                  </th>
                  <th className="py-1.5 pr-3 font-medium whitespace-nowrap">
                    {t('appSettings.cspReportsDirective')}
                  </th>
                  <th className="py-1.5 pr-3 font-medium">
                    {t('appSettings.cspReportsBlocked')}
                  </th>
                  <th className="py-1.5 font-medium">
                    {t('appSettings.cspReportsDocument')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/80">
                {cspReports.map((row) => (
                  <tr key={row.id} className={`align-top text-gray-800 dark:text-gray-200 ${ADMIN_TABLE_ROW_CLASS}`}>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {row.createdAt
                        ? new Date(row.createdAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap font-mono">
                      {row.violatedDirective || '—'}
                    </td>
                    <td className="py-1.5 pr-3 font-mono break-all max-w-[14rem]">
                      {row.blockedUri || '—'}
                    </td>
                    <td className="py-1.5 font-mono break-all max-w-[14rem]">
                      {row.documentUri || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {cspClearConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            data-csp-clear-dialog
            className="bg-white dark:bg-gray-800 rounded-lg p-5 max-w-sm w-full shadow-xl"
          >
            <p className="text-sm text-gray-800 dark:text-gray-100">
              {t('appSettings.cspReportsClearConfirm')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCspClearConfirmOpen(false)}
                className={formSecondaryButtonClass}
              >
                {t('cancel', { ns: 'common' })}
              </button>
              <button
                type="button"
                disabled={cspClearing}
                onClick={() => handleClearCspReports()}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t('appSettings.cspReportsClear')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTroubleshootingTab;
