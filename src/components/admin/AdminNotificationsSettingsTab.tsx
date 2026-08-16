import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../utils/toast';
import { getAdminWebhooks } from '../../api';
import { AdminPageShell, AdminSection, adminInputBoundedClass } from './AdminSection';
import {
  AdminNotificationChannelMode,
  ConfirmWebhooksOnlyDialog,
  type TaskNotificationChannel,
} from './AdminNotificationChannelMode';

interface AdminNotificationsSettingsTabProps {
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
  discardNonce?: number;
}

const AdminNotificationsSettingsTab: React.FC<AdminNotificationsSettingsTabProps> = ({
  settings,
  editingSettings,
  onSettingsChange,
  onSave,
  discardNonce = 0,
}) => {
  const { t } = useTranslation('admin');
  const [notificationDefaults, setNotificationDefaults] = useState<{ [key: string]: boolean }>({});
  const [webhookCount, setWebhookCount] = useState(0);
  const [confirmWebhooksOnly, setConfirmWebhooksOnly] = useState(false);
  const channelMode =
    editingSettings.TASK_NOTIFICATION_CHANNELS || settings.TASK_NOTIFICATION_CHANNELS || 'email';

  useEffect(() => {
    void getAdminWebhooks()
      .then((hooks) => setWebhookCount((hooks || []).length))
      .catch(() => setWebhookCount(0));
  }, [discardNonce]);

  const persistChannel = async (value: TaskNotificationChannel) => {
    if ((value === 'both' || value === 'webhooks') && webhookCount === 0) return;
    const next = {
      ...editingSettings,
      TASK_NOTIFICATION_CHANNELS: value,
    };
    onSettingsChange(next);
    try {
      await onSave(next);
      toast.success(t('webhooks.channelSaved'));
    } catch {
      toast.error(t('failedToSaveSettings'));
    }
  };

  useEffect(() => {
    const raw =
      editingSettings.NOTIFICATION_DEFAULTS ?? settings.NOTIFICATION_DEFAULTS;
    if (raw) {
      try {
        setNotificationDefaults(JSON.parse(raw));
        return;
      } catch (error) {
        console.error('Failed to parse notification defaults:', error);
      }
    }
    setNotificationDefaults({
      newTaskAssigned: true,
      myTaskUpdated: true,
      watchedTaskUpdated: true,
      addedAsCollaborator: true,
      addedAsWatcher: true,
      collaboratingTaskUpdated: true,
      commentAdded: true,
      requesterTaskCreated: true,
      requesterTaskUpdated: true,
    });
  }, [editingSettings.NOTIFICATION_DEFAULTS, settings.NOTIFICATION_DEFAULTS, discardNonce]);

  const handleNotificationDelayChange = (value: string) => {
    onSettingsChange({
      ...editingSettings,
      NOTIFICATION_DELAY: value,
    });

    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          NOTIFICATION_DELAY: value,
        });
      } catch (error) {
        console.error('Failed to save notification delay:', error);
        toast.error(t('failedToSaveSettings'), '');
      }
    }, 100);
  };

  const getNotificationDefault = (key: string): boolean => {
    return notificationDefaults[key] ?? true;
  };

  const handleNotificationDefaultChange = (key: string, value: boolean) => {
    const newDefaults = { ...notificationDefaults, [key]: value };
    setNotificationDefaults(newDefaults);

    onSettingsChange({
      ...editingSettings,
      NOTIFICATION_DEFAULTS: JSON.stringify(newDefaults),
    });

    setTimeout(async () => {
      try {
        await onSave({
          ...editingSettings,
          NOTIFICATION_DEFAULTS: JSON.stringify(newDefaults),
        });
      } catch (error) {
        console.error('Failed to save notification defaults:', error);
        toast.error(t('failedToSaveSettings'), '');
      }
    }, 100);
  };

  const notificationTypes = [
    {
      key: 'newTaskAssigned',
      label: t('appSettings.notificationTypes.newTaskAssigned'),
      description: t('appSettings.notificationTypes.newTaskAssignedDescription'),
      dotClass: 'bg-blue-500',
    },
    {
      key: 'myTaskUpdated',
      label: t('appSettings.notificationTypes.myTaskUpdated'),
      description: t('appSettings.notificationTypes.myTaskUpdatedDescription'),
      dotClass: 'bg-green-500',
    },
    {
      key: 'watchedTaskUpdated',
      label: t('appSettings.notificationTypes.watchedTaskUpdated'),
      description: t('appSettings.notificationTypes.watchedTaskUpdatedDescription'),
      dotClass: 'bg-purple-500',
    },
    {
      key: 'addedAsCollaborator',
      label: t('appSettings.notificationTypes.addedAsCollaborator'),
      description: t('appSettings.notificationTypes.addedAsCollaboratorDescription'),
      dotClass: 'bg-yellow-500',
    },
    {
      key: 'addedAsWatcher',
      label: t('appSettings.notificationTypes.addedAsWatcher'),
      description: t('appSettings.notificationTypes.addedAsWatcherDescription'),
      dotClass: 'bg-cyan-500',
    },
    {
      key: 'collaboratingTaskUpdated',
      label: t('appSettings.notificationTypes.collaboratingTaskUpdated'),
      description: t('appSettings.notificationTypes.collaboratingTaskUpdatedDescription'),
      dotClass: 'bg-orange-500',
    },
    {
      key: 'commentAdded',
      label: t('appSettings.notificationTypes.commentAdded'),
      description: t('appSettings.notificationTypes.commentAddedDescription'),
      dotClass: 'bg-red-500',
    },
    {
      key: 'requesterTaskCreated',
      label: t('appSettings.notificationTypes.requesterTaskCreated'),
      description: t('appSettings.notificationTypes.requesterTaskCreatedDescription'),
      dotClass: 'bg-indigo-500',
    },
    {
      key: 'requesterTaskUpdated',
      label: t('appSettings.notificationTypes.requesterTaskUpdated'),
      description: t('appSettings.notificationTypes.requesterTaskUpdatedDescription'),
      dotClass: 'bg-teal-500',
    },
  ];

  return (
    <div data-setting-key="NOTIFICATIONS_SECTION">
    <AdminPageShell width="full">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <AdminNotificationChannelMode
        radioName="notif-task-notification-channels"
        channelMode={channelMode}
        webhookCount={webhookCount}
        extraHint={
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('appSettings.webhooksDefaultsHint')}
          </p>
        }
        onSelect={(mode) => {
          if (mode === 'webhooks') setConfirmWebhooksOnly(true);
          else void persistChannel(mode);
        }}
      />
      <div className="space-y-3">
      <AdminSection
        title={t('appSettings.emailThrottling')}
        description={t('appSettings.notificationDelayDescription')}
        dense
      >
        <div>
          <label
            htmlFor="notification-delay"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t('appSettings.notificationDelay')}
          </label>
          <select
            id="notification-delay"
            value={editingSettings.NOTIFICATION_DELAY || '30'}
            onChange={(e) => handleNotificationDelayChange(e.target.value)}
            className={adminInputBoundedClass}
          >
            <option value="0">{t('appSettings.immediate')}</option>
            <option value="5">{t('appSettings.minutes5')}</option>
            <option value="15">{t('appSettings.minutes15')}</option>
            <option value="30">{t('appSettings.minutes30')}</option>
            <option value="60">{t('appSettings.hour1')}</option>
            <option value="120">{t('appSettings.hours2')}</option>
            <option value="240">{t('appSettings.hours4')}</option>
            <option value="480">{t('appSettings.hours8')}</option>
            <option value="1440">{t('appSettings.hours24')}</option>
          </select>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t('appSettings.notificationDelayHint')}
          </p>
        </div>
      </AdminSection>

      <AdminSection title={t('appSettings.emailSystemStatus')} dense>
        <div className="flex items-center gap-2">
          <div
            className={`h-2.5 w-2.5 rounded-full ${settings.SMTP_HOST ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {settings.SMTP_HOST
              ? t('appSettings.emailSystemConfigured')
              : t('appSettings.emailSystemNotConfigured')}
          </span>
        </div>
        {!settings.SMTP_HOST && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t('appSettings.emailSystemNotConfiguredHint')}
          </p>
        )}
      </AdminSection>
      </div>
      </div>

      <AdminSection
        title={t('appSettings.globalNotificationDefaults')}
        description={t('appSettings.globalNotificationDefaultsDescription')}
        dense
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 divide-y divide-gray-100 dark:divide-gray-800 lg:divide-y-0">
          {notificationTypes.map((notification) => (
            <div
              key={notification.key}
              className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 lg:py-2"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.dotClass}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {notification.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                    {notification.description}
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={getNotificationDefault(notification.key)}
                    onChange={(e) =>
                      handleNotificationDefaultChange(notification.key, e.target.checked)
                    }
                    className="peer sr-only"
                  />
                  <div className="h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800" />
                </label>
              </div>
            </div>
          ))}
        </div>
      </AdminSection>
    </AdminPageShell>
    <ConfirmWebhooksOnlyDialog
      open={confirmWebhooksOnly}
      onCancel={() => setConfirmWebhooksOnly(false)}
      onConfirm={() => {
        setConfirmWebhooksOnly(false);
        void persistChannel('webhooks');
      }}
    />
    </div>
  );
};

export default AdminNotificationsSettingsTab;
