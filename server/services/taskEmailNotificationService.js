import EmailService from './emailService.js';
import { EmailTemplates } from './emailTemplates.js';
import { wrapQuery } from '../utils/queryLogger.js';
import { getNotificationThrottlerForDb } from './notificationThrottler.js';
import { activity as activityQueries, tasks as taskQueries, helpers } from '../utils/sqlManager/index.js';
import { buildTaskEmailUrl, buildEmailAuthorAvatar } from '../utils/emailContent.js';
import { getUserTimeZone } from '../utils/dateFormatter.js';
import { getTenantStoragePaths } from '../middleware/tenantRouting.js';
import {
  AGENT_USER_ID,
  SYSTEM_USER_ID,
} from '../constants/agentIdentity.js';

const DEFAULT_PREFERENCES = {
  newTaskAssigned: true,
  myTaskUpdated: true,
  watchedTaskUpdated: true,
  addedAsCollaborator: true,
  addedAsWatcher: true,
  collaboratingTaskUpdated: true,
  commentAdded: true,
  requesterTaskCreated: true,
  requesterTaskUpdated: true,
};

const NON_MAILABLE_USER_IDS = new Set([AGENT_USER_ID, SYSTEM_USER_ID]);

function isNonMailableEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const normalized = email.trim().toLowerCase();
  return (
    normalized.endsWith('@local') ||
    normalized === 'agent@local' ||
    normalized === 'system@local'
  );
}

function isMailableRecipient(user) {
  if (!user?.id && !user?.userId) return false;
  const id = user.id || user.userId;
  if (NON_MAILABLE_USER_IDS.has(id)) return false;
  if (user.is_active === false || user.isActive === false) return false;
  if (isNonMailableEmail(user.email)) return false;
  return Boolean(user.email);
}

/**
 * Task / comment email orchestrator (separate from realtime notificationService.js).
 * Uses the request-scoped tenant DB for prefs, queue, and SMTP.
 */
class TaskEmailNotificationService {
  constructor(db, tenantId = null) {
    this.db = db;
    this.tenantId = tenantId;
    this.emailService = new EmailService(db);
    this.recentNotifications = new Map();
  }

  async isMailReady() {
    const validation = await this.emailService.validateEmailConfig();
    return validation;
  }

  /** Admin pause for task emails (queue still accepts; immediate paths must check too). */
  async areTaskEmailsEnabled() {
    try {
      const row = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('TASK_EMAIL_NOTIFICATIONS_ENABLED');
      return row?.value !== 'false';
    } catch {
      return true;
    }
  }

  async getUserNotificationPreferences(userId) {
    try {
      let defaults = { ...DEFAULT_PREFERENCES };
      const globalDefaults = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('NOTIFICATION_DEFAULTS');

      if (globalDefaults?.value) {
        try {
          defaults = { ...defaults, ...JSON.parse(globalDefaults.value) };
        } catch {
          /* keep defaults */
        }
      }

      const userSettings = await wrapQuery(
        this.db.prepare(
          'SELECT setting_value FROM user_settings WHERE userid = ? AND setting_key = ?'
        ),
        'SELECT'
      ).get(userId, 'notifications');

      if (userSettings?.setting_value) {
        try {
          const parsed = JSON.parse(userSettings.setting_value);
          const merged = { ...defaults, ...parsed };
          // Coerce string booleans from older / mangled saves
          for (const key of Object.keys(merged)) {
            if (merged[key] === 'true') merged[key] = true;
            if (merged[key] === 'false') merged[key] = false;
          }
          return merged;
        } catch {
          return defaults;
        }
      }
      return defaults;
    } catch (error) {
      console.warn('Failed to get user notification preferences:', error.message);
      return { ...DEFAULT_PREFERENCES };
    }
  }

