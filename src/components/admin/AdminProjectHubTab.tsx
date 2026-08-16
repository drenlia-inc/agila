import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminProjectSettingsTab from './AdminProjectSettingsTab';
import AdminFeaturesSettingsTab from './AdminFeaturesSettingsTab';
import AdminSprintSettingsTab from './AdminSprintSettingsTab';
import AdminReportingTab from './AdminReportingTab';
import AdminLifecycleTab from './AdminLifecycleTab';
import { AdminDirtyDot, AdminPendingCountBadge } from './AdminFieldDraftControls';
import {
  getDirtyProjectHubSubTabs,
  type ProjectHubSubTabId,
} from '../../utils/adminSettingsDirty';
import { adminSubtabPanelClass, adminSubNavTabClass } from './AdminSection';

export type ProjectHubSubTab = ProjectHubSubTabId;

interface AdminProjectHubTabProps {
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  onCancel: () => void;
  onAutoSave?: (key: string, value: string, options?: { silent?: boolean }) => Promise<void>;
  onLocalDirtyChange?: (dirty: boolean) => void;
  onRegisterLocalSave?: (save: (() => Promise<void>) | null) => void;
  discardNonce?: number;
  lifecyclePendingCount?: number;
  onLifecyclePendingRefresh?: () => void | Promise<void>;
  /** True when the Admin → Project Settings panel is visible. */
  isActive?: boolean;
}

