import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import AdminSSOTab from './AdminSSOTab';
import AdminMailTab from './AdminMailTab';
import AdminStorageTab from './AdminStorageTab';
import AdminFileUploadsTab from './AdminFileUploadsTab';
import AdminAISettingsTab from './AdminAISettingsTab';
import AdminNotificationQueueTab from './AdminNotificationQueueTab';
import AdminNotificationsSettingsTab from './AdminNotificationsSettingsTab';
import AdminWebhooksTab from './AdminWebhooksTab';
import { BetaSup } from '../HelpAssistantTitle';
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
  onReloadOAuth?: () => void;
  onTestEmail: () => Promise<void>;
  onMailServerDisabled: () => void;
  isTestingEmail: boolean;
  showTestEmailModal: boolean;
  testEmailResult: any;
  onCloseTestModal: () => void;
  showTestEmailErrorModal: boolean;
  testEmailError: string;
  onCloseTestErrorModal: () => void;
  onLocalDirtyChange?: (dirty: boolean) => void;
  onRegisterLocalSave?: (save: (() => Promise<void>) | null) => void;
  discardNonce?: number;
}

function subTabFromHash(hash: string): SystemSettingsSubTab {
  const bare = hash.replace(/^#/, '');
  if (bare.endsWith('#mail-server')) return 'mail-server';
  if (bare.endsWith('#storage')) return 'storage';
  if (bare.endsWith('#file-uploads')) return 'file-uploads';
  if (bare.endsWith('#ai')) return 'ai';
  if (bare.endsWith('#notifications')) return 'notifications';
  if (bare.endsWith('#webhooks')) return 'webhooks';
  if (bare.endsWith('#notification-queue')) return 'notification-queue';
  return 'sso';
}

const HASH_BY_TAB: Record<SystemSettingsSubTab, string> = {
  sso: '#admin#system-settings#sso',
  'mail-server': '#admin#system-settings#mail-server',
  storage: '#admin#system-settings#storage',
  'file-uploads': '#admin#system-settings#file-uploads',
  ai: '#admin#system-settings#ai',
  notifications: '#admin#system-settings#notifications',
  webhooks: '#admin#system-settings#webhooks',
  'notification-queue': '#admin#system-settings#notification-queue',
};

const TOUR_ID_BY_TAB: Record<SystemSettingsSubTab, string> = {
  sso: 'admin-sso',
  'mail-server': 'admin-mail-server',
  storage: 'admin-storage',
  'file-uploads': 'admin-file-uploads',
  ai: 'admin-ai',
  notifications: 'admin-notifications',
  webhooks: 'admin-webhooks',
  'notification-queue': 'admin-notification-queue',
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
  onReloadOAuth,
  onTestEmail,
  onMailServerDisabled,
  isTestingEmail,
  showTestEmailModal,
  testEmailResult,
  onCloseTestModal,
  showTestEmailErrorModal,
  testEmailError,
  onCloseTestErrorModal,
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
  const [queueRetentionLocalDirty, setQueueRetentionLocalDirty] = useState(false);
  const aiSaveRef = useRef<(() => Promise<void>) | null>(null);
  const queueSaveRef = useRef<(() => Promise<void>) | null>(null);
  const aiLocalDirtyRef = useRef(aiLocalDirty);
  const queueRetentionLocalDirtyRef = useRef(queueRetentionLocalDirty);
  aiLocalDirtyRef.current = aiLocalDirty;
  queueRetentionLocalDirtyRef.current = queueRetentionLocalDirty;

  const registerAiSave = useCallback((save: (() => Promise<void>) | null) => {
    aiSaveRef.current = save;
  }, []);
  const registerQueueSave = useCallback((save: (() => Promise<void>) | null) => {
    queueSaveRef.current = save;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/auth/license-info');
        if (cancelled) return;
        // Licensing disabled (self-host) → AI allowed
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
          // Legacy: no AI_TIER — Basic plan has no AI
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
      if (queueRetentionLocalDirtyRef.current && queueSaveRef.current) {
        await queueSaveRef.current();
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
    onLocalDirtyChange?.(aiLocalDirty || queueRetentionLocalDirty);
  }, [aiLocalDirty, queueRetentionLocalDirty, onLocalDirtyChange]);

  const dirtySubTabs = useMemo(
    () =>
      getDirtySystemSettingsSubTabs(settings, editingSettings, {
        aiLocalDirty,
        queueRetentionLocalDirty,
      }),
    [settings, editingSettings, aiLocalDirty, queueRetentionLocalDirty]
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
            <nav className="flex space-x-6 min-w-max" aria-label="System settings tabs">
              {subNavBtn('sso', t('tabs.sso'))}
              {subNavBtn('mail-server', t('tabs.mailServer'))}
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
              {subNavBtn('notifications', t('appSettings.notifications'))}
              {subNavBtn(
                'webhooks',
                <>
                  {t('webhooks.tabLabel')}
                  <BetaSup />
                </>
              )}
              {subNavBtn('notification-queue', t('appSettings.notificationQueue'))}
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
            onReloadOAuth={onReloadOAuth || (() => {})}
          />
        </div>
      )}

      {visitedSubTabs.has('mail-server') && (
        <div
          className={activeSubTab === 'mail-server' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'mail-server'}
        >
          <AdminMailTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
            onCancel={onCancel}
            onTestEmail={onTestEmail}
            onMailServerDisabled={onMailServerDisabled}
            isTestingEmail={isTestingEmail}
            showTestEmailModal={showTestEmailModal}
            testEmailResult={testEmailResult}
            onCloseTestModal={onCloseTestModal}
            showTestEmailErrorModal={showTestEmailErrorModal}
            testEmailError={testEmailError}
            onCloseTestErrorModal={onCloseTestErrorModal}
            onAutoSave={onAutoSave}
            onSettingsReload={onSettingsReload}
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

      {visitedSubTabs.has('notifications') && (
        <div
          className={activeSubTab === 'notifications' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'notifications'}
        >
          <AdminNotificationsSettingsTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
            discardNonce={discardNonce}
          />
        </div>
      )}

      {visitedSubTabs.has('webhooks') && (
        <div
          className={activeSubTab === 'webhooks' ? undefined : 'hidden'}
          aria-hidden={activeSubTab !== 'webhooks'}
        >
          <AdminWebhooksTab
            settings={settings}
            editingSettings={editingSettings}
            onSettingsChange={onSettingsChange}
            onSave={onSave}
          />
        </div>
      )}

      {visitedSubTabs.has('notification-queue') && (
        <div
          className={`min-w-0 max-w-full ${activeSubTab === 'notification-queue' ? undefined : 'hidden'}`}
          aria-hidden={activeSubTab !== 'notification-queue'}
        >
          <AdminNotificationQueueTab
            onLocalDirtyChange={setQueueRetentionLocalDirty}
            onRegisterLocalSave={registerQueueSave}
            discardNonce={discardNonce}
          />
        </div>
      )}
      </div>
    </div>
  );
};

export default AdminSystemSettingsTab;