  async getTaskParticipants(taskId) {
    try {
      const task = await taskQueries.getTaskWithRelationships(this.db, taskId);
      if (!task) return {};

      const memberId = task.memberId || task.memberid || null;
      const requesterId = task.requesterId || task.requesterid || null;
      const boardId = task.boardId || task.boardid || null;

      const board = boardId
        ? await wrapQuery(
            this.db.prepare('SELECT id, title, project FROM boards WHERE id = ?'),
            'SELECT'
          ).get(boardId)
        : null;

      const loadMemberUser = async (mid) => {
        if (!mid) return null;
        return wrapQuery(
          this.db.prepare(`
            SELECT m.user_id as "userId", m.name, u.email, u.first_name, u.last_name, u.is_active
            FROM members m
            JOIN users u ON m.user_id = u.id
            WHERE m.id = ?
          `),
          'SELECT'
        ).get(mid);
      };

      const assignee = await loadMemberUser(memberId);
      const requester = await loadMemberUser(requesterId);

      const mapParticipant = (row) => {
        const userId = row.user_id || row.userId;
        if (!userId) return null;
        return {
          userId,
          name: row.name,
          email: row.email,
        };
      };

      const watchers = (task.watchers || [])
        .map(mapParticipant)
        .filter(Boolean);
      const collaborators = (task.collaborators || [])
        .map(mapParticipant)
        .filter(Boolean);

      const projectId = board?.project || null;

      return {
        task: {
          id: taskId,
          memberId,
          requesterId,
          title: task.title,
          ticket: task.ticket,
          boardId,
          projectId,
        },
        projectId,
        boardTitle: board?.title || 'Board',
        assignee,
        requester,
        watchers,
        collaborators,
      };
    } catch (error) {
      console.warn('Failed to get task participants:', error.message);
      return {};
    }
  }

  async getActor(userId) {
    const withMember = await wrapQuery(
      this.db.prepare(`
        SELECT m.name, m.color, u.id, u.email, u.first_name, u.last_name,
               u.avatar_path, u.google_avatar_url, u.auth_provider
        FROM members m
        JOIN users u ON m.user_id = u.id
        WHERE u.id = ?
      `),
      'SELECT'
    ).get(userId);
    if (withMember) return withMember;

    // Users without a member row can still act (e.g. some admins)
    return wrapQuery(
      this.db.prepare(`
        SELECT id, email, first_name, last_name,
               avatar_path, google_avatar_url, auth_provider,
               TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name
        FROM users WHERE id = ?
      `),
      'SELECT'
    ).get(userId);
  }

  /**
   * Build recipient list. Actor never receives their own change.
   * Requesters are included on create/update like watchers/collaborators.
   * One email per user (highest-priority type wins).
   *
   * @param {object} [options]
   * @param {string|null} [options.changedField]
   * @param {string|null} [options.newAssigneeUserId] - user id of newly assigned member
   */
  determineNotifications(action, participants, actorUserId, options = {}) {
    const { assignee, requester, watchers = [], collaborators = [] } = participants;
    const { changedField = null, newAssigneeUserId = null } = options;
    const byUser = new Map();

    const priority = {
      newTaskAssigned: 100,
      myTaskUpdated: 90,
      requesterTaskCreated: 80,
      requesterTaskUpdated: 70,
      collaboratingTaskUpdated: 60,
      watchedTaskUpdated: 50,
      addedAsCollaborator: 40,
      addedAsWatcher: 35,
    };

    const add = (recipientUserId, notificationType) => {
      if (!recipientUserId || recipientUserId === actorUserId) return;
      if (NON_MAILABLE_USER_IDS.has(recipientUserId)) return;
      const existing = byUser.get(recipientUserId);
      if (!existing || (priority[notificationType] || 0) > (priority[existing] || 0)) {
        byUser.set(recipientUserId, notificationType);
      }
    };

    const asUpdate = () => {
      // Fresh assignment → "new task assigned" for the new owner (not generic update)
      if (changedField === 'memberId' && newAssigneeUserId) {
        add(newAssigneeUserId, 'newTaskAssigned');
      } else {
        add(assignee?.userId, 'myTaskUpdated');
      }
      add(requester?.userId, 'requesterTaskUpdated');
      for (const collaborator of collaborators) {
        add(collaborator.userId, 'collaboratingTaskUpdated');
      }
      for (const watcher of watchers) {
        add(watcher.userId, 'watchedTaskUpdated');
      }
    };

    switch (action) {
      case 'create_task':
        add(assignee?.userId, 'newTaskAssigned');
        add(requester?.userId, 'requesterTaskCreated');
        break;

      case 'update_task':
      case 'move_task':
      case 'associate_tag':
      case 'disassociate_tag':
      case 'delete_task':
      case 'restore_task':
      case 'copy_task':
      default:
        asUpdate();
        break;
    }

    return [...byUser.entries()].map(([recipientUserId, notificationType]) => ({
      recipientUserId,
      notificationType,
    }));
  }

