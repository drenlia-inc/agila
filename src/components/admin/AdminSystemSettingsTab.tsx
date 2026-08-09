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
import { AdminDirtyDot } from './AdminFieldDraftControls';
import {
  getDirtySystemSettingsSubTabs,
  type SystemSettingsSubTabId,
} from '../../utils/adminSettingsDirty';

export type SystemSettingsSubTab = SystemSettingsSubTabId;

interface AdminSystemSettingsTabProps {
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
  'notification-queue': '#admin#system-settings#notification-queue',
};

const TOUR_ID_BY_TAB: Record<SystemSettingsSubTab, string> = {
  sso: 'admin-sso',
  'mail-server': 'admin-mail-server',
  storage: 'admin-storage',
  'file-uploads': 'admin-file-uploads',
  ai: 'admin-ai',
  notifications: 'admin-notifications',
  'notification-queue': 'admin-notification-queue',
};

const AdminSystemSettingsTab: React.FC<AdminSystemSettingsTabProps> = ({
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

  const subNavBtn = (tab: SystemSettingsSubTab, label: string, icon?: React.ReactNode) => (
    <button
      key={tab}
      type="button"
      onClick={() => handleSubTabChange(tab)}
      data-tour-id={TOUR_ID_BY_TAB[tab]}
      className={`py-2 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-1.5 whitespace-nowrap ${
        activeSubTab === tab
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      {icon}
      {label}
      <AdminDirtyDot show={dirtySubTabs.has(tab)} />
    </button>
  );

  return (
    <div className="p-6 min-w-0 max-w-full">
      <div className="mb-3">
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {t('systemSettings.description')}
        </p>
      </div>

      <div className="mb-4 overflow-x-auto">
        <nav className="flex space-x-6 min-w-max" aria-label="System settings tabs">
          {subNavBtn('sso', t('tabs.sso'))}
          {subNavBtn('mail-server', t('tabs.mailServer'))}
          {subNavBtn('storage', t('tabs.storage'))}
          {subNavBtn('file-uploads', t('appSettings.fileUploads'))}
          {subNavBtn(
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
          {subNavBtn('notification-queue', t('appSettings.notificationQueue'))}
        </nav>
      </div>

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

      {visitedSubTabs.has('ai') && onAutoSave && (
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
  );
};

export default AdminSystemSettingsTab;
