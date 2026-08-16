/**
 * Shared helpers for task-change emails: silent fields, live snapshot, structured details.
 */

import { tasks as taskQueries } from './sqlManager/index.js';
import { wrapQuery } from './queryLogger.js';

export const PLACEHOLDER_TITLES = new Set([
  'new task',
  'nouvelle tâche',
  'nouvelle tache',
]);

export function isPlaceholderTitle(title) {
  return PLACEHOLDER_TITLES.has(String(title || '').trim().toLowerCase());
}

export function isSilentEmailField(field) {
  return field === 'effort';
}

export function contrastTextForHex(hex) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length < 6) return '#ffffff';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#374151' : '#ffffff';
}

export function priorityBadgeStyle(hex) {
  const color = String(hex || '#6b7280');
  const raw = color.replace('#', '');
  let bg = 'rgba(107, 114, 128, 0.12)';
  if (raw.length >= 6) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    bg = `rgba(${r}, ${g}, ${b}, 0.12)`;
  }
  return { backgroundColor: bg, color };
}

export function mergeEmailChange(prev, next) {
  const a = prev?.items || [];
  const b = next?.items || [];
  const byField = new Map();
  for (const item of [...a, ...b]) {
    if (!item?.field || isSilentEmailField(item.field)) continue;
    if (item.field === 'generic') {
      if (!byField.has('generic')) byField.set('generic', item);
      continue;
    }
    if (item.field === 'tags') {
      const existing = byField.get('tags') || { field: 'tags', added: [], removed: [] };
      existing.added = [...(existing.added || []), ...(item.added || [])];
      existing.removed = [...(existing.removed || []), ...(item.removed || [])];
      byField.set('tags', existing);
      continue;
    }
    const existing = byField.get(item.field);
    if (existing) {
      byField.set(item.field, {
        ...item,
        oldValue: existing.oldValue ?? existing.oldName ?? item.oldValue,
        oldName: existing.oldName ?? existing.oldValue ?? item.oldName,
        oldColor: existing.oldColor ?? item.oldColor,
        newValue: item.newValue ?? item.newName ?? existing.newValue,
        newName: item.newName ?? item.newValue ?? existing.newName,
        newColor: item.newColor ?? existing.newColor,
      });
    } else {
      byField.set(item.field, item);
    }
  }
  if (byField.size > 1) byField.delete('generic');
  const items = [...byField.values()];
  if (items.some((i) => i.field === 'sprintId')) {
    const filtered = items.filter((i) => i.field !== 'dueDate');
    return {
      items: filtered,
      newAssigneeUserId: next?.newAssigneeUserId || prev?.newAssigneeUserId || null,
    };
  }
  return {
    items,
    newAssigneeUserId: next?.newAssigneeUserId || prev?.newAssigneeUserId || null,
  };
}

export function mergeEmailChangesFromActors(actors) {
  return actors.reduce((acc, actor) => mergeEmailChange(acc, actor?.emailChange), {
    items: [],
    newAssigneeUserId: null,
  });
}

export function emailChangeIsSilent(emailChange) {
  const items = (emailChange?.items || []).filter((i) => !isSilentEmailField(i.field));
  return items.length === 0;
}

function firstQuotedName(text) {
  let source = text;
  if (source && typeof source === 'object') {
    source = source.fr || source.en || '';
  } else if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      if (parsed && typeof parsed === 'object') {
        source = parsed.fr || parsed.en || source;
      }
    } catch {
      /* plain string */
    }
  }
  const match = String(source || '').match(/"([^"]+)"/);
  return match?.[1]?.trim() || '';
}

async function lookupTagColor(db, name) {
  if (!db || !name) return '#4F46E5';
  try {
    const row = await wrapQuery(
      db.prepare('SELECT color FROM tags WHERE tag = ?'),
      'SELECT'
    ).get(name);
    return row?.color || '#4F46E5';
  } catch {
    return '#4F46E5';
  }
}