function subTabFromHash(hash: string): ProjectHubSubTab {
  const bare = hash.replace(/^#/, '');
  if (bare.endsWith('#features')) return 'features';
  if (bare.endsWith('#sprint-settings')) return 'sprint-settings';
  if (bare.endsWith('#reporting')) return 'reporting';
  if (bare.endsWith('#lifecycle')) return 'lifecycle';
  return 'project';
}

const HASH_BY_TAB: Record<ProjectHubSubTab, string> = {
  project: '#admin#project-settings#project',
  features: '#admin#project-settings#features',
  'sprint-settings': '#admin#project-settings#sprint-settings',
  reporting: '#admin#project-settings#reporting',
  lifecycle: '#admin#project-settings#lifecycle',
};

const TOUR_ID_BY_TAB: Record<ProjectHubSubTab, string> = {
  // Distinct from main nav `admin-project-settings` (hub tab button)
  project: 'admin-project-general',
  features: 'admin-features',
  'sprint-settings': 'admin-sprint-settings',
  reporting: 'admin-reporting',
  lifecycle: 'admin-lifecycle',
};

const AdminProjectHubTab: React.FC<AdminProjectHubTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onAutoSave,
  onLocalDirtyChange,
  onRegisterLocalSave,
  discardNonce = 0,
  lifecyclePendingCount = 0,
  onLifecyclePendingRefresh,
  isActive = true,
}) => {
  const { t } = useTranslation('admin');
  const [activeSubTab, setActiveSubTab] = useState<ProjectHubSubTab>(() =>
    typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'project'
  );
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<ProjectHubSubTab>>(
    () =>
      new Set<ProjectHubSubTab>([
        typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'project',
      ])
  );
  const [reportingLocalDirty, setReportingLocalDirty] = useState(false);
  const [lifecycleLocalDirty, setLifecycleLocalDirty] = useState(false);
  const reportingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const lifecycleSaveRef = useRef<(() => Promise<void>) | null>(null);
  const reportingLocalDirtyRef = useRef(reportingLocalDirty);
  const lifecycleLocalDirtyRef = useRef(lifecycleLocalDirty);
  reportingLocalDirtyRef.current = reportingLocalDirty;
  lifecycleLocalDirtyRef.current = lifecycleLocalDirty;

  const registerReportingSave = useCallback((save: (() => Promise<void>) | null) => {
    reportingSaveRef.current = save;
  }, []);
  const registerLifecycleSave = useCallback((save: (() => Promise<void>) | null) => {
    lifecycleSaveRef.current = save;
  }, []);

  useEffect(() => {
    if (!onRegisterLocalSave) return;
    onRegisterLocalSave(async () => {
      if (reportingLocalDirtyRef.current && reportingSaveRef.current) {
        await reportingSaveRef.current();
      }
      if (lifecycleLocalDirtyRef.current && lifecycleSaveRef.current) {
        await lifecycleSaveRef.current();
      }
    });
    return () => onRegisterLocalSave(null);
  }, [onRegisterLocalSave]);

  useEffect(() => {
    setVisitedSubTabs((prev) => {
      if (prev.has(activeSubTab)) return prev;
      const next = new Set(prev);
      next.add(activeSubTab);
      return next;
    });
  }, [activeSubTab]);

  useEffect(() => {
    onLocalDirtyChange?.(reportingLocalDirty || lifecycleLocalDirty);
  }, [reportingLocalDirty, lifecycleLocalDirty, onLocalDirtyChange]);

  const dirtySubTabs = useMemo(
    () =>
      getDirtyProjectHubSubTabs(settings, editingSettings, {
        reportingLocalDirty,
        lifecycleLocalDirty,
      }),
    [settings, editingSettings, reportingLocalDirty, lifecycleLocalDirty]
  );

  const handleSubTabChange = (tab: ProjectHubSubTab) => {
    setActiveSubTab(tab);
    window.location.hash = HASH_BY_TAB[tab];
  };

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#admin#project-settings')) return;
      setActiveSubTab(subTabFromHash(hash));
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const subNavBtn = (tab: ProjectHubSubTab, label: string) => (
    <button
      key={tab}
      type="button"
      onClick={() => handleSubTabChange(tab)}
      data-tour-id={TOUR_ID_BY_TAB[tab]}
      className={adminSubNavTabClass(activeSubTab === tab)}
    >
      {label}
      {tab === 'lifecycle' && (
        <AdminPendingCountBadge
          count={lifecyclePendingCount}
          label={t('lifecycle.pendingBadge', { count: lifecyclePendingCount })}
        />
      )}
      <AdminDirtyDot show={dirtySubTabs.has(tab)} />
    </button>
  );

  return (
    <div className="p-6">
      <div className="mb-4 overflow-x-auto">
        <nav className="flex space-x-6 min-w-max" aria-label="Project settings tabs">
          {subNavBtn('project', t('projectHub.projectSubtab'))}
          {subNavBtn('features', t('projectHub.featuresSubtab'))}
          {subNavBtn('sprint-settings', t('tabs.sprintSettings'))}
          {subNavBtn('reporting', t('tabs.reporting'))}
          {subNavBtn('lifecycle', t('tabs.lifecycle'))}
        </nav>
      </div>

      <div className={adminSubtabPanelClass}>
      {visitedSubTabs.has('project') && (
        <div
          className={activeSubTab === 'project' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'project'}
        >
          <AdminProjectSettingsTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
            onCancel={onCancel}
            onAutoSave={onAutoSave}
            embedded
          />
        </div>
      )}

      {visitedSubTabs.has('features') && (
        <div
          className={activeSubTab === 'features' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'features'}
        >
          <AdminFeaturesSettingsTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onAutoSave={onAutoSave}
          />
        </div>
      )}

      {visitedSubTabs.has('sprint-settings') && (
        <div
          className={activeSubTab === 'sprint-settings' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'sprint-settings'}
        >
          <AdminSprintSettingsTab />
        </div>
      )}

      {visitedSubTabs.has('reporting') && (
        <div
          className={activeSubTab === 'reporting' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'reporting'}
        >
          <AdminReportingTab
            onLocalDirtyChange={setReportingLocalDirty}
            onRegisterLocalSave={registerReportingSave}
            discardNonce={discardNonce}
          />
        </div>
      )}

      {visitedSubTabs.has('lifecycle') && (
        <div
          className={activeSubTab === 'lifecycle' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'lifecycle'}
        >
          <AdminLifecycleTab
            onLocalDirtyChange={setLifecycleLocalDirty}
            onRegisterLocalSave={registerLifecycleSave}
            discardNonce={discardNonce}
            onPendingChange={onLifecyclePendingRefresh}
            isActive={isActive && activeSubTab === 'lifecycle'}
          />
        </div>
      )}
      </div>
    </div>
  );
};

export default AdminProjectHubTab;
