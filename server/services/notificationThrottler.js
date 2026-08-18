import { wrapQuery } from '../utils/queryLogger.js';
import crypto from 'crypto';
import EmailService from './emailService.js';
import { EmailTemplates } from './emailTemplates.js';
import { getAllTenantDatabases, isMultiTenant } from '../middleware/tenantRouting.js';
import {
  formatDetailsForEmail,
  buildTaskEmailUrl,
} from '../utils/emailContent.js';
import { getUserTimeZone } from '../utils/dateFormatter.js';
import { publishNotificationQueueUpdated } from '../utils/publishNotificationQueueUpdated.js';
import { resolveCorrespondenceLanguage } from '../utils/i18n.js';
import {
  refreshTaskSnapshot,
  mergeEmailChange,
  mergeEmailChangesFromActors,
  emailChangeIsSilent,
  webhookShouldNotify,
  isRecentlyCreatedTask,
  ensureTagEmailChange,
} from '../utils/taskEmailPayload.js';
import { dispatchWebhookById } from './webhookDispatcher.js';

export { formatDetailsForEmail };

/**
 * Notification Throttler Service
 * Handles throttling of notifications to prevent spam
 * Accumulates changes and sends consolidated notifications
 * DATABASE PERSISTENCE — survives server restarts.
 * Per-tenant DB instance; global processor claims rows atomically (multi-pod safe).
 */
class NotificationThrottler {
  constructor(db, tenantId = null) {
    this.db = db;
    this.tenantId = tenantId;
  }

  notifyQueueChanged() {
    publishNotificationQueueUpdated(this.tenantId).catch(() => {});
  }

  /**
   * Get notification delay setting from database
   */
  async getNotificationDelay() {
    try {
      const setting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('NOTIFICATION_DELAY');
      
      return setting ? parseInt(setting.value, 10) : 30; // Default 30 minutes
    } catch (error) {
      console.warn('Failed to get notification delay setting:', error.message);
      return 30; // Default 30 minutes
    }
  }

  /** @deprecated Per-tenant intervals removed — use startGlobalNotificationProcessor() */
  startProcessing() {
    startGlobalNotificationProcessor();
  }

  /** @deprecated */
  stopProcessing() {
    /* global processor owns the interval */
  }

