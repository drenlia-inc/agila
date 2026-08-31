import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AdminMailTab from './AdminMailTab';
import AdminNotificationQueueTab from './AdminNotificationQueueTab';
import AdminNotificationsSettingsTab from './AdminNotificationsSettingsTab';
import AdminWebhooksTab from './AdminWebhooksTab';
import { BetaSup } from '../HelpAssistantTitle';
import { AdminDirtyDot } from './AdminFieldDraftControls';
import {
  getDirtyNotificationsHubSubTabs,
  type NotificationsHubSubTabId,
} from '../../utils/adminSettingsDirty';
import { adminSubtabPanelClass, adminSubNavTabClass, adminHubSubnavShellClass } from './AdminSection';
import { AdminHubSubnavPortal } from './AdminHubSubnavPortal';

export type NotificationsHubSubTab = NotificationsHubSubTabId;

interface AdminNotificationsHubTabProps {
  panelActive?: boolean;
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  onCancel: () => void;
  onAutoSave?: (key: string, value: string) => Promise<void>;
  onSettingsReload?: (options?: { quiet?: boolean }) => Promise<void>;
  onApplySettingsPatch?: (patch: Record<string, string | undefined>) => void;
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

function subTabFromHash(hash: string): NotificationsHubSubTab {
  const bare = hash.replace(/^#/, '');
  if (bare.endsWith('#mail-server')) return 'mail-server';
  if (bare.endsWith('#webhooks')) return 'webhooks';
  if (bare.endsWith('#queue') || bare.endsWith('#notification-queue')) return 'queue';
  return 'notification-settings';
}

const HASH_BY_TAB: Record<NotificationsHubSubTab, string> = {
  'notification-settings': '#admin#notifications#notification-settings',
  'mail-server': '#admin#notifications#mail-server',
  webhooks: '#admin#notifications#webhooks',
  queue: '#admin#notifications#queue',
};

const TOUR_ID_BY_TAB: Record<NotificationsHubSubTab, string> = {
  // Distinct from main nav `admin-notifications`
  'notification-settings': 'admin-notification-settings',
  'mail-server': 'admin-mail-server',
  webhooks: 'admin-webhooks',
  queue: 'admin-notification-queue',
};

const AdminNotificationsHubTab: React.FC<AdminNotificationsHubTabProps> = ({
  panelActive = true,
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  onCancel,
  onAutoSave,
  onSettingsReload,
  onApplySettingsPatch,
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
  const [activeSubTab, setActiveSubTab] = useState<NotificationsHubSubTab>(() =>
    typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'notification-settings'
  );
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<NotificationsHubSubTab>>(
    () =>
      new Set<NotificationsHubSubTab>([
        typeof window !== 'undefined' ? subTabFromHash(window.location.hash) : 'notification-settings',
      ])
  );
  const [queueRetentionLocalDirty, setQueueRetentionLocalDirty] = useState(false);
  const queueSaveRef = useRef<(() => Promise<void>) | null>(null);
  const queueRetentionLocalDirtyRef = useRef(queueRetentionLocalDirty);
  queueRetentionLocalDirtyRef.current = queueRetentionLocalDirty;

  const registerQueueSave = useCallback((save: (() => Promise<void>) | null) => {
    queueSaveRef.current = save;
  }, []);

  useEffect(() => {
    if (!onRegisterLocalSave) return;
    onRegisterLocalSave(async () => {
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
    onLocalDirtyChange?.(queueRetentionLocalDirty);
  }, [queueRetentionLocalDirty, onLocalDirtyChange]);

  const dirtySubTabs = useMemo(
    () =>
      getDirtyNotificationsHubSubTabs(settings, editingSettings, {
        queueRetentionLocalDirty,
      }),
    [settings, editingSettings, queueRetentionLocalDirty]
  );

  const handleSubTabChange = (tab: NotificationsHubSubTab) => {
    setActiveSubTab(tab);
    window.location.hash = HASH_BY_TAB[tab];
  };

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#admin#notifications')) return;
      setActiveSubTab(subTabFromHash(hash));
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const subNavBtn = (tab: NotificationsHubSubTab, label: React.ReactNode) => (
    <button
      key={tab}
      type="button"
      onClick={() => handleSubTabChange(tab)}
      data-tour-id={TOUR_ID_BY_TAB[tab]}
      className={adminSubNavTabClass(activeSubTab === tab)}
    >
      {label}
      <AdminDirtyDot show={dirtySubTabs.has(tab)} />
    </button>
  );

  return (
    <div className="p-6 min-w-0 max-w-full">
      {panelActive ? (
        <AdminHubSubnavPortal>
          <div className={adminHubSubnavShellClass}>
            <nav className="flex space-x-6 min-w-max" aria-label={t('notificationsHub.subnav')}>
              {subNavBtn('notification-settings', t('tabs.notificationSettings'))}
              {subNavBtn('mail-server', t('tabs.mailServer'))}
              {subNavBtn(
                'webhooks',
                <>
                  {t('webhooks.tabLabel')}
                  <BetaSup />
                </>
              )}
              {subNavBtn('queue', t('tabs.queue'))}
            </nav>
          </div>
        </AdminHubSubnavPortal>
      ) : null}

      <div className={adminSubtabPanelClass}>
        {visitedSubTabs.has('notification-settings') && (
          <div
            className={activeSubTab === 'notification-settings' ? undefined : 'hidden'}
            aria-hidden={activeSubTab !== 'notification-settings'}
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

        {visitedSubTabs.has('mail-server') && (
          <div
            className={activeSubTab === 'mail-server' ? undefined : 'hidden'}
            aria-hidden={activeSubTab !== 'mail-server'}
          >
            <AdminMailTab
              settings={settings}
              editingSettings={editingSettings}
              onSettingsChange={onSettingsChange}
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
              onApplySettingsPatch={onApplySettingsPatch}
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

        {visitedSubTabs.has('queue') && (
          <div
            className={`min-w-0 max-w-full ${activeSubTab === 'queue' ? undefined : 'hidden'}`}
            aria-hidden={activeSubTab !== 'queue'}
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

export default AdminNotificationsHubTab;
