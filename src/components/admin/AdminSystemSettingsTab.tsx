import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import AdminSSOTab from './AdminSSOTab';
import AdminStorageTab from './AdminStorageTab';
import AdminFileUploadsTab from './AdminFileUploadsTab';
import AdminAISettingsTab from './AdminAISettingsTab';
import { AdminDirtyDot } from './AdminFieldDraftControls';
import {
  getDirtySystemSettingsSubTabs,
  type SystemSettingsSubTabId,
} from '../../utils/adminSettingsDirty';
import { adminSubtabPanelClass, adminSubNavTabClass, adminHubSubnavShellClass } from './AdminSection';
import { AdminHubSubnavPortal } from './AdminHubSubnavPortal';
import api from '../../api';

export type SystemSettingsSubTab = SystemSettingsSubTabId;

interface AdminSystemSettingsTabProps {
  panelActive?: boolean;
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  onCancel: () => void;
  onAutoSave?: (key: string, value: string) => Promise<void>;
  onSettingsReload?: (options?: { quiet?: boolean }) => Promise<void>;
  /** Patch saved + draft settings without a full Admin reload (keeps modals mounted). */
  onApplySettingsPatch?: (patch: Record<string, string | undefined>) => void;
  onLocalDirtyChange?: (dirty: boolean) => void;
  onRegisterLocalSave?: (save: (() => Promise<void>) | null) => void;
  discardNonce?: number;
}