  async resolvePeopleDisplayValues(changedField, oldValue, newValue) {
    if (changedField === 'columnId') {
      const looksLikeColumnId = (value) => {
        const s = String(value || '').trim();
        if (!s) return false;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
          return true;
        }
        // Column ids are often slug-prefixed UUIDs (e.g. todo-<uuid>)
        return /^[a-z0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
      };

      const resolveTitle = async (value) => {
        if (!value) return '';
        if (!looksLikeColumnId(value)) return String(value);
        const column = await helpers.getColumnById(this.db, value);
        return column?.title || String(value);
      };

      const [oldTitle, newTitle] = await Promise.all([
        resolveTitle(oldValue),
        resolveTitle(newValue),
      ]);
      return { oldValue: oldTitle, newValue: newTitle, newAssigneeUserId: null };
    }

    if (changedField !== 'memberId' && changedField !== 'requesterId') {
      return { oldValue, newValue, newAssigneeUserId: null };
    }

    const [oldName, newName, newAssigneeUserId] = await Promise.all([
      activityQueries.resolveMemberDisplayName(this.db, oldValue),
      activityQueries.resolveMemberDisplayName(this.db, newValue),
      changedField === 'memberId'
        ? activityQueries.getUserIdForMember(this.db, newValue)
        : Promise.resolve(null),
    ]);

    return {
      oldValue: oldName || (oldValue ? String(oldValue) : ''),
      newValue: newName || (newValue ? String(newValue) : ''),
      newAssigneeUserId,
    };
  }

  isDuplicateBurst(userId, action, taskId) {
    const key = `${userId}-${action}-${taskId}`;
    const now = Date.now();
    const last = this.recentNotifications.get(key);
    if (last && now - last < 1000) return true;
    this.recentNotifications.set(key, now);
    for (const [k, ts] of this.recentNotifications.entries()) {
      if (now - ts > 10000) this.recentNotifications.delete(k);
    }
    return false;
  }

  /**
   * Enqueue (or immediately send) task-change emails for eligible recipients.
   */
  async sendTaskNotification(activityData) {
    try {
      if (process.env.DEMO_ENABLED === 'true') return;
      if (!(await this.areTaskEmailsEnabled())) return;

      const mail = await this.isMailReady();
      if (!mail.valid) {
        return;
      }

      const {
        userId,
        action,
        taskId,
        details,
        oldValue,
        newValue,
        changedField = null,
        projectIdentifier = null,
        taskTicket: activityTaskTicket = null,
      } = activityData;
      if (!userId || !taskId || !action) return;
      if (this.isDuplicateBurst(userId, action, taskId)) return;

      const participants = await this.getTaskParticipants(taskId);
      if (!participants.task) return;

      // Prefer live board project; fall back to values captured at delete/update time
      if (!participants.projectId && projectIdentifier) {
        participants.projectId = projectIdentifier;
        if (participants.task) participants.task.projectId = projectIdentifier;
      }
      if (activityTaskTicket && participants.task && !participants.task.ticket) {
        participants.task.ticket = activityTaskTicket;
      }

      const actor = await this.getActor(userId);
      if (!actor) return;

      const display = await this.resolvePeopleDisplayValues(
        changedField,
        oldValue,
        newValue
      );

      const notifications = this.determineNotifications(
        action,
        participants,
        userId,
        {
          changedField,
          newAssigneeUserId: display.newAssigneeUserId,
        }
      );
      const throttler = getNotificationThrottlerForDb(this.db, this.tenantId);
      if (!throttler) {
        console.warn('📧 [TASK-EMAIL] Throttler unavailable — skipping enqueue');
        return;
      }

      const actorWithMeta = {
        ...actor,
        changedField: changedField || null,
      };

      for (const { recipientUserId, notificationType } of notifications) {
        const userPrefs = await this.getUserNotificationPreferences(recipientUserId);
        if (!userPrefs[notificationType]) continue;

        const recipient = await wrapQuery(
          this.db.prepare(
            'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ?'
          ),
          'SELECT'
        ).get(recipientUserId);
        if (!isMailableRecipient(recipient)) continue;

        await throttler.addNotification(recipientUserId, taskId, {
          userId,
          action,
          taskId,
          details,
          oldValue: display.oldValue,
          newValue: display.newValue,
          task: participants.task,
          participants,
          actor: actorWithMeta,
          notificationType,
          boardTitle: participants.boardTitle,
        });
      }
    } catch (error) {
      console.error('❌ [TASK-EMAIL] Error enqueueing task notification:', error);
    }
  }

