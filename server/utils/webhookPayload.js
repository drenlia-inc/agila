import { getAppLanguage, getTranslatorForLanguage, normalizeLanguage } from './i18n.js';
import { wrapQuery } from './queryLogger.js';
import { buildTaskEmailUrl, stripHtmlForEmail } from './emailContent.js';
import { refreshTaskSnapshot, ensureTagEmailChange } from './taskEmailPayload.js';
import { formatDateTimeLocal } from './dateFormatter.js';

export async function resolveWebhookLocale(db, webhookLocale) {
  const explicit = normalizeLanguage(webhookLocale);
  if (explicit) return explicit;
  return getAppLanguage(db);
}

function displayPerson(person) {
  if (!person) return '';
  const composed = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
  return String(person.name || composed || person.email || '').trim();
}

function itemLabel(t, field) {
  if (field === 'memberId') return t('emails.taskNotification.common.fieldAssignee');
  if (field === 'requesterId') return t('emails.taskNotification.common.fieldRequester');
  if (field === 'priority') return t('emails.taskNotification.common.fieldPriority');
  if (field === 'sprint') return t('emails.taskNotification.common.fieldSprint');
  if (field === 'startDate' || field === 'dueDate' || field === 'endDate') {
    return t('emails.taskNotification.common.fieldDate');
  }
  if (field === 'title') return t('emails.webhooks.fieldTitle');
  if (field === 'columnId' || field === 'column') return t('emails.webhooks.fieldColumn');
  return field || '';
}

function plainChangeValue(value) {
  return stripHtmlForEmail(value).slice(0, 500);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Bold a status name using each chat platform's markup. */
export function formatWebhookBold(text, platform) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const p = String(platform || '').toLowerCase();
  if (p === 'slack' || p === 'whatsapp') return `*${raw}*`;
  if (p === 'telegram' || p === 'teams') return `<b>${escapeHtml(raw)}</b>`;
  // Mattermost (and generic incoming webhooks) use Markdown
  return `**${raw}**`;
}

function columnChangeItem(items) {
  return (items || []).find((i) => i && (i.field === 'columnId' || i.field === 'column')) || null;
}

function columnChangeName(item, queueRow) {
  const fromItem = plainChangeValue(item?.newName ?? item?.newValue ?? '');
  if (fromItem) return fromItem;
  return plainChangeValue(queueRow?.new_value || queueRow?.newValue || '');
}