/**
 * Ensure associate/disassociate emails carry chip data (name + board color).
 */
export async function ensureTagEmailChange(db, action, emailChange, details, tagId = null) {
  if (action !== 'associate_tag' && action !== 'disassociate_tag') {
    return emailChange;
  }

  let items = [...(emailChange?.items || [])];
  let tagItem = items.find((i) => i.field === 'tags');
  if (!tagItem) {
    let name = '';
    let color = '#4F46E5';
    if (tagId && db) {
      try {
        const row = await wrapQuery(
          db.prepare('SELECT tag, color FROM tags WHERE id = ?'),
          'SELECT'
        ).get(tagId);
        if (row) {
          name = row.tag;
          color = row.color || color;
        }
      } catch {
        /* fall through */
      }
    }
    if (!name) name = firstQuotedName(details);
    if (name && color === '#4F46E5') color = await lookupTagColor(db, name);
    const chip = { name, color };
    tagItem = {
      field: 'tags',
      added: action === 'associate_tag' && name ? [chip] : [],
      removed: action === 'disassociate_tag' && name ? [chip] : [],
    };
    items = [tagItem, ...items.filter((i) => i.field !== 'generic')];
  } else {
    const fill = async (chips) =>
      Promise.all(
        (chips || []).map(async (chip) => {
          if (!chip?.name) return chip;
          if (chip.color) return chip;
          return { ...chip, color: await lookupTagColor(db, chip.name) };
        })
      );
    tagItem = {
      ...tagItem,
      added: await fill(tagItem.added),
      removed: await fill(tagItem.removed),
    };
    items = items.map((i) => (i.field === 'tags' ? tagItem : i));
  }

  return {
    ...(emailChange || {}),
    items,
  };
}

export function isRecentlyCreatedTask(task, firstChangeTime, windowMs = 15 * 60 * 1000) {
  const createdRaw = task?.created_at || task?.createdAt;
  if (!createdRaw || !firstChangeTime) return false;
  const created = new Date(createdRaw).getTime();
  const first = new Date(firstChangeTime).getTime();
  if (Number.isNaN(created) || Number.isNaN(first)) return false;
  return first - created >= 0 && first - created < windowMs;
}

export function shouldUseWordDiff(before, after, field) {
  if (field === 'description' || field === 'title') return true;
  const a = String(before || '');
  const b = String(after || '');
  if (a.includes('\n') || b.includes('\n')) return true;
  const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  if (words(a) > 6 || words(b) > 6) return true;
  if (a.length >= 50 || b.length >= 50) return true;
  return false;
}

/**
 * Overlay live DB title/description/ticket so delayed emails don't ship "New Task".
 */
export async function refreshTaskSnapshot(db, task) {
  if (!db || !task?.id) return task;
  try {
    const live = await taskQueries.getTaskById(db, task.id);
    if (!live) return task;
    const liveTitle = live.title || task.title;
    const liveDescription =
      live.description !== undefined && live.description !== null
        ? live.description
        : task.description;
    return {
      ...task,
      title: liveTitle,
      description: liveDescription,
      ticket: live.ticket || task.ticket,
      created_at: live.created_at || live.createdAt || task.created_at || task.createdAt,
      createdAt: live.created_at || live.createdAt || task.createdAt || task.created_at,
      memberId: live.memberid || live.memberId || task.memberId,
      requesterId: live.requesterid || live.requesterId || task.requesterId,
    };
  } catch (err) {
    console.warn('Failed to refresh task snapshot for email:', err.message);
    return task;
  }
}

export async function loadPriorityVisual(db, priorityId) {
  if (!db || priorityId == null || priorityId === '') return null;
  try {
    const row = await wrapQuery(
      db.prepare('SELECT priority, color FROM priorities WHERE id = ?'),
      'SELECT'
    ).get(priorityId);
    if (!row) return null;
    return { name: row.priority, color: row.color };
  } catch {
    return null;
  }
}