  /**
   * Send comment emails immediately (not throttled), when mail is configured.
   */
  async sendCommentNotification(commentData) {
    try {
      if (process.env.DEMO_ENABLED === 'true') return;
      if (!(await this.areTaskEmailsEnabled())) return;

      const { userId, action, taskId, commentContent } = commentData;
      if (action !== 'create_comment' || !userId || !taskId) return;

      const mail = await this.isMailReady();
      if (!mail.valid) return;

      const participants = await this.getTaskParticipants(taskId);
      if (!participants.task) return;

      const actor = await this.getActor(userId);
      if (!actor) return;

      const recipientIds = new Set();
      const consider = (uid) => {
        if (uid && uid !== userId && !NON_MAILABLE_USER_IDS.has(uid)) {
          recipientIds.add(uid);
        }
      };
      consider(participants.assignee?.userId);
      consider(participants.requester?.userId);
      for (const w of participants.watchers || []) consider(w.userId);
      for (const c of participants.collaborators || []) consider(c.userId);

      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      let baseUrl =
        appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');
      const ticket = participants.task.ticket || participants.task.id;
      const taskUrl = buildTaskEmailUrl(baseUrl, {
        projectId: participants.projectId,
        ticket,
        taskId: participants.task.id,
      });

      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';

      const storagePaths = getTenantStoragePaths(this.tenantId);
      const authorAvatar = await buildEmailAuthorAvatar({
        db: this.db,
        storagePaths,
        author: actor,
      });

      for (const recipientUserId of recipientIds) {
        const userPrefs = await this.getUserNotificationPreferences(recipientUserId);
        if (!userPrefs.commentAdded) continue;

        const recipient = await wrapQuery(
          this.db.prepare(
            'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ?'
          ),
          'SELECT'
        ).get(recipientUserId);
        if (!isMailableRecipient(recipient)) continue;

        const recipientTimeZone = await getUserTimeZone(this.db, recipientUserId);

        const emailContent = await EmailTemplates.commentNotification({
          user: recipient,
          task: participants.task,
          board: {
            id: participants.task.boardId,
            name: participants.boardTitle || 'Board',
            title: participants.boardTitle || 'Board',
          },
          project: participants.projectId || null,
          comment: { text: commentContent || '' },
          commentAuthor: {
            first_name: actor.first_name || actor.name?.split(' ')[0] || 'User',
            last_name:
              actor.last_name ||
              actor.name?.split(' ').slice(1).join(' ') ||
              '',
            color: actor.color || null,
            avatar_path: actor.avatar_path || null,
            google_avatar_url: actor.google_avatar_url || null,
          },
          authorAvatarHtml: authorAvatar.html,
          emailAttachments: authorAvatar.attachments,
          taskUrl,
          siteName,
          timestamp: new Date().toISOString(),
          recipientTimeZone,
          db: this.db,
        });

        await this.emailService.sendEmail({
          to: recipient.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
          attachments: emailContent.attachments || [],
        });
      }
    } catch (error) {
      console.error('❌ [TASK-EMAIL] Error sending comment notification:', error);
    }
  }