function subTabFromHash(hash: string): SystemSettingsSubTab {
  const bare = hash.replace(/^#/, '');
  if (bare.endsWith('#storage')) return 'storage';
  if (bare.endsWith('#file-uploads')) return 'file-uploads';
  if (bare.endsWith('#ai')) return 'ai';
  return 'sso';
}

const HASH_BY_TAB: Record<SystemSettingsSubTab, string> = {
  sso: '#admin#system-settings#sso',
  storage: '#admin#system-settings#storage',
  'file-uploads': '#admin#system-settings#file-uploads',
  ai: '#admin#system-settings#ai',
};

const TOUR_ID_BY_TAB: Record<SystemSettingsSubTab, string> = {
  sso: 'admin-sso',
  storage: 'admin-storage',
  'file-uploads': 'admin-file-uploads',
  ai: 'admin-ai',
};

const AdminSystemSettingsTab: React.FC<AdminSystemSettingsTabProps> = ({
  panelActive = true,
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onAutoSave,
  onSettingsReload,
  onApplySettingsPatch,
  onLocalDirtyChange,
  onRegisterLocalSave,
  discardNonce = 0,
}) => {
  const { t } = useTranslation('admin');
  const [activeSubTab, setActiveSubTab] = useState<SystemSettingsSubTab>(() =>
    typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'sso'
  );
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<SystemSettingsSubTab>>(
    () =>
      new Set<SystemSettingsSubTab>([
        typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'sso',
      ])
  );
  const [aiLocalDirty, setAiLocalDirty] = useState(false);
  /** false when licensed Basic (AI_TIER=off); true when self-host or Pro */
  const [aiAllowedByPlan, setAiAllowedByPlan] = useState(true);
  const aiSaveRef = useRef<(() => Promise<void>) | null>(null);
  const aiLocalDirtyRef = useRef(aiLocalDirty);
  aiLocalDirtyRef.current = aiLocalDirty;

  const registerAiSave = useCallback((save: (() => Promise<void>) | null) => {
    aiSaveRef.current = save;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/auth/license-info');
        if (cancelled) return;
        if (!data?.enabled) {
          setAiAllowedByPlan(true);
          return;
        }
        const tier = String(data?.limits?.AI_TIER || '').toLowerCase();
        const support = String(data?.limits?.SUPPORT_LEVEL || data?.limits?.SUPPORT_TYPE || '').toLowerCase();
        if (tier === 'off' || tier === 'none' || tier === 'false') {
          setAiAllowedByPlan(false);
        } else if (tier === 'full' || tier === 'limited') {
          setAiAllowedByPlan(true);
        } else {
          setAiAllowedByPlan(support === 'pro' || support === 'community' || support === '');
        }
      } catch {
        if (!cancelled) setAiAllowedByPlan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!aiAllowedByPlan && activeSubTab === 'ai') {
      setActiveSubTab('sso');
    }
  }, [aiAllowedByPlan, activeSubTab]);

  useEffect(() => {
    if (!onRegisterLocalSave) return;
    onRegisterLocalSave(async () => {
      if (aiLocalDirtyRef.current && aiSaveRef.current) {
        await aiSaveRef.current();
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
    onLocalDirtyChange?.(aiLocalDirty);
  }, [aiLocalDirty, onLocalDirtyChange]);

  const dirtySubTabs = useMemo(
    () =>
      getDirtySystemSettingsSubTabs(settings, editingSettings, {
        aiLocalDirty,
      }),
    [settings, editingSettings, aiLocalDirty]
  );

  const handleSubTabChange = (tab: SystemSettingsSubTab) => {
    setActiveSubTab(tab);
    window.location.hash = HASH_BY_TAB[tab];
  };

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#admin#system-settings')) return;
      setActiveSubTab(subTabFromHash(hash));
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const subNavBtn = (tab: SystemSettingsSubTab, label: React.ReactNode, icon?: React.ReactNode) => (
    <button
      key={tab}
      type="button"
      onClick={() => handleSubTabChange(tab)}
      data-tour-id={TOUR_ID_BY_TAB[tab]}
      className={adminSubNavTabClass(activeSubTab === tab)}
    >
      {icon}
      {label}
      <AdminDirtyDot show={dirtySubTabs.has(tab)} />
    </button>
  );

  return (
    <div className="p-6 min-w-0 max-w-full">
      {panelActive ? (
        <AdminHubSubnavPortal>
          <div className={adminHubSubnavShellClass}>
            <nav className="flex space-x-6 min-w-max" aria-label={t('systemSettings.subnav')}>
              {subNavBtn('sso', t('tabs.sso'))}
              {subNavBtn('storage', t('tabs.storage'))}
              {subNavBtn('file-uploads', t('appSettings.fileUploads'))}
              {aiAllowedByPlan &&
                subNavBtn(
                  'ai',
                  t('appSettings.ai'),
                  <Sparkles
                    size={14}
                    className={
                      activeSubTab === 'ai'
                        ? 'text-teal-600 dark:text-teal-400'
                        : 'text-teal-500/80 dark:text-teal-400/80'
                    }
                    aria-hidden
                  />
                )}
            </nav>
          </div>
        </AdminHubSubnavPortal>
      ) : null}

      <div className={adminSubtabPanelClass}>
      {visitedSubTabs.has('sso') && (
        <div className={activeSubTab === 'sso' ? undefined : 'hidden'} aria-hidden={activeSubTab !== 'sso'}>
          <AdminSSOTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
            onCancel={onCancel}
            onSettingsReload={onSettingsReload}
            onApplySettingsPatch={onApplySettingsPatch}
          />
        </div>
      )}

      {visitedSubTabs.has('storage') && (
        <div
          className={activeSubTab === 'storage' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'storage'}
        >
          <AdminStorageTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
            onCancel={onCancel}
            onSettingsReload={onSettingsReload}
            onApplySettingsPatch={onApplySettingsPatch}
          />
        </div>
      )}

      {visitedSubTabs.has('file-uploads') && (
        <div
          className={activeSubTab === 'file-uploads' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'file-uploads'}
        >
          <AdminFileUploadsTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
            onCancel={onCancel}
            discardNonce={discardNonce}
          />
        </div>
      )}

      {aiAllowedByPlan && visitedSubTabs.has('ai') && onAutoSave && (
        <div className={activeSubTab === 'ai' ? undefined : 'hidden'} aria-hidden={activeSubTab !== 'ai'}>
          <AdminAISettingsTab
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onApplySettingsPatch={onApplySettingsPatch}
            onAutoSave={onAutoSave}
            onLocalDirtyChange={setAiLocalDirty}
            onRegisterLocalSave={registerAiSave}
            discardNonce={discardNonce}
          />
        </div>
      )}
      </div>
    </div>
  );
};

export default AdminSystemSettingsTab;
