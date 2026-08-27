import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Trash2, CheckSquare, Square, RefreshCw, ChevronDown, Search, Loader2 } from 'lucide-react';
import { getNotificationQueue, sendNotificationsImmediately, deleteNotifications, updateSetting } from '../../api';
import { toast } from '../../utils/toast';
import { formatToYYYYMMDDHHmmss as formatDateTimeLocal } from '../../utils/dateUtils';
import { ModernCheckbox } from '../ModernCheckbox';
import { useSettings } from '../../contexts/SettingsContext';
import websocketClient from '../../services/websocketClient';
import {
  ADMIN_NUMERIC_INPUT_CLASS,
  ADMIN_TABLE_ROW_CLASS,
  NOTIFICATION_QUEUE_RETENTION_DAYS,
  clampIntToString,
  parseOptionalInt,
} from '../../utils/adminFieldLimits';
import { AdminUnsavedHint } from './AdminUnsavedChanges';
import { adminFieldClass } from './AdminSection';
import { formDropdownSearchClass, formSecondaryButtonClass } from '../../utils/formFieldClasses';

interface NotificationQueueItem {
  id: string;
  recipientEmail: string;
  recipientName: string;
  taskTitle: string;
  taskTicket: string;
  columnTitle: string;
  boardTitle: string;
  notificationType: string;
  action: string;
  details: string;
  oldValue: string | null;
  newValue: string | null;
  status: string;
  scheduledSendTime: string;
  firstChangeTime: string;
  lastChangeTime: string;
  changeCount: number;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  actor: {
    name: string;
    email: string;
  } | null;
  deliveryChannel?: string;
  webhookId?: string | null;
  webhookName?: string | null;
  webhookPlatform?: string | null;
}

interface AdminNotificationQueueTabProps {
  onLocalDirtyChange?: (dirty: boolean) => void;
  onRegisterLocalSave?: (save: (() => Promise<void>) | null) => void;
  discardNonce?: number;
}