  /**
   * Add a notification to the throttling queue (DATABASE BACKED)
   */
  async addNotification(userId, taskId, notificationData) {
    // Skip notifications in demo mode
    if (process.env.DEMO_ENABLED === 'true') {
      console.log('📧 [THROTTLER] Skipping notification in demo mode');
      return Promise.resolve();
    }
    
    const delay = await this.getNotificationDelay();

    const incomingChange = notificationData.actor?.emailChange;
    if (
      notificationData.action !== 'create_task' &&
      notificationData.action !== 'delete_task' &&
      notificationData.action !== 'restore_task' &&
      notificationData.action !== 'copy_task' &&
      emailChangeIsSilent(incomingChange)
    ) {
      return Promise.resolve();
    }
    
    // If delay is 0, send immediately
    if (delay === 0) {
      return this.sendImmediateNotification(userId, taskId, notificationData);
    }

    try {
      const now = new Date();
      const scheduledSendTime = new Date(now.getTime() + delay * 60 * 1000);
      
      // Check if there's already a pending notification for this user-task combo
      const existing = await wrapQuery(
        this.db.prepare(`
          SELECT id, change_count, first_change_time, task_data, participants_data, actor_data
          FROM notification_queue
          WHERE user_id = ? AND task_id = ? AND status = 'pending'
            AND COALESCE(delivery_channel, 'email') = 'email'
          ORDER BY created_at ASC
          LIMIT 1
        `),
        'SELECT'
      ).get(userId, taskId);

      if (existing) {
        const prevActor = JSON.parse(existing.actor_data || '{}');
        const mergedChange = mergeEmailChange(
          prevActor.emailChange,
          notificationData.actor?.emailChange
        );
        if (
          notificationData.action !== 'create_task' &&
          notificationData.action !== 'delete_task' &&
          notificationData.action !== 'restore_task' &&
          notificationData.action !== 'copy_task' &&
          emailChangeIsSilent(mergedChange) &&
          emailChangeIsSilent(prevActor.emailChange)
        ) {
          return;
        }
        const mergedActor = {
          ...notificationData.actor,
          emailChange: mergedChange,
        };
        const nextAction =
          notificationData.action === 'effort' ? existing.action : notificationData.action;

        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET 
              action = ?,
              details = ?,
              old_value = ?,
              new_value = ?,
              task_data = ?,
              participants_data = ?,
              actor_data = ?,
              last_change_time = ?,
              scheduled_send_time = ?,
              change_count = change_count + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `),
          'UPDATE'
        ).run(
          nextAction,
          notificationData.details,
          notificationData.oldValue || null,
          notificationData.newValue || null,
          JSON.stringify(notificationData.task),
          JSON.stringify(notificationData.participants),
          JSON.stringify(mergedActor),
          now.toISOString(),
          scheduledSendTime.toISOString(),
          existing.id
        );

        console.log(`📧 [THROTTLER] Updated existing notification ${existing.id} for user ${userId}, task ${taskId}. Change count: ${existing.change_count + 1}`);
        this.notifyQueueChanged();
      } else {
        const notificationId = crypto.randomUUID();
        try {
          await wrapQuery(
            this.db.prepare(`
            INSERT INTO notification_queue (
              id, user_id, task_id, webhook_id, delivery_channel, notification_type, action, details,
              old_value, new_value, task_data, participants_data, actor_data,
              status, scheduled_send_time, first_change_time, last_change_time,
              change_count, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `),
            'INSERT'
          ).run(
            notificationId,
            userId,
            taskId,
            notificationData.notificationType,
            notificationData.action,
            notificationData.details,
            notificationData.oldValue || null,
            notificationData.newValue || null,
            JSON.stringify(notificationData.task),
            JSON.stringify(notificationData.participants),
            JSON.stringify(notificationData.actor),
            'pending',
            scheduledSendTime.toISOString(),
            now.toISOString(),
            now.toISOString(),
            1
          );
          console.log(`📧 [THROTTLER] Created notification ${notificationId} for user ${userId}, task ${taskId}. Will send at ${scheduledSendTime.toISOString()}`);
          this.notifyQueueChanged();
        } catch (insertErr) {
          const isUnique =
            insertErr?.code === '23505' ||
            /unique|duplicate key/i.test(String(insertErr?.message || ''));
          if (!isUnique) throw insertErr;
          const raced = await wrapQuery(
            this.db.prepare(`
              SELECT id, change_count, first_change_time, task_data, participants_data, actor_data
              FROM notification_queue
              WHERE user_id = ? AND task_id = ? AND status = 'pending'
                AND COALESCE(delivery_channel, 'email') = 'email'
            AND COALESCE(delivery_channel, 'email') = 'email'
              ORDER BY created_at DESC
              LIMIT 1
            `),
            'SELECT'
          ).get(userId, taskId);
          if (!raced) throw insertErr;
          await this.addNotification(userId, taskId, notificationData);
        }
      }
    } catch (error) {
      console.error(`❌ [THROTTLER] Failed to queue notification for user ${userId}, task ${taskId}:`, error);
    }
  }

  async addWebhookNotification(webhookId, taskId, notificationData) {
    if (process.env.DEMO_ENABLED === 'true') return Promise.resolve();
    const delay = await this.getNotificationDelay();
    const incomingChange = notificationData.actor?.emailChange;
    if (
      !webhookShouldNotify(notificationData.action, incomingChange, {
        changedField: notificationData.actor?.changedField,
        oldValue: notificationData.oldValue,
        newValue: notificationData.newValue,
      })
    ) {
      return Promise.resolve();
    }
    if (delay === 0) {
      return this.sendImmediateWebhook(webhookId, taskId, notificationData);
    }
    try {
      const now = new Date();
      const scheduledSendTime = new Date(now.getTime() + delay * 60 * 1000);
      const existing = await wrapQuery(
        this.db.prepare(`
          SELECT id, change_count, actor_data, action
          FROM notification_queue
          WHERE webhook_id = ? AND task_id = ? AND status = 'pending'
            AND delivery_channel = 'webhook'
          ORDER BY created_at ASC
          LIMIT 1
        `),
        'SELECT'
      ).get(webhookId, taskId);

      if (existing) {
        const prevActor = JSON.parse(existing.actor_data || '{}');
        const mergedChange = mergeEmailChange(
          prevActor.emailChange,
          notificationData.actor?.emailChange
        );
        const mergedActor = { ...notificationData.actor, emailChange: mergedChange };
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET action = ?, details = ?, old_value = ?, new_value = ?,
                task_data = ?, participants_data = ?, actor_data = ?,
                last_change_time = ?, scheduled_send_time = ?,
                change_count = change_count + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `),
          'UPDATE'
        ).run(
          notificationData.action === 'effort' ? existing.action : notificationData.action,
          notificationData.details,
          notificationData.oldValue || null,
          notificationData.newValue || null,
          JSON.stringify(notificationData.task),
          JSON.stringify(notificationData.participants),
          JSON.stringify(mergedActor),
          now.toISOString(),
          scheduledSendTime.toISOString(),
          existing.id
        );
        this.notifyQueueChanged();
      } else {
        const notificationId = crypto.randomUUID();
        try {
          await wrapQuery(
            this.db.prepare(`
            INSERT INTO notification_queue (
              id, user_id, task_id, webhook_id, delivery_channel, notification_type, action, details,
              old_value, new_value, task_data, participants_data, actor_data,
              status, scheduled_send_time, first_change_time, last_change_time,
              change_count, created_at, updated_at
            ) VALUES (?, NULL, ?, ?, 'webhook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `),
            'INSERT'
          ).run(
            notificationId,
            taskId,
            webhookId,
            notificationData.notificationType || 'webhook',
            notificationData.action,
            notificationData.details,
            notificationData.oldValue || null,
            notificationData.newValue || null,
            JSON.stringify(notificationData.task || {}),
            JSON.stringify(notificationData.participants || {}),
            JSON.stringify(notificationData.actor || {}),
            'pending',
            scheduledSendTime.toISOString(),
            now.toISOString(),
            now.toISOString()
          );
          this.notifyQueueChanged();
        } catch (insertErr) {
          const isUnique =
            insertErr?.code === '23505' ||
            /unique|duplicate key/i.test(String(insertErr?.message || ''));
          if (!isUnique) throw insertErr;
          await this.addWebhookNotification(webhookId, taskId, notificationData);
        }
      }
    } catch (error) {
      console.error(`❌ [THROTTLER] Failed to queue webhook ${webhookId} for task ${taskId}:`, error);
    }
  }

  async sendWebhookGrouped(notifications) {
    if (!notifications.length) return;
    const base = notifications[0];
    const ids = notifications.map((n) => n.id);
    try {
      await dispatchWebhookById(this.db, base.webhook_id, {
        queueRow: base,
        commentContent: (() => {
          try {
            return JSON.parse(base.actor_data || '{}').commentContent || null;
          } catch {
            return null;
          }
        })(),
      });
      const ph = ids.map(() => '?').join(',');
      await wrapQuery(
        this.db.prepare(`
          UPDATE notification_queue
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error_message = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id IN (${ph})
        `),
        'UPDATE'
      ).run(...ids);
      this.notifyQueueChanged();
    } catch (error) {
      const retryCount = (base.retry_count || 0) + 1;
      const maxRetries = 3;
      if (retryCount >= maxRetries) {
        const ph = ids.map(() => '?').join(',');
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET status = 'failed', error_message = ?, retry_count = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${ph})
          `),
          'UPDATE'
        ).run(error.message, retryCount, ...ids);
      } else {
        const retryTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const ph = ids.map(() => '?').join(',');
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET status = 'pending', scheduled_send_time = ?, error_message = ?, retry_count = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${ph})
          `),
          'UPDATE'
        ).run(retryTime, error.message, retryCount, ...ids);
      }
      this.notifyQueueChanged();
    }
  }

  async sendImmediateWebhook(webhookId, taskId, notificationData) {
    try {
      const notificationId = crypto.randomUUID();
      const now = new Date().toISOString();
      await wrapQuery(
        this.db.prepare(`
          INSERT INTO notification_queue (
            id, user_id, task_id, webhook_id, delivery_channel, notification_type, action, details,
            old_value, new_value, task_data, participants_data, actor_data,
            status, scheduled_send_time, first_change_time, last_change_time,
            change_count, created_at, updated_at
          ) VALUES (?, NULL, ?, ?, 'webhook', ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `),
        'INSERT'
      ).run(
        notificationId,
        taskId,
        webhookId,
        notificationData.notificationType || 'webhook',
        notificationData.action,
        notificationData.details,
        notificationData.oldValue || null,
        notificationData.newValue || null,
        JSON.stringify(notificationData.task || {}),
        JSON.stringify(notificationData.participants || {}),
        JSON.stringify(notificationData.actor || {}),
        now,
        now,
        now
      );
      await this.sendWebhookGrouped([
        {
          id: notificationId,
          webhook_id: webhookId,
          task_id: taskId,
          action: notificationData.action,
          details: notificationData.details,
          task_data: JSON.stringify(notificationData.task || {}),
          participants_data: JSON.stringify(notificationData.participants || {}),
          actor_data: JSON.stringify(notificationData.actor || {}),
          retry_count: 0,
        },
      ]);
    } catch (error) {
      console.error(`❌ [THROTTLER] Immediate webhook failed:`, error);
    }
  }

  /**
   * Atomically claim due pending rows (multi-pod safe via FOR UPDATE SKIP LOCKED),
   * then send. Skips the cycle when this tenant's mail is not configured.
   */
  async processReadyNotifications() {
    try {
      try {
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE status = 'processing'
              AND updated_at < NOW() - INTERVAL '15 minutes'
          `),
          'UPDATE'
        ).run();
      } catch (recoverErr) {
        console.warn('📧 [THROTTLER] Stuck-row recovery skipped:', recoverErr.message);
      }

      const now = new Date().toISOString();
      const readyNotifications = await wrapQuery(
        this.db.prepare(`
          WITH due AS (
            SELECT id
            FROM notification_queue
            WHERE status = 'pending' AND scheduled_send_time <= ?
            ORDER BY scheduled_send_time ASC
            LIMIT 50
            FOR UPDATE SKIP LOCKED
          )
          UPDATE notification_queue nq
          SET status = 'processing', updated_at = CURRENT_TIMESTAMP
          FROM due
          WHERE nq.id = due.id
          RETURNING nq.*
        `),
        'UPDATE'
      ).all(now);

      if (!readyNotifications || readyNotifications.length === 0) {
        return;
      }

      const mail = await new EmailService(this.db).validateEmailConfig();
      const sendingSetting = await wrapQuery(
        this.db.prepare(`SELECT value FROM settings WHERE key = ?`),
        'SELECT'
      ).get('TASK_EMAIL_NOTIFICATIONS_ENABLED');
      const emailsPaused = sendingSetting && sendingSetting.value === 'false';

      const label = this.tenantId || 'default';
      console.log(
        `📧 [THROTTLER] [${label}] Claimed ${readyNotifications.length} notification(s)`
      );

      const groupedNotifications = new Map();
      for (const notification of readyNotifications) {
        const channel = notification.delivery_channel || 'email';
        const key =
          channel === 'webhook'
            ? `webhook:${notification.webhook_id}:${notification.task_id}`
            : `email:${notification.user_id}:${notification.task_id}`;
        if (!groupedNotifications.has(key)) {
          groupedNotifications.set(key, []);
        }
        groupedNotifications.get(key).push(notification);
      }

      for (const [, notifications] of groupedNotifications.entries()) {
        notifications.sort((a, b) => {
          const timeA = new Date(a.last_change_time).getTime();
          const timeB = new Date(b.last_change_time).getTime();
          return timeB - timeA;
        });
        const channel = notifications[0].delivery_channel || 'email';
        if (channel === 'webhook') {
          await this.sendWebhookGrouped(notifications);
          continue;
        }
        if (!mail.valid || emailsPaused) {
          const ids = notifications.map((n) => n.id);
          const ph = ids.map(() => '?').join(',');
          await wrapQuery(
            this.db.prepare(`
              UPDATE notification_queue
              SET status = 'pending', updated_at = CURRENT_TIMESTAMP
              WHERE id IN (${ph})
            `),
            'UPDATE'
          ).run(...ids);
          continue;
        }
        await this.sendGroupedNotification(notifications);
      }
    } catch (error) {
      console.error('❌ [THROTTLER] Error processing ready notifications:', error);
    }
  }

  /**
   * Send a grouped notification (multiple changes to the same task for the same user)
   */
  async sendGroupedNotification(notifications) {
    if (notifications.length === 0) return;

    // Use the most recent notification as the base
    const baseNotification = notifications[0];
    
    try {
      console.log(`📧 [THROTTLER] Sending grouped notification for user ${baseNotification.user_id}, task ${baseNotification.task_id} (${notifications.length} change(s))`);
      
      // Parse stored JSON data from the most recent notification
      const task = JSON.parse(baseNotification.task_data);
      const participants = JSON.parse(baseNotification.participants_data);
      const actors = [...notifications]
        .sort(
          (a, b) =>
            new Date(a.last_change_time || a.first_change_time || 0).getTime() -
            new Date(b.last_change_time || b.first_change_time || 0).getTime()
        )
        .map((row) => {
        try {
          return JSON.parse(row.actor_data || '{}');
        } catch {
          return {};
        }
      });
      const actor = {
        ...actors[actors.length - 1],
        emailChange: mergeEmailChangesFromActors(actors),
      };

      // Get recipient user info (alias both casings for template safety)
      const recipientUser = await wrapQuery(
        this.db.prepare(`
          SELECT id, email,
                 first_name, first_name AS "firstName",
                 last_name, last_name AS "lastName"
          FROM users WHERE id = ?
        `),
        'SELECT'
      ).get(baseNotification.user_id);

      if (!recipientUser) {
        throw new Error(`Recipient user ${baseNotification.user_id} not found`);
      }

      const recipientEmail = String(recipientUser.email || '').toLowerCase();
      if (!recipientEmail || recipientEmail.endsWith('@local')) {
        console.log(
          `📧 [THROTTLER] Skipping non-mailable recipient ${baseNotification.user_id} (${recipientUser.email || 'no email'})`
        );
        const skipIds = notifications.map((n) => n.id);
        const skipPlaceholders = skipIds.map(() => '?').join(',');
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error_message = 'skipped_non_mailable'
            WHERE id IN (${skipPlaceholders})
          `),
          'UPDATE'
        ).run(...skipIds);
        return;
      }

      // Get board info for task URL
      const boardInfo = await wrapQuery(
        this.db.prepare('SELECT id, title, project FROM boards WHERE id = ?'),
        'SELECT'
      ).get(task.boardId || task.boardid);

      // Get APP_URL for building task URL
      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      
      let baseUrl = appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');

      const projectId =
        task.projectId ||
        participants?.projectId ||
        boardInfo?.project ||
        null;
      const taskTicket = task.ticket || task.id;
      const taskUrl = buildTaskEmailUrl(baseUrl, {
        projectId,
        ticket: taskTicket,
        taskId: task.id,
      });

      // Get site name
      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';

      // Recipient language: user pref → APP_LANGUAGE → en
      const recipientId = recipientUser.id || recipientUser.userId;
      const lang = await resolveCorrespondenceLanguage(this.db, recipientId);
      const refreshedTask = await refreshTaskSnapshot(this.db, task);
      const emailChange = await ensureTagEmailChange(
        this.db,
        baseNotification.action,
        actor?.emailChange || null,
        baseNotification.details,
        actor?.tagId || null
      );
      const visibleItems = (emailChange?.items || []).filter(
        (i) => i && i.field !== 'effort' && i.field !== 'generic'
      );
      const actionType =
        visibleItems.length > 1 ? 'consolidated_update' : baseNotification.action;
      const actionDetails = formatDetailsForEmail(baseNotification.details, lang);
      const firstChangeTime =
        [...notifications]
          .map((n) => n.first_change_time || n.last_change_time)
          .filter(Boolean)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ||
        baseNotification.last_change_time;
      const assigneeUserId = emailChange?.newAssigneeUserId;
      const isRecentAssignment =
        Boolean(assigneeUserId) &&
        String(assigneeUserId) === String(recipientId) &&
        isRecentlyCreatedTask(refreshedTask, firstChangeTime);

      const boardTitle = boardInfo?.title || 'Board';
      const changedField = actor?.changedField || null;
      const recipientTimeZone = await getUserTimeZone(
        this.db,
        recipientId
      );

      // Create email template data
      const emailTemplateData = {
        user: recipientUser,
        task: refreshedTask,
        board: {
          id: boardInfo?.id || task.boardId || task.boardid,
          title: boardTitle,
          name: boardTitle,
        },
        project: projectId,
        actionType: actionType,
        actionDetails: actionDetails,
        taskUrl: taskUrl,
        siteName: siteName,
        oldValue: baseNotification.old_value,
        newValue: baseNotification.new_value,
        changedField,
        notificationType: baseNotification.notification_type || null,
        timestamp: baseNotification.last_change_time,
        recipientTimeZone,
        lang,
        emailChange,
        isRecentAssignment,
        db: this.db
      };

      // Generate email content using template
      const emailContent = await EmailTemplates.taskNotification(emailTemplateData);

      // Send email using EmailService
      const emailService = new EmailService(this.db);
      await emailService.sendEmail({
        to: recipientUser.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html
      });

      // Mark all notifications in the group as sent
      const notificationIds = notifications.map(n => n.id);
      const placeholders = notificationIds.map(() => '?').join(',');
      
      await wrapQuery(
        this.db.prepare(`
          UPDATE notification_queue
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP
          WHERE id IN (${placeholders})
        `),
        'UPDATE'
      ).run(...notificationIds);

      console.log(`✅ [THROTTLER] Grouped notification sent successfully (${notifications.length} change(s))`);
      this.notifyQueueChanged();

    } catch (error) {
      console.error(`❌ [THROTTLER] Failed to send grouped notification:`, error);

      // Mark all as failed
      const notificationIds = notifications.map(n => n.id);
      const placeholders = notificationIds.map(() => '?').join(',');
      
      await wrapQuery(
        this.db.prepare(`
          UPDATE notification_queue
          SET status = 'failed', error_message = ?, retry_count = retry_count + 1
          WHERE id IN (${placeholders})
        `),
        'UPDATE'
      ).run(error.message, ...notificationIds);
    }
  }

  /**
   * Send a notification from the queue
   */
  async sendNotificationFromQueue(queuedNotification) {
    try {
      console.log(`📧 [THROTTLER] Sending notification ${queuedNotification.id} to user ${queuedNotification.user_id} for task ${queuedNotification.task_id}`);
      
      // Parse stored JSON data
      const task = JSON.parse(queuedNotification.task_data);
      const participants = JSON.parse(queuedNotification.participants_data);
      const actor = JSON.parse(queuedNotification.actor_data);

      // Get recipient user info (alias both casings for template safety)
      const recipientUser = await wrapQuery(
        this.db.prepare(`
          SELECT id, email,
                 first_name, first_name AS "firstName",
                 last_name, last_name AS "lastName"
          FROM users WHERE id = ?
        `),
        'SELECT'
      ).get(queuedNotification.user_id);

      if (!recipientUser) {
        throw new Error(`Recipient user ${queuedNotification.user_id} not found`);
      }

      // Get board info for task URL
      const boardInfo = await wrapQuery(
        this.db.prepare('SELECT id, title, project FROM boards WHERE id = ?'),
        'SELECT'
      ).get(task.boardId || task.boardid);

      // Get APP_URL for building task URL
      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      
      let baseUrl = appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');

      const projectId =
        task.projectId || participants?.projectId || boardInfo?.project || null;
      const taskTicket = task.ticket || task.id;
      const taskUrl = buildTaskEmailUrl(baseUrl, {
        projectId,
        ticket: taskTicket,
        taskId: task.id,
      });

      // Get site name
      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';

      // Recipient language: user pref → APP_LANGUAGE → en
      const recipientId = recipientUser.id || recipientUser.userId;
      const lang = await resolveCorrespondenceLanguage(this.db, recipientId);
      const refreshedTask = await refreshTaskSnapshot(this.db, task);
      const emailChange = await ensureTagEmailChange(
        this.db,
        queuedNotification.action,
        actor?.emailChange || null,
        queuedNotification.details,
        actor?.tagId || null
      );
      const visibleItems = (emailChange?.items || []).filter(
        (i) => i && i.field !== 'effort' && i.field !== 'generic'
      );
      const actionType =
        visibleItems.length > 1 ? 'consolidated_update' : queuedNotification.action;
      const actionDetails = formatDetailsForEmail(queuedNotification.details, lang);
      const firstChangeTime =
        queuedNotification.first_change_time || queuedNotification.last_change_time;
      const assigneeUserId = emailChange?.newAssigneeUserId;
      const isRecentAssignment =
        Boolean(assigneeUserId) &&
        String(assigneeUserId) === String(recipientId) &&
        isRecentlyCreatedTask(refreshedTask, firstChangeTime);
      const boardTitle = boardInfo?.title || 'Board';
      const changedField = actor?.changedField || null;
      const recipientTimeZone = await getUserTimeZone(
        this.db,
        recipientId
      );

      // Create email template data
      const emailTemplateData = {
        user: recipientUser,
        task: refreshedTask,
        board: {
          id: boardInfo?.id || task.boardId || task.boardid,
          title: boardTitle,
          name: boardTitle,
        },
        project: projectId,
        actionType: actionType,
        actionDetails: actionDetails,
        taskUrl: taskUrl,
        siteName: siteName,
        oldValue: queuedNotification.old_value,
        newValue: queuedNotification.new_value,
        changedField,
        notificationType: queuedNotification.notification_type || null,
        timestamp: queuedNotification.last_change_time,
        recipientTimeZone,
        lang,
        emailChange,
        isRecentAssignment,
        db: this.db
      };

      // Generate email content using template
      const emailContent = await EmailTemplates.taskNotification(emailTemplateData);

      // Send email using EmailService
      const emailService = new EmailService(this.db);
      await emailService.sendEmail({
        to: recipientUser.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html
      });

      // Mark as sent
      await wrapQuery(
        this.db.prepare(`
          UPDATE notification_queue
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `),
        'UPDATE'
      ).run(queuedNotification.id);

      console.log(`✅ [THROTTLER] Notification ${queuedNotification.id} sent successfully (${queuedNotification.change_count} change(s))`);
      this.notifyQueueChanged();

    } catch (error) {
      console.error(`❌ [THROTTLER] Failed to send notification ${queuedNotification.id}:`, error);

      // Mark as failed and increment retry count
      const retryCount = queuedNotification.retry_count + 1;
      const maxRetries = 3;

      if (retryCount >= maxRetries) {
        // Give up after max retries
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET status = 'failed', error_message = ?, retry_count = ?
            WHERE id = ?
          `),
          'UPDATE'
        ).run(error.message, retryCount, queuedNotification.id);

        console.error(`❌ [THROTTLER] Notification ${queuedNotification.id} failed permanently after ${maxRetries} attempts`);
      } else {
        // Schedule retry (5 minutes later)
        const retryTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        
        await wrapQuery(
          this.db.prepare(`
            UPDATE notification_queue
            SET scheduled_send_time = ?, error_message = ?, retry_count = ?
            WHERE id = ?
          `),
          'UPDATE'
        ).run(retryTime, error.message, retryCount, queuedNotification.id);

        console.warn(`⚠️ [THROTTLER] Notification ${queuedNotification.id} failed (attempt ${retryCount}/${maxRetries}), will retry at ${retryTime}`);
      }
    }
  }

  /**
   * Send immediately when NOTIFICATION_DELAY is 0 (still persists a row for admin audit).
   */
  async sendImmediateNotification(userId, taskId, notificationData) {
    try {
      const mail = await new EmailService(this.db).validateEmailConfig();
      if (!mail.valid) return;

      console.log(
        `📧 [THROTTLER] Sending immediate notification to user ${userId} for task ${taskId} (delay=0)`
      );

      const notificationId = crypto.randomUUID();
      const now = new Date().toISOString();

      await wrapQuery(
        this.db.prepare(`
          INSERT INTO notification_queue (
            id, user_id, task_id, webhook_id, delivery_channel, notification_type, action, details,
            old_value, new_value, task_data, participants_data, actor_data,
            status, scheduled_send_time, first_change_time, last_change_time,
            change_count, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, 'email', ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `),
        'INSERT'
      ).run(
        notificationId,
        userId,
        taskId,
        notificationData.notificationType,
        notificationData.action,
        notificationData.details,
        notificationData.oldValue || null,
        notificationData.newValue || null,
        JSON.stringify(notificationData.task),
        JSON.stringify(notificationData.participants),
        JSON.stringify(notificationData.actor),
        now,
        now,
        now
      );

      await this.sendGroupedNotification([
        {
          id: notificationId,
          user_id: userId,
          task_id: taskId,
          action: notificationData.action,
          details: notificationData.details,
          old_value: notificationData.oldValue || null,
          new_value: notificationData.newValue || null,
          task_data: JSON.stringify(notificationData.task),
          participants_data: JSON.stringify(notificationData.participants),
          actor_data: JSON.stringify(notificationData.actor),
          last_change_time: now,
          change_count: 1,
        },
      ]);
    } catch (error) {
      console.error(`❌ [THROTTLER] Failed to send immediate notification to user ${userId}:`, error);
    }
  }

  /**
   * Calculate human-readable time span
   */
  calculateTimeSpan(startTime, endTime) {
    const diffMs = endTime - startTime;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) {
      return 'less than a minute';
    } else if (diffMinutes === 1) {
      return '1 minute';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minutes`;
    } else {
      const diffHours = Math.floor(diffMinutes / 60);
      return diffHours === 1 ? '1 hour' : `${diffHours} hours`;
    }
  }

  /**
   * Force send all pending notifications (for shutdown, etc.)
   */
  async flushAllNotifications() {
    console.log('🔄 Flushing all pending notifications...');

    try {
      const mail = await new EmailService(this.db).validateEmailConfig();

      // Atomic claim so multi-pod shutdown does not double-send
      const pendingNotifications = await wrapQuery(
        this.db.prepare(`
          WITH due AS (
            SELECT id
            FROM notification_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 200
            FOR UPDATE SKIP LOCKED
          )
          UPDATE notification_queue nq
          SET status = 'processing', updated_at = CURRENT_TIMESTAMP
          FROM due
          WHERE nq.id = due.id
          RETURNING nq.*
        `),
        'UPDATE'
      ).all();

      console.log(
        `📧 [THROTTLER] Found ${pendingNotifications.length} pending notification(s) to flush`
      );

      const grouped = new Map();
      for (const notification of pendingNotifications) {
        const channel = notification.delivery_channel || 'email';
        const key =
          channel === 'webhook'
            ? `webhook:${notification.webhook_id}:${notification.task_id}`
            : `email:${notification.user_id}:${notification.task_id}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(notification);
      }
      for (const [, notifications] of grouped) {
        if ((notifications[0].delivery_channel || 'email') === 'webhook') {
          await this.sendWebhookGrouped(notifications);
        } else if (mail.valid) {
          await this.sendGroupedNotification(notifications);
        } else {
          const ids = notifications.map((n) => n.id);
          const ph = ids.map(() => '?').join(',');
          await wrapQuery(
            this.db.prepare(`
              UPDATE notification_queue
              SET status = 'pending', updated_at = CURRENT_TIMESTAMP
              WHERE id IN (${ph})
            `),
            'UPDATE'
          ).run(...ids);
        }
      }

      console.log('✅ All pending notifications flushed');
    } catch (error) {
      console.error('❌ Failed to flush notifications:', error);
    }
  }

  /**
   * Get pending notifications count for a user
   */
  async getPendingCount(userId) {
    try {
      const result = await wrapQuery(
        this.db.prepare(`
          SELECT COUNT(*) as count
          FROM notification_queue
          WHERE user_id = ? AND status = 'pending'
        `),
        'SELECT'
      ).get(userId);

      return result ? result.count : 0;
    } catch (error) {
      console.error('Failed to get pending notification count:', error);
      return 0;
    }
  }

  /**
   * Get all pending notifications for debugging
   */
  async getPendingNotifications() {
    try {
      const notifications = await wrapQuery(
        this.db.prepare(`
          SELECT 
            user_id, task_id, notification_type, change_count,
            first_change_time, scheduled_send_time, status
          FROM notification_queue
          WHERE status = 'pending'
          ORDER BY scheduled_send_time ASC
        `),
        'SELECT'
      ).all();

      return notifications;
    } catch (error) {
      console.error('Failed to get pending notifications:', error);
      return [];
    }
  }

  /**
   * Retention days for sent/failed queue rows (0 = keep forever).
   */
  async getQueueRetentionDays() {
    try {
      const setting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('NOTIFICATION_QUEUE_RETENTION_DAYS');
      return parseRetentionDays(setting?.value);
    } catch (error) {
      console.warn('Failed to get notification queue retention setting:', error.message);
      return 0;
    }
  }

  /**
   * Clean up old sent/failed notifications per NOTIFICATION_QUEUE_RETENTION_DAYS.
   * 0 / unset = keep forever (no automatic purge).
   */
  async cleanupOldNotifications() {
    try {
      const retentionDays = await this.getQueueRetentionDays();
      if (retentionDays === 0) return;

      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000
      ).toISOString();

      const result = await wrapQuery(
        this.db.prepare(`
          DELETE FROM notification_queue
          WHERE (status = 'sent' OR status = 'failed')
            AND created_at < ?
        `),
        'DELETE'
      ).run(cutoff);

      if (result.changes > 0) {
        console.log(
          `🧹 [THROTTLER] Cleaned up ${result.changes} notification(s) older than ${retentionDays} day(s)`
        );
      }
    } catch (error) {
      console.error('Failed to clean up old notifications:', error);
    }
  }
}

/** tenantId|null key → throttler bound to that tenant DB */
const throttlersByTenant = new Map();
let globalProcessorInterval = null;
let defaultThrottler = null;

function tenantKey(tenantId) {
  return tenantId || 'default';
}

/**
 * Get or create a throttler for a tenant database (used when enqueueing).
 */
export function getNotificationThrottlerForDb(db, tenantId = null) {
  const key = tenantKey(tenantId);
  let throttler = throttlersByTenant.get(key);
  if (!throttler || throttler.db !== db) {
    throttler = new NotificationThrottler(db, tenantId);
    throttlersByTenant.set(key, throttler);
    if (key === 'default') defaultThrottler = throttler;
  }
  return throttler;
}

/** @deprecated Prefer getNotificationThrottlerForDb(db, tenantId) */
export const getNotificationThrottler = () => defaultThrottler;

/**
 * Process due queue rows for every known tenant DB (and single-tenant default).
 */
export async function processAllTenantNotificationQueues() {
  try {
    if (isMultiTenant()) {
      const tenants = await getAllTenantDatabases();
      for (const { tenantId, db } of tenants) {
        const throttler = getNotificationThrottlerForDb(db, tenantId);
        await throttler.processReadyNotifications();
      }
      return;
    }
    if (defaultThrottler) {
      await defaultThrottler.processReadyNotifications();
    }
  } catch (error) {
    console.error('❌ [THROTTLER] processAllTenantNotificationQueues failed:', error);
  }
}

export async function flushAllTenantNotifications() {
  if (isMultiTenant()) {
    const tenants = await getAllTenantDatabases();
    for (const { tenantId, db } of tenants) {
      const throttler = getNotificationThrottlerForDb(db, tenantId);
      await throttler.flushAllNotifications();
    }
    return;
  }
  if (defaultThrottler) {
    await defaultThrottler.flushAllNotifications();
  }
}

export async function cleanupAllTenantNotifications() {
  if (isMultiTenant()) {
    const tenants = await getAllTenantDatabases();
    for (const { tenantId, db } of tenants) {
      const throttler = getNotificationThrottlerForDb(db, tenantId);
      await throttler.cleanupOldNotifications();
    }
    return;
  }
  if (defaultThrottler) {
    await defaultThrottler.cleanupOldNotifications();
  }
}

export function startGlobalNotificationProcessor() {
  if (globalProcessorInterval) return;
  console.log(
    '📧 [THROTTLER] Starting global notification queue processor (every 60s, all tenants)'
  );
  void processAllTenantNotificationQueues();
  globalProcessorInterval = setInterval(() => {
    void processAllTenantNotificationQueues();
  }, 60 * 1000);
}

export function stopGlobalNotificationProcessor() {
  if (globalProcessorInterval) {
    clearInterval(globalProcessorInterval);
    globalProcessorInterval = null;
    console.log('📧 [THROTTLER] Global notification queue processor stopped');
  }
}

/**
 * Single-tenant: bind default DB + start global processor.
 * Multi-tenant: call startGlobalNotificationProcessor() with no default DB
 * (throttlers are created lazily as tenant DBs warm).
 */
export const initNotificationThrottler = (db, tenantId = null) => {
  if (db) {
    defaultThrottler = getNotificationThrottlerForDb(db, tenantId);
    void defaultThrottler.cleanupOldNotifications();
  }
  startGlobalNotificationProcessor();
  return defaultThrottler;
};

export { NotificationThrottler };
