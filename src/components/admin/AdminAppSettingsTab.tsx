import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AdminTroubleshootingTab from './AdminTroubleshootingTab';
import api from '../../api';
import { ALL_TROUBLESHOOTING_SETTING_KEYS } from '../../constants/clientDebugKeys';
import { useSettings } from '../../contexts/SettingsContext';
import { toast } from '../../utils/toast';
import {
  adminSettingsHaveChanges,
  getDirtyAppSettingsSubTabs,
  revertAdminSettingField,
} from '../../utils/adminSettingsDirty';
import {
  ACTIVITY_FEED_HEIGHT,
  ACTIVITY_FEED_INSET,
  ACTIVITY_FEED_POS_Y,
  ACTIVITY_FEED_WIDTH,
  ADMIN_NUMERIC_INPUT_CLASS,
  clampActivityFeedInSettings,
  clampIntToString,
  parseActivityFeedPosition,
  readActivityFeedPositionRaw,
  stringifyActivityFeedPosition,
} from '../../utils/adminFieldLimits';
import { normalizeTaskViewMode } from '../../utils/userPreferences';
import { AdminDirtyDot, AdminFieldDraftControls } from './AdminFieldDraftControls';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import {
  AdminActionsBar,
  AdminPageShell,
  AdminSection,
  adminInputClass,
} from './AdminSection';
import { AdminToggle, adminSettingIsEnabled } from './AdminToggle';
import {
  TROUBLESHOOTING_UNLOCK_KEY,
  TROUBLESHOOTING_UNLOCK_SEQUENCE,
  isTroubleshootingGatedDeployment,
  notifyTroubleshootingVisibilityChanged,
  readTroubleshootingUnlocked,
} from '../../utils/troubleshootingAccess';

interface AdminAppSettingsTabProps {
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  onCancel: () => void;
  onAutoSave?: (key: string, value: string) => Promise<void>;
  /** Incremented when admin Discard runs — re-hydrate local subtab drafts */
  discardNonce?: number;
}

type AppSettingsSubTab = 'ui' | 'troubleshooting';

/**
 * Hidden unlock for Troubleshooting when MULTI_TENANT or DEMO_ENABLED:
 * Type TROUBLE (all caps) while on Admin → App Settings. Works on any OS/keyboard.
 * Ignored while focus is in an input/textarea. Session-only (sessionStorage).
 */
function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function subTabFromHash(hash: string): AppSettingsSubTab {
  if (hash === '#admin#app-settings#troubleshooting') return 'troubleshooting';
  return 'ui';
}

