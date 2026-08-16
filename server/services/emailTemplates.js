/**
 * Email Templates - Centralized email content for the application
 */

import {
  getTranslatorForLanguage,
  resolveCorrespondenceLanguage,
} from '../utils/i18n.js';
import { formatDateTimeLocal } from '../utils/dateFormatter.js';
// recipientTimeZone: IANA tz from user_settings (browser-synced)
import {
  stripHtmlForEmail,
  formatWordDiffHtml,
  formatWordDiffText,
  buildTaskEmailUrl,
  buildEmailSiteLogo,
} from '../utils/emailContent.js';
import {
  contrastTextForHex,
  priorityBadgeStyle,
  shouldUseWordDiff,
} from '../utils/taskEmailPayload.js';

/**
 * Email language: explicit data.lang → recipient user pref → APP_LANGUAGE → en
 */
async function getEmailLangAndTranslator(data) {
  const lang =
    data.lang ||
    (data.db
      ? await resolveCorrespondenceLanguage(
          data.db,
          data.user?.id || data.user?.userId || null
        )
      : 'en');
  return { lang, t: getTranslatorForLanguage(lang) };
}

/** Map activity / queue action codes → emails.taskNotification.common.actionMessage.* keys */
const ACTION_MESSAGE_KEY_MAP = {
  create_task: 'created',
  copy_task: 'created',
  update_task: 'updated',
  delete_task: 'deleted',
  restore_task: 'restored',
  copy_task: 'copied',
  move_task: 'status_changed',
  associate_tag: 'updated',
  disassociate_tag: 'updated',
  create_tag: 'updated',
  update_tag: 'updated',
  delete_tag: 'updated',
  create_comment: 'commented',
  update_comment: 'commented',
  delete_comment: 'commented',
  agent_job_done: 'updated',
  agent_job_failed: 'updated',
  consolidated_update: 'consolidated_update',
  newTaskAssigned: 'assigned',
  created: 'created',
  assigned: 'assigned',
  updated: 'updated',
  commented: 'commented',
  status_changed: 'status_changed',
  priority_changed: 'priority_changed',
  due_date_changed: 'due_date_changed',
  assignee_changed: 'assignee_changed',
  requester_changed: 'requester_changed',
  default: 'default',
};

function resolveActionMessageKey(actionType, changedField, notificationType) {
  if (notificationType === 'newTaskAssigned') return 'assigned';
  if (notificationType === 'addedAsCollaborator') return 'added_as_collaborator';
  if (notificationType === 'addedAsWatcher') return 'added_as_watcher';
  if (actionType === 'delete_task') return 'deleted';
  if (changedField === 'memberId') return 'assignee_changed';
  if (changedField === 'requesterId') return 'requester_changed';
  if (changedField === 'columnId') return 'status_changed';
  if (changedField === 'isBlocked') return 'status_changed';
  if (changedField === 'priorityId') return 'priority_changed';
  if (!actionType) return 'default';
  return ACTION_MESSAGE_KEY_MAP[actionType] || 'default';
}

function isPeopleField(changedField) {
  return changedField === 'memberId' || changedField === 'requesterId';
}

/** Detect leftover raw member/user/column ids so we never show them in the diff. */
function looksLikeId(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }
  if (/^user-[a-z0-9-]+$/i.test(s)) return true;
  // Column ids are often slug-prefixed UUIDs (e.g. todo-<uuid>, archive-<uuid>)
  if (/^[a-z0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }
  return false;
}

function displayFirstName(user) {
  const name =
    user?.first_name ||
    user?.firstName ||
    (typeof user?.name === 'string' ? user.name.split(/\s+/)[0] : '') ||
    '';
  if (name) return name;
  if (user?.email) return String(user.email).split('@')[0];
  return 'there';
}

function displayBoardName(board) {
  return board?.name || board?.title || 'Board';
}

