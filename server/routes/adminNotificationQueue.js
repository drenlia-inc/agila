import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import EmailService from '../services/emailService.js';
import { EmailTemplates } from '../services/emailTemplates.js';
import { buildTaskEmailUrl } from '../utils/emailContent.js';
import { getUserTimeZone } from '../utils/dateFormatter.js';
// MIGRATED: Import sqlManager modules
import { notificationQueue as notificationQueueQueries, users as userQueries, boards as boardQueries, helpers } from '../utils/sqlManager/index.js';
import { parseBody, notificationIdsBodySchema } from '../utils/requestValidation.js';

const router = express.Router();

/**
 * GET /api/admin/notification-queue
 * Get all notification queue items with human-readable data
 */
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    
    // MIGRATED: Get all notification queue items using sqlManager
    const notificationsResult = await notificationQueueQueries.getAllNotificationQueueItems(db, 500);

    // Ensure we have an array (PostgreSQL returns array, but handle edge cases)
    const notifications = Array.isArray(notificationsResult) ? notificationsResult : [];

    // Parse actor data from JSON
    const notificationsWithActor = notifications.map(notif => {
      let actor = null;
      try {
        const rawActor = notif.actorData ?? notif.actor_data;
        if (rawActor) {
          actor = typeof rawActor === 'string' ? JSON.parse(rawActor) : rawActor;
        }
      } catch (e) {
        console.warn('Failed to parse actor_data for notification', notif.id);
      }

      return {
        id: notif.id,
        recipientEmail: notif.recipientEmail,
        recipientName: notif.recipientName,
        taskTitle: notif.taskTitle,
        taskTicket: notif.taskTicket,
        columnTitle: notif.columnTitle,
        boardTitle: notif.boardTitle,
        notificationType: notif.notificationType,
        action: notif.action,
        details: notif.details,
        oldValue: notif.oldValue,
        newValue: notif.newValue,
        status: notif.status,
        scheduledSendTime: notif.scheduledSendTime,
        firstChangeTime: notif.firstChangeTime,
        lastChangeTime: notif.lastChangeTime,
        changeCount: notif.changeCount,
        errorMessage: notif.errorMessage,
        retryCount: notif.retryCount,
        createdAt: notif.createdAt,
        updatedAt: notif.updatedAt,
        sentAt: notif.sentAt,
        actor: actor
      };
    });

    res.json(notificationsWithActor);
  } catch (error) {
    console.error('Error fetching notification queue:', error);
    res.status(500).json({ error: 'Failed to fetch notification queue' });
  }
});

/**
 * POST /api/admin/notification-queue/send
 * Send selected notifications immediately
 */
router.post('/send', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const parsed = parseBody(notificationIdsBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { notificationIds } = parsed.data;

    const db = getRequestDatabase(req);
    const emailService = new EmailService(db);

    const sendingSetting = await helpers.getSetting(db, 'TASK_EMAIL_NOTIFICATIONS_ENABLED');
    if (sendingSetting === 'false') {
      return res.status(400).json({
        error: 'Task email notifications are paused. Enable them in Mail settings to send from the queue.',
        code: 'TASK_EMAIL_NOTIFICATIONS_PAUSED',
      });
    }
    
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    
    for (const notificationId of notificationIds) {
      try {
        // Allow retry of failed rows as well as pending (UI "Send Now" is a resend/retry).
        const notification = await notificationQueueQueries.getNotificationQueueItemById(
          db,
          notificationId
        );

        if (!notification) {
          errors.push(`Notification ${notificationId} not found`);
          failedCount++;
          continue;
        }
        if (notification.status !== 'pending' && notification.status !== 'failed') {
          errors.push(
            `Notification ${notificationId} cannot be sent (status: ${notification.status})`
          );
          failedCount++;
          continue;
        }

        // Parse stored JSON data
        const task = JSON.parse(notification.task_data);
        const participants = JSON.parse(notification.participants_data);
        const actor = JSON.parse(notification.actor_data);

        // MIGRATED: Get recipient user info using sqlManager
        const recipientUser = await userQueries.getUserById(db, notification.user_id);

        if (!recipientUser) {
          errors.push(`Recipient user ${notification.user_id} not found for notification ${notificationId}`);
          failedCount++;
          continue;
        }

        // MIGRATED: Get board info for task URL using sqlManager
        const boardInfo = await boardQueries.getBoardById(db, task.boardId || task.boardid);

        // MIGRATED: Get APP_URL for building task URL using sqlManager
        const appUrlSetting = await helpers.getSetting(db, 'APP_URL');
        
        let baseUrl = appUrlSetting || process.env.BASE_URL || 'http://localhost:3000';
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

        // MIGRATED: Get site name using sqlManager
        const siteNameSetting = await helpers.getSetting(db, 'SITE_NAME');
        const siteName = siteNameSetting || 'Agila';

        // Determine action type and details
        const actionType = notification.change_count > 1 ? 'consolidated_update' : notification.action;
        const actionDetails = notification.details;

        // Create email template data
        const recipientTimeZone = await getUserTimeZone(db, recipientUser.id);
        const emailTemplateData = {
          user: recipientUser,
          task: task,
          board: boardInfo || { id: task.boardId || task.boardid, name: 'Unknown Board' },
          project: projectId,
          actionType: actionType,
          actionDetails: actionDetails,
          taskUrl: taskUrl,
          siteName: siteName,
          oldValue: notification.old_value,
          newValue: notification.new_value,
          timestamp: notification.last_change_time,
          recipientTimeZone,
          db: db
        };

        // Generate email content using template
        const emailContent = await EmailTemplates.taskNotification(emailTemplateData);

        // Send email
        await emailService.sendEmail({
          to: recipientUser.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html
        });

        // MIGRATED: Mark as sent using sqlManager
        await notificationQueueQueries.updateNotificationQueueStatus(db, notificationId, 'sent');

        sentCount++;
      } catch (error) {
        console.error(`Failed to send notification ${notificationId}:`, error);
        errors.push(`Failed to send ${notificationId}: ${error.message}`);
        failedCount++;
      }
    }

    res.json({
      success: true,
      sentCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error sending notifications:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

/**
 * DELETE /api/admin/notification-queue
 * Delete selected notifications
 */
router.delete('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const parsed = parseBody(notificationIdsBodySchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }
    const { notificationIds } = parsed.data;

    const db = getRequestDatabase(req);
    
    // MIGRATED: Delete notifications using sqlManager
    const result = await notificationQueueQueries.deleteNotificationQueueItems(db, notificationIds);

    res.json({
      success: true,
      deletedCount: result.changes
    });
  } catch (error) {
    console.error('Error deleting notifications:', error);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
});

export default router;