  /**
   * Email the newly added collaborator immediately (respects addedAsCollaborator pref).
   * Does not notify other task participants.
   */
  async sendCollaboratorAddedNotification({ actorUserId, taskId, memberId }) {
    try {
      if (process.env.DEMO_ENABLED === 'true') return;
      if (!(await this.areTaskEmailsEnabled())) return;
      if (!actorUserId || !taskId || !memberId) return;

      const mail = await this.isMailReady();
      if (!mail.valid) return;

      const recipientUserId = await activityQueries.getUserIdForMember(this.db, memberId);
      if (!recipientUserId || recipientUserId === actorUserId) return;
      if (NON_MAILABLE_USER_IDS.has(recipientUserId)) return;

      const userPrefs = await this.getUserNotificationPreferences(recipientUserId);
      if (!userPrefs.addedAsCollaborator) return;

      const recipient = await wrapQuery(
        this.db.prepare(
          'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ?'
        ),
        'SELECT'
      ).get(recipientUserId);
      if (!isMailableRecipient(recipient)) return;

      const participants = await this.getTaskParticipants(taskId);
      if (!participants.task) return;

      const actor = await this.getActor(actorUserId);
      const actorName =
        actor?.name ||
        [actor?.first_name, actor?.last_name].filter(Boolean).join(' ') ||
        actor?.email ||
        'Someone';

      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      let baseUrl =
        appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');
      const ticket = participants.task.ticket || participants.task.id;
      const taskUrl = buildTaskEmailUrl(baseUrl, {
        projectId: participants.projectId,
        ticket,
        taskId: participants.task.id,
      });

      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';
      const recipientTimeZone = await getUserTimeZone(this.db, recipientUserId);

      const { getTranslatorForUser } = await import('../utils/i18n.js');
      const t = await getTranslatorForUser(this.db, recipientUserId);
      const actionDetails = `${t('emails.taskNotification.addedAsCollaborator.addedBy')} ${actorName}`;

      const emailContent = await EmailTemplates.taskNotification({
        user: recipient,
        task: participants.task,
        board: {
          id: participants.task.boardId,
          name: participants.boardTitle || 'Board',
          title: participants.boardTitle || 'Board',
        },
        project: participants.projectId || null,
        actionType: 'update_task',
        actionDetails,
        taskUrl,
        siteName,
        notificationType: 'addedAsCollaborator',
        timestamp: new Date().toISOString(),
        recipientTimeZone,
        db: this.db,
      });

      await this.emailService.sendEmail({
        to: recipient.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
    } catch (error) {
      console.error('❌ [TASK-EMAIL] Error sending collaborator-added notification:', error);
    }
  }

  /**
   * Email the newly added watcher immediately (respects addedAsWatcher pref).
   * Does not notify other task participants.
   */
  async sendWatcherAddedNotification({ actorUserId, taskId, memberId }) {
    try {
      if (process.env.DEMO_ENABLED === 'true') return;
      if (!(await this.areTaskEmailsEnabled())) return;
      if (!actorUserId || !taskId || !memberId) return;

      const mail = await this.isMailReady();
      if (!mail.valid) return;

      const recipientUserId = await activityQueries.getUserIdForMember(this.db, memberId);
      if (!recipientUserId || recipientUserId === actorUserId) return;
      if (NON_MAILABLE_USER_IDS.has(recipientUserId)) return;

      const userPrefs = await this.getUserNotificationPreferences(recipientUserId);
      if (!userPrefs.addedAsWatcher) return;

      const recipient = await wrapQuery(
        this.db.prepare(
          'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ?'
        ),
        'SELECT'
      ).get(recipientUserId);
      if (!isMailableRecipient(recipient)) return;

      const participants = await this.getTaskParticipants(taskId);
      if (!participants.task) return;

      const actor = await this.getActor(actorUserId);
      const actorName =
        actor?.name ||
        [actor?.first_name, actor?.last_name].filter(Boolean).join(' ') ||
        actor?.email ||
        'Someone';

      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      let baseUrl =
        appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');
      const ticket = participants.task.ticket || participants.task.id;
      const taskUrl = buildTaskEmailUrl(baseUrl, {
        projectId: participants.projectId,
        ticket,
        taskId: participants.task.id,
      });

      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';
      const recipientTimeZone = await getUserTimeZone(this.db, recipientUserId);

      const { getTranslatorForUser } = await import('../utils/i18n.js');
      const t = await getTranslatorForUser(this.db, recipientUserId);
      const actionDetails = `${t('emails.taskNotification.addedAsWatcher.addedBy')} ${actorName}`;

      const emailContent = await EmailTemplates.taskNotification({
        user: recipient,
        task: participants.task,
        board: {
          id: participants.task.boardId,
          name: participants.boardTitle || 'Board',
          title: participants.boardTitle || 'Board',
        },
        project: participants.projectId || null,
        actionType: 'update_task',
        actionDetails,
        taskUrl,
        siteName,
        notificationType: 'addedAsWatcher',
        timestamp: new Date().toISOString(),
        recipientTimeZone,
        db: this.db,
      });

      await this.emailService.sendEmail({
        to: recipient.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
    } catch (error) {
      console.error('❌ [TASK-EMAIL] Error sending watcher-added notification:', error);
    }
  }

  /**
   * One digest email per recipient for kanban multi-select field updates.
   * Lists only the tasks that recipient is involved in.
   */
  async sendBulkTaskFieldNotification(bulkData) {
    try {
      if (process.env.DEMO_ENABLED === 'true') return;
      if (!(await this.areTaskEmailsEnabled())) return;

      const mail = await this.isMailReady();
      if (!mail.valid) return;

      const {
        userId,
        field,
        taskIds,
        oldValue = null,
        newValue = null,
        newLabel = null,
        details = null,
        reason = null,
      } = bulkData || {};

      if (!userId || !field || !Array.isArray(taskIds) || taskIds.length === 0) {
        return;
      }

      const actor = await this.getActor(userId);
      if (!actor) return;

      const display = await this.resolvePeopleDisplayValues(field, oldValue, newValue);

      let changeBefore = '';
      let changeAfter = '';
      if (field === 'memberId' || field === 'requesterId') {
        // Only show from→to when all tasks shared the same previous value
        if (oldValue) changeBefore = display.oldValue || '';
        changeAfter = display.newValue || '';
      } else if (field === 'priorityId') {
        changeAfter = newLabel || String(newValue ?? '');
      } else if (field === 'sprintId') {
        if (newValue === null || newValue === undefined || newValue === '') {
          changeAfter = '—';
        } else {
          changeAfter = newLabel || String(newValue);
        }
      } else if (field === 'moveBoard' || field === 'collaborator' || field === 'watcher' || field === 'tag') {
        changeAfter = newLabel || String(newValue ?? '');
      } else if (field === 'columnId' && newLabel) {
        changeAfter = newLabel;
      }

      const typePriority = {
        newTaskAssigned: 100,
        myTaskUpdated: 90,
        requesterTaskUpdated: 70,
        collaboratingTaskUpdated: 60,
        watchedTaskUpdated: 50,
        addedAsCollaborator: 40,
        addedAsWatcher: 35,
      };

      /** @type {Map<string, { notificationType: string, tasks: object[], boardTitle: string }>} */
      const byRecipient = new Map();
      let boardTitle = 'Board';

      // Bulk collaborator/watcher add: one digest to the new member only
      if ((field === 'collaborator' || field === 'watcher') && newValue) {
        const recipientUserId = await activityQueries.getUserIdForMember(this.db, newValue);
        const notificationType =
          field === 'collaborator' ? 'addedAsCollaborator' : 'addedAsWatcher';
        if (recipientUserId && recipientUserId !== userId && !NON_MAILABLE_USER_IDS.has(recipientUserId)) {
          const tasks = [];
          for (const taskId of taskIds) {
            const participants = await this.getTaskParticipants(taskId);
            if (!participants?.task) continue;
            boardTitle = participants.boardTitle || boardTitle;
            tasks.push({
              id: participants.task.id,
              title: participants.task.title,
              ticket: participants.task.ticket,
              boardId: participants.task.boardId,
              projectId: participants.projectId || participants.task.projectId || null,
            });
          }
          if (tasks.length > 0) {
            byRecipient.set(recipientUserId, {
              notificationType,
              tasks,
              boardTitle,
            });
          }
        }
      } else {
        for (const taskId of taskIds) {
          const participants = await this.getTaskParticipants(taskId);
          if (!participants?.task) continue;
          boardTitle = participants.boardTitle || boardTitle;

          const action =
            field === 'delete'
              ? 'delete_task'
              : field === 'copy'
                ? 'copy_task'
                : field === 'tag'
                  ? 'associate_tag'
                  : field === 'moveBoard' || field === 'columnId'
                    ? 'move_task'
                    : 'update_task';

          const notifications = this.determineNotifications(
            action,
            participants,
            userId,
            {
              changedField:
                field === 'delete' || field === 'moveBoard' || field === 'copy' || field === 'tag'
                  ? null
                  : field,
              newAssigneeUserId: display.newAssigneeUserId,
            }
          );

          const taskSummary = {
            id: participants.task.id,
            title: participants.task.title,
            ticket: participants.task.ticket,
            boardId: participants.task.boardId,
            projectId: participants.projectId || participants.task.projectId || null,
          };

          for (const { recipientUserId, notificationType } of notifications) {
            const existing = byRecipient.get(recipientUserId);
            if (!existing) {
              byRecipient.set(recipientUserId, {
                notificationType,
                tasks: [taskSummary],
                boardTitle: participants.boardTitle || boardTitle,
              });
            } else {
              if (
                (typePriority[notificationType] || 0) >
                (typePriority[existing.notificationType] || 0)
              ) {
                existing.notificationType = notificationType;
              }
              if (!existing.tasks.some((t) => t.id === taskSummary.id)) {
                existing.tasks.push(taskSummary);
              }
            }
          }
        }
      }

      if (byRecipient.size === 0) return;

      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      let baseUrl =
        appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');

      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';

      const { resolveCorrespondenceLanguage } = await import('../utils/i18n.js');
      const { formatDetailsForEmail } = await import('../utils/emailContent.js');

      const actorName =
        actor.name ||
        [actor.first_name, actor.last_name].filter(Boolean).join(' ') ||
        actor.email ||
        'Someone';

      for (const [recipientUserId, payload] of byRecipient.entries()) {
        const userPrefs = await this.getUserNotificationPreferences(recipientUserId);
        if (!userPrefs[payload.notificationType]) continue;

        const recipient = await wrapQuery(
          this.db.prepare(
            'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ?'
          ),
          'SELECT'
        ).get(recipientUserId);
        if (!isMailableRecipient(recipient)) continue;

        const recipientTimeZone = await getUserTimeZone(this.db, recipientUserId);
        const lang = await resolveCorrespondenceLanguage(this.db, recipientUserId);
        const summaryDetails = details
          ? formatDetailsForEmail(details, lang)
          : '';

        const emailContent = await EmailTemplates.bulkTaskNotification({
          user: recipient,
          actorName,
          boardTitle: payload.boardTitle || boardTitle,
          field,
          reason,
          tasks: payload.tasks,
          changeBefore,
          changeAfter,
          summaryDetails,
          baseUrl,
          siteName,
          timestamp: new Date().toISOString(),
          recipientTimeZone,
          lang,
          db: this.db,
        });

        await this.emailService.sendEmail({
          to: recipient.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });
      }
    } catch (error) {
      console.error('❌ [TASK-EMAIL] Error sending bulk task notification:', error);
    }
  }

  /**
   * One digest email per recipient for multi-select / batch column moves.
   * @param {{ userId: string, moves: Array<{ taskId: string, title?: string, ticket?: string, boardId?: string, fromColumnName?: string, toColumnName?: string }> }} bulkData
   */
  async sendBulkColumnMoveNotification(bulkData) {
    try {
      if (process.env.DEMO_ENABLED === 'true') return;
      if (!(await this.areTaskEmailsEnabled())) return;

      const mail = await this.isMailReady();
      if (!mail.valid) return;

      const { userId, moves } = bulkData || {};
      if (!userId || !Array.isArray(moves) || moves.length < 2) return;

      const actor = await this.getActor(userId);
      if (!actor) return;

      const typePriority = {
        newTaskAssigned: 100,
        myTaskUpdated: 90,
        requesterTaskUpdated: 70,
        collaboratingTaskUpdated: 60,
        watchedTaskUpdated: 50,
      };

      /** @type {Map<string, { notificationType: string, tasks: object[], boardTitle: string }>} */
      const byRecipient = new Map();
      let boardTitle = 'Board';

      const toColumnNames = [
        ...new Set(moves.map((m) => m.toColumnName).filter(Boolean)),
      ];
      const fromColumnNames = [
        ...new Set(moves.map((m) => m.fromColumnName).filter(Boolean)),
      ];
      const changeAfter =
        toColumnNames.length === 1 ? toColumnNames[0] : toColumnNames.join(', ');
      const changeBefore =
        fromColumnNames.length === 1 ? fromColumnNames[0] : '';

      for (const move of moves) {
        const participants = await this.getTaskParticipants(move.taskId);
        if (!participants?.task) continue;
        boardTitle = participants.boardTitle || boardTitle;

        const notifications = this.determineNotifications(
          'move_task',
          participants,
          userId,
          {}
        );

        const taskSummary = {
          id: participants.task.id,
          title: participants.task.title || move.title,
          ticket: participants.task.ticket || move.ticket,
          boardId: participants.task.boardId || move.boardId,
          projectId: participants.projectId || participants.task.projectId || null,
        };

        for (const { recipientUserId, notificationType } of notifications) {
          const existing = byRecipient.get(recipientUserId);
          if (!existing) {
            byRecipient.set(recipientUserId, {
              notificationType,
              tasks: [taskSummary],
              boardTitle: participants.boardTitle || boardTitle,
            });
          } else {
            if (
              (typePriority[notificationType] || 0) >
              (typePriority[existing.notificationType] || 0)
            ) {
              existing.notificationType = notificationType;
            }
            if (!existing.tasks.some((t) => t.id === taskSummary.id)) {
              existing.tasks.push(taskSummary);
            }
          }
        }
      }

      if (byRecipient.size === 0) return;

      const appUrlSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('APP_URL');
      let baseUrl =
        appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
      baseUrl = baseUrl.replace(/\/$/, '');

      const siteNameSetting = await wrapQuery(
        this.db.prepare('SELECT value FROM settings WHERE key = ?'),
        'SELECT'
      ).get('SITE_NAME');
      const siteName = siteNameSetting?.value || 'Agila';

      const actorName =
        actor.name ||
        [actor.first_name, actor.last_name].filter(Boolean).join(' ') ||
        actor.email ||
        'Someone';

      for (const [recipientUserId, payload] of byRecipient.entries()) {
        const userPrefs = await this.getUserNotificationPreferences(recipientUserId);
        if (!userPrefs[payload.notificationType]) continue;

        const recipient = await wrapQuery(
          this.db.prepare(
            'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = ?'
          ),
          'SELECT'
        ).get(recipientUserId);
        if (!isMailableRecipient(recipient)) continue;

        const recipientTimeZone = await getUserTimeZone(this.db, recipientUserId);

        const emailContent = await EmailTemplates.bulkTaskNotification({
          user: recipient,
          actorName,
          boardTitle: payload.boardTitle || boardTitle,
          field: 'columnId',
          tasks: payload.tasks,
          changeBefore,
          changeAfter,
          summaryDetails: '',
          baseUrl,
          siteName,
          timestamp: new Date().toISOString(),
          recipientTimeZone,
          db: this.db,
        });

        await this.emailService.sendEmail({
          to: recipient.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });
      }
    } catch (error) {
      console.error('❌ [TASK-EMAIL] Error sending bulk column-move notification:', error);
    }
  }
}

/** Fire-and-forget helpers used from activityLogger */
export function notifyTaskActivity(db, activityData, tenantId = null) {
  if (!db) return Promise.resolve();
  const service = new TaskEmailNotificationService(db, tenantId);
  return service.sendTaskNotification(activityData);
}

export function notifyCommentActivity(db, commentData, tenantId = null) {
  if (!db) return Promise.resolve();
  const service = new TaskEmailNotificationService(db, tenantId);
  return service.sendCommentNotification(commentData);
}

export function notifyBulkTaskFieldActivity(db, bulkData, tenantId = null) {
  if (!db) return Promise.resolve();
  const service = new TaskEmailNotificationService(db, tenantId);
  return service.sendBulkTaskFieldNotification(bulkData);
}

export function notifyCollaboratorAdded(db, data, tenantId = null) {
  if (!db) return Promise.resolve();
  const service = new TaskEmailNotificationService(db, tenantId);
  return service.sendCollaboratorAddedNotification(data);
}

export function notifyWatcherAdded(db, data, tenantId = null) {
  if (!db) return Promise.resolve();
  const service = new TaskEmailNotificationService(db, tenantId);
  return service.sendWatcherAddedNotification(data);
}

export function notifyBulkColumnMove(db, data, tenantId = null) {
  if (!db) return Promise.resolve();
  const service = new TaskEmailNotificationService(db, tenantId);
  return service.sendBulkColumnMoveNotification(data);
}

export { TaskEmailNotificationService };