/** Task heading for email body: "TASK-00042 — Title" (ticket omitted if missing). */
function formatTaskHeading(task) {
  const title = task?.title || 'Task';
  const ticket = task?.ticket || '';
  return ticket ? `${ticket} — ${title}` : title;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailPriorityChip(name, hex) {
  const style = priorityBadgeStyle(hex);
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background-color:${escapeHtml(style.backgroundColor)};color:${escapeHtml(style.color)};">${escapeHtml(name || '')}</span>`;
}

function emailTagChip(name, hex) {
  const bg = hex || '#4F46E5';
  const fg = contrastTextForHex(bg);
  const border = fg === '#374151' ? 'border:1px solid #d1d5db;' : 'border:1px solid transparent;';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background-color:${escapeHtml(bg)};color:${escapeHtml(fg)};${border}margin:0 4px 0 0;vertical-align:middle;">${escapeHtml(name || '')}</span>`;
}

/**
 * Shared chrome for transactional emails (invite, password reset).
 * Table-based layout for broad client support; no emoji chrome.
 */
function wrapTransactionalEmail({ siteName, headline, bodyHtml, footerNote, logoHtml }) {
  const brand = escapeHtml(siteName || 'Agila');
  const headlineSafe = escapeHtml(headline);
  const headerRow = logoHtml
    ? `<tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:3px solid #0d9488;background:linear-gradient(180deg,#ecfdf8 0%,#ffffff 100%);">
              ${logoHtml}
            </td>
          </tr>`
    : `<tr>
            <td style="background-color:#111827;padding:20px 28px;">
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;">${brand}</p>
            </td>
          </tr>`;
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          ${headerRow}
          <tr>
            <td style="padding:32px 28px 8px 28px;">
              <h1 style="margin:0 0 20px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;line-height:1.3;font-weight:650;color:#111827;">${headlineSafe}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;">
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9ca3af;">
                ${footerNote || ''}
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#9ca3af;">
          ${brand}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailPrimaryButton(href, label) {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px 0;">
  <tr>
    <td align="center" style="border-radius:6px;background-color:#2563eb;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
        ${escapeHtml(label)}
      </a>
    </td>
  </tr>
</table>`;
}

function emailMutedNote(text) {
  return `
<p style="margin:20px 0 0 0;padding:12px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#4b5563;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
  ${escapeHtml(text)}
</p>`;
}

export const EmailTemplates = {
  /**
   * User Invitation Template
   * Sent when an admin creates a new local account
   */
  userInvite: async (data) => {
    const {
      user,
      inviteUrl,
      adminName,
      siteName,
      siteLogo,
      siteLogoDark,
      hideSiteLogo,
      baseUrl,
      db,
      lang: langOverride,
    } = data;
    const { t } = await getEmailLangAndTranslator({ user, db, lang: langOverride });
    const brand = siteName || 'Agila';
    const firstName = escapeHtml(user.first_name || '');
    const lastName = escapeHtml(user.last_name || '');
    const email = escapeHtml(user.email || '');
    const displayName = `${firstName} ${lastName}`.trim();

    const logoPath = hideSiteLogo ? '' : (siteLogo || siteLogoDark || '');
    const siteLogoEmbed = buildEmailSiteLogo({
      baseUrl,
      logoPath,
      hideSiteLogo,
      alt: brand,
      embedDefaultBrandLogo: true,
    });

    const bodyHtml = `
      <p style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#374151;">
        ${escapeHtml(t('emails.userInvite.greeting', { firstName: displayFirstName(user) }))}
      </p>
      <p style="margin:0 0 20px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#4b5563;">
        ${escapeHtml(t('emails.userInvite.body1', { adminName: adminName || 'Administrator', siteName: brand }))}
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 8px 0;background-color:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 10px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">
              ${escapeHtml(t('emails.userInvite.accountDetails'))}
            </p>
            <p style="margin:0 0 6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#374151;">
              <span style="color:#6b7280;">${escapeHtml(t('emails.userInvite.email'))}</span> ${email}
            </p>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#374151;">
              <span style="color:#6b7280;">${escapeHtml(t('emails.userInvite.name'))}</span> ${escapeHtml(displayName)}
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#4b5563;">
        ${escapeHtml(t('emails.userInvite.body2'))}
      </p>
      ${emailPrimaryButton(inviteUrl, t('emails.userInvite.activateAccount'))}
      ${emailMutedNote(t('emails.userInvite.body3'))}
      <p style="margin:20px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
        ${escapeHtml(t('emails.userInvite.body4'))}
      </p>
      <p style="margin:24px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
        ${escapeHtml(t('emails.userInvite.body5'))}<br>
        <strong style="color:#374151;">${escapeHtml(t('emails.userInvite.body6', { siteName: brand }))}</strong>
      </p>`;

    return {
      subject: t('emails.userInvite.subject', { siteName: brand }),
      text: `${t('emails.userInvite.greeting', { firstName: displayFirstName(user) })}

${t('emails.userInvite.body1', { adminName, siteName: brand })}

${t('emails.userInvite.body2')}
${inviteUrl}

${t('emails.userInvite.body3')}

${t('emails.userInvite.body4')}

${t('emails.userInvite.body5')}
${t('emails.userInvite.body6', { siteName: brand })}`,
      html: wrapTransactionalEmail({
        siteName: brand,
        headline: t('emails.userInvite.headline', { siteName: brand }),
        bodyHtml,
        footerNote: '',
        logoHtml: siteLogoEmbed.html,
      }),
      attachments: siteLogoEmbed.attachments,
    };
  },

  /**
   * Task Notification Template
   * Sent when tasks are created, updated, assigned, etc.
   */
  taskNotification: async (data) => {
    const { 
      user, 
      task, 
      board, 
      actionType, 
      taskUrl, 
      siteName,
      oldValue,
      newValue,
      timestamp,
      changedField = null,
      notificationType = null,
      recipientTimeZone = null,
      emailChange = null,
      isRecentAssignment = false,
      db,
      lang: langOverride,
    } = data;

    const { lang, t } = await getEmailLangAndTranslator({
      user,
      db,
      lang: langOverride,
    });
    const firstName = displayFirstName(user);
    const boardName = displayBoardName(board);
    const taskTitle = task?.title || 'Task';
    const taskHeading = formatTaskHeading(task);
    const items = (emailChange?.items || []).filter((i) => i && i.field !== 'effort');
    const showDescriptionAsDetails =
      isRecentAssignment ||
      notificationType === 'newTaskAssigned' ||
      actionType === 'create_task';

    const effectiveActionType =
      actionType === 'delete_task' ? 'delete_task' : actionType;
    const effectiveNotificationType =
      showDescriptionAsDetails && notificationType !== 'requesterTaskCreated'
        ? 'newTaskAssigned'
        : notificationType;

    const getActionMessage = () => {
      if (
        items.filter((i) => i.field !== 'generic').length > 1 &&
        effectiveActionType !== 'delete_task' &&
        !showDescriptionAsDetails
      ) {
        return t('emails.taskNotification.common.actionMessage.consolidated_update');
      }
      const actionKey = resolveActionMessageKey(
        effectiveActionType,
        changedField,
        effectiveNotificationType
      );
      return t(`emails.taskNotification.common.actionMessage.${actionKey}`);
    };

    const fromToCard = (label, before, after, beforeHtml = null, afterHtml = null) => {
      if (!before && !after) return '';
      if (before === after && !beforeHtml && !afterHtml) return '';
      return `<div style="margin: 14px 0 0 0; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 10px;">${escapeHtml(label)}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
            <tr>
              <td style="padding: 8px 10px; background:#fef2f2; border-radius:4px; color:#7f1d1d; font-size:14px;">${beforeHtml || escapeHtml(before || '—')}</td>
              <td style="width:36px; text-align:center; color:#9ca3af; font-size:16px;">→</td>
              <td style="padding: 8px 10px; background:#f0fdf4; border-radius:4px; color:#14532d; font-size:14px; font-weight:600;">${afterHtml || escapeHtml(after || '—')}</td>
            </tr>
          </table>
        </div>`;
    };

    const wordDiffCard = (before, after) => {
      const diffHtml = formatWordDiffHtml(before, after);
      if (!diffHtml) return '';
      return `<div style="margin: 14px 0 0 0; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 8px;">${t('emails.taskNotification.common.changed')}</div>
          <div style="font-size: 14px; line-height: 1.55; color: #374151;">${diffHtml}</div>
          <div style="margin-top: 10px; font-size: 11px; color: #9ca3af;">
            <span style="background-color:#fecaca;color:#7f1d1d;text-decoration:line-through;padding:0 3px;">${t('emails.taskNotification.common.diffRemoved')}</span>
            &nbsp;&nbsp;
            <span style="background-color:#bbf7d0;color:#14532d;font-weight:600;padding:0 3px;">${t('emails.taskNotification.common.diffAdded')}</span>
          </div>
        </div>`;
    };

    const valueChangeCard = (field, beforeRaw, afterRaw) => {
      let before = stripHtmlForEmail(beforeRaw);
      let after = stripHtmlForEmail(afterRaw);
      if (field === 'isBlocked') {
        const toBlockedLabel = (value) => {
          const blocked =
            value === true ||
            value === 1 ||
            value === '1' ||
            String(value).toLowerCase() === 'true';
          return blocked ? t('activity.blocked') : t('activity.unblocked');
        };
        before = toBlockedLabel(beforeRaw);
        after = toBlockedLabel(afterRaw);
      }
      if (!before && !after) return '';
      if (before === after) return '';
      if (looksLikeId(before) || looksLikeId(after)) return '';
      if (shouldUseWordDiff(before, after, field)) {
        return wordDiffCard(before, after);
      }
      return fromToCard(t('emails.taskNotification.common.changed'), before, after);
    };

    const buildStructuredDetailsHtml = () => {
      if (effectiveActionType === 'delete_task') {
        return escapeHtml(
          t('emails.taskNotification.common.detailsDeleted', {
            taskTitle,
            ticket: task?.ticket || '',
          })
        );
      }
      if (showDescriptionAsDetails) {
        const desc = stripHtmlForEmail(task?.description || '');
        return desc ? escapeHtml(desc) : '';
      }

      const lines = [];
      for (const item of items) {
        if (item.field === 'sprintId') {
          const name = item.newName || item.oldName || '';
          if (name) {
            lines.push(
              `${escapeHtml(t('emails.taskNotification.common.fieldSprint'))}: "${escapeHtml(name)}"`
            );
          }
        } else if (item.field === 'startDate' || item.field === 'date') {
          const from = item.oldValue || item.oldName || '';
          const to = item.newValue || item.newName || '';
          if (from || to) {
            lines.push(
              `${escapeHtml(t('emails.taskNotification.common.fieldDate'))}: ${escapeHtml(
                t('emails.taskNotification.common.fromTo', {
                  from: from || '—',
                  to: to || '—',
                })
              )}`
            );
          }
        } else if (item.field === 'tags') {
          const added = item.added || [];
          const removed = item.removed || [];
          if (added.length) {
            const key =
              added.length > 1
                ? 'emails.taskNotification.common.tagsAddedPlural'
                : 'emails.taskNotification.common.tagsAdded';
            lines.push(
              `${escapeHtml(t(key))} ${added.map((tag) => emailTagChip(tag.name, tag.color)).join('')}`
            );
          }
          if (removed.length) {
            const key =
              removed.length > 1
                ? 'emails.taskNotification.common.tagsRemovedPlural'
                : 'emails.taskNotification.common.tagsRemoved';
            lines.push(
              `${escapeHtml(t(key))} ${removed.map((tag) => emailTagChip(tag.name, tag.color)).join('')}`
            );
          }
        } else if (item.field === 'priorityId') {
          const oldChip = item.oldName
            ? emailPriorityChip(item.oldName, item.oldColor)
            : escapeHtml('—');
          const newChip = item.newName
            ? emailPriorityChip(item.newName, item.newColor)
            : escapeHtml('—');
          lines.push(
            `${escapeHtml(t('emails.taskNotification.common.fieldPriority'))}: ${oldChip} → ${newChip}`
          );
        }
      }
      if (lines.length) return lines.join('<br>');
      if (items.length) return '';
      return '';
    };

    const getChangeDetails = () => {
      if (showDescriptionAsDetails) return '';
      if (effectiveActionType === 'delete_task') return '';

      const parts = [];
      if (items.length) {
        for (const item of items) {
          if (item.field === 'sprintId' || item.field === 'tags' || item.field === 'priorityId' || item.field === 'startDate' || item.field === 'delete') {
            continue;
          }
          if (item.field === 'memberId' || item.field === 'requesterId') {
            if (showDescriptionAsDetails) continue;
            const before = item.oldName || item.oldValue || '';
            const after = item.newName || item.newValue || '';
            const label =
              item.field === 'requesterId'
                ? t('emails.taskNotification.common.fieldRequester')
                : t('emails.taskNotification.common.fieldAssignee');
            parts.push(fromToCard(label, before || t('emails.taskNotification.common.unassigned'), after || t('emails.taskNotification.common.unassigned')));
            continue;
          }
          parts.push(valueChangeCard(item.field, item.oldValue, item.newValue));
        }
        return parts.join('');
      }

      if (isPeopleField(changedField) && !showDescriptionAsDetails) {
        const beforeRaw = stripHtmlForEmail(oldValue);
        const afterRaw = stripHtmlForEmail(newValue);
        if (!beforeRaw && !afterRaw) return '';
        if (looksLikeId(beforeRaw) || looksLikeId(afterRaw)) return '';
        const label =
          changedField === 'requesterId'
            ? t('emails.taskNotification.common.fieldRequester')
            : t('emails.taskNotification.common.fieldAssignee');
        return fromToCard(
          label,
          beforeRaw || t('emails.taskNotification.common.unassigned'),
          afterRaw || t('emails.taskNotification.common.unassigned')
        );
      }
      return valueChangeCard(changedField, oldValue, newValue);
    };

    const formattedTimestamp = formatDateTimeLocal(
      timestamp || new Date(),
      recipientTimeZone
    );
    
    const taskTicket = task?.ticket || '';
    const ticketPrefix = taskTicket ? `[ ${taskTicket} ] ` : '';
    const actionMessage = getActionMessage();
    const knownTypes = [
      'addedAsCollaborator',
      'addedAsWatcher',
      'newTaskAssigned',
      'myTaskUpdated',
      'watchedTaskUpdated',
      'collaboratingTaskUpdated',
      'requesterTaskCreated',
      'requesterTaskUpdated',
    ];
    let subjectKey = knownTypes.includes(effectiveNotificationType)
      ? `emails.taskNotification.${effectiveNotificationType}.subject`
      : null;
    if (effectiveActionType === 'delete_task') {
      subjectKey = 'emails.taskNotification.common.subjectDeleted';
    }
    const typeSpecificSubject = subjectKey
      ? t(subjectKey, { taskTitle })
      : null;
    const emailSubject = typeSpecificSubject
      ? `${ticketPrefix}${typeSpecificSubject}`
      : `${ticketPrefix}${actionMessage} - ${taskTitle}`;
    const receivingReason =
      knownTypes.includes(effectiveNotificationType)
        ? t(`emails.taskNotification.${effectiveNotificationType}.receivingReason`)
        : t('emails.taskNotification.common.receivingReason');

    const detailsHtml = buildStructuredDetailsHtml();
    const detailsTextPlain = detailsHtml
      ? detailsHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      : '';
    const changeHtml = getChangeDetails();
    let textChangeBlock = '';
    if (!showDescriptionAsDetails && effectiveActionType !== 'delete_task') {
      const beforeText = stripHtmlForEmail(oldValue);
      const afterText = stripHtmlForEmail(newValue);
      if (
        beforeText !== afterText &&
        (beforeText || afterText) &&
        !looksLikeId(beforeText) &&
        !looksLikeId(afterText)
      ) {
        if (shouldUseWordDiff(beforeText, afterText, changedField)) {
          textChangeBlock = `\n${t('emails.taskNotification.common.changed')} ${formatWordDiffText(beforeText, afterText)}\n`;
        } else if (isPeopleField(changedField) || !shouldUseWordDiff(beforeText, afterText, changedField)) {
          textChangeBlock = `\n${t('emails.taskNotification.common.changed')} ${beforeText || '—'} → ${afterText || '—'}\n`;
        }
      }
    }

    return {
      subject: emailSubject,
      text: `${t('emails.taskNotification.common.hi', { firstName })}

${t('emails.taskNotification.common.actionInBoard', { actionMessage, boardName })}

${taskHeading}
${t('emails.taskNotification.common.project')} ${boardName}
${t('emails.taskNotification.common.timestamp')} ${formattedTimestamp}
${detailsTextPlain ? `${t('emails.taskNotification.common.details')}\n${detailsTextPlain}` : ''}
${textChangeBlock}
${t('emails.taskNotification.common.viewTask')}: ${taskUrl}

${t('emails.taskNotification.common.teamSignature', { siteName: siteName || 'Agila' })}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <p style="color: #374151; margin: 0 0 8px 0; font-size: 16px;">${t('emails.taskNotification.common.hi', { firstName })}</p>
            <p style="color: #6b7280; line-height: 1.6; font-size: 16px; margin: 0;">
              ${t('emails.taskNotification.common.actionInBoard', {
                actionMessage: escapeHtml(actionMessage),
                boardName: `<strong>${escapeHtml(boardName)}</strong>`,
              })}
            </p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #1f2937; margin-top: 0; font-size: 18px;">${escapeHtml(taskHeading)}</h3>
            <p style="color: #6b7280; margin: 5px 0;"><strong>${t('emails.taskNotification.common.project')}</strong> ${escapeHtml(boardName)}</p>
            <p style="color: #6b7280; margin: 5px 0; font-size: 14px;"><strong>${t('emails.taskNotification.common.timestamp')}</strong> ${escapeHtml(formattedTimestamp)}</p>
            ${detailsHtml ? `<div style="color: #374151; margin: 12px 0 0 0; line-height: 1.55;"><strong>${t('emails.taskNotification.common.details')}</strong><div style="margin-top:6px;">${detailsHtml}</div></div>` : ''}
            ${changeHtml}
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
              <tr>
                <td align="center" style="border-radius: 6px; background-color: #2563eb;">
                  <a href="${taskUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    ${t('emails.taskNotification.common.viewTask')}
                  </a>
                </td>
              </tr>
            </table>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            ${receivingReason}<br>
            <strong>${t('emails.taskNotification.common.teamSignature', { siteName: siteName || 'Agila' })}</strong>
          </p>
        </div>
      `
    };
  },

  /**
   * Comment Notification Template
   * Sent when comments are added to tasks
   */
  commentNotification: async (data) => {
    const { 
      user, 
      task, 
      board, 
      project, 
      comment, 
      commentAuthor, 
      taskUrl, 
      siteName,
      timestamp,
      recipientTimeZone = null,
      db,
      authorAvatarHtml,
      emailAttachments = [],
      lang: langOverride,
    } = data;

    const { t } = await getEmailLangAndTranslator({
      user,
      db,
      lang: langOverride,
    });
    const firstName = displayFirstName(user);
    const boardName = displayBoardName(board);
    const taskTitle = task?.title || 'Task';
    const taskHeading = formatTaskHeading(task);
    const authorFirst =
      commentAuthor?.first_name || commentAuthor?.firstName || 'Someone';
    const authorLast = commentAuthor?.last_name || commentAuthor?.lastName || '';
    const authorInitials = `${String(authorFirst).charAt(0)}${String(authorLast).charAt(0)}`;
    const authorColor = commentAuthor?.color || '#0ea5e9';
    const avatarHtml =
      authorAvatarHtml ||
      `<div style="background-color:${escapeHtml(authorColor)};color:white;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-right:10px;font-weight:bold;font-size:12px;line-height:32px;text-align:center;vertical-align:middle;">${escapeHtml(authorInitials)}</div>`;

    const formattedTimestamp = formatDateTimeLocal(
      timestamp || new Date(),
      recipientTimeZone
    );
    
    // Get task ticket for subject
    const taskTicket = task?.ticket || '';
    const ticketPrefix = taskTicket ? `[ ${taskTicket} ] ` : '';
    const commentText = (comment?.text || '').replace(/<[^>]*>/g, '');

    return {
      subject: `${ticketPrefix}${t('emails.commentNotification.subject', { taskTitle })}`,
      text: `${t('emails.taskNotification.common.hi', { firstName })}

${authorFirst} ${authorLast} ${t('emails.commentNotification.addedCommentToTask')}

Task: ${taskHeading}
${project ? `${t('emails.taskNotification.common.project')} ${project}` : ''}
${t('emails.taskNotification.common.board')} ${boardName}

Comment: ${commentText}

${t('emails.taskNotification.common.viewTask')}: ${taskUrl}

Best regards,
${t('emails.taskNotification.common.teamSignature', { siteName: siteName || 'Agila' })}`,
      attachments: emailAttachments,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #374151; margin-top: 0;">${t('emails.taskNotification.common.hi', { firstName })}</h2>
            <p style="color: #6b7280; line-height: 1.6;">
              <strong>${escapeHtml(authorFirst)} ${escapeHtml(authorLast)}</strong> ${t('emails.commentNotification.addedCommentToTask')}
            </p>
          </div>

          <div style="background-color: #fff; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #1f2937; margin-top: 0;">📝 ${escapeHtml(taskHeading)}</h3>
            ${project ? `<p style="color: #6b7280; margin: 5px 0;"><strong>${t('emails.taskNotification.common.project')}</strong> ${escapeHtml(boardName)}</p>` : ''}
            <p style="color: #6b7280; margin: 5px 0;"><strong>${t('emails.taskNotification.common.board')}</strong> ${escapeHtml(boardName)}</p>
            <p style="color: #6b7280; margin: 5px 0; font-size: 14px;"><strong>${t('emails.taskNotification.common.timestamp')}</strong> ${escapeHtml(formattedTimestamp)}</p>
          </div>

          <div style="background-color: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 16px; margin-bottom: 20px;">
            <div style="margin-bottom: 10px;">
              ${avatarHtml}
              <strong style="color: #0c4a6e; vertical-align: middle;">${escapeHtml(authorFirst)} ${escapeHtml(authorLast)}</strong>
            </div>
            <div style="color: #374151; line-height: 1.6;">
              ${comment?.text || ''}
            </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
              <tr>
                <td align="center" style="border-radius: 6px; background-color: #2563eb;">
                  <a href="${taskUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    ${t('emails.taskNotification.common.viewTaskReply')}
                  </a>
                </td>
              </tr>
            </table>
          </div>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            ${t('emails.taskNotification.common.receivingReason')}<br>
            <strong>${t('emails.taskNotification.common.teamSignature', { siteName: siteName || 'Agila' })}</strong>
          </p>
        </div>
      `
    };
  },

  /**
   * Password Reset Template
   * Sent when users request password reset
   */
  passwordReset: async (data) => {
    const {
      user,
      resetUrl,
      siteName,
      siteLogo,
      siteLogoDark,
      hideSiteLogo,
      baseUrl,
      db,
      lang: langOverride,
    } = data;
    const { t } = await getEmailLangAndTranslator({ user, db, lang: langOverride });
    const brand = siteName || 'Agila';

    const logoPath = hideSiteLogo ? '' : (siteLogo || siteLogoDark || '');
    const siteLogoEmbed = buildEmailSiteLogo({
      baseUrl,
      logoPath,
      hideSiteLogo,
      alt: brand,
      embedDefaultBrandLogo: true,
    });

    const bodyHtml = `
      <p style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#374151;">
        ${escapeHtml(t('emails.passwordReset.greeting', { firstName: displayFirstName(user) }))}
      </p>
      <p style="margin:0 0 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#4b5563;">
        ${escapeHtml(t('emails.passwordReset.body1', { siteName: brand }))}
      </p>
      ${emailPrimaryButton(resetUrl, t('emails.passwordReset.resetButton'))}
      <p style="margin:12px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#9ca3af;word-break:break-all;">
        ${escapeHtml(t('emails.passwordReset.body2'))}<br>
        <a href="${resetUrl}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(resetUrl)}</a>
      </p>
      ${emailMutedNote(t('emails.passwordReset.body3'))}
      <p style="margin:20px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
        ${escapeHtml(t('emails.passwordReset.body4'))}
      </p>
      <p style="margin:24px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b7280;">
        ${escapeHtml(t('emails.passwordReset.body5'))}<br>
        <strong style="color:#374151;">${escapeHtml(t('emails.passwordReset.body6', { siteName: brand }))}</strong>
      </p>`;

    return {
      subject: t('emails.passwordReset.subject', { siteName: brand }),
      text: `${t('emails.passwordReset.greeting', { firstName: displayFirstName(user) })}

${t('emails.passwordReset.body1', { siteName: brand })}

${t('emails.passwordReset.body2')}
${resetUrl}

${t('emails.passwordReset.body3')}

${t('emails.passwordReset.body4')}

${t('emails.passwordReset.body5')}
${t('emails.passwordReset.body6', { siteName: brand })}`,
      html: wrapTransactionalEmail({
        siteName: brand,
        headline: t('emails.passwordReset.headline'),
        bodyHtml,
        footerNote: '',
        logoHtml: siteLogoEmbed.html,
      }),
      attachments: siteLogoEmbed.attachments,
    };
  },

  /**
   * Bulk multi-select field update — one email listing all affected tasks for a recipient.
   */
  bulkTaskNotification: async (data) => {
    const {
      user,
      actorName,
      boardTitle,
      field,
      reason = null,
      tasks = [],
      changeBefore = '',
      changeAfter = '',
      summaryDetails = '',
      baseUrl = '',
      siteName,
      timestamp,
      recipientTimeZone = null,
      db,
      lang: langOverride,
    } = data;

    const { t } = await getEmailLangAndTranslator({
      user,
      db,
      lang: langOverride,
    });
    const firstName = displayFirstName(user);
    const count = tasks.length;
    const board = boardTitle || 'Board';
    const formattedTimestamp = formatDateTimeLocal(
      timestamp || new Date(),
      recipientTimeZone
    );

    const summaryKey =
      field === 'memberId'
        ? 'summaryAssignee'
        : field === 'requesterId'
          ? 'summaryRequester'
          : field === 'priorityId'
            ? 'summaryPriority'
            : field === 'sprintId'
              ? 'summarySprint'
              : field === 'columnId'
                ? (reason === 'archive' ? 'summaryArchive' : 'summaryColumnMove')
                : field === 'delete'
                  ? 'summaryDeleted'
                  : field === 'moveBoard'
                    ? 'summaryMoveBoard'
                    : field === 'collaborator'
                      ? 'summaryCollaborator'
                      : field === 'watcher'
                        ? 'summaryWatcher'
                        : field === 'tag'
                          ? 'summaryTag'
                          : field === 'copy'
                            ? 'summaryCopy'
                            : 'summaryDefault';
    const summary = t(`emails.bulkTaskNotification.${summaryKey}`);

    const fieldLabel =
      field === 'memberId'
        ? t('emails.taskNotification.common.fieldAssignee')
        : field === 'requesterId'
          ? t('emails.taskNotification.common.fieldRequester')
          : field === 'priorityId'
            ? t('emails.taskNotification.common.fieldPriority')
            : field === 'sprintId'
              ? t('emails.taskNotification.common.fieldSprint')
              : field === 'columnId'
                ? t('emails.bulkTaskNotification.fieldColumn')
                : field === 'tag'
                  ? t('emails.bulkTaskNotification.fieldTag')
                  : t('emails.bulkTaskNotification.whatChanged');

    const before =
      changeBefore || t('emails.taskNotification.common.unassigned');
    const after =
      changeAfter || t('emails.taskNotification.common.unassigned');
    const showFromTo = Boolean(changeBefore && changeAfter && changeBefore !== changeAfter);
    const showSetTo = Boolean(changeAfter) && !showFromTo;

    const changeHtml = showFromTo
      ? `<div style="margin: 14px 0; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 10px;">${escapeHtml(fieldLabel)}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
            <tr>
              <td style="padding: 8px 10px; background:#fef2f2; border-radius:4px; color:#7f1d1d; font-size:14px;">${escapeHtml(before)}</td>
              <td style="width:36px; text-align:center; color:#9ca3af; font-size:16px;">→</td>
              <td style="padding: 8px 10px; background:#f0fdf4; border-radius:4px; color:#14532d; font-size:14px; font-weight:600;">${escapeHtml(after)}</td>
            </tr>
          </table>
        </div>`
      : showSetTo
        ? `<div style="margin: 14px 0; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px;">
          <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 8px;">${escapeHtml(fieldLabel)}</div>
          <div style="font-size: 14px; color: #14532d;"><strong>${t('emails.bulkTaskNotification.setTo')}:</strong> ${escapeHtml(after)}</div>
        </div>`
        : '';

    const changeText = showFromTo
      ? `\n${fieldLabel}: ${before} → ${after}\n`
      : showSetTo
        ? `\n${fieldLabel}: ${t('emails.bulkTaskNotification.setTo')} ${after}\n`
        : '';

    const taskRowsHtml = tasks
      .map((task) => {
        const ticket = task.ticket || task.id;
        const url = buildTaskEmailUrl(baseUrl, {
          projectId: task.projectId,
          ticket,
          taskId: task.id,
        });
        return `<tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 12px; color: #4b5563; white-space: nowrap;">${escapeHtml(ticket)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827;">${escapeHtml(task.title || 'Task')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">
            <a href="${escapeHtml(url)}" style="color: #2563eb; font-size: 13px; text-decoration: none;">${t('emails.bulkTaskNotification.viewTask')}</a>
          </td>
        </tr>`;
      })
      .join('');

    const taskLinesText = tasks
      .map((task) => {
        const ticket = task.ticket || task.id;
        const url = buildTaskEmailUrl(baseUrl, {
          projectId: task.projectId,
          ticket,
          taskId: task.id,
        });
        return `- [${ticket}] ${task.title || 'Task'}\n  ${url}`;
      })
      .join('\n');

    const subject = t('emails.bulkTaskNotification.subject', {
      count,
      summary,
      boardTitle: board,
    });

    return {
      subject,
      text: `${t('emails.bulkTaskNotification.hi', { firstName })}

${t('emails.bulkTaskNotification.intro', {
  actorName: actorName || 'Someone',
  count,
  boardTitle: board,
})}
${summaryDetails ? `\n${summaryDetails}\n` : ''}${changeText}
${t('emails.bulkTaskNotification.tasksAffected')} (${count}):
${taskLinesText}

${formattedTimestamp}

${t('emails.bulkTaskNotification.receivingReason')}
${t('emails.bulkTaskNotification.teamSignature', { siteName: siteName || 'Agila' })}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #2563eb; margin: 0;">📋 ${t('emails.bulkTaskNotification.title')}</h1>
          </div>
          <h2 style="color: #374151; margin-top: 0;">${t('emails.bulkTaskNotification.hi', { firstName })}</h2>
          <p style="color: #374151; line-height: 1.5;">
            ${escapeHtml(
              t('emails.bulkTaskNotification.intro', {
                actorName: actorName || 'Someone',
                count,
                boardTitle: board,
              })
            )}
          </p>
          ${summaryDetails ? `<p style="color: #4b5563; font-size: 14px;"><strong>${t('emails.taskNotification.common.details')}</strong> ${escapeHtml(summaryDetails)}</p>` : ''}
          ${changeHtml}
          <div style="margin: 20px 0;">
            <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 8px;">
              ${t('emails.bulkTaskNotification.tasksAffected')} (${count})
            </div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
              ${taskRowsHtml}
            </table>
          </div>
          <p style="color: #6b7280; font-size: 13px;"><strong>${t('emails.taskNotification.common.timestamp')}</strong> ${escapeHtml(formattedTimestamp)}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            ${t('emails.bulkTaskNotification.receivingReason')}<br>
            <strong>${t('emails.bulkTaskNotification.teamSignature', { siteName: siteName || 'Agila' })}</strong>
          </p>
        </div>
      `,
    };
  },
};

export default EmailTemplates;