export async function buildWebhookText({
  db,
  webhook,
  queueRow,
  commentContent = null,
  isTest = false,
}) {
  const lang = await resolveWebhookLocale(db, webhook?.locale);
  const t = getTranslatorForLanguage(lang);
  if (isTest) {
    return t('emails.webhooks.testText');
  }

  let task = {};
  let participants = {};
  let actor = {};
  try {
    task = JSON.parse(queueRow.task_data || '{}');
  } catch {
    task = {};
  }
  try {
    participants = JSON.parse(queueRow.participants_data || '{}');
  } catch {
    participants = {};
  }
  try {
    actor = JSON.parse(queueRow.actor_data || '{}');
  } catch {
    actor = {};
  }

  const eventKeyEarly = queueRow.notification_type || '';
  const refreshed =
    eventKeyEarly.startsWith('board') ? task : await refreshTaskSnapshot(db, task);
  const emailChange = await ensureTagEmailChange(
    db,
    queueRow.action,
    actor?.emailChange || null,
    queueRow.details,
    actor?.tagId || null
  );
  const platform = String(webhook?.platform || '').toLowerCase();
  const statusItem = columnChangeItem(emailChange?.items);
  const newStatusName = columnChangeName(statusItem, queueRow);
  const previousStatusName = plainChangeValue(
    statusItem?.oldName ?? statusItem?.oldValue ?? queueRow?.old_value ?? queueRow?.oldValue ?? ''
  );
  const isStatusChange = Boolean(
    eventKeyEarly === 'taskChanged' &&
      (statusItem || actor?.changedField === 'columnId' || queueRow.action === 'move_task') &&
      newStatusName &&
      previousStatusName !== newStatusName
  );
  const visibleItems = (emailChange?.items || []).filter(
    (i) =>
      i &&
      i.field !== 'effort' &&
      i.field !== 'generic' &&
      i.field !== 'description' &&
      !(isStatusChange && (i.field === 'columnId' || i.field === 'column'))
  );

  const appUrlSetting = await wrapQuery(
    db.prepare('SELECT value FROM settings WHERE key = ?'),
    'SELECT'
  ).get('APP_URL');
  let baseUrl = appUrlSetting?.value || process.env.BASE_URL || 'http://localhost:3000';
  baseUrl = baseUrl.replace(/\/$/, '');
  const eventKey = queueRow.notification_type || '';
  const ticket = refreshed.ticket || task.ticket || task.id || '';
  const title = refreshed.title || task.title || participants.boardTitle || '';
  const boardName = participants.boardTitle || '';
  const actorName = displayPerson(actor);
  const requesterName = displayPerson(participants.requester);
  const assigneeName = displayPerson(participants.assignee);
  const occurredAt =
    actor.occurredAt || queueRow.last_change_time || queueRow.created_at || new Date().toISOString();
  const taskUrl = buildTaskEmailUrl(baseUrl, {
    projectId: participants.projectId || task.projectId,
    ticket,
    taskId: task.id || queueRow.task_id,
  });

  const lines = [];
  const headingKey = `emails.webhooks.event.${eventKey}`;
  const heading = eventKey ? t(headingKey) : '';
  if (isStatusChange) {
    lines.push(
      t('emails.webhooks.newTaskStatus', {
        status: formatWebhookBold(newStatusName, platform),
      })
    );
  } else if (heading && heading !== headingKey) {
    lines.push(heading);
  }
  if (eventKey.startsWith('board')) {
    const boardId = participants.boardId || task.id || queueRow.task_id || '';
    if (title) lines.push(`${t('emails.webhooks.fieldTitle')}: ${title}`);
    if (boardId) lines.push(`${t('emails.webhooks.fieldId')}: ${boardId}`);
    if (participants.projectId) {
      lines.push(`${t('emails.webhooks.fieldProject')}: ${participants.projectId}`);
    }
    if (actor.oldTitle && eventKey === 'boardRenamed') {
      lines.push(`${t('emails.webhooks.fieldPreviousTitle')}: ${actor.oldTitle}`);
    }
  } else {
    if (title) lines.push(`${t('emails.webhooks.fieldTitle')}: ${title}`);
    if (ticket) lines.push(`${t('emails.webhooks.fieldId')}: ${ticket}`);
    if (boardName) {
      lines.push(`${t('emails.taskNotification.common.board')} ${boardName}`);
    }
  }
  if (actorName) {
    lines.push(`${t('emails.webhooks.fieldActor')}: ${actorName}`);
  }
  if (requesterName && !eventKey.startsWith('board')) {
    lines.push(`${t('emails.webhooks.fieldRequester')}: ${requesterName}`);
  }
  if (assigneeName && !eventKey.startsWith('board')) {
    lines.push(`${t('emails.webhooks.fieldAssignee')}: ${assigneeName}`);
  }
  if (occurredAt) {
    const formatted = formatDateTimeLocal(occurredAt) || String(occurredAt);
    lines.push(`${t('emails.webhooks.fieldOccurredAt')}: ${formatted}`);
  }
  if (commentContent) {
    lines.push(
      t('emails.webhooks.commentLine', { text: plainChangeValue(commentContent) })
    );
  }
  for (const item of visibleItems) {
    const label = itemLabel(t, item.field);
    const from = plainChangeValue(item.oldName ?? item.oldValue ?? '');
    const to = plainChangeValue(item.newName ?? item.newValue ?? '');
    if (item.field === 'title') {
      if (to || from) lines.push(`${label}: ${to || from}`);
    } else if (from || to) {
      lines.push(
        `${label}: ${t('emails.taskNotification.common.fromTo', { from: from || '—', to: to || '—' })}`
      );
    }
  }
  if (taskUrl && !eventKey.startsWith('board')) lines.push(taskUrl);
  const joined = lines.filter(Boolean);
  if (platform !== 'telegram') return joined.join('\n');
  return joined
    .map((line) => (line.includes('<b>') ? line : escapeHtml(line)))
    .join('\n');
}