function queueItemAgeMs(n: NotificationQueueItem): number {
  const raw = n.firstChangeTime || n.createdAt || n.scheduledSendTime;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Split `YYYY-MM-DD HH:MM:SS` into date / time for two-line table cells. */
function splitDateTimeLocal(value: string | null | undefined): { date: string; time: string } | null {
  if (!value) return null;
  const formatted = formatDateTimeLocal(typeof value === 'string' ? value : String(value));
  if (!formatted) return null;
  const spaceIdx = formatted.indexOf(' ');
  if (spaceIdx === -1) return { date: formatted, time: '' };
  return {
    date: formatted.slice(0, spaceIdx),
    time: formatted.slice(spaceIdx + 1),
  };
}

const AdminNotificationQueueTab: React.FC<AdminNotificationQueueTabProps> = ({
  onLocalDirtyChange,
  onRegisterLocalSave,
  discardNonce = 0,
}) => {
  const { t } = useTranslation('admin');
  const { systemSettings, refreshSettings } = useSettings();
  const [notifications, setNotifications] = useState<NotificationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{
    done: number;
    total: number;
    sent: number;
    failed: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(50);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [retentionDays, setRetentionDays] = useState('0');
  const [savingRetention, setSavingRetention] = useState(false);
  const [savingSendingToggle, setSavingSendingToggle] = useState(false);
  const [channelFilter, setChannelFilter] = useState<null | 'email' | 'webhook'>(null);

  const savedRetentionDays = systemSettings?.NOTIFICATION_QUEUE_RETENTION_DAYS || '0';
  const retentionDirty = retentionDays.trim() !== savedRetentionDays.trim();
  const channelMode =
    systemSettings?.TASK_NOTIFICATION_CHANNELS || 'email';
  const webhooksOnly = channelMode === 'webhooks';
  const emailSendingEnabled =
    !webhooksOnly && systemSettings?.TASK_EMAIL_NOTIFICATIONS_ENABLED !== 'false';

  useEffect(() => {
    setRetentionDays(systemSettings?.NOTIFICATION_QUEUE_RETENTION_DAYS || '0');
  }, [systemSettings?.NOTIFICATION_QUEUE_RETENTION_DAYS, discardNonce]);

  useEffect(() => {
    onLocalDirtyChange?.(retentionDirty);
  }, [retentionDirty, onLocalDirtyChange]);

  const fetchNotifications = async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const data = await getNotificationQueue();
      setNotifications(data);
      setSelectedIds((prev) => {
        const valid = new Set(data.map((n: NotificationQueueItem) => n.id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (valid.has(id)) next.add(id);
        });
        return next;
      });
    } catch (error: any) {
      console.error('Failed to fetch notification queue:', error);
      if (!opts?.silent) {
        toast.error(t('notificationQueue.fetchError') || 'Failed to fetch notification queue', '');
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  };

  const liveFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchNotificationsRef = useRef(fetchNotifications);
  fetchNotificationsRef.current = fetchNotifications;

  useEffect(() => {
    void fetchNotifications();
    const refreshSilent = () => {
      if (liveFetchTimer.current) clearTimeout(liveFetchTimer.current);
      liveFetchTimer.current = setTimeout(() => {
        void fetchNotificationsRef.current({ silent: true });
      }, 400);
    };
    websocketClient.onNotificationQueueUpdated(refreshSilent);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchNotificationsRef.current({ silent: true });
      }
    }, 10000);
    return () => {
      websocketClient.offNotificationQueueUpdated(refreshSilent);
      window.clearInterval(poll);
      if (liveFetchTimer.current) clearTimeout(liveFetchTimer.current);
    };
  }, []);

  const saveRetention = async () => {
    const parsed = parseOptionalInt(retentionDays);
    if (
      parsed === null ||
      parsed < NOTIFICATION_QUEUE_RETENTION_DAYS.min ||
      parsed > NOTIFICATION_QUEUE_RETENTION_DAYS.max
    ) {
      toast.error(
        t('numberOutOfRange', {
          label: t('notificationQueue.retentionDays'),
          min: NOTIFICATION_QUEUE_RETENTION_DAYS.min,
          max: NOTIFICATION_QUEUE_RETENTION_DAYS.max,
        })
      );
      setRetentionDays(
        clampIntToString(
          retentionDays,
          NOTIFICATION_QUEUE_RETENTION_DAYS.min,
          NOTIFICATION_QUEUE_RETENTION_DAYS.max,
          0
        )
      );
      return;
    }
    const normalized = String(parsed);
    setSavingRetention(true);
    try {
      await updateSetting('NOTIFICATION_QUEUE_RETENTION_DAYS', normalized);
      await refreshSettings?.();
      setRetentionDays(normalized);
      toast.success(t('notificationQueue.retentionSaved'));
    } catch (error) {
      console.error(error);
      toast.error(t('notificationQueue.retentionSaveFailed'));
    } finally {
      setSavingRetention(false);
    }
  };

  const saveLocalDraftsRef = useRef<() => Promise<void>>(async () => {});
  saveLocalDraftsRef.current = async () => {
    if (retentionDirty) {
      await saveRetention();
    }
  };

  useEffect(() => {
    if (!onRegisterLocalSave) return;
    onRegisterLocalSave(() => saveLocalDraftsRef.current());
    return () => onRegisterLocalSave(null);
  }, [onRegisterLocalSave]);

  const toggleTaskEmailSending = async () => {
    if (savingSendingToggle || webhooksOnly) return;
    const next = emailSendingEnabled ? 'false' : 'true';
    setSavingSendingToggle(true);
    try {
      await updateSetting('TASK_EMAIL_NOTIFICATIONS_ENABLED', next);
      await refreshSettings?.();
      toast.success(
        next === 'true'
          ? t('mail.taskEmailNotificationsEnabledToast')
          : t('mail.taskEmailNotificationsPausedToast')
      );
    } catch (error) {
      console.error(error);
      toast.error(t('failedToSaveSettings'));
    } finally {
      setSavingSendingToggle(false);
    }
  };

  // Filter notifications based on search query
  const filteredNotifications = notifications.filter((notification: NotificationQueueItem) => {
    const channel = notification.deliveryChannel || 'email';
    if (systemSettings?.TASK_NOTIFICATION_CHANNELS === 'webhooks' && channel === 'email') {
      return false;
    }
    if (channelFilter && channel !== channelFilter) return false;
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    return (
      notification.recipientEmail?.toLowerCase().includes(query) ||
      notification.recipientName?.toLowerCase().includes(query) ||
      notification.webhookName?.toLowerCase().includes(query) ||
      notification.taskTitle?.toLowerCase().includes(query) ||
      notification.taskTicket?.toLowerCase().includes(query) ||
      notification.columnTitle?.toLowerCase().includes(query) ||
      notification.boardTitle?.toLowerCase().includes(query) ||
      notification.notificationType?.toLowerCase().includes(query) ||
      notification.action?.toLowerCase().includes(query) ||
      notification.status?.toLowerCase().includes(query) ||
      notification.actor?.name?.toLowerCase().includes(query) ||
      notification.actor?.email?.toLowerCase().includes(query)
    );
  });

  const handleSelectAll = () => {
    // Only select visible notifications (up to displayLimit)
    const visibleNotifications = filteredNotifications.slice(0, displayLimit);
    const visibleIds = new Set(visibleNotifications.map(n => n.id));
    
    // Check if all visible items are already selected
    const allVisibleSelected = visibleIds.size > 0 && Array.from(visibleIds).every(id => selectedIds.has(id));
    
    if (allVisibleSelected) {
      // Deselect all visible items
      const newSelected = new Set(selectedIds);
      visibleIds.forEach(id => newSelected.delete(id));
      setSelectedIds(newSelected);
    } else {
      // Select all visible items
      const newSelected = new Set(selectedIds);
      visibleIds.forEach(id => newSelected.add(id));
      setSelectedIds(newSelected);
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSendImmediately = async () => {
    if (selectedIds.size === 0) {
      toast.error(t('notificationQueue.noSelection'));
      return;
    }

    const selectedNotifications = filteredNotifications.filter(n => selectedIds.has(n.id));
    const unsentNotifications = selectedNotifications.filter((n) => n.status !== 'sent');
    const sendableNotifications = unsentNotifications
      .filter((n) => (n.deliveryChannel || 'email') === 'webhook' || emailSendingEnabled)
      .slice()
      .sort((a, b) => queueItemAgeMs(a) - queueItemAgeMs(b));

    if (unsentNotifications.length === 0) {
      toast.error(t('notificationQueue.noUnsentNotifications'));
      return;
    }

    if (sendableNotifications.length === 0) {
      toast.error(t('notificationQueue.sendPaused'));
      return;
    }

    if (sendableNotifications.length < unsentNotifications.length) {
      toast.warning(t('notificationQueue.sendSkippedPausedEmail'), '');
    }

    if (unsentNotifications.length < selectedNotifications.length) {
      toast.warning(
        t('notificationQueue.someAlreadySent', {
          total: selectedNotifications.length,
          sendable: unsentNotifications.length,
        })
      );
    }

    try {
      setIsSending(true);
      const ids = sendableNotifications.map((n) => n.id);
      const progress = { done: 0, total: ids.length, sent: 0, failed: 0 };
      setSendProgress({ ...progress });
      const errors: string[] = [];

      for (const id of ids) {
        try {
          const result = await sendNotificationsImmediately([id]);
          progress.sent += result.sentCount || 0;
          progress.failed += result.failedCount || 0;
          if (result.errors?.length) errors.push(...result.errors);
        } catch (error: any) {
          const code = error?.response?.data?.code;
          if (code === 'TASK_EMAIL_NOTIFICATIONS_PAUSED') {
            toast.error(t('notificationQueue.sendPaused'));
            break;
          }
          progress.failed += 1;
          errors.push(error?.response?.data?.error || String(error));
        }
        progress.done += 1;
        setSendProgress({ ...progress });
      }

      if (errors.length > 0) {
        console.warn('Some notifications failed to send:', errors);
      }

      if (progress.sent > 0 && progress.failed > 0) {
        toast.warning(
          t('notificationQueue.sendPartial', {
            sent: progress.sent,
            failed: progress.failed,
          }),
          ''
        );
      } else if (progress.sent > 0) {
        toast.success(
          t('notificationQueue.sendSuccess', { count: progress.sent }),
          ''
        );
      } else if (errors.length > 0) {
        toast.error(errors[0], '');
      } else {
        toast.error(t('notificationQueue.sendNone'), '');
      }

      setSelectedIds(new Set());
      await fetchNotifications({ silent: true });
    } catch (error: any) {
      console.error('Failed to send notifications:', error);
      const code = error?.response?.data?.code;
      const msg = error?.response?.data?.error;
      if (code === 'TASK_EMAIL_NOTIFICATIONS_PAUSED') {
        toast.error(t('notificationQueue.sendPaused'));
      } else {
        toast.error(msg || t('notificationQueue.sendError'));
      }
    } finally {
      setIsSending(false);
      setSendProgress(null);
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) {
      toast.error(t('notificationQueue.noSelection') || 'Please select at least one notification', '');
      return;
    }

    if (!confirm(t('notificationQueue.deleteConfirm', { count: selectedIds.size }) || `Are you sure you want to delete ${selectedIds.size} notification(s)?`)) {
      return;
    }

    try {
      setIsDeleting(true);
      const result = await deleteNotifications(Array.from(selectedIds));
      
      if (result.success) {
        toast.success(
          t('notificationQueue.deleteSuccess', { count: result.deletedCount }) || `Successfully deleted ${result.deletedCount} notification(s)`,
          ''
        );
        
        setSelectedIds(new Set());
        await fetchNotifications({ silent: true });
      }
    } catch (error: any) {
      console.error('Failed to delete notifications:', error);
      toast.error(t('notificationQueue.deleteError') || 'Failed to delete notifications', '');
    } finally {
      setIsDeleting(false);
      setShowDeleteMenu(false);
    }
  };

  const handleDeleteAllSent = async () => {
    const sentNotifications = notifications.filter(n => n.status === 'sent');
    
    if (sentNotifications.length === 0) {
      toast.error(t('notificationQueue.noSentNotifications') || 'No sent notifications found in queue', '');
      setShowDeleteMenu(false);
      return;
    }

    if (!confirm(t('notificationQueue.deleteAllSentConfirm', { count: sentNotifications.length }) || `Are you sure you want to delete all ${sentNotifications.length} sent notification(s)?`)) {
      setShowDeleteMenu(false);
      return;
    }

    try {
      setIsDeleting(true);
      const result = await deleteNotifications(sentNotifications.map(n => n.id));
      
      if (result.success) {
        toast.success(
          t('notificationQueue.deleteAllSentSuccess', { count: result.deletedCount }) || `Successfully deleted ${result.deletedCount} sent notification(s)`,
          ''
        );
        
        setSelectedIds(new Set());
        await fetchNotifications({ silent: true });
      }
    } catch (error: any) {
      console.error('Failed to delete all sent notifications:', error);
      toast.error(t('notificationQueue.deleteError') || 'Failed to delete notifications', '');
    } finally {
      setIsDeleting(false);
      setShowDeleteMenu(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusClasses = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      sent: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    };

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusClasses[status as keyof typeof statusClasses] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'}`}>
        {t(`notificationQueue.statusLabels.${status}`, status)}
      </span>
    );
  };

  const getNotificationTypeLabel = (type: string) => {
    const translationKey = `notificationQueue.type.${type}`;
    const translated = t(translationKey);
    // If translation returns the key itself or an object, fallback to the type
    if (translated === translationKey || typeof translated !== 'string') {
      return type;
    }
    return translated;
  };

  if (loading && notifications.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('notificationQueue.loading')}</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 max-w-sm">
            {webhooksOnly ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {t('notificationQueue.webhooksOnlyHint')}
              </p>
            ) : (
              <div
                className="inline-flex items-center gap-2"
                data-setting-key="TASK_EMAIL_NOTIFICATIONS_ENABLED"
                title={t('mail.taskEmailNotificationsHint')}
              >
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {emailSendingEnabled
                    ? t('mail.taskEmailNotificationsOn')
                    : t('mail.taskEmailNotificationsOff')}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={emailSendingEnabled}
                  aria-label={t('mail.taskEmailNotificationsLabel')}
                  disabled={savingSendingToggle}
                  onClick={() => void toggleTaskEmailSending()}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 ${
                    emailSendingEnabled
                      ? 'bg-blue-600 dark:bg-blue-500'
                      : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      emailSendingEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )}

            <div className="relative w-full">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  e.stopPropagation();
                  setSearchQuery('');
                  e.currentTarget.blur();
                }}
                placeholder={t('notificationQueue.searchPlaceholder')}
                aria-label={t('notificationQueue.searchPlaceholder')}
                className={`${formDropdownSearchClass('w-full')} pl-8 pr-3`}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setChannelFilter((prev) => (prev === 'email' ? null : 'email'))}
                className={
                  channelFilter === 'email'
                    ? 'rounded-full px-2.5 py-0.5 text-xs font-medium border border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-100'
                    : `${formSecondaryButtonClass} !rounded-full !px-2.5 !py-0.5`
                }
              >
                {t('notificationQueue.filterEmail')}
              </button>
              <button
                type="button"
                onClick={() => setChannelFilter((prev) => (prev === 'webhook' ? null : 'webhook'))}
                className={
                  channelFilter === 'webhook'
                    ? 'rounded-full px-2.5 py-0.5 text-xs font-medium border border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-100'
                    : `${formSecondaryButtonClass} !rounded-full !px-2.5 !py-0.5`
                }
              >
                {t('notificationQueue.filterWebhooks')}
              </button>
            </div>
          </div>

          <div
            className="shrink-0 sm:min-w-[11rem]"
            data-setting-key="NOTIFICATION_QUEUE_RETENTION_DAYS"
            title={t('notificationQueue.retentionDaysDescription')}
          >
            <label
              htmlFor="notification-queue-retention"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('notificationQueue.retentionDays')}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <AdminUnsavedHint show={retentionDirty} />
              <input
                id="notification-queue-retention"
                type="number"
                inputMode="numeric"
                min={NOTIFICATION_QUEUE_RETENTION_DAYS.min}
                max={NOTIFICATION_QUEUE_RETENTION_DAYS.max}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                onBlur={() =>
                  setRetentionDays(
                    clampIntToString(
                      retentionDays,
                      NOTIFICATION_QUEUE_RETENTION_DAYS.min,
                      NOTIFICATION_QUEUE_RETENTION_DAYS.max,
                      0
                    )
                  )
                }
                aria-describedby="notification-queue-retention-hint"
                className={`${adminFieldClass(false, 'w-16')} ${ADMIN_NUMERIC_INPUT_CLASS}`}
              />
              <button
                type="button"
                onClick={() => void saveRetention()}
                disabled={savingRetention || !retentionDirty}
                className={`px-2.5 py-1.5 text-xs font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
                  retentionDirty
                    ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-amber-400 ring-offset-1 dark:ring-offset-gray-800'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {savingRetention
                  ? t('notificationQueue.savingRetention')
                  : t('notificationQueue.saveRetention')}
              </button>
            </div>
            <p
              id="notification-queue-retention-hint"
              className="mt-1 text-[11px] text-gray-500 dark:text-gray-400"
            >
              {t('notificationQueue.retentionDaysHint')}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {filteredNotifications.length > 0 ? (
              <>
                {t('notificationQueue.showing', { 
                  count: Math.min(displayLimit, filteredNotifications.length),
                  total: filteredNotifications.length 
                }) || `Showing ${Math.min(displayLimit, filteredNotifications.length)} of ${filteredNotifications.length} notification(s)`}
              </>
            ) : (
              <span>{t('notificationQueue.noResults') || 'No notifications found'}</span>
            )}
          </div>
          <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            className={`${formSecondaryButtonClass} text-sm px-4 py-2`}
          >
            {(() => {
              const visibleNotifications = filteredNotifications.slice(0, displayLimit);
              const visibleIds = new Set(visibleNotifications.map(n => n.id));
              const allVisibleSelected = visibleIds.size > 0 && Array.from(visibleIds).every(id => selectedIds.has(id));
              
              return allVisibleSelected ? (
                <>
                  <Square className="inline-block w-4 h-4 mr-2" />
                  {t('notificationQueue.selectNone') || 'Select None'}
                </>
              ) : (
                <>
                  <CheckSquare className="inline-block w-4 h-4 mr-2" />
                  {t('notificationQueue.selectAll') || 'Select All'}
                </>
              );
            })()}
          </button>
          <button
            onClick={handleSendImmediately}
            disabled={(() => {
              if (selectedIds.size === 0 || isSending || isDeleting) return true;
              const selectedNotifications = filteredNotifications.filter((n) => selectedIds.has(n.id));
              const sendable = selectedNotifications.filter(
                (n) =>
                  n.status !== 'sent' &&
                  ((n.deliveryChannel || 'email') === 'webhook' || emailSendingEnabled)
              );
              return sendable.length === 0;
            })()}
            title={
              (() => {
                const selectedNotifications = filteredNotifications.filter((n) => selectedIds.has(n.id));
                const unsentEmail = selectedNotifications.some(
                  (n) =>
                    n.status !== 'sent' && (n.deliveryChannel || 'email') !== 'webhook'
                );
                const unsentWebhook = selectedNotifications.some(
                  (n) =>
                    n.status !== 'sent' && (n.deliveryChannel || 'email') === 'webhook'
                );
                if (!emailSendingEnabled && unsentEmail && !unsentWebhook) {
                  return t('notificationQueue.sendPaused');
                }
                return undefined;
              })()
            }
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {isSending && sendProgress
              ? t('notificationQueue.sendingProgress', {
                  done: sendProgress.done,
                  total: sendProgress.total,
                })
              : isSending
                ? t('notificationQueue.sending')
                : t('notificationQueue.sendNow')}
          </button>
          <div className="relative">
            <button
              onClick={() => {
                if (selectedIds.size > 0) {
                  handleDelete();
                } else {
                  setShowDeleteMenu(!showDeleteMenu);
                }
              }}
              disabled={isSending || isDeleting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {isDeleting ? (t('notificationQueue.deleting') || 'Deleting...') : (t('notificationQueue.delete') || 'Delete')}
              <ChevronDown className="w-4 h-4 ml-2" />
            </button>
            
            {showDeleteMenu && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowDeleteMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-20">
                  <div className="py-1">
                    <button
                      onClick={handleDelete}
                      disabled={selectedIds.size === 0 || isDeleting}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('notificationQueue.deleteSelected') || 'Delete Selected'}
                      {selectedIds.size > 0 && ` (${selectedIds.size})`}
                    </button>
                    <button
                      onClick={handleDeleteAllSent}
                      disabled={isDeleting || notifications.filter((n: NotificationQueueItem) => n.status === 'sent').length === 0}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('notificationQueue.deleteAllSent') || 'Delete All Sent'}
                      {notifications.filter((n: NotificationQueueItem) => n.status === 'sent').length > 0 && ` (${notifications.filter((n: NotificationQueueItem) => n.status === 'sent').length})`}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => void fetchNotifications()}
            disabled={loading || isSending || isDeleting}
            className={`${formSecondaryButtonClass} text-sm px-4 py-2`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t('notificationQueue.refresh')}
          </button>
          </div>
        </div>
      </div>

      {sendProgress && (
        <div
          className="mb-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {t('notificationQueue.sendingProgress', {
                done: sendProgress.done,
                total: sendProgress.total,
              })}
            </p>
            {sendProgress.done > 0 && (
              <p className="mt-0.5 text-xs opacity-90">
                {t('notificationQueue.sendPartial', {
                  sent: sendProgress.sent,
                  failed: sendProgress.failed,
                })}
              </p>
            )}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
              <div
                className="h-full bg-blue-600 transition-all dark:bg-blue-400"
                style={{
                  width: `${sendProgress.total ? Math.round((sendProgress.done / sendProgress.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {filteredNotifications.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">
            {searchQuery.trim() 
              ? (t('notificationQueue.noResults') || 'No notifications found matching your search')
              : (t('notificationQueue.empty') || 'No notifications in queue')
            }
          </p>
        </div>
      ) : (
        <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
          {/*
            Auto layout + w-max: table grows to column needs → horizontal scroll.
            TASK is the only capped/wrapping column (overflow-wrap) so unbroken titles
            wrap instead of stretching the table forever.
          */}
          <table className="w-max border-collapse divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th
                  scope="col"
                  className="w-12 px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                >
                  <ModernCheckbox
                    checked={(() => {
                      const visibleNotifications = filteredNotifications.slice(0, displayLimit);
                      const visibleIds = new Set(visibleNotifications.map(n => n.id));
                      return visibleIds.size > 0 && Array.from(visibleIds).every(id => selectedIds.has(id));
                    })()}
                    indeterminate={(() => {
                      const visibleNotifications = filteredNotifications.slice(0, displayLimit);
                      const visibleIds = Array.from(new Set(visibleNotifications.map(n => n.id)));
                      const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;
                      return selectedVisible > 0 && selectedVisible < visibleIds.length;
                    })()}
                    onChange={handleSelectAll}
                    size="sm"
                  />
                </th>
                <th
                  scope="col"
                  className="min-w-[13rem] max-w-[16rem] px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                >
                  {t('notificationQueue.recipient')}
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                  style={{ width: '26rem', minWidth: '22rem', maxWidth: '26rem' }}
                >
                  {t('notificationQueue.task')}
                </th>
                <th
                  scope="col"
                  className="min-w-[10rem] px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap"
                >
                  {t('notificationQueue.typeColumn')}
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                  style={{ width: '15rem', minWidth: '15rem', maxWidth: '18rem' }}
                >
                  {t('notificationQueue.status')}
                </th>
                <th
                  scope="col"
                  className="min-w-[7rem] px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap"
                >
                  {t('notificationQueue.scheduled')}
                </th>
                <th
                  scope="col"
                  className="min-w-[7rem] px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap"
                >
                  {t('notificationQueue.sent')}
                </th>
                <th
                  scope="col"
                  className="min-w-[10rem] px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap"
                >
                  {t('notificationQueue.changes')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredNotifications.slice(0, displayLimit).map((notification) => {
                const scheduledParts = splitDateTimeLocal(notification.scheduledSendTime);
                const sentParts =
                  notification.status === 'sent' && notification.sentAt
                    ? splitDateTimeLocal(notification.sentAt)
                    : null;
                return (
                  <tr
                    key={notification.id}
                    className={`${ADMIN_TABLE_ROW_CLASS} ${
                      selectedIds.has(notification.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <td className="w-12 px-3 py-4 align-top">
                      <ModernCheckbox
                        checked={selectedIds.has(notification.id)}
                        onChange={() => handleSelectOne(notification.id)}
                        size="sm"
                      />
                    </td>
                    <td className="min-w-[13rem] max-w-[16rem] px-3 py-4 align-top">
                      {(notification.deliveryChannel || 'email') === 'webhook' ? (
                        <>
                          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {notification.webhookName || t('notificationQueue.channelWebhook')}
                          </div>
                          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {notification.webhookPlatform
                              ? t(`webhooks.platforms.${notification.webhookPlatform}`, {
                                  defaultValue: notification.webhookPlatform,
                                })
                              : t('notificationQueue.channelWebhook')}
                          </div>
                        </>
                      ) : (
                        <>
                      <div
                        className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
                        title={notification.recipientName || notification.recipientEmail}
                      >
                        {notification.recipientName || notification.recipientEmail}
                      </div>
                      <div
                        className="truncate text-sm text-gray-500 dark:text-gray-400"
                        title={notification.recipientEmail}
                      >
                        {notification.recipientEmail}
                      </div>
                        </>
                      )}
                    </td>
                    <td
                      className="px-3 py-4 align-top"
                      style={{ width: '26rem', minWidth: '22rem', maxWidth: '26rem' }}
                    >
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere] break-words">
                        {notification.taskTicket ? `[${notification.taskTicket}]` : ''}{' '}
                        {notification.taskTitle || t('notificationQueue.unknownTask')}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere] break-words">
                        {notification.boardTitle && `${notification.boardTitle} → `}
                        {notification.columnTitle || t('notificationQueue.unknownColumn')}
                      </div>
                      {notification.actor && (
                        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 [overflow-wrap:anywhere] break-words">
                          {t('notificationQueue.by')} {notification.actor.name}
                        </div>
                      )}
                    </td>
                    <td className="min-w-[10rem] whitespace-nowrap px-3 py-4 align-top">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {getNotificationTypeLabel(notification.notificationType)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {notification.action}
                      </div>
                    </td>
                    <td
                      className="px-3 py-4 align-top"
                      style={{ width: '15rem', minWidth: '15rem', maxWidth: '18rem' }}
                    >
                      {getStatusBadge(notification.status)}
                      {notification.errorMessage && (
                        <div
                          className="mt-1 truncate text-xs text-red-600 dark:text-red-400"
                          title={notification.errorMessage}
                        >
                          {notification.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="min-w-[7rem] whitespace-nowrap px-3 py-4 align-top text-sm leading-tight text-gray-500 dark:text-gray-400">
                      {scheduledParts ? (
                        <>
                          <div>{scheduledParts.date}</div>
                          <div>{scheduledParts.time}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="min-w-[7rem] whitespace-nowrap px-3 py-4 align-top text-sm leading-tight text-gray-500 dark:text-gray-400">
                      {sentParts ? (
                        <>
                          <div>{sentParts.date}</div>
                          <div>{sentParts.time}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="min-w-[10rem] whitespace-nowrap px-3 py-4 align-top text-sm text-gray-500 dark:text-gray-400">
                      {notification.changeCount > 1 ? (
                        <span className="font-medium">
                          {notification.changeCount} {t('notificationQueue.changesPlural')}
                        </span>
                      ) : (
                        <span>
                          1 {t('notificationQueue.change')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Load More Button */}
      {filteredNotifications.length > displayLimit && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setDisplayLimit(prev => prev + 50)}
            className="px-6 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {t('notificationQueue.loadMore', { 
              count: Math.min(50, filteredNotifications.length - displayLimit),
              remaining: filteredNotifications.length - displayLimit
            }) || `Load More (${Math.min(50, filteredNotifications.length - displayLimit)} of ${filteredNotifications.length - displayLimit} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminNotificationQueueTab;