const AdminAppSettingsTab: React.FC<AdminAppSettingsTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onAutoSave,
}) => {
  const { t } = useTranslation('admin');
  const { updateSiteSettings, siteSettings } = useSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<AppSettingsSubTab>(() =>
    typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'ui'
  );
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<AppSettingsSubTab>>(
    () =>
      new Set<AppSettingsSubTab>([
        typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'ui',
      ])
  );

  useEffect(() => {
    setVisitedSubTabs((prev) => {
      if (prev.has(activeSubTab)) return prev;
      const next = new Set(prev);
      next.add(activeSubTab);
      return next;
    });
  }, [activeSubTab]);

  const troubleshootingGated = isTroubleshootingGatedDeployment(siteSettings);
  const [troubleshootingUnlocked, setTroubleshootingUnlocked] = useState(
    () => !troubleshootingGated || readTroubleshootingUnlocked()
  );
  const showTroubleshootingTab = !troubleshootingGated || troubleshootingUnlocked;
  const troubleshootingUnlockedRef = useRef(troubleshootingUnlocked);
  troubleshootingUnlockedRef.current = troubleshootingUnlocked;
  const editingSettingsRef = useRef(editingSettings);
  editingSettingsRef.current = editingSettings;
  const lockInProgressRef = useRef(false);

  const disableAllTroubleshootingSettings = useCallback(async () => {
    const settings: Record<string, string> = {};
    for (const key of ALL_TROUBLESHOOTING_SETTING_KEYS) {
      settings[key] = 'false';
    }
    await api.put('/admin/settings/bulk', { settings });
    return settings;
  }, []);

  // Sync activeSubTab from URL hash (fall back if troubleshooting is gated/locked)
  useEffect(() => {
    const tab = subTabFromHash(window.location.hash);
    if (tab === 'troubleshooting' && !showTroubleshootingTab) {
      setActiveSubTab('ui');
      window.location.hash = '#admin#app-settings#user-interface';
      return;
    }
    setActiveSubTab(tab);
  }, [showTroubleshootingTab]);

  // Hidden sequence: type TROUBLE (caps) to toggle Troubleshooting on MULTI_TENANT / DEMO
  useEffect(() => {
    if (!troubleshootingGated) return;

    let buffer = '';
    let lastKeyAt = 0;
    const RESET_MS = 2500;

    const applyUnlocked = (next: boolean) => {
      troubleshootingUnlockedRef.current = next;
      try {
        if (next) {
          sessionStorage.setItem(TROUBLESHOOTING_UNLOCK_KEY, 'true');
        } else {
          sessionStorage.removeItem(TROUBLESHOOTING_UNLOCK_KEY);
        }
      } catch {
        /* ignore */
      }
      setTroubleshootingUnlocked(next);
      notifyTroubleshootingVisibilityChanged();
      if (next) {
        toast.success(t('appSettings.troubleshootingUnlocked'), '');
      } else {
        toast.success(t('appSettings.troubleshootingLocked'), '');
        setActiveSubTab((cur) => {
          if (cur === 'troubleshooting') {
            window.location.hash = '#admin#app-settings#user-interface';
            return 'ui';
          }
          return cur;
        });
      }
    };

    const toggleTroubleshooting = async () => {
      if (lockInProgressRef.current) return;

      if (!troubleshootingUnlockedRef.current) {
        applyUnlocked(true);
        return;
      }

      // Locking: one bulk save, then hide — no per-toggle UI updates.
      lockInProgressRef.current = true;
      try {
        const cleared = await disableAllTroubleshootingSettings();
        applyUnlocked(false);
        updateSiteSettings(cleared);
        onSettingsChange({ ...editingSettingsRef.current, ...cleared });
      } catch {
        toast.error(t('failedToSaveSettings'), '');
      } finally {
        lockInProgressRef.current = false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't steal browser shortcuts or interfere with form fields (AI URL, etc.).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableKeyTarget(e.target)) return;
      if (e.key.length !== 1) return;

      const now = Date.now();
      if (now - lastKeyAt > RESET_MS) buffer = '';
      lastKeyAt = now;

      // All caps only — lowercase or other characters reset the sequence.
      if (e.key < 'A' || e.key > 'Z') {
        buffer = '';
        return;
      }

      buffer = (buffer + e.key).slice(-TROUBLESHOOTING_UNLOCK_SEQUENCE.length);
      if (buffer === TROUBLESHOOTING_UNLOCK_SEQUENCE) {
        buffer = '';
        e.preventDefault();
        void toggleTroubleshooting();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [troubleshootingGated, t, disableAllTroubleshootingSettings, updateSiteSettings, onSettingsChange]);

  // Update URL hash when activeSubTab changes
  const handleSubTabChange = (tab: AppSettingsSubTab) => {
    if (tab === 'troubleshooting' && !showTroubleshootingTab) return;
    setActiveSubTab(tab);
    const hashByTab: Record<AppSettingsSubTab, string> = {
      ui: '#admin#app-settings#user-interface',
      troubleshooting: '#admin#app-settings#troubleshooting',
    };
    window.location.hash = hashByTab[tab];
  };

  // Listen for hash changes (back/forward navigation within App Settings only)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      // Ignore Admin tab switches (e.g. → mail-server) so we don't fight navigation
      if (!hash.startsWith('#admin#app-settings')) {
        return;
      }
      const tab = subTabFromHash(hash);
      if (tab === 'troubleshooting' && !showTroubleshootingTab) {
        setActiveSubTab('ui');
        window.location.hash = '#admin#app-settings#user-interface';
        return;
      }
      setActiveSubTab(tab);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [showTroubleshootingTab]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const clamped = clampActivityFeedInSettings(editingSettings);
      if (clamped !== editingSettings) {
        onSettingsChange(clamped);
      }
      await onSave(clamped);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = useMemo(
    () => adminSettingsHaveChanges(settings, editingSettings),
    [settings, editingSettings]
  );

  const dirtySubTabs = useMemo(
    () => getDirtyAppSettingsSubTabs(settings, editingSettings),
    [settings, editingSettings]
  );

  const activityFeedPos = useMemo(
    () => readActivityFeedPositionRaw(editingSettings.DEFAULT_ACTIVITY_FEED_POSITION),
    [editingSettings.DEFAULT_ACTIVITY_FEED_POSITION]
  );

  const revertField = (key: string) => {
    onSettingsChange(revertAdminSettingField(key, settings, editingSettings));
  };

  const handleAppLanguageChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      APP_LANGUAGE: value
    });
    
    // Auto-save the app language change (silent - no toast, parent will show one)
    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          APP_LANGUAGE: value
        });
        // Don't show toast here - parent handleSaveSettings will show one
      } catch (error) {
        console.error('Failed to save app language:', error);
      }
    }, 100);
  };

  const handleTaskDeleteConfirmChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      TASK_DELETE_CONFIRM: value
    });
    
    // Auto-save the task delete confirm change (silent - no toast, parent will show one)
    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          TASK_DELETE_CONFIRM: value
        });
        // Don't show toast here - parent handleSaveSettings will show one
      } catch (error) {
        console.error('Failed to save task delete confirm:', error);
      }
    }, 100);
  };

  const handleAllowUserSelfDeleteChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      ALLOW_USER_SELF_DELETE: value
    });

    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          ALLOW_USER_SELF_DELETE: value
        });
      } catch (error) {
        console.error('Failed to save allow user self-delete:', error);
      }
    }, 100);
  };

  const handleShowActivityFeedChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      SHOW_ACTIVITY_FEED: value
    });
    
    // Auto-save the activity feed visibility change (silent - no toast, parent will show one)
    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          SHOW_ACTIVITY_FEED: value
        });
        // Don't show toast here - parent handleSaveSettings will show one
      } catch (error) {
        console.error('Failed to save activity feed visibility:', error);
      }
    }, 100);
  };

  const handleDefaultViewModeChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      DEFAULT_VIEW_MODE: value
    });
    
    // Auto-save the default view mode change (silent - no toast, parent will show one)
    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          DEFAULT_VIEW_MODE: value
        });
        // Don't show toast here - parent handleSaveSettings will show one
      } catch (error) {
        console.error('Failed to save default view mode:', error);
      }
    }, 100);
  };

  const handleDefaultTaskViewModeChange = (value: string) => {
    const mode = normalizeTaskViewMode(value);
    onSettingsChange({
      ...editingSettings,
      DEFAULT_TASK_VIEW_MODE: mode
    });
    
    // Auto-save the default task view mode change (silent - no toast, parent will show one)
    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          DEFAULT_TASK_VIEW_MODE: mode
        });
        // Don't show toast here - parent handleSaveSettings will show one
      } catch (error) {
        console.error('Failed to save default task view mode:', error);
      }
    }, 100);
  };

  // Manual save fields (no auto-save) - position, width, height
  const handleActivityFeedPosChange = (
    field: 'edge' | 'inset' | 'y',
    value: string
  ) => {
    const current = readActivityFeedPositionRaw(editingSettings.DEFAULT_ACTIVITY_FEED_POSITION);
    const edge = field === 'edge' ? (value as 'left' | 'right') : current.edge;
    const inset = field === 'inset' ? value : current.inset;
    const y = field === 'y' ? value : current.y;
    const insetNum =
      inset === '' || inset === undefined || inset === null
        ? ''
        : Number(inset);
    const yNum = y === '' || y === undefined || y === null ? '' : Number(y);
    const signedX =
      insetNum === ''
        ? ''
        : edge === 'right'
          ? -Math.abs(Number(insetNum) || 0)
          : Math.abs(Number(insetNum) || 0);
    onSettingsChange({
      ...editingSettings,
      DEFAULT_ACTIVITY_FEED_POSITION: JSON.stringify({ x: signedX, y: yNum }),
    });
  };

  const clampActivityFeedPosOnBlur = () => {
    const pos = parseActivityFeedPosition(editingSettings.DEFAULT_ACTIVITY_FEED_POSITION);
    onSettingsChange({
      ...editingSettings,
      DEFAULT_ACTIVITY_FEED_POSITION: stringifyActivityFeedPosition(pos),
    });
  };

  const handleDefaultActivityFeedWidthChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      DEFAULT_ACTIVITY_FEED_WIDTH: value,
    });
  };

  const handleDefaultActivityFeedHeightChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      DEFAULT_ACTIVITY_FEED_HEIGHT: value,
    });
  };

  return (
    <div className="p-6">
      {/* Sub-tab Navigation */}
      <div className="mb-6">
        <nav className="flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => handleSubTabChange('ui')}
            className={`py-2 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-1.5 ${
              activeSubTab === 'ui'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {t('appSettings.userInterface')}
            <AdminDirtyDot show={dirtySubTabs.has('ui')} />
          </button>
          {showTroubleshootingTab && (
            <button
              onClick={() => handleSubTabChange('troubleshooting')}
              className={`py-2 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-1.5 ${
                activeSubTab === 'troubleshooting'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {t('appSettings.troubleshooting')}
              <AdminDirtyDot show={dirtySubTabs.has('troubleshooting')} />
            </button>
          )}
        </nav>
      </div>

      {/* Sub-tab panels: keep visited mounted (hidden) so drafts survive switches */}
      {visitedSubTabs.has('troubleshooting') && showTroubleshootingTab && onAutoSave && (
        <div
          className={activeSubTab === 'troubleshooting' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'troubleshooting'}
        >
          <AdminTroubleshootingTab
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onAutoSave={onAutoSave}
          />
        </div>
      )}

      {visitedSubTabs.has('ui') && (
        <div
          className={activeSubTab === 'ui' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'ui'}
        >
          <AdminPageShell
            description={t('appSettings.userInterfaceSettingsDescription')}
            width="full"
          >
            <AdminSection title={t('appSettings.userInterfaceSettings')} dense>
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start" data-setting-key="APP_LANGUAGE">
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                      {t('appSettings.defaultApplicationLanguage')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-line leading-snug">
                      {t('appSettings.defaultApplicationLanguageDescription')}
                    </p>
                  </div>
                  <select
                    value={editingSettings.APP_LANGUAGE || 'EN'}
                    onChange={(e) => handleAppLanguageChange(e.target.value)}
                    className={`w-36 ${adminInputClass}`}
                  >
                    <option value="EN">English</option>
                    <option value="FR">Français</option>
                  </select>
                </div>

                <div
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start"
                  data-setting-key="TASK_DELETE_CONFIRM"
                >
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                      {t('appSettings.taskDeleteConfirmation')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      {t('appSettings.taskDeleteConfirmationDescription')}
                    </p>
                  </div>
                  <AdminToggle
                    checked={adminSettingIsEnabled(editingSettings.TASK_DELETE_CONFIRM)}
                    label={
                      adminSettingIsEnabled(editingSettings.TASK_DELETE_CONFIRM)
                        ? t('appSettings.enabled')
                        : t('appSettings.disabled')
                    }
                    onChange={(next) =>
                      handleTaskDeleteConfirmChange(next ? 'true' : 'false')
                    }
                  />
                </div>

                <div
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start"
                  data-setting-key="ALLOW_USER_SELF_DELETE"
                >
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                      {t('appSettings.allowUserSelfDelete')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      {t('appSettings.allowUserSelfDeleteDescription')}
                    </p>
                  </div>
                  <AdminToggle
                    checked={adminSettingIsEnabled(editingSettings.ALLOW_USER_SELF_DELETE)}
                    label={
                      adminSettingIsEnabled(editingSettings.ALLOW_USER_SELF_DELETE)
                        ? t('appSettings.enabled')
                        : t('appSettings.disabled')
                    }
                    onChange={(next) =>
                      handleAllowUserSelfDeleteChange(next ? 'true' : 'false')
                    }
                  />
                </div>
              </div>
            </AdminSection>

            <AdminSection
              title={t('appSettings.newUserDefaults')}
              description={t('appSettings.newUserDefaultsDescription')}
              dense
            >
              <div className="space-y-2.5">
                <div
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start"
                  data-setting-key="DEFAULT_VIEW_MODE"
                >
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                      {t('appSettings.defaultViewMode')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      {t('appSettings.defaultViewModeDescription')}
                    </p>
                  </div>
                  <select
                    value={editingSettings.DEFAULT_VIEW_MODE || 'kanban'}
                    onChange={(e) => handleDefaultViewModeChange(e.target.value)}
                    className={`w-36 ${adminInputClass}`}
                  >
                    <option value="kanban">Kanban</option>
                    <option value="list">List</option>
                  </select>
                </div>

                <div
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start"
                  data-setting-key="DEFAULT_TASK_VIEW_MODE"
                >
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                      {t('appSettings.defaultTaskViewMode')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      {t('appSettings.defaultTaskViewModeDescription')}
                    </p>
                  </div>
                  <select
                    value={normalizeTaskViewMode(editingSettings.DEFAULT_TASK_VIEW_MODE)}
                    onChange={(e) => handleDefaultTaskViewModeChange(e.target.value)}
                    className={`w-40 ${adminInputClass}`}
                  >
                    <option value="expand">{t('appSettings.taskViewExpand')}</option>
                    <option value="shrink">{t('appSettings.taskViewShrink')}</option>
                    <option value="compact">{t('appSettings.taskViewCompact')}</option>
                  </select>
                </div>

                <div className="rounded-md border border-blue-200 dark:border-blue-700 bg-blue-50/80 dark:bg-blue-950/20 p-3 space-y-2.5">
                  <div>
                    <h5 className="text-sm font-medium text-blue-900 dark:text-blue-200">
                      {t('appSettings.activityFeedDefaults')}
                    </h5>
                    <p className="text-xs text-blue-700 dark:text-blue-300 leading-snug">
                      {t('appSettings.activityFeedDefaultsDescription')}
                    </p>
                  </div>

                  <div
                    className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start"
                    data-setting-key="SHOW_ACTIVITY_FEED"
                  >
                    <div className="min-w-0">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block">
                        {t('appSettings.defaultVisibility')}
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {t('appSettings.defaultVisibilityDescription')}
                      </p>
                    </div>
                    <AdminToggle
                      checked={adminSettingIsEnabled(editingSettings.SHOW_ACTIVITY_FEED)}
                      label={
                        adminSettingIsEnabled(editingSettings.SHOW_ACTIVITY_FEED)
                          ? t('appSettings.enabled')
                          : t('appSettings.disabled')
                      }
                      onChange={(next) =>
                        handleShowActivityFeedChange(next ? 'true' : 'false')
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start">
                    <div className="min-w-0">
                      <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        <span>{t('appSettings.defaultPosition')}</span>
                        <AdminFieldDraftControls
                          settingKey="DEFAULT_ACTIVITY_FEED_POSITION"
                          saved={settings}
                          draft={editingSettings}
                          onRevert={() => revertField('DEFAULT_ACTIVITY_FEED_POSITION')}
                        />
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {t('appSettings.defaultPositionDescription', {
                          min: ACTIVITY_FEED_INSET.min,
                          max: ACTIVITY_FEED_INSET.max,
                          yMin: ACTIVITY_FEED_POS_Y.min,
                          yMax: ACTIVITY_FEED_POS_Y.max,
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <span className="sr-only">{t('appSettings.positionEdge')}</span>
                        <select
                          value={activityFeedPos.edge}
                          onChange={(e) =>
                            handleActivityFeedPosChange('edge', e.target.value)
                          }
                          onBlur={clampActivityFeedPosOnBlur}
                          className={`w-24 ${adminInputClass}`}
                          aria-label={t('appSettings.positionEdge')}
                        >
                          <option value="left">{t('appSettings.positionEdgeLeft')}</option>
                          <option value="right">{t('appSettings.positionEdgeRight')}</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        {t('appSettings.positionInset')}
                        <input
                          type="number"
                          inputMode="numeric"
                          value={activityFeedPos.inset}
                          onChange={(e) => handleActivityFeedPosChange('inset', e.target.value)}
                          onBlur={clampActivityFeedPosOnBlur}
                          className={`w-16 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
                          aria-label={`${t('appSettings.positionInset')} (${ACTIVITY_FEED_INSET.min}–${ACTIVITY_FEED_INSET.max})`}
                        />
                      </label>
                      <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        Y
                        <input
                          type="number"
                          inputMode="numeric"
                          value={activityFeedPos.y}
                          onChange={(e) => handleActivityFeedPosChange('y', e.target.value)}
                          onBlur={clampActivityFeedPosOnBlur}
                          className={`w-16 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
                          aria-label={`${t('appSettings.defaultPosition')} Y (${ACTIVITY_FEED_POS_Y.min}–${ACTIVITY_FEED_POS_Y.max})`}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start">
                    <div className="min-w-0">
                      <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        <span>{t('appSettings.defaultWidth')}</span>
                        <AdminFieldDraftControls
                          settingKey="DEFAULT_ACTIVITY_FEED_WIDTH"
                          saved={settings}
                          draft={editingSettings}
                          onRevert={() => revertField('DEFAULT_ACTIVITY_FEED_WIDTH')}
                        />
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {t('appSettings.defaultWidthDescription', {
                          min: ACTIVITY_FEED_WIDTH.min,
                          max: ACTIVITY_FEED_WIDTH.max,
                        })}
                      </p>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editingSettings.DEFAULT_ACTIVITY_FEED_WIDTH || '160'}
                      onChange={(e) => handleDefaultActivityFeedWidthChange(e.target.value)}
                      onBlur={() =>
                        onSettingsChange({
                          ...editingSettings,
                          DEFAULT_ACTIVITY_FEED_WIDTH: clampIntToString(
                            editingSettings.DEFAULT_ACTIVITY_FEED_WIDTH,
                            ACTIVITY_FEED_WIDTH.min,
                            ACTIVITY_FEED_WIDTH.max,
                            160
                          ),
                        })
                      }
                      className={`w-20 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start">
                    <div className="min-w-0">
                      <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                        <span>{t('appSettings.defaultHeight')}</span>
                        <AdminFieldDraftControls
                          settingKey="DEFAULT_ACTIVITY_FEED_HEIGHT"
                          saved={settings}
                          draft={editingSettings}
                          onRevert={() => revertField('DEFAULT_ACTIVITY_FEED_HEIGHT')}
                        />
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {t('appSettings.defaultHeightDescription', {
                          min: ACTIVITY_FEED_HEIGHT.min,
                          max: ACTIVITY_FEED_HEIGHT.max,
                        })}
                      </p>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editingSettings.DEFAULT_ACTIVITY_FEED_HEIGHT || '400'}
                      onChange={(e) => handleDefaultActivityFeedHeightChange(e.target.value)}
                      onBlur={() =>
                        onSettingsChange({
                          ...editingSettings,
                          DEFAULT_ACTIVITY_FEED_HEIGHT: clampIntToString(
                            editingSettings.DEFAULT_ACTIVITY_FEED_HEIGHT,
                            ACTIVITY_FEED_HEIGHT.min,
                            ACTIVITY_FEED_HEIGHT.max,
                            400
                          ),
                        })
                      }
                      className={`w-20 ${adminInputClass} ${ADMIN_NUMERIC_INPUT_CLASS}`}
                    />
                  </div>
                </div>
              </div>
            </AdminSection>

            <AdminActionsBar className="justify-between">
              <AdminUnsavedHint show={hasChanges} />
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isSaving || !hasChanges}
                  className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('appSettings.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !hasChanges}
                  className={`px-4 py-1.5 text-sm border border-transparent rounded-md shadow-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                    hasChanges
                      ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-amber-400 ring-offset-2'
                      : 'bg-blue-600'
                  }`}
                >
                  {isSaving ? t('appSettings.saving') : t('appSettings.saveChanges')}
                </button>
              </div>
            </AdminActionsBar>
          </AdminPageShell>
        </div>
      )}
    </div>
  );
};

export default AdminAppSettingsTab;
